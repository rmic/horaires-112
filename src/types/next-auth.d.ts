import type { AppUserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string | null;
      role: AppUserRole | null;
      managerAuthorized: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    appUserId?: string | null;
    managerRole?: AppUserRole | null;
    managerAuthorized?: boolean;
  }
}
