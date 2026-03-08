import "dotenv/config";
import { defineConfig } from "prisma/config";

const isGenerateCommand = process.argv.includes("generate");
const fallbackGenerateUrl = "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public";
const datasourceUrl =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? (isGenerateCommand ? fallbackGenerateUrl : undefined);

if (!datasourceUrl) {
  throw new Error("DIRECT_URL ou DATABASE_URL doit être défini pour les commandes Prisma qui accèdent à la base.");
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
