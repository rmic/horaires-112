import { isAfter, isBefore } from "date-fns";
import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { validateEmployeeBlock } from "@/lib/constraints";
import { prisma } from "@/lib/prisma";
import { generateFixedEmployeeBlocks } from "@/lib/server/employee-blocks";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";
import { getPlanningMonthWindow, parseDateInput } from "@/lib/time";

export const runtime = "nodejs";

const manualSchema = z.object({
  mode: z.literal("manual"),
  startTime: z.string(),
  endTime: z.string(),
  label: z.string().trim().min(1).max(30).optional(),
});

const bulkSchema = z.object({
  mode: z.literal("bulk"),
  replaceExisting: z.boolean().default(true),
});

const schema = z.union([manualSchema, bulkSchema]);

export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;
    const employeeBlocks = await prisma.employeeBlock.findMany({
      where: {
        planningMonthId,
      },
      orderBy: {
        startTime: "asc",
      },
    });

    return ok({ employeeBlocks });
  });

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id: planningMonthId } = await context.params;

    const month = await prisma.planningMonth.findUnique({ where: { id: planningMonthId } });
    if (!month) {
      throw new ApiError(404, "Mois introuvable.");
    }
    const window = getPlanningMonthWindow(month);

    const body = schema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Bloc salarié invalide.", body.error.flatten());
    }

    if (body.data.mode === "bulk") {
      const { replaceExisting } = body.data;
      const blocks = generateFixedEmployeeBlocks(window.coverageStart, window.coverageEnd);

      await prisma.$transaction(async (tx) => {
        if (replaceExisting) {
          await tx.employeeBlock.deleteMany({
            where: {
              planningMonthId,
            },
          });
        }

        if (blocks.length > 0) {
          await tx.employeeBlock.createMany({
            data: blocks.map((block) => ({
              planningMonthId,
              startTime: block.startTime,
              endTime: block.endTime,
              label: block.label,
            })),
          });
        }
      });

      return ok({ generated: blocks.length });
    }

    const startTime = parseDateInput(body.data.startTime);
    const endTime = parseDateInput(body.data.endTime);

    const message = validateEmployeeBlock(startTime, endTime);
    if (message) {
      throw new ApiError(400, message);
    }

    const intersectsMonth = isBefore(startTime, window.coverageEnd) && isAfter(endTime, window.coverageStart);
    if (!intersectsMonth) {
      throw new ApiError(400, "Le bloc salarié doit couvrir au moins une partie du mois.");
    }

    const employeeBlock = await prisma.employeeBlock.create({
      data: {
        planningMonthId,
        startTime,
        endTime,
        label: body.data.label ?? "Salarié",
      },
    });

    return ok({ employeeBlock }, { status: 201 });
  });
