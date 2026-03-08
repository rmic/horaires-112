import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { generateFixedEmployeeBlocks } from "@/lib/server/employee-blocks";
import { getMonthBounds } from "@/lib/time";

export const runtime = "nodejs";

const createMonthSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  autoGenerateEmployeeBlocks: z.boolean().default(false),
});

export const GET = () =>
  withApiError(async () => {
    const months = await prisma.planningMonth.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        _count: {
          select: {
            assignments: true,
            availabilities: true,
            employeeBlocks: true,
          },
        },
      },
    });

    return ok({ months });
  });

export const POST = (request: Request) =>
  withApiError(async () => {
    const body = createMonthSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Formulaire mois invalide.", body.error.flatten());
    }

    const existing = await prisma.planningMonth.findUnique({
      where: {
        year_month: {
          year: body.data.year,
          month: body.data.month,
        },
      },
    });

    if (existing) {
      throw new ApiError(409, "Ce mois existe déjà.");
    }

    const bounds = getMonthBounds(body.data.year, body.data.month);

    const month = await prisma.$transaction(async (tx) => {
      const created = await tx.planningMonth.create({
        data: {
          year: body.data.year,
          month: body.data.month,
          startsAt: bounds.startsAt,
          endsAt: bounds.endsAt,
        },
      });

      if (body.data.autoGenerateEmployeeBlocks) {
        const blocks = generateFixedEmployeeBlocks(bounds.startsAt, bounds.endsAt);
        if (blocks.length > 0) {
          await tx.employeeBlock.createMany({
            data: blocks.map((block) => ({
              planningMonthId: created.id,
              startTime: block.startTime,
              endTime: block.endTime,
              label: block.label,
            })),
          });
        }
      }

      return created;
    });

    return ok({ month }, { status: 201 });
  });
