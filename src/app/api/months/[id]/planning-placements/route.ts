import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { placeVolunteerOnPlanningLane } from "@/lib/server/planning-placement-service";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";
import { parseDateInput } from "@/lib/time";

export const runtime = "nodejs";

const schema = z.object({
  volunteerId: z.string().min(1),
  lane: z.enum(["A1", "A2", "A3"]),
  startTime: z.string(),
  endTime: z.string(),
  ignoreRestWarning: z.boolean().optional().default(false),
  resolutions: z
    .array(
      z.object({
        assignmentId: z.string().min(1),
        winner: z.enum(["existing", "new"]),
      }),
    )
    .optional(),
});

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id: planningMonthId } = await context.params;

    const body = schema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Placement invalide.", body.error.flatten());
    }

    const result = await placeVolunteerOnPlanningLane({
      planningMonthId,
      volunteerId: body.data.volunteerId,
      lane: body.data.lane,
      startTime: parseDateInput(body.data.startTime),
      endTime: parseDateInput(body.data.endTime),
      ignoreRestWarning: body.data.ignoreRestWarning,
      resolutions: body.data.resolutions,
    });

    return ok(result, { status: 201 });
  });
