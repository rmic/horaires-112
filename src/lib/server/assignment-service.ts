import { AssignmentLane, AssignmentSource, AssignmentStatus } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { validateVolunteerAssignment } from "@/lib/server/assignment-rules";
import { logAssignmentEvent } from "@/lib/server/events";

export async function listAssignments(planningMonthId: string) {
  return prisma.assignment.findMany({
    where: {
      planningMonthId,
    },
    include: {
      volunteer: true,
    },
    orderBy: {
      startTime: "asc",
    },
  });
}

export async function getAssignmentOrThrow(assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: {
      id: assignmentId,
    },
    include: {
      volunteer: true,
      planningMonth: true,
    },
  });

  if (!assignment) {
    throw new ApiError(404, "Garde introuvable.");
  }

  return assignment;
}

export async function createAssignments(params: {
  planningMonthId: string;
  volunteerIds: string[];
  startTime: Date;
  endTime: Date;
  lane?: AssignmentLane | null;
  status?: AssignmentStatus;
  source?: AssignmentSource;
  ignoreRestWarning?: boolean;
}) {
  if (params.volunteerIds.length === 0) {
    throw new ApiError(400, "Au moins un volontaire est requis.");
  }

  if (new Set(params.volunteerIds).size !== params.volunteerIds.length) {
    throw new ApiError(400, "Sélectionnez deux volontaires différents pour une garde en binôme.");
  }

  if (params.lane && params.volunteerIds.length !== 1) {
    throw new ApiError(400, "Une affectation sur une lane doit concerner un seul volontaire.");
  }

  for (const volunteerId of params.volunteerIds) {
    await validateVolunteerAssignment({
      planningMonthId: params.planningMonthId,
      volunteerId,
      startTime: params.startTime,
      endTime: params.endTime,
      lane: params.lane ?? null,
      ignoreRestWarning: params.ignoreRestWarning,
    });
  }

  const assignments = await prisma.$transaction(async (tx) => {
    const created = [] as Awaited<ReturnType<typeof tx.assignment.create>>[];

    for (const volunteerId of params.volunteerIds) {
      const assignment = await tx.assignment.create({
        data: {
          planningMonthId: params.planningMonthId,
          volunteerId,
          startTime: params.startTime,
          endTime: params.endTime,
          lane: params.lane ?? null,
          status: params.status ?? AssignmentStatus.CONFIRMED,
          source: params.source ?? AssignmentSource.MANUAL,
        },
        include: {
          volunteer: true,
        },
      });

      created.push(assignment);
    }

    return created;
  });

  for (const assignment of assignments) {
    await logAssignmentEvent({
      planningMonthId: assignment.planningMonthId,
      assignmentId: assignment.id,
      eventType: "CREATED",
      payload: {
        volunteerId: assignment.volunteerId,
        startTime: assignment.startTime.toISOString(),
        endTime: assignment.endTime.toISOString(),
        lane: assignment.lane,
        status: assignment.status,
        source: assignment.source,
      },
    });
  }

  return assignments;
}

export async function updateAssignment(
  assignmentId: string,
  params: {
    volunteerId: string;
    startTime: Date;
    endTime: Date;
    lane?: AssignmentLane | null;
    status: AssignmentStatus;
    ignoreRestWarning?: boolean;
  },
) {
  const existing = await getAssignmentOrThrow(assignmentId);

  await validateVolunteerAssignment({
    planningMonthId: existing.planningMonthId,
    volunteerId: params.volunteerId,
    startTime: params.startTime,
    endTime: params.endTime,
    lane: params.lane ?? existing.lane,
    ignoreRestWarning: params.ignoreRestWarning,
    excludeAssignmentId: existing.id,
  });

  const assignment = await prisma.assignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      volunteerId: params.volunteerId,
      startTime: params.startTime,
      endTime: params.endTime,
      lane: params.lane ?? existing.lane,
      status: params.status,
    },
    include: {
      volunteer: true,
    },
  });

  await logAssignmentEvent({
    planningMonthId: existing.planningMonthId,
    assignmentId: assignment.id,
    eventType: "UPDATED",
    payload: {
      before: {
        volunteerId: existing.volunteerId,
        startTime: existing.startTime.toISOString(),
        endTime: existing.endTime.toISOString(),
        lane: existing.lane,
        status: existing.status,
      },
      after: {
        volunteerId: assignment.volunteerId,
        startTime: assignment.startTime.toISOString(),
        endTime: assignment.endTime.toISOString(),
        lane: assignment.lane,
        status: assignment.status,
      },
    },
  });

  return assignment;
}

export async function deleteAssignment(assignmentId: string) {
  const existing = await getAssignmentOrThrow(assignmentId);

  await prisma.assignment.delete({
    where: {
      id: assignmentId,
    },
  });

  await logAssignmentEvent({
    planningMonthId: existing.planningMonthId,
    assignmentId: null,
    eventType: "DELETED",
    payload: {
      deletedAssignmentId: existing.id,
      volunteerId: existing.volunteerId,
      startTime: existing.startTime.toISOString(),
      endTime: existing.endTime.toISOString(),
      lane: existing.lane,
    },
  });
}
