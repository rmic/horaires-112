import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getMonthSnapshot } from "@/lib/server/month-data";

export const runtime = "nodejs";

const patchSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    const snapshot = await getMonthSnapshot(id);
    if (!snapshot) {
      throw new ApiError(404, "Mois introuvable.");
    }

    const volunteers = await prisma.volunteer.findMany({
      include: {
        monthSettings: {
          where: {
            planningMonthId: id,
          },
          take: 1,
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    const origin = new URL(request.url).origin;

    return ok({
      month: snapshot.month,
      volunteers: volunteers.map((volunteer) => ({
        id: volunteer.id,
        name: volunteer.name,
        color: volunteer.color,
        monthMaxGuardsPerMonth: volunteer.monthSettings[0]?.maxGuardsPerMonth ?? null,
      })),
      coverageSegments: snapshot.segments,
      dayTimelines: snapshot.dayTimelines,
      gaps: snapshot.gaps,
      publicUrl: `${origin}/p/${snapshot.month.publicToken}`,
    });
  });

export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    const body = patchSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Formulaire invalide.", body.error.flatten());
    }

    const month = await prisma.planningMonth.update({
      where: { id },
      data: {
        ...(body.data.status ? { status: body.data.status } : {}),
      },
    });

    return ok({ month });
  });

export const DELETE = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    await prisma.planningMonth.delete({
      where: { id },
    });

    return ok({ success: true });
  });
