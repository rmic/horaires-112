import { AssignmentLane } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  buildPlanningPlacementPlan,
  type PlanningLane,
  type PlanningPlacementResolution,
} from "@/lib/planning-lanes";
import { validateVolunteerAssignmentAgainstContext } from "@/lib/server/assignment-rules";
import { logAssignmentEvent } from "@/lib/server/events";

export async function placeVolunteerOnPlanningLane(params: {
  planningMonthId: string;
  volunteerId: string;
  lane: PlanningLane;
  startTime: Date;
  endTime: Date;
  ignoreRestWarning?: boolean;
  resolutions?: PlanningPlacementResolution[];
}) {
  const month = await prisma.planningMonth.findUnique({
    where: {
      id: params.planningMonthId,
    },
    include: {
      assignments: {
        include: {
          volunteer: true,
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
  });

  if (!month) {
    throw new ApiError(404, "Mois introuvable.");
  }

  const volunteer = await prisma.volunteer.findUnique({
    where: {
      id: params.volunteerId,
    },
    include: {
      monthSettings: {
        where: {
          planningMonthId: params.planningMonthId,
        },
        take: 1,
      },
      availabilities: {
        where: {
          planningMonthId: params.planningMonthId,
          status: "APPROVED",
        },
      },
      assignments: {
        where: {
          planningMonthId: params.planningMonthId,
        },
      },
    },
  });

  if (!volunteer) {
    throw new ApiError(404, "Volontaire introuvable.");
  }

  const plan = buildPlanningPlacementPlan({
    assignments: month.assignments.map((assignment) => ({
      id: assignment.id,
      volunteerId: assignment.volunteerId,
      volunteerName: assignment.volunteer.name,
      volunteerColor: assignment.volunteer.color,
      startTime: assignment.startTime.toISOString(),
      endTime: assignment.endTime.toISOString(),
      lane: assignment.lane as PlanningLane | null,
      status: assignment.status,
      source: assignment.source,
    })),
    lane: params.lane,
    volunteerId: volunteer.id,
    volunteerName: volunteer.name,
    volunteerColor: volunteer.color,
    startTime: params.startTime.toISOString(),
    endTime: params.endTime.toISOString(),
    resolutions: params.resolutions,
  });

  if (plan.missingResolutionIds.length > 0) {
    throw new ApiError(409, "Des conflits d'affectation doivent être arbitrés.", {
      conflicts: plan.conflicts,
    });
  }

  const finalVolunteerAssignments = plan.previewAssignments
    .filter((assignment) => assignment.volunteerId === volunteer.id)
    .map((assignment) => ({
      id: assignment.id,
      volunteerId: assignment.volunteerId,
      startTime: new Date(assignment.startTime),
      endTime: new Date(assignment.endTime),
    }));

  for (const mutation of plan.mutations) {
    if (mutation.kind !== "create" || mutation.volunteerId !== volunteer.id || mutation.originAssignmentId) {
      continue;
    }

    validateVolunteerAssignmentAgainstContext({
      month: {
        id: month.id,
        startsAt: month.startsAt,
        endsAt: month.endsAt,
      },
      volunteer: {
        id: volunteer.id,
        name: volunteer.name,
        maxGuardsPerMonth: volunteer.monthSettings[0]?.maxGuardsPerMonth ?? null,
        availabilities: volunteer.availabilities.map((availability) => ({
          startTime: availability.startTime,
          endTime: availability.endTime,
        })),
        assignments: finalVolunteerAssignments,
      },
      startTime: new Date(mutation.startTime),
      endTime: new Date(mutation.endTime),
      ignoreRestWarning: params.ignoreRestWarning,
      excludeAssignmentId: mutation.tempId,
    });
  }

  const createdEvents: Array<{
    planningMonthId: string;
    assignmentId: string;
    volunteerId: string;
    startTime: string;
    endTime: string;
    lane: AssignmentLane;
    status: string;
    source: string | null;
    originAssignmentId?: string;
  }> = [];
  const updatedEvents: Array<{
    planningMonthId: string;
    assignmentId: string;
    before: {
      volunteerId: string;
      startTime: string;
      endTime: string;
      lane: AssignmentLane | null;
      status: string;
    };
    after: {
      volunteerId: string;
      startTime: string;
      endTime: string;
      lane: AssignmentLane;
      status: string;
    };
  }> = [];
  const deletedEvents: Array<{
    planningMonthId: string;
    assignmentId: string;
    volunteerId: string;
    startTime: string;
    endTime: string;
    lane: AssignmentLane | null;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const mutation of plan.mutations) {
      if (mutation.kind === "delete") {
        const existing = await tx.assignment.findUnique({
          where: {
            id: mutation.assignmentId,
          },
        });

        if (!existing) {
          continue;
        }

        await tx.assignment.delete({
          where: {
            id: mutation.assignmentId,
          },
        });

        deletedEvents.push({
          planningMonthId: existing.planningMonthId,
          assignmentId: existing.id,
          volunteerId: existing.volunteerId,
          startTime: existing.startTime.toISOString(),
          endTime: existing.endTime.toISOString(),
          lane: existing.lane,
        });
        continue;
      }

      if (mutation.kind === "update") {
        const existing = await tx.assignment.findUnique({
          where: {
            id: mutation.assignmentId,
          },
        });

        if (!existing) {
          continue;
        }

        const updated = await tx.assignment.update({
          where: {
            id: mutation.assignmentId,
          },
          data: {
            startTime: new Date(mutation.startTime),
            endTime: new Date(mutation.endTime),
            lane: mutation.lane,
          },
        });

        updatedEvents.push({
          planningMonthId: updated.planningMonthId,
          assignmentId: updated.id,
          before: {
            volunteerId: existing.volunteerId,
            startTime: existing.startTime.toISOString(),
            endTime: existing.endTime.toISOString(),
            lane: existing.lane,
            status: existing.status,
          },
          after: {
            volunteerId: updated.volunteerId,
            startTime: updated.startTime.toISOString(),
            endTime: updated.endTime.toISOString(),
            lane: updated.lane ?? mutation.lane,
            status: updated.status,
          },
        });
        continue;
      }

      const created = await tx.assignment.create({
        data: {
          planningMonthId: params.planningMonthId,
          volunteerId: mutation.volunteerId,
          startTime: new Date(mutation.startTime),
          endTime: new Date(mutation.endTime),
          lane: mutation.lane,
          status: mutation.status,
          source: mutation.source ?? "MANUAL",
        },
      });

      createdEvents.push({
        planningMonthId: created.planningMonthId,
        assignmentId: created.id,
        volunteerId: created.volunteerId,
        startTime: created.startTime.toISOString(),
        endTime: created.endTime.toISOString(),
        lane: created.lane ?? mutation.lane,
        status: created.status,
        source: created.source,
        originAssignmentId: mutation.originAssignmentId,
      });
    }
  });

  for (const event of createdEvents) {
    await logAssignmentEvent({
      planningMonthId: event.planningMonthId,
      assignmentId: event.assignmentId,
      eventType: "CREATED",
      payload: {
        volunteerId: event.volunteerId,
        startTime: event.startTime,
        endTime: event.endTime,
        lane: event.lane,
        status: event.status,
        source: event.source,
        originAssignmentId: event.originAssignmentId,
      },
    });
  }

  for (const event of updatedEvents) {
    await logAssignmentEvent({
      planningMonthId: event.planningMonthId,
      assignmentId: event.assignmentId,
      eventType: "UPDATED",
      payload: {
        before: event.before,
        after: event.after,
      },
    });
  }

  for (const event of deletedEvents) {
    await logAssignmentEvent({
      planningMonthId: event.planningMonthId,
      assignmentId: null,
      eventType: "DELETED",
      payload: {
        deletedAssignmentId: event.assignmentId,
        volunteerId: event.volunteerId,
        startTime: event.startTime,
        endTime: event.endTime,
        lane: event.lane,
      },
    });
  }

  return {
    conflicts: plan.conflicts,
    mutations: plan.mutations,
  };
}
