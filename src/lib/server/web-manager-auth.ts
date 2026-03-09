import { AppUserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { ApiError } from "@/lib/api";
import { authOptions } from "@/lib/auth-options";
import { isValidManagerSessionToken, MANAGER_SESSION_COOKIE } from "@/lib/manager-auth";
import { prisma } from "@/lib/prisma";

export async function requireManagerSession() {
  const cookieStore = await cookies();
  const passwordSessionToken = cookieStore.get(MANAGER_SESSION_COOKIE)?.value;

  if (await isValidManagerSessionToken(passwordSessionToken)) {
    return {
      role: AppUserRole.PLANNER,
      appUser: null,
      authMode: "password" as const,
    };
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();

  if (!session?.user?.managerAuthorized || !email) {
    throw new ApiError(401, "Session manager requise.");
  }

  const appUser = await prisma.appUser.findUnique({
    where: {
      email,
    },
  });

  if (!appUser?.active) {
    throw new ApiError(403, "Accès manager refusé.");
  }

  return {
    role: appUser.role,
    appUser,
    authMode: "oauth" as const,
  };
}

export async function requirePlannerAccess() {
  const context = await requireManagerSession();

  if (context.role !== AppUserRole.PLANNER) {
    throw new ApiError(403, "Permission insuffisante pour modifier les données.");
  }

  return context;
}
