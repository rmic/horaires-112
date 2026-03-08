import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const volunteerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

const palette = ["#0ea5e9", "#22c55e", "#f97316", "#e11d48", "#8b5cf6", "#14b8a6", "#f59e0b"];

export const GET = () =>
  withApiError(async () => {
    const volunteers = await prisma.volunteer.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            availabilities: true,
            assignments: true,
          },
        },
      },
    });

    return ok({ volunteers });
  });

export const POST = (request: Request) =>
  withApiError(async () => {
    const body = volunteerSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Formulaire volontaire invalide.", body.error.flatten());
    }

    const existingCount = await prisma.volunteer.count();

    const volunteer = await prisma.volunteer.create({
      data: {
        name: body.data.name,
        color: body.data.color ?? palette[existingCount % palette.length],
      },
    });

    return ok({ volunteer }, { status: 201 });
  });
