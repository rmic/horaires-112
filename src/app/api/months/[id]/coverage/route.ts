import { ApiError, ok, withApiError } from "@/lib/api";
import { getStaffingGaps } from "@/lib/server/schedule-service";

export const runtime = "nodejs";

export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;

    const gaps = await getStaffingGaps({ planningMonthId });
    if (!gaps) {
      throw new ApiError(404, "Mois introuvable.");
    }

    return ok({ gaps });
  });
