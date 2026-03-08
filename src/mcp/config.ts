import { z } from "zod";

const envSchema = z.object({
  MCP_HOST: z.string().default("127.0.0.1"),
  MCP_PORT: z.coerce.number().int().positive().default(4001),
  MCP_BASE_URL: z.string().url().optional(),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  MCP_RESOURCE_NAME: z.string().default("Horaire 112 MCP"),
  MCP_SERVICE_DOCUMENTATION_URL: z.string().url().optional(),
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_DISCOVERY_URL: z.string().url().optional(),
  OIDC_JWKS_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_REQUIRED_SCOPES: z.string().optional(),
  OIDC_ACCEPTED_ALGS: z.string().optional(),
});

export type McpConfig = ReturnType<typeof getMcpConfig>;

let cachedConfig: ReturnType<typeof buildConfig> | null = null;

function buildConfig() {
  const env = envSchema.parse(process.env);
  const baseUrl = env.MCP_BASE_URL ?? `http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`;

  return {
    host: env.MCP_HOST,
    port: env.MCP_PORT,
    baseUrl: new URL(baseUrl),
    allowedHosts: env.MCP_ALLOWED_HOSTS?.split(",").map((item) => item.trim()).filter(Boolean) ?? undefined,
    resourceName: env.MCP_RESOURCE_NAME,
    serviceDocumentationUrl: env.MCP_SERVICE_DOCUMENTATION_URL
      ? new URL(env.MCP_SERVICE_DOCUMENTATION_URL)
      : undefined,
    oidcIssuerUrl: new URL(env.OIDC_ISSUER_URL),
    oidcDiscoveryUrl: env.OIDC_DISCOVERY_URL ? new URL(env.OIDC_DISCOVERY_URL) : undefined,
    oidcJwksUrl: env.OIDC_JWKS_URL ? new URL(env.OIDC_JWKS_URL) : undefined,
    oidcAudience: env.OIDC_AUDIENCE,
    requiredScopes: env.OIDC_REQUIRED_SCOPES?.split(",").map((item) => item.trim()).filter(Boolean) ?? [],
    acceptedAlgorithms: env.OIDC_ACCEPTED_ALGS?.split(",").map((item) => item.trim()).filter(Boolean),
  };
}

export function getMcpConfig() {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }

  return cachedConfig;
}

export function resetMcpConfigForTests() {
  cachedConfig = null;
}
