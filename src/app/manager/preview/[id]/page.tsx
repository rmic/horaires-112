import { notFound } from "next/navigation";
import { PublicScheduleContent } from "@/components/published/public-schedule-view";
import { getManagerPreviewPayload } from "@/lib/server/public-schedule";
import { requireManagerSession } from "@/lib/server/web-manager-auth";

export default async function ManagerPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireManagerSession();
  const { id } = await params;

  const payload = await getManagerPreviewPayload(id);
  if (!payload) {
    notFound();
  }

  return (
    <PublicScheduleContent
      payload={payload}
      title={`Aperçu manager ${String(payload.month?.month).padStart(2, "0")}/${payload.month?.year}`}
      description="Prévisualisation du rendu public, accessible uniquement aux managers authentifiés."
    />
  );
}
