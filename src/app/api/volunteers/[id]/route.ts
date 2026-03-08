import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;
    const body = patchSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Formulaire invalide.", body.error.flatten());
    }

    const volunteer = await prisma.volunteer.update({
      where: { id },
      data: {
        ...(body.data.name ? { name: body.data.name } : {}),
        ...(body.data.color ? { color: body.data.color } : {}),
      },
    });

    return ok({ volunteer });
  });

export const DELETE = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    const assignmentCount = await prisma.assignment.count({
      where: {
        volunteerId: id,
      },
    });

    if (assignmentCount > 0) {
      throw new ApiError(
        409,
        "Impossible de supprimer ce volontaire: des gardes existent déjà. Supprimez-les d'abord.",
      );
    }

    await prisma.volunteer.delete({
      where: { id },
    });

    return ok({ success: true });
  });
