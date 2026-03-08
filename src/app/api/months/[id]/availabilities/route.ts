import { AvailabilityStatus } from "@prisma/client";
import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { createAvailability, listAvailabilities } from "@/lib/server/availability-service";
import { parseDateInput } from "@/lib/time";

export const runtime = "nodejs";

const createAvailabilitySchema = z.object({
  volunteerId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
});

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const volunteerId = searchParams.get("volunteerId");
    const statusQuery = searchParams.get("status");

    const statuses = statusQuery
      ? statusQuery.split(",").map((status) => AvailabilityStatus[status as keyof typeof AvailabilityStatus])
      : undefined;

    const availabilities = await listAvailabilities({
      planningMonthId,
      volunteerId: volunteerId ?? undefined,
      statuses: statuses?.filter((value): value is AvailabilityStatus => Boolean(value)),
    });

    return ok({ availabilities });
  });

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;

    const body = createAvailabilitySchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Disponibilité invalide.", body.error.flatten());
    }

    const availability = await createAvailability({
      planningMonthId,
      volunteerId: body.data.volunteerId,
      startTime: parseDateInput(body.data.startTime),
      endTime: parseDateInput(body.data.endTime),
      status: AvailabilityStatus.APPROVED,
    });

    return ok({ availability }, { status: 201 });
  });
