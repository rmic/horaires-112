import { AppUserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getEnvManagerAllowedEmails() {
  return new Set(
    (process.env.MANAGER_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean),
  );
}

export function isManagerEmailAllowedByEnv(email: string) {
  return getEnvManagerAllowedEmails().has(normalizeEmail(email));
}

export async function getManagerAccessByEmail(email: string) {
  return prisma.managerAccess.findUnique({
    where: {
      email: normalizeEmail(email),
    },
  });
}

export async function isManagerEmailAllowed(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (isManagerEmailAllowedByEnv(normalizedEmail)) {
    return true;
  }

  const managerAccess = await getManagerAccessByEmail(normalizedEmail);
  return Boolean(managerAccess?.active);
}

export async function getManagerRoleForEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const managerAccess = await getManagerAccessByEmail(normalizedEmail);

  if (managerAccess?.active) {
    return managerAccess.role;
  }

  if (isManagerEmailAllowedByEnv(normalizedEmail)) {
    return AppUserRole.PLANNER;
  }

  return null;
}
