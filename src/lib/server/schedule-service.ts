import { AssignmentSource, AssignmentStatus, AvailabilityStatus, Prisma, ScheduleAdjustmentDraftStatus } from "@prisma/client";
import { differenceInMinutes, isBefore } from "date-fns";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { computeCoverageSegments, getGapSegments, splitCoverageByDay } from "@/lib/coverage";
import { generateDraftAssignments } from "@/lib/draft";
import { prisma } from "@/lib/prisma";
import { parseDateInput } from "@/lib/time";
import {
  getVolunteerCandidateContexts,
  mergeGapSegments,
  suggestCandidatesForGap,
  type GapSegment,
} from "@/lib/server/candidate-suggestions";
import { logAssignmentEvent } from "@/lib/server/events";
import {
  validateVolunteerAssignmentAgainstContext,
  type AssignmentValidationVolunteerContext,
} from "@/lib/server/assignment-rules";

const createAssignmentOperationSchema = z.object({
  kind: z.literal("create_assignment"),
  volunteerId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  status: z.nativeEnum(AssignmentStatus).optional().default(AssignmentStatus.PROVISIONAL),
  source: z.nativeEnum(AssignmentSource).optional().default(AssignmentSource.MANUAL),
  ignoreRestWarning: z.boolean().optional().default(false),
});

const updateAssignmentOperationSchema = z.object({
  kind: z.literal("update_assignment"),
  assignmentId: z.string().min(1),
  volunteerId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  status: z.nativeEnum(AssignmentStatus),
  ignoreRestWarning: z.boolean().optional().default(false),
});

const deleteAssignmentOperationSchema = z.object({
  kind: z.literal("delete_assignment"),
  assignmentId: z.string().min(1),
});

export const scheduleAdjustmentOperationSchema = z.discriminatedUnion("kind", [
  createAssignmentOperationSchema,
  updateAssignmentOperationSchema,
  deleteAssignmentOperationSchema,
]);

export const scheduleAdjustmentChangeSetSchema = z.object({
  operations: z.array(scheduleAdjustmentOperationSchema).min(1).max(100),
});

export type ScheduleAdjustmentChangeSet = z.infer<typeof scheduleAdjustmentChangeSetSchema>;
export type ScheduleAdjustmentOperation = ScheduleAdjustmentChangeSet["operations"][number];

type ResolvedPlanningPeriod = {
  month: {
    id: string;
    year: number;
    month: number;
    startsAt: Date;
    endsAt: Date;
    status: string;
  };
  rangeStart: Date;
  rangeEnd: Date;
};

type WorkingAssignment = {
  id: string;
  volunteerId: string;
  planningMonthId: string;
  startTime: Date;
  endTime: Date;
  status: AssignmentStatus;
  source: AssignmentSource;
  volunteerName: string;
  volunteerColor: string;
};

function buildGapSummary(gaps: GapSegment[], axisStart?: Date) {
  const missingStaffMinutes = gaps.reduce(
    (total, gap) => total + differenceInMinutes(gap.endTime, gap.startTime) * gap.missingCount,
    0,
  );

  return {
    gapSegmentCount: gaps.length,
    mergedGapCount: mergeGapSegments(gaps, axisStart).length,
    missingStaffHours: Math.round((missingStaffMinutes / 60) * 10) / 10,
  };
}

export function buildScheduleSlotId(planningMonthId: string, startTime: Date, endTime: Date) {
  return `seg:${planningMonthId}:${encodeURIComponent(startTime.toISOString())}:${encodeURIComponent(endTime.toISOString())}`;
}

function parseScheduleSlotId(slotId: string) {
  const [kind, planningMonthId, startIso, endIso] = slotId.split(":");
  if (kind !== "seg" || !planningMonthId || !startIso || !endIso) {
    throw new ApiError(400, "Identifiant de créneau invalide.");
  }

  return {
    planningMonthId,
    startTime: parseDateInput(decodeURIComponent(startIso)),
    endTime: parseDateInput(decodeURIComponent(endIso)),
  };
}

async function getPlanningMonthOrThrow(planningMonthId: string) {
  const month = await prisma.planningMonth.findUnique({
    where: { id: planningMonthId },
  });

  if (!month) {
    throw new ApiError(404, "Mois introuvable.");
  }

  return month;
}

export async function resolvePlanningPeriod(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  if (params.planningMonthId) {
    const month = await getPlanningMonthOrThrow(params.planningMonthId);
    const rangeStart = params.startTime ?? month.startsAt;
    const rangeEnd = params.endTime ?? month.endsAt;

    if (!isBefore(rangeStart, rangeEnd)) {
      throw new ApiError(400, "La fin doit être après le début.");
    }

    if (isBefore(rangeStart, month.startsAt) || isBefore(month.endsAt, rangeEnd)) {
      throw new ApiError(400, "La période doit rester dans le mois sélectionné.");
    }

    return {
      month,
      rangeStart,
      rangeEnd,
    } satisfies ResolvedPlanningPeriod;
  }

  if (!params.startTime || !params.endTime) {
    throw new ApiError(400, "planningMonthId ou bien startTime/endTime sont requis.");
  }

  if (!isBefore(params.startTime, params.endTime)) {
    throw new ApiError(400, "La fin doit être après le début.");
  }

  const month = await prisma.planningMonth.findFirst({
    where: {
      startsAt: {
        lte: params.startTime,
      },
      endsAt: {
        gte: params.endTime,
      },
    },
  });

  if (!month) {
    throw new ApiError(400, "La période doit appartenir à un seul mois de planning existant.");
  }

  return {
    month,
    rangeStart: params.startTime,
    rangeEnd: params.endTime,
  } satisfies ResolvedPlanningPeriod;
}

async function loadMonthSchedule(monthId: string) {
  const month = await prisma.planningMonth.findUnique({
    where: {
      id: monthId,
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
      employeeBlocks: {
        orderBy: {
          startTime: "asc",
        },
      },
    },
  });

  if (!month) {
    throw new ApiError(404, "Mois introuvable.");
  }

  return month;
}

function computeScheduleWindow(params: {
  month: Awaited<ReturnType<typeof loadMonthSchedule>>;
  rangeStart: Date;
  rangeEnd: Date;
  assignments?: WorkingAssignment[];
}) {
  const sourceAssignments = params.assignments ?? cloneWorkingAssignments(params.month.assignments);

  const segments = computeCoverageSegments({
    rangeStart: params.rangeStart,
    rangeEnd: params.rangeEnd,
    assignments: sourceAssignments.map((assignment) => ({
      id: assignment.id,
      volunteerId: assignment.volunteerId,
      volunteerName: assignment.volunteerName,
      volunteerColor: assignment.volunteerColor,
      status: assignment.status,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
    })),
    employeeBlocks: params.month.employeeBlocks.map((block) => ({
      id: block.id,
      label: block.label,
      startTime: block.startTime,
      endTime: block.endTime,
    })),
    forceHourlyBoundaries: true,
  });

  const gaps = getGapSegments(segments).map(
    (segment): GapSegment => ({
      startTime: segment.startTime,
      endTime: segment.endTime,
      missingCount: segment.missingCount,
    }),
  );

  return {
    segments,
    gaps,
    dayTimelines: splitCoverageByDay(params.rangeStart, params.rangeEnd, segments),
  };
}

export async function getSchedule(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  const { month, rangeStart, rangeEnd } = await resolvePlanningPeriod(params);
  const monthSchedule = await loadMonthSchedule(month.id);
  const window = computeScheduleWindow({ month: monthSchedule, rangeStart, rangeEnd });

  return {
    month,
    rangeStart,
    rangeEnd,
    assignments: monthSchedule.assignments,
    employeeBlocks: monthSchedule.employeeBlocks,
    coverageSegments: window.segments,
    dayTimelines: window.dayTimelines,
    gaps: window.gaps,
    gapSummary: buildGapSummary(window.gaps, month.startsAt),
  };
}

function mapSegmentToSlot(planningMonthId: string, segment: ReturnType<typeof computeCoverageSegments>[number]) {
  return {
    slotId: buildScheduleSlotId(planningMonthId, segment.startTime, segment.endTime),
    startTime: segment.startTime,
    endTime: segment.endTime,
    volunteerAssignments: segment.volunteerAssignments.map((assignment) => ({
      assignmentId: assignment.id,
      volunteerId: assignment.volunteerId,
      volunteerName: assignment.volunteerName,
      volunteerColor: assignment.volunteerColor,
      status: assignment.status,
    })),
    employeeBlocks: segment.employeeBlocks.map((block) => ({
      employeeBlockId: block.id,
      label: block.label,
    })),
    volunteerCount: segment.volunteerCount,
    employeeCount: segment.employeeCount,
    totalCoverage: segment.totalCoverage,
    missingCount: segment.missingCount,
  };
}

export async function listScheduleSlots(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
  onlyUnfilled?: boolean;
}) {
  const schedule = await getSchedule(params);
  const slots = schedule.coverageSegments.map((segment) => mapSegmentToSlot(schedule.month.id, segment));

  return params.onlyUnfilled ? slots.filter((slot) => slot.missingCount > 0) : slots;
}

export async function getScheduleSlot(slotId: string) {
  const parsed = parseScheduleSlotId(slotId);
  const slots = await listScheduleSlots({
    planningMonthId: parsed.planningMonthId,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
  });

  const slot = slots.find((item) => item.slotId === slotId);
  if (!slot) {
    throw new ApiError(404, "Créneau introuvable.");
  }

  return slot;
}

export async function getUnfilledSlots(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  return listScheduleSlots({
    ...params,
    onlyUnfilled: true,
  });
}

export async function getStaffingGaps(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  const schedule = await getSchedule(params);
  const volunteerContexts = await getVolunteerCandidateContexts(schedule.month.id);
  const mergedGaps = mergeGapSegments(schedule.gaps, schedule.month.startsAt);

  return mergedGaps.map((gap) => {
    const suggestions = suggestCandidatesForGap(gap, volunteerContexts);
    return {
      startTime: gap.startTime,
      endTime: gap.endTime,
      missingCount: gap.missingCount,
      fullCoverageCount: suggestions.fullCoverageSuggestions.length,
      partialCoverageCount: suggestions.partialCoverageSuggestions.length,
      fullCoverageSuggestions: suggestions.fullCoverageSuggestions,
      partialCoverageSuggestions: suggestions.partialCoverageSuggestions,
    };
  });
}

async function getVolunteerValidationContexts(planningMonthId: string) {
  const volunteers = await prisma.volunteer.findMany({
    include: {
      monthSettings: {
        where: {
          planningMonthId,
        },
        take: 1,
      },
      availabilities: {
        where: {
          planningMonthId,
          status: AvailabilityStatus.APPROVED,
        },
        orderBy: {
          startTime: "asc",
        },
      },
      assignments: {
        where: {
          planningMonthId,
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  return new Map<string, AssignmentValidationVolunteerContext>(
    volunteers.map((volunteer) => [
      volunteer.id,
      {
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
    ]),
  );
}

function parseDraftChangeSet(changeSet: Prisma.JsonValue): ScheduleAdjustmentChangeSet {
  const parsed = scheduleAdjustmentChangeSetSchema.safeParse(changeSet);
  if (!parsed.success) {
    throw new ApiError(500, "Brouillon d'ajustement invalide en base.", parsed.error.flatten());
  }

  return parsed.data;
}

function parseOperationInterval(operation: { startTime: string; endTime: string }) {
  return {
    startTime: parseDateInput(operation.startTime),
    endTime: parseDateInput(operation.endTime),
  };
}

async function getScheduleAdjustmentDraftOrThrow(scheduleAdjustmentDraftId: string) {
  const draft = await prisma.scheduleAdjustmentDraft.findUnique({
    where: { id: scheduleAdjustmentDraftId },
    include: {
      planningMonth: true,
      createdByUser: true,
    },
  });

  if (!draft) {
    throw new ApiError(404, "Brouillon d'ajustement introuvable.");
  }

  return draft;
}

export async function createScheduleAdjustmentDraft(params: {
  planningMonthId: string;
  createdByUserId: string;
  title?: string | null;
  changeSet: ScheduleAdjustmentChangeSet;
}) {
  await getPlanningMonthOrThrow(params.planningMonthId);

  const parsed = scheduleAdjustmentChangeSetSchema.safeParse(params.changeSet);
  if (!parsed.success) {
    throw new ApiError(400, "Change set invalide.", parsed.error.flatten());
  }

  return prisma.scheduleAdjustmentDraft.create({
    data: {
      planningMonthId: params.planningMonthId,
      createdByUserId: params.createdByUserId,
      title: params.title ?? null,
      changeSet: parsed.data,
    },
    include: {
      planningMonth: true,
      createdByUser: true,
    },
  });
}

function cloneWorkingAssignments(assignments: Awaited<ReturnType<typeof loadMonthSchedule>>["assignments"]): WorkingAssignment[] {
  return assignments.map((assignment) => ({
    id: assignment.id,
    volunteerId: assignment.volunteerId,
    planningMonthId: assignment.planningMonthId,
    startTime: new Date(assignment.startTime),
    endTime: new Date(assignment.endTime),
    status: assignment.status,
    source: assignment.source,
    volunteerName: assignment.volunteer.name,
    volunteerColor: assignment.volunteer.color,
  }));
}

function applyWorkingAssignmentToVolunteerContext(
  volunteerContext: AssignmentValidationVolunteerContext,
  assignment: { id: string; volunteerId: string; startTime: Date; endTime: Date },
) {
  volunteerContext.assignments.push({
    id: assignment.id,
    volunteerId: assignment.volunteerId,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
  });
}

function removeWorkingAssignmentFromVolunteerContext(
  volunteerContext: AssignmentValidationVolunteerContext,
  assignmentId: string,
) {
  volunteerContext.assignments = volunteerContext.assignments.filter((assignment) => assignment.id !== assignmentId);
}

export async function previewScheduleAdjustment(scheduleAdjustmentDraftId: string) {
  const draft = await getScheduleAdjustmentDraftOrThrow(scheduleAdjustmentDraftId);
  if (draft.status === ScheduleAdjustmentDraftStatus.CANCELLED) {
    throw new ApiError(409, "Ce brouillon d'ajustement est annulé.");
  }

  const changeSet = parseDraftChangeSet(draft.changeSet);
  const monthSchedule = await loadMonthSchedule(draft.planningMonthId);
  const volunteerContexts = await getVolunteerValidationContexts(draft.planningMonthId);
  const workingAssignments = cloneWorkingAssignments(monthSchedule.assignments);
  const issues: Prisma.JsonObject[] = [];
  const appliedOperations: Prisma.JsonObject[] = [];

  for (let index = 0; index < changeSet.operations.length; index += 1) {
    const operation = changeSet.operations[index];

    try {
      if (operation.kind === "create_assignment") {
        const interval = parseOperationInterval(operation);
        const volunteerContext = volunteerContexts.get(operation.volunteerId);
        if (!volunteerContext) {
          throw new ApiError(404, "Volontaire introuvable.");
        }

        validateVolunteerAssignmentAgainstContext({
          month: draft.planningMonth,
          volunteer: volunteerContext,
          startTime: interval.startTime,
          endTime: interval.endTime,
          ignoreRestWarning: operation.ignoreRestWarning,
        });

        const assignmentId = `draft-create-${index}`;
        const assignment: WorkingAssignment = {
          id: assignmentId,
          volunteerId: operation.volunteerId,
          planningMonthId: draft.planningMonthId,
          startTime: interval.startTime,
          endTime: interval.endTime,
          status: operation.status,
          source: operation.source,
          volunteerName: volunteerContext.name,
          volunteerColor: monthSchedule.assignments.find((item) => item.volunteerId === volunteerContext.id)?.volunteer.color ?? "#16a34a",
        };

        workingAssignments.push(assignment);
        applyWorkingAssignmentToVolunteerContext(volunteerContext, assignment);
        appliedOperations.push({
          kind: operation.kind,
          assignmentId,
          volunteerId: operation.volunteerId,
          startTime: interval.startTime.toISOString(),
          endTime: interval.endTime.toISOString(),
          status: operation.status,
        });
        continue;
      }

      if (operation.kind === "update_assignment") {
        const current = workingAssignments.find((assignment) => assignment.id === operation.assignmentId);
        if (!current) {
          throw new ApiError(404, `Garde introuvable pour mise à jour (${operation.assignmentId}).`);
        }

        const currentVolunteerContext = volunteerContexts.get(current.volunteerId);
        const targetVolunteerContext = volunteerContexts.get(operation.volunteerId);
        if (!currentVolunteerContext || !targetVolunteerContext) {
          throw new ApiError(404, "Volontaire introuvable.");
        }

        removeWorkingAssignmentFromVolunteerContext(currentVolunteerContext, current.id);

        try {
          const interval = parseOperationInterval(operation);
          validateVolunteerAssignmentAgainstContext({
            month: draft.planningMonth,
            volunteer: targetVolunteerContext,
            startTime: interval.startTime,
            endTime: interval.endTime,
            ignoreRestWarning: operation.ignoreRestWarning,
          });

          current.volunteerId = operation.volunteerId;
          current.startTime = interval.startTime;
          current.endTime = interval.endTime;
          current.status = operation.status;
          current.volunteerName = targetVolunteerContext.name;
          applyWorkingAssignmentToVolunteerContext(targetVolunteerContext, current);
          appliedOperations.push({
            kind: operation.kind,
            assignmentId: current.id,
            volunteerId: operation.volunteerId,
            startTime: interval.startTime.toISOString(),
            endTime: interval.endTime.toISOString(),
            status: operation.status,
          });
        } catch (error) {
          applyWorkingAssignmentToVolunteerContext(currentVolunteerContext, current);
          throw error;
        }

        continue;
      }

      const current = workingAssignments.find((assignment) => assignment.id === operation.assignmentId);
      if (!current) {
        throw new ApiError(404, `Garde introuvable pour suppression (${operation.assignmentId}).`);
      }

      const currentVolunteerContext = volunteerContexts.get(current.volunteerId);
      if (currentVolunteerContext) {
        removeWorkingAssignmentFromVolunteerContext(currentVolunteerContext, current.id);
      }

      const currentIndex = workingAssignments.findIndex((assignment) => assignment.id === operation.assignmentId);
      workingAssignments.splice(currentIndex, 1);
      appliedOperations.push({
        kind: operation.kind,
        assignmentId: operation.assignmentId,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        issues.push({
          operationIndex: index,
          code: `${error.status}`,
          message: error.message,
        });
      } else if (error instanceof Error) {
        issues.push({
          operationIndex: index,
          code: "UNEXPECTED",
          message: error.message,
        });
      } else {
        issues.push({
          operationIndex: index,
          code: "UNEXPECTED",
          message: "Erreur inconnue pendant la prévisualisation.",
        });
      }
    }
  }

  const beforeWindow = computeScheduleWindow({
    month: monthSchedule,
    rangeStart: monthSchedule.startsAt,
    rangeEnd: monthSchedule.endsAt,
  });
  const afterWindow = computeScheduleWindow({
    month: monthSchedule,
    rangeStart: monthSchedule.startsAt,
    rangeEnd: monthSchedule.endsAt,
    assignments: workingAssignments,
  });

  const preview = {
    valid: issues.length === 0,
    issues,
    before: buildGapSummary(beforeWindow.gaps, monthSchedule.startsAt),
    after: buildGapSummary(afterWindow.gaps, monthSchedule.startsAt),
    resultingGaps: mergeGapSegments(afterWindow.gaps, monthSchedule.startsAt).map((gap) => ({
      startTime: gap.startTime.toISOString(),
      endTime: gap.endTime.toISOString(),
      missingCount: gap.missingCount,
    })),
    appliedOperations,
  } satisfies Prisma.JsonObject;

  const updatedDraft = await prisma.scheduleAdjustmentDraft.update({
    where: {
      id: scheduleAdjustmentDraftId,
    },
    data: {
      preview,
      status: issues.length === 0 ? ScheduleAdjustmentDraftStatus.PREVIEWED : ScheduleAdjustmentDraftStatus.DRAFT,
      previewedAt: new Date(),
    },
    include: {
      planningMonth: true,
      createdByUser: true,
    },
  });

  return {
    draft: updatedDraft,
    preview,
  };
}

export async function commitScheduleAdjustment(scheduleAdjustmentDraftId: string) {
  const preview = await previewScheduleAdjustment(scheduleAdjustmentDraftId);
  const previewPayload = preview.preview;
  if (!previewPayload.valid) {
    throw new ApiError(409, "Le brouillon d'ajustement contient encore des erreurs bloquantes.", previewPayload);
  }

  const draft = await getScheduleAdjustmentDraftOrThrow(scheduleAdjustmentDraftId);
  const changeSet = parseDraftChangeSet(draft.changeSet);
  const created: Array<{ id: string; planningMonthId: string; volunteerId: string; startTime: Date; endTime: Date; status: AssignmentStatus; source: AssignmentSource }> = [];
  const updated: Array<{ id: string; planningMonthId: string; before: Prisma.JsonObject; after: Prisma.JsonObject }> = [];
  const deleted: Array<{ id: string; planningMonthId: string; volunteerId: string; startTime: Date; endTime: Date }> = [];

  await prisma.$transaction(async (tx) => {
    for (const operation of changeSet.operations) {
      if (operation.kind === "create_assignment") {
        const interval = parseOperationInterval(operation);
        const assignment = await tx.assignment.create({
          data: {
            planningMonthId: draft.planningMonthId,
            volunteerId: operation.volunteerId,
            startTime: interval.startTime,
            endTime: interval.endTime,
            status: operation.status,
            source: operation.source,
          },
        });

        created.push({
          id: assignment.id,
          planningMonthId: assignment.planningMonthId,
          volunteerId: assignment.volunteerId,
          startTime: assignment.startTime,
          endTime: assignment.endTime,
          status: assignment.status,
          source: assignment.source,
        });
        continue;
      }

      if (operation.kind === "update_assignment") {
        const existing = await tx.assignment.findUnique({
          where: {
            id: operation.assignmentId,
          },
        });

        if (!existing) {
          throw new ApiError(404, `Garde introuvable pour mise à jour (${operation.assignmentId}).`);
        }

        const interval = parseOperationInterval(operation);
        const assignment = await tx.assignment.update({
          where: {
            id: operation.assignmentId,
          },
          data: {
            volunteerId: operation.volunteerId,
            startTime: interval.startTime,
            endTime: interval.endTime,
            status: operation.status,
          },
        });

        updated.push({
          id: assignment.id,
          planningMonthId: assignment.planningMonthId,
          before: {
            volunteerId: existing.volunteerId,
            startTime: existing.startTime.toISOString(),
            endTime: existing.endTime.toISOString(),
            status: existing.status,
          },
          after: {
            volunteerId: assignment.volunteerId,
            startTime: assignment.startTime.toISOString(),
            endTime: assignment.endTime.toISOString(),
            status: assignment.status,
          },
        });
        continue;
      }

      const existing = await tx.assignment.findUnique({
        where: {
          id: operation.assignmentId,
        },
      });

      if (!existing) {
        throw new ApiError(404, `Garde introuvable pour suppression (${operation.assignmentId}).`);
      }

      await tx.assignment.delete({
        where: {
          id: operation.assignmentId,
        },
      });

      deleted.push({
        id: existing.id,
        planningMonthId: existing.planningMonthId,
        volunteerId: existing.volunteerId,
        startTime: existing.startTime,
        endTime: existing.endTime,
      });
    }

    await tx.scheduleAdjustmentDraft.update({
      where: {
        id: scheduleAdjustmentDraftId,
      },
      data: {
        status: ScheduleAdjustmentDraftStatus.COMMITTED,
        committedAt: new Date(),
        preview: preview.preview,
      },
    });
  });

  await Promise.all(
    created.map((assignment) =>
      logAssignmentEvent({
        planningMonthId: assignment.planningMonthId,
        assignmentId: assignment.id,
        eventType: "CREATED",
        payload: {
          volunteerId: assignment.volunteerId,
          startTime: assignment.startTime.toISOString(),
          endTime: assignment.endTime.toISOString(),
          status: assignment.status,
          source: assignment.source,
        },
      }),
    ),
  );

  await Promise.all(
    updated.map((assignment) =>
      logAssignmentEvent({
        planningMonthId: assignment.planningMonthId,
        assignmentId: assignment.id,
        eventType: "UPDATED",
        payload: {
          before: assignment.before,
          after: assignment.after,
        },
      }),
    ),
  );

  await Promise.all(
    deleted.map((assignment) =>
      logAssignmentEvent({
        planningMonthId: assignment.planningMonthId,
        assignmentId: assignment.id,
        eventType: "DELETED",
        payload: {
          volunteerId: assignment.volunteerId,
          startTime: assignment.startTime.toISOString(),
          endTime: assignment.endTime.toISOString(),
        },
      }),
    ),
  );

  return getScheduleAdjustmentDraftOrThrow(scheduleAdjustmentDraftId);
}

export async function cancelScheduleAdjustmentDraft(scheduleAdjustmentDraftId: string) {
  const draft = await getScheduleAdjustmentDraftOrThrow(scheduleAdjustmentDraftId);
  if (draft.status === ScheduleAdjustmentDraftStatus.COMMITTED) {
    throw new ApiError(409, "Ce brouillon d'ajustement a déjà été committé.");
  }

  return prisma.scheduleAdjustmentDraft.update({
    where: {
      id: scheduleAdjustmentDraftId,
    },
    data: {
      status: ScheduleAdjustmentDraftStatus.CANCELLED,
      cancelledAt: new Date(),
    },
    include: {
      planningMonth: true,
      createdByUser: true,
    },
  });
}

export async function suggestCandidatesForSlot(params: {
  slotId?: string;
  assignmentId?: string;
  maxFullSuggestions?: number;
  maxPartialSuggestions?: number;
}) {
  if (!params.slotId && !params.assignmentId) {
    throw new ApiError(400, "slotId ou assignmentId est requis.");
  }

  let planningMonthId: string;
  let gap: GapSegment;
  let excludedVolunteerId: string | null = null;

  if (params.assignmentId) {
    const assignment = await prisma.assignment.findUnique({
      where: {
        id: params.assignmentId,
      },
    });

    if (!assignment) {
      throw new ApiError(404, "Garde introuvable.");
    }

    planningMonthId = assignment.planningMonthId;
    gap = {
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      missingCount: 1,
    };
    excludedVolunteerId = assignment.volunteerId;
  } else {
    const parsed = parseScheduleSlotId(params.slotId!);
    planningMonthId = parsed.planningMonthId;
    gap = {
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      missingCount: 1,
    };
  }

  const volunteerContexts = (await getVolunteerCandidateContexts(planningMonthId)).filter(
    (volunteer) => volunteer.id !== excludedVolunteerId,
  );

  return suggestCandidatesForGap(gap, volunteerContexts, {
    full: params.maxFullSuggestions ?? 8,
    partial: params.maxPartialSuggestions ?? 8,
  });
}

export async function suggestScheduleImprovements(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  const { month, rangeStart, rangeEnd } = await resolvePlanningPeriod(params);
  const monthSchedule = await loadMonthSchedule(month.id);
  const volunteers = await prisma.volunteer.findMany({
    include: {
      monthSettings: {
        where: {
          planningMonthId: month.id,
        },
        take: 1,
      },
      availabilities: {
        where: {
          planningMonthId: month.id,
          status: AvailabilityStatus.APPROVED,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const suggestions = generateDraftAssignments({
    monthStart: rangeStart,
    monthEnd: rangeEnd,
    volunteers: volunteers.map((volunteer) => ({
      id: volunteer.id,
      name: volunteer.name,
      color: volunteer.color,
      maxGuardsPerMonth: volunteer.monthSettings[0]?.maxGuardsPerMonth ?? null,
      availabilities: volunteer.availabilities.map((availability) => ({
        startTime: availability.startTime,
        endTime: availability.endTime,
      })),
    })),
    assignments: monthSchedule.assignments.map((assignment) => ({
      id: assignment.id,
      volunteerId: assignment.volunteerId,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
    })),
    employeeBlocks: monthSchedule.employeeBlocks.map((block) => ({
      id: block.id,
      startTime: block.startTime,
      endTime: block.endTime,
    })),
  });

  return suggestions.map((suggestion) => ({
    kind: "create_assignment" as const,
    volunteerId: suggestion.volunteerId,
    startTime: suggestion.startTime.toISOString(),
    endTime: suggestion.endTime.toISOString(),
    status: AssignmentStatus.PROVISIONAL,
    source: AssignmentSource.DRAFT,
  }));
}

export async function explainCoverageIssues(params: {
  planningMonthId?: string;
  startTime?: Date;
  endTime?: Date;
}) {
  const gaps = await getStaffingGaps(params);
  const totalGapMinutes = gaps.reduce(
    (total, gap) => total + differenceInMinutes(gap.endTime, gap.startTime) * gap.missingCount,
    0,
  );

  return {
    gapCount: gaps.length,
    missingStaffHours: Math.round((totalGapMinutes / 60) * 10) / 10,
    blockingGaps: gaps.filter((gap) => gap.fullCoverageCount === 0),
    recoverableGaps: gaps.filter((gap) => gap.fullCoverageCount > 0),
  };
}
