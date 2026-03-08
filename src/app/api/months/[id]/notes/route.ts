import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  volunteerId: z.string().optional().nullable(),
});

export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;

    const notes = await prisma.note.findMany({
      where: {
        planningMonthId,
      },
      include: {
        volunteer: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return ok({ notes });
  });

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;

    const body = createNoteSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Note invalide.", body.error.flatten());
    }

    const note = await prisma.note.create({
      data: {
        planningMonthId,
        volunteerId: body.data.volunteerId ?? null,
        body: body.data.body,
      },
      include: {
        volunteer: true,
      },
    });

    return ok({ note }, { status: 201 });
  });
