import { ApiError, ok, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";

export const runtime = "nodejs";

export const DELETE = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id } = await context.params;

    const existing = await prisma.employeeBlock.findUnique({
      where: {
        id,
      },
    });

    if (!existing) {
      throw new ApiError(404, "Bloc salarié introuvable.");
    }

    await prisma.employeeBlock.delete({
      where: {
        id,
      },
    });

    return ok({ success: true });
  });
