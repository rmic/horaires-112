import { AppUserRole, AuthIdentityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getManagerRoleForEmail, isManagerEmailAllowed } from "@/lib/server/manager-access";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function fallbackDisplayName(email: string) {
  return normalizeEmail(email).split("@")[0] ?? email;
}

export async function provisionAuthorizedManagerFromExternalIdentity(params: {
  email: string;
  displayName?: string | null;
  providerKey: string;
  providerName: string;
  subject: string;
}) {
  const email = normalizeEmail(params.email);
  const allowed = await isManagerEmailAllowed(email);

  if (!allowed) {
    return {
      ok: false as const,
      reason: "not-authorized",
    };
  }

  const role = (await getManagerRoleForEmail(email)) ?? AppUserRole.PLANNER;
  const existingUser = await prisma.appUser.findUnique({
    where: {
      email,
    },
  });

  const existingIdentity = await prisma.appUserIdentity.findUnique({
    where: {
      providerKey_subject: {
        providerKey: params.providerKey,
        subject: params.subject,
      },
    },
    include: {
      appUser: true,
    },
  });

  if (existingIdentity && existingUser && existingIdentity.appUserId !== existingUser.id) {
    return {
      ok: false as const,
      reason: "identity-conflict",
    };
  }

  if (existingIdentity && normalizeEmail(existingIdentity.appUser.email) !== email) {
    return {
      ok: false as const,
      reason: "email-conflict",
    };
  }

  const appUser =
    existingUser ??
    (await prisma.appUser.create({
      data: {
        email,
        displayName: params.displayName?.trim() || fallbackDisplayName(email),
        role,
        active: true,
      },
    }));

  const nextDisplayName = params.displayName?.trim() || appUser.displayName || fallbackDisplayName(email);

  const updatedAppUser =
    appUser.displayName !== nextDisplayName || appUser.role !== role || !appUser.active
      ? await prisma.appUser.update({
          where: {
            id: appUser.id,
          },
          data: {
            displayName: nextDisplayName,
            role,
            active: true,
          },
        })
      : appUser;

  await prisma.appUserIdentity.upsert({
    where: {
      providerKey_subject: {
        providerKey: params.providerKey,
        subject: params.subject,
      },
    },
    update: {
      appUserId: updatedAppUser.id,
      providerName: params.providerName,
      email,
      lastSeenAt: new Date(),
    },
    create: {
      appUserId: updatedAppUser.id,
      type: AuthIdentityType.WEB_OAUTH,
      providerKey: params.providerKey,
      providerName: params.providerName,
      subject: params.subject,
      email,
      lastSeenAt: new Date(),
    },
  });

  return {
    ok: true as const,
    appUser: updatedAppUser,
  };
}

export async function provisionAppUserForMcpIdentity(params: {
  email: string;
  displayName: string;
  role: AppUserRole;
  providerKey: string;
  providerName?: string;
  subject: string;
  active?: boolean;
}) {
  const email = normalizeEmail(params.email);
  const active = params.active ?? true;

  const existingUser = await prisma.appUser.findUnique({
    where: {
      email,
    },
  });

  const appUser =
    existingUser ??
    (await prisma.appUser.create({
      data: {
        email,
        displayName: params.displayName.trim() || fallbackDisplayName(email),
        role: params.role,
        active,
      },
    }));

  const updatedAppUser =
    appUser.displayName !== params.displayName ||
    appUser.role !== params.role ||
    appUser.active !== active ||
    (appUser.oidcIssuer !== params.providerKey && params.providerKey.startsWith("http"))
      ? await prisma.appUser.update({
          where: {
            id: appUser.id,
          },
          data: {
            displayName: params.displayName.trim() || fallbackDisplayName(email),
            role: params.role,
            active,
            oidcIssuer: params.providerKey.startsWith("http") ? params.providerKey : appUser.oidcIssuer,
            oidcSubject: params.providerKey.startsWith("http") ? params.subject : appUser.oidcSubject,
          },
        })
      : appUser;

  await prisma.appUserIdentity.upsert({
    where: {
      providerKey_subject: {
        providerKey: params.providerKey,
        subject: params.subject,
      },
    },
    update: {
      appUserId: updatedAppUser.id,
      providerName: params.providerName ?? params.providerKey,
      email,
      lastSeenAt: new Date(),
    },
    create: {
      appUserId: updatedAppUser.id,
      type: AuthIdentityType.MCP_OIDC,
      providerKey: params.providerKey,
      providerName: params.providerName ?? params.providerKey,
      subject: params.subject,
      email,
      lastSeenAt: new Date(),
    },
  });

  return updatedAppUser;
}

export async function resolveAppUserByExternalIdentity(params: {
  providerKey: string;
  subject: string;
  email?: string | null;
}) {
  const identity = await prisma.appUserIdentity.findUnique({
    where: {
      providerKey_subject: {
        providerKey: params.providerKey,
        subject: params.subject,
      },
    },
    include: {
      appUser: true,
    },
  });

  const appUser =
    identity?.appUser ??
    (await prisma.appUser.findFirst({
      where: {
        oidcIssuer: params.providerKey,
        oidcSubject: params.subject,
      },
    }));

  if (!appUser || !appUser.active) {
    return null;
  }

  if (params.email && normalizeEmail(params.email) !== normalizeEmail(appUser.email)) {
    return null;
  }

  if (identity) {
    await prisma.appUserIdentity.update({
      where: {
        id: identity.id,
      },
      data: {
        email: params.email ? normalizeEmail(params.email) : identity.email,
        lastSeenAt: new Date(),
      },
    });
  }

  return appUser;
}
