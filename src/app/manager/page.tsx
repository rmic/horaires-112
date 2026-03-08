import { ManagerDashboard } from "@/components/manager/manager-dashboard";
import { isManagerAuthConfigured } from "@/lib/manager-auth";

export default function ManagerPage() {
  return <ManagerDashboard managerAuthEnabled={isManagerAuthConfigured()} />;
}
