import { NextResponse } from "next/server";

export const MANAGER_SESSION_COOKIE = "horaire112_manager_session";
export const MANAGER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type ManagerOAuthProvider = {
  id: "google" | "azure-ad";
  label: string;
};

function getManagerPassword() {
  return process.env.MANAGER_PASSWORD?.trim() ?? "";
}

function getAuthSecret() {
  return process.env.AUTH_SECRET?.trim() ?? "";
}

export function isManagerOpenAccessEnabled() {
  return process.env.ALLOW_OPEN_MANAGER_ACCESS?.trim().toLowerCase() === "true";
}

export function getConfiguredManagerOAuthProviders(): ManagerOAuthProvider[] {
  const providers: ManagerOAuthProvider[] = [];

  if (process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim()) {
    providers.push({
      id: "google",
      label: "Google",
    });
  }

  if (process.env.AUTH_MICROSOFT_ID?.trim() && process.env.AUTH_MICROSOFT_SECRET?.trim()) {
    providers.push({
      id: "azure-ad",
      label: "Microsoft",
    });
  }

  return providers;
}

export function isManagerPasswordConfigured() {
  return Boolean(getManagerPassword() && getAuthSecret());
}

export function isManagerOAuthConfigured() {
  return Boolean(getAuthSecret() && getConfiguredManagerOAuthProviders().length > 0);
}

export function isManagerAuthConfigured() {
  return isManagerOAuthConfigured() || isManagerPasswordConfigured();
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getExpectedManagerSessionToken() {
  const password = getManagerPassword();
  const authSecret = getAuthSecret();

  if (!password || !authSecret) {
    throw new Error("Manager auth is not configured.");
  }

  return sha256Hex(`manager:${password}:${authSecret}`);
}

export async function verifyManagerPassword(rawPassword: string) {
  const password = getManagerPassword();

  if (!password || !getAuthSecret()) {
    return false;
  }

  return rawPassword.trim() === password;
}

export async function isValidManagerSessionToken(token?: string | null) {
  if (!token || !isManagerAuthConfigured()) {
    return false;
  }

  return token === (await getExpectedManagerSessionToken());
}

export async function applyManagerSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: MANAGER_SESSION_COOKIE,
    value: await getExpectedManagerSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MANAGER_SESSION_MAX_AGE,
  });

  return response;
}

export function clearManagerSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: MANAGER_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
