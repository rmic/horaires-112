import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { provisionAppUserForMcpIdentity } from "@/lib/server/app-user-identities";

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();
    const nextValue = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && nextValue && !nextValue.startsWith("--")) {
      options[key] = nextValue;
      index += 1;
      continue;
    }

    options[key] = inlineValue ?? "true";
  }

  return options;
}

function printUsage() {
  console.log(`
Usage:
  npm run mcp:user:upsert -- --email planner@example.com --name "Planning Manager" --role PLANNER --subject auth0|abc123

Options:
  --email      Internal email, must be unique
  --name       Display name
  --role       PLANNER or READ_ONLY
  --subject    OIDC subject claim (sub)
  --issuer     OIDC issuer URL (defaults to OIDC_ISSUER_URL from .env)
  --active     true or false (defaults to true)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim()?.toLowerCase();
  const displayName = args.name?.trim();
  const role = args.role?.trim()?.toUpperCase() ?? "READ_ONLY";
  const oidcSubject = args.subject?.trim();
  const oidcIssuer = args.issuer?.trim() ?? process.env.OIDC_ISSUER_URL?.trim();
  const active = args.active === undefined ? true : args.active !== "false";

  if (!email || !displayName || !oidcSubject || !oidcIssuer) {
    printUsage();
    throw new Error("Arguments manquants. email, name, subject et issuer sont requis.");
  }

  if (role !== "PLANNER" && role !== "READ_ONLY") {
    throw new Error(`Role invalide: ${role}. Valeurs acceptées: PLANNER, READ_ONLY.`);
  }

  const user = await provisionAppUserForMcpIdentity({
    email,
    displayName,
    role,
    active,
    providerKey: oidcIssuer,
    providerName: "OIDC MCP",
    subject: oidcSubject,
  });

  console.log("Utilisateur MCP synchronisé:");
  console.log(JSON.stringify(user, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
