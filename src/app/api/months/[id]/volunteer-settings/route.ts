import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";

export const runtime = "nodejs";

const volunteerSettingSchema = z.object({
  volunteerId: z.string().min(1),
  maxGuardsPerMonth: z.number().int().positive().max(62).nullable(),
});

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id: planningMonthId } = await context.params;

    const body = volunteerSettingSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Paramètres du plafond mensuel invalides.", body.error.flatten());
    }

    const month = await prisma.planningMonth.findUnique({
      where: {
        id: planningMonthId,
      },
    });

    if (!month) {
      throw new ApiError(404, "Mois introuvable.");
    }

    const volunteer = await prisma.volunteer.findUnique({
      where: {
        id: body.data.volunteerId,
      },
    });

    if (!volunteer) {
      throw new ApiError(404, "Volontaire introuvable.");
    }

    if (body.data.maxGuardsPerMonth === null) {
      await prisma.volunteerMonthSetting.deleteMany({
        where: {
          planningMonthId,
          volunteerId: body.data.volunteerId,
        },
      });

      return ok({
        volunteerSetting: null,
      });
    }

    const volunteerSetting = await prisma.volunteerMonthSetting.upsert({
      where: {
        planningMonthId_volunteerId: {
          planningMonthId,
          volunteerId: body.data.volunteerId,
        },
      },
      create: {
        planningMonthId,
        volunteerId: body.data.volunteerId,
        maxGuardsPerMonth: body.data.maxGuardsPerMonth,
      },
      update: {
        maxGuardsPerMonth: body.data.maxGuardsPerMonth,
      },
    });

    return ok({ volunteerSetting });
  });
