import { AssignmentStatus } from "@prisma/client";
import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { deleteAssignment, updateAssignment } from "@/lib/server/assignment-service";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";
import { parseDateInput } from "@/lib/time";

export const runtime = "nodejs";

const patchSchema = z.object({
  volunteerId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  status: z.nativeEnum(AssignmentStatus),
  ignoreRestWarning: z.boolean().optional().default(false),
});

export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id } = await context.params;

    const body = patchSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Garde invalide.", body.error.flatten());
    }

    const assignment = await updateAssignment(id, {
      volunteerId: body.data.volunteerId,
      startTime: parseDateInput(body.data.startTime),
      endTime: parseDateInput(body.data.endTime),
      status: body.data.status,
      ignoreRestWarning: body.data.ignoreRestWarning,
    });

    return ok({ assignment });
  });

export const DELETE = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id } = await context.params;

    await deleteAssignment(id);

    return ok({ success: true });
  });
