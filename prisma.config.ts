import "dotenv/config";
import { defineConfig } from "prisma/config";

const datasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!datasourceUrl) {
  throw new Error("DIRECT_URL ou DATABASE_URL doit être défini pour Prisma.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations-postgres",
  },
  datasource: {
    url: datasourceUrl,
  },
});
