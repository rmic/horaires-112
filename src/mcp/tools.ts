import type { AppUserRole, AvailabilityStatus as AvailabilityStatusValue, Prisma } from "@prisma/client";
import { AvailabilityStatus } from "@prisma/client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Notification as McpNotification, Request as McpRequest } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseDateInput } from "@/lib/time";
import {
  approveAvailability,
  bulkValidateAvailabilities,
  cancelAvailabilityDraft,
  commitAvailabilityDraft,
  createAvailabilityDraft,
  getPendingAvailabilityValidations,
  listAvailabilities,
  rejectAvailability,
  updateAvailabilityDraft,
  validateAvailabilityDraft,
} from "@/lib/server/availability-service";
import { writeAuditLog } from "@/lib/server/audit";
import { explainAvailabilityStatuses, getBusinessRules, getRoleCapabilities } from "@/lib/server/business-rules";
import { assertCapability, type Capability } from "@/lib/server/permissions";
import {
  cancelScheduleAdjustmentDraft,
  commitScheduleAdjustment,
  createScheduleAdjustmentDraft,
  explainCoverageIssues,
  getSchedule,
  getScheduleSlot,
  getStaffingGaps,
  getUnfilledSlots,
  listScheduleSlots,
  previewScheduleAdjustment,
  scheduleAdjustmentChangeSetSchema,
  suggestCandidatesForSlot,
  suggestScheduleImprovements,
} from "@/lib/server/schedule-service";

type ToolExtra = RequestHandlerExtra<McpRequest, McpNotification>;

type AuthenticatedActor = {
  id: string;
  email: string;
  displayName: string;
  role: AppUserRole;
};

function getActorFromExtra(extra: ToolExtra): AuthenticatedActor {
  const authExtra = extra.authInfo?.extra;

  if (!authExtra) {
    throw new Error("Contexte d'authentification manquant.");
  }

  const id = authExtra.appUserId;
  const email = authExtra.appUserEmail;
  const displayName = authExtra.appUserDisplayName;
  const role = authExtra.appUserRole;

  if (typeof id !== "string" || typeof email !== "string" || typeof displayName !== "string") {
    throw new Error("Utilisateur authentifié invalide.");
  }

  if (role !== "PLANNER" && role !== "READ_ONLY") {
    throw new Error("Rôle MCP invalide.");
  }

  return {
    id,
    email,
    displayName,
    role,
  };
}

function toToolResult(payload: Record<string, unknown>, summary: string): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: summary,
      },
    ],
    structuredContent: payload,
  };
}

function castArgs<T>(args: Record<string, unknown>) {
  return args as unknown as T;
}

function parseOptionalDate(value?: string) {
  return value ? parseDateInput(value) : undefined;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}

function toAuditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function withMutationAudit<T>(params: {
  actor: AuthenticatedActor;
  capability: Capability;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Prisma.InputJsonValue;
  run: () => Promise<T>;
}) {
  const baseDetails =
    params.details && typeof params.details === "object" && !Array.isArray(params.details)
      ? (params.details as Record<string, unknown>)
      : params.details === undefined
        ? {}
        : { details: params.details };

  try {
    assertCapability(params.actor.role, params.capability);
  } catch (error) {
    await writeAuditLog({
      actorUserId: params.actor.id,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      outcome: "DENIED",
      details: toAuditJson({
        ...baseDetails,
        error: serializeError(error),
      }),
    });
    throw error;
  }

  try {
    const result = await params.run();
    await writeAuditLog({
      actorUserId: params.actor.id,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      outcome: "SUCCESS",
      details: params.details ? toAuditJson(params.details) : undefined,
    });
    return result;
  } catch (error) {
    await writeAuditLog({
      actorUserId: params.actor.id,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      outcome: "FAILURE",
      details: toAuditJson({
        ...baseDetails,
        error: serializeError(error),
      }),
    });
    throw error;
  }
}

function normalizeAvailabilityStatuses(statuses?: AvailabilityStatusValue[]) {
  return statuses?.length ? statuses : undefined;
}

function mapAvailability(availability: Awaited<ReturnType<typeof listAvailabilities>>[number]) {
  return {
    availabilityId: availability.id,
    volunteerId: availability.volunteerId,
    volunteerName: availability.volunteer.name,
    planningMonthId: availability.planningMonthId,
    year: availability.planningMonth.year,
    month: availability.planningMonth.month,
    startTime: availability.startTime.toISOString(),
    endTime: availability.endTime.toISOString(),
    status: availability.status,
    reviewComment: availability.reviewComment,
  };
}

async function searchVolunteerMatches(query: string, limit = 10) {
  const normalized = query.trim().toLowerCase();
  const volunteers = await prisma.volunteer.findMany({
    orderBy: {
      name: "asc",
    },
  });

  const matches = volunteers
    .filter((volunteer) => volunteer.name.toLowerCase().includes(normalized))
    .slice(0, limit)
    .map((volunteer) => ({
      userId: volunteer.id,
      volunteerId: volunteer.id,
      kind: "VOLUNTEER",
      name: volunteer.name,
      color: volunteer.color,
    }));

  return {
    query,
    ambiguous: matches.length > 1,
    emailMatchingSupported: false,
    matches,
  };
}

async function getVolunteerRecord(volunteerId: string) {
  const volunteer = await prisma.volunteer.findUnique({
    where: {
      id: volunteerId,
    },
    include: {
      monthSettings: {
        include: {
          planningMonth: true,
        },
        orderBy: [
          {
            planningMonth: {
              year: "desc",
            },
          },
          {
            planningMonth: {
              month: "desc",
            },
          },
        ],
      },
      _count: {
        select: {
          availabilities: true,
          assignments: true,
        },
      },
    },
  });

  if (!volunteer) {
    throw new Error("Volontaire introuvable.");
  }

  return {
    volunteerId: volunteer.id,
    userId: volunteer.id,
    kind: "VOLUNTEER",
    name: volunteer.name,
    color: volunteer.color,
    availabilityCount: volunteer._count.availabilities,
    assignmentCount: volunteer._count.assignments,
    monthSettings: volunteer.monthSettings.map((setting) => ({
      planningMonthId: setting.planningMonthId,
      year: setting.planningMonth.year,
      month: setting.planningMonth.month,
      maxGuardsPerMonth: setting.maxGuardsPerMonth,
    })),
  };
}

export function registerMcpTools(server: McpServer) {
  const registerToolUnsafe = server.registerTool.bind(server) as unknown as (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: ZodRawShapeCompat;
      annotations?: Record<string, unknown>;
    },
    cb: (args: unknown, extra: unknown) => Promise<CallToolResult>,
  ) => unknown;

  const registerReadTool = <T extends ZodRawShapeCompat>(
    name: string,
    description: string,
    inputSchema: T,
    handler: (args: Record<string, unknown>, extra: ToolExtra, actor: AuthenticatedActor) => Promise<Record<string, unknown>>,
  ) => {
    registerToolUnsafe(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: true,
        },
      },
      async (args, extra): Promise<CallToolResult> => {
        const actor = getActorFromExtra(extra as ToolExtra);
        const payload = await handler(args as Record<string, unknown>, extra as ToolExtra, actor);
        return toToolResult(payload, `${name} executed`);
      },
    );
  };

  const registerMutationTool = <T extends ZodRawShapeCompat>(
    name: string,
    description: string,
    capability: Capability,
    resourceType: string,
    inputSchema: T,
    handler: (args: Record<string, unknown>, extra: ToolExtra, actor: AuthenticatedActor) => Promise<{ payload: Record<string, unknown>; resourceId?: string | null; auditDetails?: Prisma.InputJsonValue }>,
  ) => {
    registerToolUnsafe(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: false,
        },
      },
      async (args, extra): Promise<CallToolResult> => {
        const actor = getActorFromExtra(extra as ToolExtra);
        const result = await withMutationAudit({
          actor,
          capability,
          action: name,
          resourceType,
          details: toAuditJson({
            input: args as Record<string, unknown>,
          }),
          run: async () => handler(args as Record<string, unknown>, extra as ToolExtra, actor),
        });

        return toToolResult(result.payload, `${name} executed`);
      },
    );
  };

  const searchToolHandler = async (args: Record<string, unknown>) => {
    const { query, optionalEmail, limit } = castArgs<{
      query: string;
      optionalEmail?: string;
      limit?: number;
    }>(args);
    const payload = await searchVolunteerMatches(query, limit ?? 10);
    return {
      ...payload,
      optionalEmail,
      note: optionalEmail
        ? "Le domaine actuel ne stocke pas encore l'email des volontaires; la recherche s'est faite sur le nom."
        : undefined,
    };
  };

  registerReadTool(
    "search_volunteers",
    "Recherche des volontaires par nom.",
    {
      query: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
    },
    async (args) => searchToolHandler(args),
  );

  registerReadTool(
    "search_users",
    "Alias métier de search_volunteers pour les clients qui attendent un search_users.",
    {
      query: z.string().min(1),
      optionalEmail: z.string().email().optional(),
      limit: z.number().int().positive().max(50).optional(),
    },
    async (args) => searchToolHandler(args),
  );

  registerReadTool(
    "get_volunteer",
    "Retourne la fiche d'un volontaire.",
    {
      volunteerId: z.string().min(1),
    },
    async (args) => {
      const { volunteerId } = castArgs<{ volunteerId: string }>(args);
      return {
        volunteer: await getVolunteerRecord(volunteerId),
      };
    },
  );

  registerReadTool(
    "get_user",
    "Alias métier de get_volunteer.",
    {
      userId: z.string().min(1),
    },
    async (args) => {
      const { userId } = castArgs<{ userId: string }>(args);
      return {
        user: await getVolunteerRecord(userId),
      };
    },
  );

  registerReadTool(
    "list_availabilities",
    "Liste les disponibilités sur une période, avec filtre de statut.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      volunteerId: z.string().optional(),
      statuses: z.array(z.nativeEnum(AvailabilityStatus)).optional(),
    },
    async (args) => {
      const { planningMonthId, startTime, endTime, volunteerId, statuses } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
        volunteerId?: string;
        statuses?: AvailabilityStatusValue[];
      }>(args);
      const availabilities = await listAvailabilities({
        planningMonthId,
        volunteerId,
        startTime: parseOptionalDate(startTime),
        endTime: parseOptionalDate(endTime),
        statuses: normalizeAvailabilityStatuses(statuses),
      });

      return {
        availabilities: availabilities.map(mapAvailability),
        count: availabilities.length,
      };
    },
  );

  registerReadTool(
    "get_pending_availability_validations",
    "Retourne les disponibilités en attente de validation.",
    {
      planningMonthId: z.string().optional(),
      volunteerId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    async (args) => {
      const { planningMonthId, volunteerId, startTime, endTime } = castArgs<{
        planningMonthId?: string;
        volunteerId?: string;
        startTime?: string;
        endTime?: string;
      }>(args);
      const availabilities = await getPendingAvailabilityValidations({
        planningMonthId,
        volunteerId,
        startTime: parseOptionalDate(startTime),
        endTime: parseOptionalDate(endTime),
      });

      return {
        availabilities: availabilities.map(mapAvailability),
        count: availabilities.length,
      };
    },
  );

  registerReadTool(
    "get_schedule",
    "Retourne l'horaire, les segments de couverture et les gaps sur un mois ou une sous-période.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    async (args) => {
      const { planningMonthId, startTime, endTime } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
      }>(args);
      const schedule = await getSchedule({
        planningMonthId,
        startTime: parseOptionalDate(startTime),
        endTime: parseOptionalDate(endTime),
      });

      return {
        month: {
          planningMonthId: schedule.month.id,
          year: schedule.month.year,
          month: schedule.month.month,
          status: schedule.month.status,
        },
        range: {
          startTime: schedule.rangeStart.toISOString(),
          endTime: schedule.rangeEnd.toISOString(),
        },
        gapSummary: schedule.gapSummary,
        assignments: schedule.assignments.map((assignment) => ({
          assignmentId: assignment.id,
          volunteerId: assignment.volunteerId,
          volunteerName: assignment.volunteer.name,
          startTime: assignment.startTime.toISOString(),
          endTime: assignment.endTime.toISOString(),
          status: assignment.status,
          source: assignment.source,
        })),
        employeeBlocks: schedule.employeeBlocks.map((block) => ({
          employeeBlockId: block.id,
          label: block.label,
          startTime: block.startTime.toISOString(),
          endTime: block.endTime.toISOString(),
        })),
      };
    },
  );

  registerReadTool(
    "list_schedule_slots",
    "Liste les créneaux de couverture segmentés où l'effectif change.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      onlyUnfilled: z.boolean().optional(),
    },
    async (args) => {
      const { planningMonthId, startTime, endTime, onlyUnfilled } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
        onlyUnfilled?: boolean;
      }>(args);
      return {
        slots: await listScheduleSlots({
          planningMonthId,
          startTime: parseOptionalDate(startTime),
          endTime: parseOptionalDate(endTime),
          onlyUnfilled,
        }),
      };
    },
  );

  registerReadTool(
    "get_schedule_slot",
    "Retourne un créneau de couverture précis via son slotId.",
    {
      slotId: z.string().min(1),
    },
    async (args) => {
      const { slotId } = castArgs<{ slotId: string }>(args);
      return {
        slot: await getScheduleSlot(slotId),
      };
    },
  );

  registerReadTool(
    "get_unfilled_slots",
    "Retourne uniquement les segments sous-couverts.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    async (args) => {
      const { planningMonthId, startTime, endTime } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
      }>(args);
      return {
        slots: await getUnfilledSlots({
          planningMonthId,
          startTime: parseOptionalDate(startTime),
          endTime: parseOptionalDate(endTime),
        }),
      };
    },
  );

  registerReadTool(
    "get_staffing_gaps",
    "Retourne les gaps fusionnés et les candidats complets/partiels pour les couvrir.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    async (args) => {
      const { planningMonthId, startTime, endTime } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
      }>(args);
      return {
        gaps: await getStaffingGaps({
          planningMonthId,
          startTime: parseOptionalDate(startTime),
          endTime: parseOptionalDate(endTime),
        }),
      };
    },
  );

  registerMutationTool(
    "create_availability_draft",
    "Crée un brouillon de disponibilité avant validation/commit.",
    "draft:availability",
    "availability_draft",
    {
      planningMonthId: z.string().min(1),
      volunteerId: z.string().min(1),
      startTime: z.string(),
      endTime: z.string(),
      sourceNote: z.string().max(2000).optional(),
    },
    async (args, _extra, actor) => {
      const { planningMonthId, volunteerId, startTime, endTime, sourceNote } = castArgs<{
        planningMonthId: string;
        volunteerId: string;
        startTime: string;
        endTime: string;
        sourceNote?: string;
      }>(args);
      const draft = await createAvailabilityDraft({
        planningMonthId,
        volunteerId,
        startTime: parseDateInput(startTime),
        endTime: parseDateInput(endTime),
        createdByUserId: actor.id,
        sourceNote,
      });

      return {
        payload: {
          draft: {
            availabilityDraftId: draft.id,
            planningMonthId: draft.planningMonthId,
            volunteerId: draft.volunteerId,
            volunteerName: draft.volunteer.name,
            startTime: draft.startTime.toISOString(),
            endTime: draft.endTime.toISOString(),
            status: draft.status,
            sourceNote: draft.sourceNote,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerMutationTool(
    "update_availability_draft",
    "Modifie un brouillon de disponibilité existant.",
    "draft:availability",
    "availability_draft",
    {
      availabilityDraftId: z.string().min(1),
      volunteerId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      sourceNote: z.string().max(2000).optional().nullable(),
    },
    async (args) => {
      const { availabilityDraftId, volunteerId, startTime, endTime, sourceNote } = castArgs<{
        availabilityDraftId: string;
        volunteerId?: string;
        startTime?: string;
        endTime?: string;
        sourceNote?: string | null;
      }>(args);
      const draft = await updateAvailabilityDraft(availabilityDraftId, {
        volunteerId,
        startTime: startTime ? parseDateInput(startTime) : undefined,
        endTime: endTime ? parseDateInput(endTime) : undefined,
        sourceNote,
      });

      return {
        payload: {
          draft: {
            availabilityDraftId: draft.id,
            planningMonthId: draft.planningMonthId,
            volunteerId: draft.volunteerId,
            volunteerName: draft.volunteer.name,
            startTime: draft.startTime.toISOString(),
            endTime: draft.endTime.toISOString(),
            status: draft.status,
            sourceNote: draft.sourceNote,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerMutationTool(
    "validate_availability_draft",
    "Valide un brouillon de disponibilité avant commit.",
    "draft:availability",
    "availability_draft",
    {
      availabilityDraftId: z.string().min(1),
    },
    async (args) => {
      const { availabilityDraftId } = castArgs<{ availabilityDraftId: string }>(args);
      const draft = await validateAvailabilityDraft(availabilityDraftId);
      return {
        payload: {
          draft: {
            availabilityDraftId: draft.id,
            status: draft.status,
            validationSummary: draft.validationSummary,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerMutationTool(
    "commit_availability_draft",
    "Commite un brouillon de disponibilité vers une disponibilité PENDING.",
    "commit:availability",
    "availability_draft",
    {
      availabilityDraftId: z.string().min(1),
    },
    async (args) => {
      const { availabilityDraftId } = castArgs<{ availabilityDraftId: string }>(args);
      const result = await commitAvailabilityDraft(availabilityDraftId);
      return {
        payload: {
          draft: {
            availabilityDraftId: result.draft.id,
            status: result.draft.status,
            committedAvailabilityId: result.draft.committedAvailabilityId,
          },
          availability: mapAvailability(result.availability),
        },
        resourceId: result.draft.id,
      };
    },
  );

  registerMutationTool(
    "cancel_availability_draft",
    "Annule un brouillon de disponibilité.",
    "draft:availability",
    "availability_draft",
    {
      availabilityDraftId: z.string().min(1),
    },
    async (args) => {
      const { availabilityDraftId } = castArgs<{ availabilityDraftId: string }>(args);
      const draft = await cancelAvailabilityDraft(availabilityDraftId);
      return {
        payload: {
          draft: {
            availabilityDraftId: draft.id,
            status: draft.status,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerMutationTool(
    "approve_availability",
    "Approuve une disponibilité PENDING.",
    "approve:availability",
    "availability",
    {
      availabilityId: z.string().min(1),
      reviewComment: z.string().max(1000).optional().nullable(),
    },
    async (args) => {
      const { availabilityId, reviewComment } = castArgs<{
        availabilityId: string;
        reviewComment?: string | null;
      }>(args);
      const availability = await approveAvailability(availabilityId, reviewComment);
      return {
        payload: {
          availability: mapAvailability(availability as Awaited<ReturnType<typeof listAvailabilities>>[number]),
        },
        resourceId: availability.id,
      };
    },
  );

  registerMutationTool(
    "reject_availability",
    "Rejette une disponibilité PENDING.",
    "approve:availability",
    "availability",
    {
      availabilityId: z.string().min(1),
      reviewComment: z.string().max(1000).optional().nullable(),
    },
    async (args) => {
      const { availabilityId, reviewComment } = castArgs<{
        availabilityId: string;
        reviewComment?: string | null;
      }>(args);
      const availability = await rejectAvailability(availabilityId, reviewComment);
      return {
        payload: {
          availability: mapAvailability(availability as Awaited<ReturnType<typeof listAvailabilities>>[number]),
        },
        resourceId: availability.id,
      };
    },
  );

  registerMutationTool(
    "bulk_validate_availabilities",
    "Valide ou rejette plusieurs disponibilités PENDING.",
    "approve:availability",
    "availability",
    {
      availabilityIds: z.array(z.string().min(1)).min(1).max(200),
      action: z.enum(["APPROVE", "REJECT"]),
      reviewComment: z.string().max(1000).optional().nullable(),
    },
    async (args) => {
      const { availabilityIds, action, reviewComment } = castArgs<{
        availabilityIds: string[];
        action: "APPROVE" | "REJECT";
        reviewComment?: string | null;
      }>(args);
      const availabilities = await bulkValidateAvailabilities({
        availabilityIds,
        action,
        reviewComment,
      });

      return {
        payload: {
          availabilities: availabilities.map((availability) => mapAvailability(availability as Awaited<ReturnType<typeof listAvailabilities>>[number])),
          count: availabilities.length,
          action,
        },
      };
    },
  );

  registerMutationTool(
    "create_schedule_adjustment_draft",
    "Crée un brouillon d'ajustement du planning avec un change set explicite.",
    "draft:schedule",
    "schedule_adjustment_draft",
    {
      planningMonthId: z.string().min(1),
      title: z.string().max(200).optional().nullable(),
      changeSet: scheduleAdjustmentChangeSetSchema,
    },
    async (args, _extra, actor) => {
      const { planningMonthId, title, changeSet } = castArgs<{
        planningMonthId: string;
        title?: string | null;
        changeSet: z.infer<typeof scheduleAdjustmentChangeSetSchema>;
      }>(args);
      const draft = await createScheduleAdjustmentDraft({
        planningMonthId,
        createdByUserId: actor.id,
        title,
        changeSet,
      });

      return {
        payload: {
          draft: {
            scheduleAdjustmentDraftId: draft.id,
            planningMonthId: draft.planningMonthId,
            title: draft.title,
            status: draft.status,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerMutationTool(
    "preview_schedule_adjustment",
    "Valide et prévisualise un brouillon d'ajustement du planning.",
    "draft:schedule",
    "schedule_adjustment_draft",
    {
      scheduleAdjustmentDraftId: z.string().min(1),
    },
    async (args) => {
      const { scheduleAdjustmentDraftId } = castArgs<{ scheduleAdjustmentDraftId: string }>(args);
      const preview = await previewScheduleAdjustment(scheduleAdjustmentDraftId);
      return {
        payload: {
          draft: {
            scheduleAdjustmentDraftId: preview.draft.id,
            status: preview.draft.status,
          },
          preview: preview.preview,
        },
        resourceId: preview.draft.id,
      };
    },
  );

  registerMutationTool(
    "commit_schedule_adjustment",
    "Commite un brouillon d'ajustement du planning après preview valide.",
    "commit:schedule",
    "schedule_adjustment_draft",
    {
      scheduleAdjustmentDraftId: z.string().min(1),
    },
    async (args) => {
      const { scheduleAdjustmentDraftId } = castArgs<{ scheduleAdjustmentDraftId: string }>(args);
      const draft = await commitScheduleAdjustment(scheduleAdjustmentDraftId);
      return {
        payload: {
          draft: {
            scheduleAdjustmentDraftId: draft.id,
            status: draft.status,
            committedAt: draft.committedAt?.toISOString() ?? null,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerMutationTool(
    "cancel_schedule_adjustment_draft",
    "Annule un brouillon d'ajustement du planning.",
    "draft:schedule",
    "schedule_adjustment_draft",
    {
      scheduleAdjustmentDraftId: z.string().min(1),
    },
    async (args) => {
      const { scheduleAdjustmentDraftId } = castArgs<{ scheduleAdjustmentDraftId: string }>(args);
      const draft = await cancelScheduleAdjustmentDraft(scheduleAdjustmentDraftId);
      return {
        payload: {
          draft: {
            scheduleAdjustmentDraftId: draft.id,
            status: draft.status,
          },
        },
        resourceId: draft.id,
      };
    },
  );

  registerReadTool(
    "suggest_schedule_improvements",
    "Propose un ensemble d'affectations volontaires pour améliorer la couverture sur une période.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    async (args, _extra, actor) => {
      const { planningMonthId, startTime, endTime } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
      }>(args);
      assertCapability(actor.role, "draft:schedule");
      const suggestions = await suggestScheduleImprovements({
        planningMonthId,
        startTime: parseOptionalDate(startTime),
        endTime: parseOptionalDate(endTime),
      });

      return {
        suggestions,
        count: suggestions.length,
      };
    },
  );

  registerReadTool(
    "suggest_candidates_for_slot",
    "Retourne les candidats capables de couvrir complètement ou partiellement un slot ou de remplacer une garde.",
    {
      slotId: z.string().optional(),
      assignmentId: z.string().optional(),
      maxFullSuggestions: z.number().int().positive().max(20).optional(),
      maxPartialSuggestions: z.number().int().positive().max(20).optional(),
    },
    async (args) => {
      const { slotId, assignmentId, maxFullSuggestions, maxPartialSuggestions } = castArgs<{
        slotId?: string;
        assignmentId?: string;
        maxFullSuggestions?: number;
        maxPartialSuggestions?: number;
      }>(args);
      return {
        suggestions: await suggestCandidatesForSlot({
          slotId,
          assignmentId,
          maxFullSuggestions,
          maxPartialSuggestions,
        }),
      };
    },
  );

  registerReadTool(
    "explain_coverage_issues",
    "Explique les problèmes de couverture restants sur une période.",
    {
      planningMonthId: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    async (args) => {
      const { planningMonthId, startTime, endTime } = castArgs<{
        planningMonthId?: string;
        startTime?: string;
        endTime?: string;
      }>(args);
      return {
        explanation: await explainCoverageIssues({
          planningMonthId,
          startTime: parseOptionalDate(startTime),
          endTime: parseOptionalDate(endTime),
        }),
      };
    },
  );

  registerReadTool(
    "get_business_rules",
    "Retourne les règles métier stables du planning ambulance.",
    {},
    async () => ({
      businessRules: getBusinessRules(),
    }),
  );

  registerReadTool(
    "get_role_capabilities",
    "Retourne les capacités du rôle courant et le catalogue des rôles.",
    {},
    async (_args, _extra, actor) => ({
      currentUser: {
        appUserId: actor.id,
        email: actor.email,
        displayName: actor.displayName,
        role: actor.role,
      },
      capabilities: getRoleCapabilities(),
    }),
  );

  registerReadTool(
    "explain_availability_statuses",
    "Explique les statuts de disponibilité exposés par le MCP.",
    {},
    async () => ({
      statuses: explainAvailabilityStatuses(),
    }),
  );
}
