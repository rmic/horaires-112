import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { logAssignmentEvent } from "@/lib/server/events";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";

export const runtime = "nodejs";

const publishSchema = z.object({
  publish: z.boolean(),
  password: z.string().optional().nullable(),
});

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id } = await context.params;
    const body = publishSchema.safeParse(await readJson<unknown>(request));

    if (!body.success) {
      throw new ApiError(400, "Paramètres de publication invalides.", body.error.flatten());
    }

    const month = await prisma.planningMonth.findUnique({
      where: {
        id,
      },
    });

    if (!month) {
      throw new ApiError(404, "Mois introuvable.");
    }

    const publicPasswordHash =
      body.data.publish && body.data.password ? await hashPassword(body.data.password) : null;

    const updated = await prisma.planningMonth.update({
      where: {
        id,
      },
      data: {
        status: body.data.publish ? "PUBLISHED" : "DRAFT",
        publishedAt: body.data.publish ? new Date() : null,
        publicPasswordHash,
      },
    });

    await logAssignmentEvent({
      planningMonthId: month.id,
      eventType: body.data.publish ? "PUBLISHED" : "UNPUBLISHED",
      payload: {
        publishedAt: updated.publishedAt?.toISOString() ?? null,
        passwordProtected: Boolean(publicPasswordHash),
      },
    });

    return ok({ month: updated });
  });
