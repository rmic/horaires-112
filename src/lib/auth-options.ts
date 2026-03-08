import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import GoogleProvider from "next-auth/providers/google";
import { AppUserRole } from "@prisma/client";
import { getConfiguredManagerOAuthProviders, isManagerOAuthConfigured } from "@/lib/manager-auth";
import { prisma } from "@/lib/prisma";
import { provisionAuthorizedManagerFromExternalIdentity } from "@/lib/server/app-user-identities";

function buildProviders() {
  const configuredProviders = getConfiguredManagerOAuthProviders();
  const providers = [];

  if (configuredProviders.some((provider) => provider.id === "google")) {
    providers.push(
      GoogleProvider({
        clientId: process.env.AUTH_GOOGLE_ID!,
        clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      }),
    );
  }

  if (configuredProviders.some((provider) => provider.id === "azure-ad")) {
    providers.push(
      AzureADProvider({
        clientId: process.env.AUTH_MICROSOFT_ID!,
        clientSecret: process.env.AUTH_MICROSOFT_SECRET!,
        tenantId: process.env.AUTH_MICROSOFT_TENANT_ID?.trim() || "common",
      }),
    );
  }

  return providers;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET || "dev-auth-secret-not-for-production",
  session: {
    strategy: "jwt",
  },
  providers: buildProviders(),
  pages: {
    signIn: "/manager/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!isManagerOAuthConfigured()) {
        return "/manager/login?error=oauth-not-configured";
      }

      const email = user.email?.trim().toLowerCase();
      const subject = account?.providerAccountId?.trim();
      const providerId = account?.provider?.trim();

      if (!email || !subject || !providerId) {
        return "/manager/login?error=identity-incomplete";
      }

      const result = await provisionAuthorizedManagerFromExternalIdentity({
        email,
        displayName: user.name,
        providerKey: `nextauth:${providerId}`,
        providerName: account?.provider ?? providerId,
        subject,
      });

      if (!result.ok) {
        return `/manager/login?error=${encodeURIComponent(result.reason)}`;
      }

      return true;
    },
    async jwt({ token, user, account }) {
      const email = (user?.email ?? token.email)?.trim().toLowerCase();

      if (!email) {
        token.managerAuthorized = false;
        token.managerRole = null;
        token.appUserId = null;
        return token;
      }

      if (account?.provider && account.providerAccountId) {
        const provisioned = await provisionAuthorizedManagerFromExternalIdentity({
          email,
          displayName: user?.name ?? token.name,
          providerKey: `nextauth:${account.provider}`,
          providerName: account.provider,
          subject: account.providerAccountId,
        });

        if (!provisioned.ok) {
          token.managerAuthorized = false;
          token.managerRole = null;
          token.appUserId = null;
          token.email = email;
          return token;
        }

        token.email = provisioned.appUser.email;
        token.appUserId = provisioned.appUser.id;
        token.managerAuthorized = true;
        token.managerRole = provisioned.appUser.role;
        return token;
      }

      const appUser = await prisma.appUser.findUnique({
        where: {
          email,
        },
      });

      token.email = email;
      token.appUserId = appUser?.active ? appUser.id : null;
      token.managerAuthorized = Boolean(appUser?.active);
      token.managerRole = appUser?.active ? appUser.role : null;

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = typeof token.email === "string" ? token.email : session.user.email;
        session.user.id = typeof token.appUserId === "string" ? token.appUserId : null;
        session.user.managerAuthorized = Boolean(token.managerAuthorized);
        session.user.role =
          token.managerRole === AppUserRole.PLANNER || token.managerRole === AppUserRole.READ_ONLY
            ? token.managerRole
            : null;
      }

      return session;
    },
  },
};
