import { AvailabilityStatus, AvailabilityDraftStatus, Prisma } from "@prisma/client";
import { isBefore } from "date-fns";
import { ApiError } from "@/lib/api";
import { intervalContainedIn } from "@/lib/constraints";
import { prisma } from "@/lib/prisma";

export type AvailabilityIntervalInput = {
  startTime: Date;
  endTime: Date;
};

async function getPlanningMonthOrThrow(planningMonthId: string) {
  const month = await prisma.planningMonth.findUnique({
    where: { id: planningMonthId },
  });

  if (!month) {
    throw new ApiError(404, "Mois introuvable.");
  }

  return month;
}

async function getVolunteerOrThrow(volunteerId: string) {
  const volunteer = await prisma.volunteer.findUnique({
    where: { id: volunteerId },
  });

  if (!volunteer) {
    throw new ApiError(404, "Volontaire introuvable.");
  }

  return volunteer;
}

function validateAvailabilityInterval(month: { startsAt: Date; endsAt: Date }, interval: AvailabilityIntervalInput) {
  if (!isBefore(interval.startTime, interval.endTime)) {
    throw new ApiError(400, "La fin doit être après le début.");
  }

  if (interval.startTime.getMinutes() !== 0 || interval.endTime.getMinutes() !== 0) {
    throw new ApiError(400, "La disponibilité doit être alignée sur l'heure.");
  }

  if (isBefore(interval.startTime, month.startsAt) || isBefore(month.endsAt, interval.endTime)) {
    throw new ApiError(400, "La disponibilité doit rester dans le mois.");
  }
}

async function ensureVolunteerAssignmentsStillCovered(params: {
  volunteerId: string;
  planningMonthId: string;
  replacementIntervals: AvailabilityIntervalInput[];
}) {
  const assignments = await prisma.assignment.findMany({
    where: {
      volunteerId: params.volunteerId,
      planningMonthId: params.planningMonthId,
    },
    orderBy: {
      startTime: "asc",
    },
  });

  for (const assignment of assignments) {
    const covered = intervalContainedIn(
      {
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      },
      params.replacementIntervals,
    );

    if (!covered) {
      throw new ApiError(
        409,
        "Cette modification rendrait une garde invalide. Étendez d'abord la disponibilité concernée.",
      );
    }
  }
}

export async function listAvailabilities(params: {
  planningMonthId?: string;
  volunteerId?: string;
  startTime?: Date;
  endTime?: Date;
  statuses?: AvailabilityStatus[];
}) {
  const statuses = params.statuses?.length ? params.statuses : [AvailabilityStatus.APPROVED];

  return prisma.availability.findMany({
    where: {
      ...(params.planningMonthId ? { planningMonthId: params.planningMonthId } : {}),
      ...(params.volunteerId ? { volunteerId: params.volunteerId } : {}),
      ...(params.startTime && params.endTime
        ? {
            startTime: { lt: params.endTime },
            endTime: { gt: params.startTime },
          }
        : {}),
      status: {
        in: statuses,
      },
    },
    include: {
      volunteer: true,
      planningMonth: true,
    },
    orderBy: {
      startTime: "asc",
    },
  });
}

export async function createAvailability(params: {
  planningMonthId: string;
  volunteerId: string;
  startTime: Date;
  endTime: Date;
  status?: AvailabilityStatus;
  reviewComment?: string | null;
}) {
  const month = await getPlanningMonthOrThrow(params.planningMonthId);
  await getVolunteerOrThrow(params.volunteerId);

  validateAvailabilityInterval(month, params);

  return prisma.availability.create({
    data: {
      planningMonthId: params.planningMonthId,
      volunteerId: params.volunteerId,
      startTime: params.startTime,
      endTime: params.endTime,
      status: params.status ?? AvailabilityStatus.APPROVED,
      reviewComment: params.reviewComment ?? null,
    },
    include: {
      volunteer: true,
      planningMonth: true,
    },
  });
}

export async function updateAvailability(availabilityId: string, params: AvailabilityIntervalInput) {
  const availability = await prisma.availability.findUnique({
    where: { id: availabilityId },
  });

  if (!availability) {
    throw new ApiError(404, "Disponibilité introuvable.");
  }

  const month = await getPlanningMonthOrThrow(availability.planningMonthId);
  validateAvailabilityInterval(month, params);

  const others = await prisma.availability.findMany({
    where: {
      volunteerId: availability.volunteerId,
      planningMonthId: availability.planningMonthId,
      id: {
        not: availability.id,
      },
      status: {
        in: [AvailabilityStatus.APPROVED, AvailabilityStatus.PENDING],
      },
    },
  });

  await ensureVolunteerAssignmentsStillCovered({
    volunteerId: availability.volunteerId,
    planningMonthId: availability.planningMonthId,
    replacementIntervals: [
      ...others.map((item) => ({
        startTime: item.startTime,
        endTime: item.endTime,
      })),
      params,
    ],
  });

  return prisma.availability.update({
    where: { id: availabilityId },
    data: {
      startTime: params.startTime,
      endTime: params.endTime,
    },
    include: {
      volunteer: true,
      planningMonth: true,
    },
  });
}

export async function deleteAvailability(availabilityId: string) {
  const availability = await prisma.availability.findUnique({
    where: { id: availabilityId },
  });

  if (!availability) {
    throw new ApiError(404, "Disponibilité introuvable.");
  }

  const others = await prisma.availability.findMany({
    where: {
      volunteerId: availability.volunteerId,
      planningMonthId: availability.planningMonthId,
      id: {
        not: availability.id,
      },
      status: {
        in: [AvailabilityStatus.APPROVED, AvailabilityStatus.PENDING],
      },
    },
  });

  await ensureVolunteerAssignmentsStillCovered({
    volunteerId: availability.volunteerId,
    planningMonthId: availability.planningMonthId,
    replacementIntervals: others.map((item) => ({
      startTime: item.startTime,
      endTime: item.endTime,
    })),
  });

  await prisma.availability.delete({
    where: { id: availabilityId },
  });
}

async function getAvailabilityDraftOrThrow(availabilityDraftId: string) {
  const draft = await prisma.availabilityDraft.findUnique({
    where: { id: availabilityDraftId },
    include: {
      volunteer: true,
      planningMonth: true,
      createdByUser: true,
      committedAvailability: true,
    },
  });

  if (!draft) {
    throw new ApiError(404, "Brouillon de disponibilité introuvable.");
  }

  return draft;
}

function assertAvailabilityDraftMutable(status: AvailabilityDraftStatus) {
  if (status === AvailabilityDraftStatus.COMMITTED) {
    throw new ApiError(409, "Ce brouillon a déjà été committé.");
  }

  if (status === AvailabilityDraftStatus.CANCELLED) {
    throw new ApiError(409, "Ce brouillon a été annulé.");
  }
}

export async function createAvailabilityDraft(params: {
  planningMonthId: string;
  volunteerId: string;
  startTime: Date;
  endTime: Date;
  createdByUserId: string;
  sourceNote?: string | null;
}) {
  const month = await getPlanningMonthOrThrow(params.planningMonthId);
  await getVolunteerOrThrow(params.volunteerId);
  validateAvailabilityInterval(month, params);

  return prisma.availabilityDraft.create({
    data: {
      planningMonthId: params.planningMonthId,
      volunteerId: params.volunteerId,
      startTime: params.startTime,
      endTime: params.endTime,
      createdByUserId: params.createdByUserId,
      sourceNote: params.sourceNote ?? null,
    },
    include: {
      volunteer: true,
      planningMonth: true,
      createdByUser: true,
    },
  });
}

export async function updateAvailabilityDraft(
  availabilityDraftId: string,
  params: Partial<AvailabilityIntervalInput> & {
    volunteerId?: string;
    sourceNote?: string | null;
  },
) {
  const existing = await getAvailabilityDraftOrThrow(availabilityDraftId);
  assertAvailabilityDraftMutable(existing.status);

  const volunteerId = params.volunteerId ?? existing.volunteerId;
  await getVolunteerOrThrow(volunteerId);

  const startTime = params.startTime ?? existing.startTime;
  const endTime = params.endTime ?? existing.endTime;
  validateAvailabilityInterval(existing.planningMonth, { startTime, endTime });

  return prisma.availabilityDraft.update({
    where: { id: availabilityDraftId },
    data: {
      volunteerId,
      startTime,
      endTime,
      sourceNote: params.sourceNote === undefined ? existing.sourceNote : params.sourceNote,
      status: AvailabilityDraftStatus.DRAFT,
      validationSummary: Prisma.JsonNull,
      validatedAt: null,
    },
    include: {
      volunteer: true,
      planningMonth: true,
      createdByUser: true,
    },
  });
}

export async function validateAvailabilityDraft(availabilityDraftId: string) {
  const draft = await getAvailabilityDraftOrThrow(availabilityDraftId);
  assertAvailabilityDraftMutable(draft.status);

  validateAvailabilityInterval(draft.planningMonth, {
    startTime: draft.startTime,
    endTime: draft.endTime,
  });

  const summary = {
    valid: true,
    volunteerId: draft.volunteerId,
    volunteerName: draft.volunteer.name,
    planningMonthId: draft.planningMonthId,
    startTime: draft.startTime.toISOString(),
    endTime: draft.endTime.toISOString(),
  } satisfies Prisma.JsonObject;

  return prisma.availabilityDraft.update({
    where: { id: availabilityDraftId },
    data: {
      status: AvailabilityDraftStatus.VALIDATED,
      validationSummary: summary,
      validatedAt: new Date(),
    },
    include: {
      volunteer: true,
      planningMonth: true,
      createdByUser: true,
      committedAvailability: true,
    },
  });
}

export async function commitAvailabilityDraft(availabilityDraftId: string) {
  const draft = await getAvailabilityDraftOrThrow(availabilityDraftId);
  assertAvailabilityDraftMutable(draft.status);

  validateAvailabilityInterval(draft.planningMonth, {
    startTime: draft.startTime,
    endTime: draft.endTime,
  });

  return prisma.$transaction(async (tx) => {
    const availability = await tx.availability.create({
      data: {
        planningMonthId: draft.planningMonthId,
        volunteerId: draft.volunteerId,
        startTime: draft.startTime,
        endTime: draft.endTime,
        status: AvailabilityStatus.PENDING,
      },
      include: {
        volunteer: true,
        planningMonth: true,
      },
    });

    const committedDraft = await tx.availabilityDraft.update({
      where: { id: availabilityDraftId },
      data: {
        status: AvailabilityDraftStatus.COMMITTED,
        committedAvailabilityId: availability.id,
        committedAt: new Date(),
        validationSummary:
          draft.validationSummary ??
          ({
            valid: true,
            committedAvailabilityId: availability.id,
          } satisfies Prisma.JsonObject),
      },
      include: {
        volunteer: true,
        planningMonth: true,
        createdByUser: true,
        committedAvailability: true,
      },
    });

    return {
      draft: committedDraft,
      availability,
    };
  });
}

export async function cancelAvailabilityDraft(availabilityDraftId: string) {
  const draft = await getAvailabilityDraftOrThrow(availabilityDraftId);
  assertAvailabilityDraftMutable(draft.status);

  return prisma.availabilityDraft.update({
    where: { id: availabilityDraftId },
    data: {
      status: AvailabilityDraftStatus.CANCELLED,
      cancelledAt: new Date(),
    },
    include: {
      volunteer: true,
      planningMonth: true,
      createdByUser: true,
      committedAvailability: true,
    },
  });
}

export async function getPendingAvailabilityValidations(params: {
  planningMonthId?: string;
  volunteerId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  return listAvailabilities({
    ...params,
    statuses: [AvailabilityStatus.PENDING],
  });
}

async function updateAvailabilityValidationStatus(params: {
  availabilityId: string;
  status: "APPROVED" | "REJECTED";
  reviewComment?: string | null;
}) {
  const availability = await prisma.availability.findUnique({
    where: { id: params.availabilityId },
    include: {
      volunteer: true,
      planningMonth: true,
    },
  });

  if (!availability) {
    throw new ApiError(404, "Disponibilité introuvable.");
  }

  if (availability.status !== AvailabilityStatus.PENDING) {
    throw new ApiError(409, "Seules les disponibilités en attente peuvent être validées ou rejetées.");
  }

  return prisma.availability.update({
    where: { id: params.availabilityId },
    data: {
      status: params.status,
      reviewComment: params.reviewComment ?? null,
    },
    include: {
      volunteer: true,
      planningMonth: true,
    },
  });
}

export function approveAvailability(availabilityId: string, reviewComment?: string | null) {
  return updateAvailabilityValidationStatus({
    availabilityId,
    status: AvailabilityStatus.APPROVED,
    reviewComment,
  });
}

export function rejectAvailability(availabilityId: string, reviewComment?: string | null) {
  return updateAvailabilityValidationStatus({
    availabilityId,
    status: AvailabilityStatus.REJECTED,
    reviewComment,
  });
}

export async function bulkValidateAvailabilities(params: {
  availabilityIds: string[];
  action: "APPROVE" | "REJECT";
  reviewComment?: string | null;
}) {
  if (params.availabilityIds.length === 0) {
    throw new ApiError(400, "Aucune disponibilité fournie.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.availability.findMany({
      where: {
        id: {
          in: params.availabilityIds,
        },
      },
      include: {
        volunteer: true,
        planningMonth: true,
      },
    });

    if (existing.length !== params.availabilityIds.length) {
      throw new ApiError(404, "Certaines disponibilités sont introuvables.");
    }

    const nonPending = existing.filter((item) => item.status !== AvailabilityStatus.PENDING);
    if (nonPending.length > 0) {
      throw new ApiError(409, "La validation groupée n'accepte que des disponibilités en attente.");
    }

    const targetStatus =
      params.action === "APPROVE" ? AvailabilityStatus.APPROVED : AvailabilityStatus.REJECTED;

    await Promise.all(
      existing.map((item) =>
        tx.availability.update({
          where: { id: item.id },
          data: {
            status: targetStatus,
            reviewComment: params.reviewComment ?? null,
          },
        }),
      ),
    );

    return tx.availability.findMany({
      where: {
        id: {
          in: params.availabilityIds,
        },
      },
      include: {
        volunteer: true,
        planningMonth: true,
      },
      orderBy: {
        startTime: "asc",
      },
    });
  });
}

export async function getAvailabilityDraft(availabilityDraftId: string) {
  return getAvailabilityDraftOrThrow(availabilityDraftId);
}

export async function listAvailabilityDrafts(params: {
  planningMonthId?: string;
  volunteerId?: string;
  createdByUserId?: string;
  statuses?: AvailabilityDraftStatus[];
}) {
  return prisma.availabilityDraft.findMany({
    where: {
      ...(params.planningMonthId ? { planningMonthId: params.planningMonthId } : {}),
      ...(params.volunteerId ? { volunteerId: params.volunteerId } : {}),
      ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
      ...(params.statuses?.length
        ? {
            status: {
              in: params.statuses,
            },
          }
        : {}),
    },
    include: {
      volunteer: true,
      planningMonth: true,
      createdByUser: true,
      committedAvailability: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}
