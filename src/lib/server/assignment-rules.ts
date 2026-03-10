import { addHours, isAfter, isBefore } from "date-fns";
import { AvailabilityStatus } from "@prisma/client";
import { ApiError } from "@/lib/api";
import {
  getRestWarning,
  guardCount,
  hasOverlap,
  intervalContainedIn,
  projectedGuardCount,
  validateVolunteerShift,
} from "@/lib/constraints";
import { prisma } from "@/lib/prisma";
import { getPlanningMonthWindow } from "@/lib/time";

export type AssignmentValidationMonthContext = {
  id?: string;
  startsAt: Date;
  endsAt: Date;
};

export type AssignmentValidationVolunteerContext = {
  id: string;
  name: string;
  maxGuardsPerMonth: number | null;
  availabilities: Array<{
    startTime: Date;
    endTime: Date;
  }>;
  assignments: Array<{
    id: string;
    volunteerId: string;
    startTime: Date;
    endTime: Date;
  }>;
};

export function validateVolunteerAssignmentAgainstContext(params: {
  month: AssignmentValidationMonthContext;
  volunteer: AssignmentValidationVolunteerContext;
  startTime: Date;
  endTime: Date;
  ignoreRestWarning?: boolean;
  excludeAssignmentId?: string;
}) {
  const window = getPlanningMonthWindow(params.month);
  const message = validateVolunteerShift(params.startTime, params.endTime);
  if (message) {
    throw new ApiError(400, message);
  }

  if (isBefore(params.startTime, window.coverageStart) || isAfter(params.endTime, window.coverageEnd)) {
    throw new ApiError(400, "La garde doit rester dans le mois sélectionné.");
  }

  const interval = {
    startTime: params.startTime,
    endTime: params.endTime,
  };

  if (!intervalContainedIn(interval, params.volunteer.availabilities)) {
    throw new ApiError(
      400,
      "Cette garde dépasse la disponibilité du volontaire. Modifiez la disponibilité avant l'affectation.",
    );
  }

  const relevantAssignments = params.volunteer.assignments.filter(
    (assignment) => assignment.id !== params.excludeAssignmentId,
  );

  if (hasOverlap(interval, relevantAssignments)) {
    throw new ApiError(400, "Le volontaire a déjà une garde sur cet intervalle.");
  }

  const currentGuards = guardCount(
    relevantAssignments.map((assignment) => ({
      id: assignment.id,
      volunteerId: assignment.volunteerId,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
    })),
    params.volunteer.id,
  );
  const projectedGuards = projectedGuardCount(
    interval,
    relevantAssignments.map((assignment) => ({
      startTime: assignment.startTime,
      endTime: assignment.endTime,
    })),
  );

  if (
    params.volunteer.maxGuardsPerMonth !== null &&
    projectedGuards > params.volunteer.maxGuardsPerMonth
  ) {
    throw new ApiError(
      400,
      `Limite mensuelle atteinte (${currentGuards}/${params.volunteer.maxGuardsPerMonth} gardes pour ${params.volunteer.name} sur ce mois).`,
    );
  }

  const warning = getRestWarning(interval, relevantAssignments.map((assignment) => assignment), 11);
  if (warning && !params.ignoreRestWarning) {
    throw new ApiError(409, warning, {
      type: "REST_WARNING",
    });
  }

  const aligned = params.startTime.getMinutes() === 0 && params.endTime.getMinutes() === 0;
  if (!aligned) {
    throw new ApiError(400, "Les gardes doivent commencer et finir à une heure pleine.");
  }

  const expectedMin = addHours(params.startTime, 1);
  if (isAfter(expectedMin, params.endTime)) {
    throw new ApiError(400, "La garde doit durer au moins 1 heure.");
  }

  return { warning };
}

export async function validateVolunteerAssignment(params: {
  planningMonthId: string;
  volunteerId: string;
  startTime: Date;
  endTime: Date;
  lane?: "A1" | "A2" | "A3" | null;
  ignoreRestWarning?: boolean;
  excludeAssignmentId?: string;
}) {
  const month = await prisma.planningMonth.findUnique({
    where: {
      id: params.planningMonthId,
    },
  });

  if (!month) {
    throw new ApiError(404, "Mois de planning introuvable.");
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
          status: AvailabilityStatus.APPROVED,
        },
      },
      assignments: {
        where: {
          planningMonthId: params.planningMonthId,
          ...(params.excludeAssignmentId
            ? {
                id: {
                  not: params.excludeAssignmentId,
                },
              }
            : {}),
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
  });

  if (!volunteer) {
    throw new ApiError(404, "Volontaire introuvable.");
  }

  if (params.lane) {
    const overlappingLaneAssignment = await prisma.assignment.findFirst({
      where: {
        planningMonthId: params.planningMonthId,
        lane: params.lane,
        ...(params.excludeAssignmentId
          ? {
              id: {
                not: params.excludeAssignmentId,
              },
            }
          : {}),
        startTime: {
          lt: params.endTime,
        },
        endTime: {
          gt: params.startTime,
        },
      },
    });

    if (overlappingLaneAssignment) {
      throw new ApiError(400, `Le rôle ${params.lane} est déjà occupé sur cet intervalle.`);
    }
  }

  const warning = validateVolunteerAssignmentAgainstContext({
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
      assignments: volunteer.assignments.map((assignment) => ({
        id: assignment.id,
        volunteerId: assignment.volunteerId,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      })),
    },
    startTime: params.startTime,
    endTime: params.endTime,
    ignoreRestWarning: params.ignoreRestWarning,
    excludeAssignmentId: params.excludeAssignmentId,
  }).warning;

  return { volunteer, month, warning };
}
