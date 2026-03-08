import { AvailabilityStatus } from "@prisma/client";
import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { generateDraftAssignments } from "@/lib/draft";
import { prisma } from "@/lib/prisma";
import { logAssignmentEvent } from "@/lib/server/events";

export const runtime = "nodejs";

const draftSchema = z.object({
  replaceExistingDraft: z.boolean().default(true),
});

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;

    const body = draftSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Paramètres du brouillon invalides.", body.error.flatten());
    }

    const month = await prisma.planningMonth.findUnique({
      where: {
        id: planningMonthId,
      },
      include: {
        assignments: true,
        employeeBlocks: true,
      },
    });

    if (!month) {
      throw new ApiError(404, "Mois introuvable.");
    }

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
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    const baseAssignments = month.assignments.filter(
      (assignment) => !(body.data.replaceExistingDraft && assignment.source === "DRAFT"),
    );

    const draftAssignments = generateDraftAssignments({
      monthStart: month.startsAt,
      monthEnd: month.endsAt,
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
      assignments: baseAssignments.map((assignment) => ({
        id: assignment.id,
        volunteerId: assignment.volunteerId,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      })),
      employeeBlocks: month.employeeBlocks.map((block) => ({
        id: block.id,
        startTime: block.startTime,
        endTime: block.endTime,
      })),
    });

    const created = await prisma.$transaction(async (tx) => {
      if (body.data.replaceExistingDraft) {
        await tx.assignment.deleteMany({
          where: {
            planningMonthId,
            source: "DRAFT",
          },
        });
      }

      const inserted = [] as Array<{ id: string; volunteerId: string; startTime: Date; endTime: Date }>;

      for (const draft of draftAssignments) {
        const assignment = await tx.assignment.create({
          data: {
            planningMonthId,
            volunteerId: draft.volunteerId,
            startTime: draft.startTime,
            endTime: draft.endTime,
            status: "PROVISIONAL",
            source: "DRAFT",
          },
        });

        inserted.push({
          id: assignment.id,
          volunteerId: assignment.volunteerId,
          startTime: assignment.startTime,
          endTime: assignment.endTime,
        });
      }

      return inserted;
    });

    for (const assignment of created) {
      await logAssignmentEvent({
        planningMonthId,
        assignmentId: assignment.id,
        eventType: "CREATED",
        payload: {
          source: "DRAFT",
          volunteerId: assignment.volunteerId,
          startTime: assignment.startTime.toISOString(),
          endTime: assignment.endTime.toISOString(),
        },
      });
    }

    return ok({
      createdCount: created.length,
    });
  });
