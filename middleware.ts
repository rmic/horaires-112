import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  isManagerAuthConfigured,
  isManagerOpenAccessEnabled,
  isValidManagerSessionToken,
  MANAGER_SESSION_COOKIE,
} from "@/lib/manager-auth";

function isProtectedManagerRoute(pathname: string) {
  if (pathname === "/manager/login") {
    return false;
  }

  return pathname === "/manager" || pathname.startsWith("/manager/");
}

function isProtectedApiRoute(pathname: string) {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  if (pathname.startsWith("/api/published/")) {
    return false;
  }

  if (pathname.startsWith("/api/auth/")) {
    return false;
  }

  return true;
}

function buildLoginRedirect(request: NextRequest, errorCode?: string) {
  const loginUrl = new URL("/manager/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (errorCode) {
    loginUrl.searchParams.set("error", errorCode);
  }
  return NextResponse.redirect(loginUrl);
}

function isReadOnlyMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedManagerRoute(pathname) && !isProtectedApiRoute(pathname)) {
    return NextResponse.next();
  }

  if (!isManagerAuthConfigured()) {
    if (isManagerOpenAccessEnabled()) {
      return NextResponse.next();
    }

    if (isProtectedApiRoute(pathname)) {
      return NextResponse.json({ error: "Authentification manager non configurée." }, { status: 503 });
    }

    return buildLoginRedirect(request, "auth-not-configured");
  }

  const sessionToken = request.cookies.get(MANAGER_SESSION_COOKIE)?.value;
  const authToken =
    process.env.AUTH_SECRET?.trim()
      ? await getToken({
          req: request,
          secret: process.env.AUTH_SECRET,
        })
      : null;

  const hasPasswordFallbackSession = await isValidManagerSessionToken(sessionToken);
  const hasOAuthManagerSession = Boolean(authToken?.managerAuthorized);

  if (hasOAuthManagerSession || hasPasswordFallbackSession) {
    if (
      isProtectedApiRoute(pathname) &&
      !isReadOnlyMethod(request.method) &&
      !hasPasswordFallbackSession &&
      authToken?.managerRole !== "PLANNER"
    ) {
      return NextResponse.json({ error: "Permission insuffisante pour modifier les données." }, { status: 403 });
    }

    return NextResponse.next();
  }

  if (isProtectedApiRoute(pathname)) {
    return NextResponse.json({ error: "Session manager requise." }, { status: 401 });
  }

  return buildLoginRedirect(request);
}

export const config = {
  matcher: ["/manager/:path*", "/api/:path*"],
};
