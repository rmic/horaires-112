import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ManagerLoginCard } from "@/components/manager/manager-login-card";
import { authOptions } from "@/lib/auth-options";
import {
  getConfiguredManagerOAuthProviders,
  isManagerAuthConfigured,
  isManagerOpenAccessEnabled,
  isManagerPasswordConfigured,
  isValidManagerSessionToken,
  MANAGER_SESSION_COOKIE,
} from "@/lib/manager-auth";

function sanitizeNextPath(nextPath?: string) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/manager";
  }

  if (nextPath.startsWith("/manager/login")) {
    return "/manager";
  }

  return nextPath;
}

function mapLoginError(errorCode?: string) {
  switch (errorCode) {
    case "not-authorized":
      return "Ce compte est authentifié, mais n'est pas autorisé comme responsable dans l'application.";
    case "identity-conflict":
    case "email-conflict":
      return "Ce compte externe est déjà lié de manière incohérente. Vérifiez la configuration des accès.";
    case "identity-incomplete":
      return "Le provider n'a pas renvoyé les informations minimales attendues pour identifier le compte.";
    case "oauth-not-configured":
      return "La connexion OAuth n'est pas configurée correctement sur cette instance.";
    case "auth-not-configured":
      return "L'accès manager est bloqué tant qu'aucune authentification n'est configurée. Configure Google et/ou Microsoft, ou active explicitement l'ouverture locale.";
    case "AccessDenied":
      return "Accès refusé.";
    default:
      return null;
  }
}

export default async function ManagerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(params.next);
  const session = await getServerSession(authOptions);
  const cookieStore = await cookies();
  const token = cookieStore.get(MANAGER_SESSION_COOKIE)?.value;

  if (session?.user?.managerAuthorized || (await isValidManagerSessionToken(token))) {
    redirect(nextPath);
  }

  if (!isManagerAuthConfigured() && isManagerOpenAccessEnabled()) {
    redirect("/manager");
  }

  return (
    <ManagerLoginCard
      configured={isManagerAuthConfigured()}
      nextPath={nextPath}
      oauthProviders={getConfiguredManagerOAuthProviders()}
      passwordEnabled={isManagerPasswordConfigured()}
      loginError={mapLoginError(params.error)}
    />
  );
}
