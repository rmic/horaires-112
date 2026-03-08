import "dotenv/config";
import { prisma } from "@/lib/prisma";

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
  npm run manager:upsert -- --email planner@example.com --name "Responsable planning" --role PLANNER

Options:
  --email      Manager email, must be unique
  --name       Display name (optional)
  --role       PLANNER or READ_ONLY (defaults to PLANNER)
  --active     true or false (defaults to true)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim()?.toLowerCase();
  const displayName = args.name?.trim() || null;
  const role = args.role?.trim()?.toUpperCase() ?? "PLANNER";
  const active = args.active === undefined ? true : args.active !== "false";

  if (!email) {
    printUsage();
    throw new Error("Argument manquant: --email");
  }

  if (role !== "PLANNER" && role !== "READ_ONLY") {
    throw new Error(`Role invalide: ${role}. Valeurs acceptées: PLANNER, READ_ONLY.`);
  }

  const managerAccess = await prisma.managerAccess.upsert({
    where: {
      email,
    },
    update: {
      displayName,
      role,
      active,
    },
    create: {
      email,
      displayName,
      role,
      active,
    },
  });

  console.log("Manager autorisé synchronisé:");
  console.log(JSON.stringify(managerAccess, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
