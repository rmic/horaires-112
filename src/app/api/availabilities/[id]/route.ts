import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { deleteAvailability, updateAvailability } from "@/lib/server/availability-service";
import { parseDateInput } from "@/lib/time";

export const runtime = "nodejs";

const patchSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
});

export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    const body = patchSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Disponibilité invalide.", body.error.flatten());
    }

    const availability = await updateAvailability(id, {
      startTime: parseDateInput(body.data.startTime),
      endTime: parseDateInput(body.data.endTime),
    });

    return ok({ availability });
  });

export const DELETE = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    await deleteAvailability(id);

    return ok({ success: true });
  });
