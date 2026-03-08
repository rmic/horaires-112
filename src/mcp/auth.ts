import { AppUserRole } from "@prisma/client";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { resolveAppUserByExternalIdentity } from "@/lib/server/app-user-identities";
import { getMcpConfig } from "@/mcp/config";

type OidcDiscoveryDocument = OAuthMetadata & {
  jwks_uri: string;
};

type AuthenticatedAppUser = {
  id: string;
  email: string;
  displayName: string;
  role: AppUserRole;
};

let metadataCache: { expiresAt: number; value: OidcDiscoveryDocument } | null = null;
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function buildDiscoveryUrl() {
  const config = getMcpConfig();
  if (config.oidcDiscoveryUrl) {
    return config.oidcDiscoveryUrl;
  }

  const issuer = new URL(config.oidcIssuerUrl.href);
  const basePath = issuer.pathname.replace(/\/$/, "");
  issuer.pathname = `${basePath}/.well-known/openid-configuration`;
  issuer.search = "";
  issuer.hash = "";
  return issuer;
}

async function getDiscoveryDocument() {
  const now = Date.now();
  if (metadataCache && metadataCache.expiresAt > now) {
    return metadataCache.value;
  }

  const response = await fetch(buildDiscoveryUrl(), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new ServerError(`Impossible de récupérer la metadata OIDC (${response.status}).`);
  }

  const document = (await response.json()) as Partial<OidcDiscoveryDocument>;
  if (
    typeof document.issuer !== "string" ||
    typeof document.authorization_endpoint !== "string" ||
    typeof document.token_endpoint !== "string" ||
    typeof document.jwks_uri !== "string"
  ) {
    throw new ServerError("Metadata OIDC incomplète.");
  }

  metadataCache = {
    expiresAt: now + 5 * 60 * 1000,
    value: {
      ...document,
      issuer: document.issuer,
      authorization_endpoint: document.authorization_endpoint,
      token_endpoint: document.token_endpoint,
      jwks_uri: document.jwks_uri,
      response_types_supported: document.response_types_supported ?? ["code"],
    } as OidcDiscoveryDocument,
  };

  return metadataCache.value;
}

function getJwks(url: URL) {
  const key = url.href;
  if (!jwksCache.has(key)) {
    jwksCache.set(key, createRemoteJWKSet(url));
  }

  return jwksCache.get(key)!;
}

function extractScopes(payload: JWTPayload) {
  const scopes = new Set<string>();

  if (typeof payload.scope === "string") {
    payload.scope
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((scope) => scopes.add(scope));
  }

  if (typeof payload.scp === "string") {
    payload.scp
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((scope) => scopes.add(scope));
  }

  if (Array.isArray(payload.scp)) {
    payload.scp.map(String).forEach((scope) => scopes.add(scope));
  }

  return [...scopes];
}

async function resolveInternalUser(payload: JWTPayload) {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new InvalidTokenError("Le token ne contient pas de subject exploitable.");
  }

  const config = getMcpConfig();
  const appUser = await resolveAppUserByExternalIdentity({
    providerKey: config.oidcIssuerUrl.href,
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
  });

  if (!appUser || !appUser.active) {
    throw new InvalidTokenError("Le token n'est relié à aucun utilisateur interne actif.");
  }

  if (typeof payload.email === "string" && payload.email.toLowerCase() !== appUser.email.toLowerCase()) {
    throw new InvalidTokenError("L'email du token ne correspond pas à l'utilisateur interne configuré.");
  }

  return {
    id: appUser.id,
    email: appUser.email,
    displayName: appUser.displayName,
    role: appUser.role,
  } satisfies AuthenticatedAppUser;
}

export async function getOAuthMetadata() {
  const metadata = await getDiscoveryDocument();

  return {
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint,
    scopes_supported: metadata.scopes_supported,
    response_types_supported: metadata.response_types_supported,
    grant_types_supported: metadata.grant_types_supported,
    token_endpoint_auth_methods_supported: metadata.token_endpoint_auth_methods_supported,
    service_documentation: metadata.service_documentation,
    revocation_endpoint: metadata.revocation_endpoint,
    revocation_endpoint_auth_methods_supported: metadata.revocation_endpoint_auth_methods_supported,
    code_challenge_methods_supported: metadata.code_challenge_methods_supported,
    client_id_metadata_document_supported: metadata.client_id_metadata_document_supported,
  } satisfies OAuthMetadata;
}

export async function verifyAccessToken(token: string) {
  const config = getMcpConfig();
  const discovery = await getDiscoveryDocument();
  const jwks = getJwks(config.oidcJwksUrl ?? new URL(discovery.jwks_uri));

  try {
    const verification = await jwtVerify(token, jwks, {
      issuer: config.oidcIssuerUrl.href,
      audience: config.oidcAudience,
      algorithms: config.acceptedAlgorithms,
    });

    const appUser = await resolveInternalUser(verification.payload);
    const scopes = extractScopes(verification.payload);
    const aud = Array.isArray(verification.payload.aud)
      ? verification.payload.aud[0]
      : verification.payload.aud;

    return {
      token,
      clientId:
        typeof verification.payload.azp === "string"
          ? verification.payload.azp
          : typeof verification.payload.client_id === "string"
            ? verification.payload.client_id
            : typeof aud === "string"
              ? aud
              : "unknown-client",
      scopes,
      expiresAt: verification.payload.exp,
      resource: config.baseUrl,
      extra: {
        appUserId: appUser.id,
        appUserEmail: appUser.email,
        appUserDisplayName: appUser.displayName,
        appUserRole: appUser.role,
        oidcIssuer: config.oidcIssuerUrl.href,
        oidcSubject: verification.payload.sub,
      },
    };
  } catch (error) {
    if (error instanceof InvalidTokenError || error instanceof ServerError) {
      throw error;
    }

    throw new InvalidTokenError(error instanceof Error ? error.message : "Token invalide.");
  }
}

export function resetOidcCachesForTests() {
  metadataCache = null;
  jwksCache.clear();
}
