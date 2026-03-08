import { spawnSync } from "node:child_process";
import { Client } from "pg";

function withSchema(url: string, schema: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

function requireUrl(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} est requis pour exécuter les tests d'auth.`);
  }

  return value;
}

async function resetSchema(connectionString: string) {
  const parsed = new URL(connectionString);
  const schema = parsed.searchParams.get("schema") ?? "public";
  parsed.searchParams.delete("schema");

  const client = new Client({
    connectionString: parsed.toString(),
  });

  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await client.end();
  }
}

async function main() {
  const baseDatabaseUrl = requireUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const baseDirectUrl = process.env.DIRECT_URL ?? baseDatabaseUrl;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? withSchema(baseDatabaseUrl, "test_auth");
  const testDirectUrl = process.env.TEST_DIRECT_URL ?? withSchema(baseDirectUrl, "test_auth");

  await resetSchema(testDirectUrl);

  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDirectUrl,
    },
  });

  if (migrate.status !== 0) {
    process.exit(migrate.status ?? 1);
  }

  const testRun = spawnSync("node", ["--import", "tsx", "--test", "tests/auth/*.test.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDirectUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      TEST_DIRECT_URL: testDirectUrl,
    },
  });

  process.exit(testRun.status ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
