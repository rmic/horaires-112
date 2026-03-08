import { AppUserRole } from "@prisma/client";
import { ApiError } from "@/lib/api";

export type Capability =
  | "read:schedule"
  | "read:availabilities"
  | "read:gaps"
  | "read:rules"
  | "draft:availability"
  | "draft:schedule"
  | "commit:availability"
  | "approve:availability"
  | "commit:schedule";

const roleCapabilities: Record<AppUserRole, Capability[]> = {
  READ_ONLY: [
    "read:schedule",
    "read:availabilities",
    "read:gaps",
    "read:rules",
    "draft:availability",
    "draft:schedule",
  ],
  PLANNER: [
    "read:schedule",
    "read:availabilities",
    "read:gaps",
    "read:rules",
    "draft:availability",
    "draft:schedule",
    "commit:availability",
    "approve:availability",
    "commit:schedule",
  ],
};

export function getCapabilitiesForRole(role: AppUserRole) {
  return roleCapabilities[role];
}

export function hasCapability(role: AppUserRole, capability: Capability) {
  return roleCapabilities[role].includes(capability);
}

export function assertCapability(role: AppUserRole, capability: Capability) {
  if (!hasCapability(role, capability)) {
    throw new ApiError(403, `Permission insuffisante pour l'action ${capability}.`);
  }
}

export function getRoleCapabilitiesCatalog() {
  return Object.entries(roleCapabilities).map(([role, capabilities]) => ({
    role,
    capabilities,
  }));
}
