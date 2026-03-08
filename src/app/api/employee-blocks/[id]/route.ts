import { ApiError, ok, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export const DELETE = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
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
