import { ApiError, withApiError } from "@/lib/api";
import { renderSchedulePdf } from "@/lib/pdf";
import { getMonthSnapshot } from "@/lib/server/month-data";
import { getMonthLabel } from "@/lib/time";

export const runtime = "nodejs";

export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id } = await context.params;

    const snapshot = await getMonthSnapshot(id);
    if (!snapshot) {
      throw new ApiError(404, "Mois introuvable.");
    }

    const pdf = await renderSchedulePdf({
      monthLabel: getMonthLabel(snapshot.month.year, snapshot.month.month),
      dayTimelines: snapshot.dayTimelines,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=planning-${snapshot.month.year}-${String(snapshot.month.month).padStart(2, "0")}.pdf`,
      },
    });
  });
