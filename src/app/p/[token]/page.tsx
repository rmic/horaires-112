import { PublicScheduleView } from "@/components/published/public-schedule-view";

export default async function PublicTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicScheduleView token={token} />;
}
