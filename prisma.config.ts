import "dotenv/config";
import { defineConfig } from "prisma/config";

const fallbackGenerateUrl = "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public";
const datasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? fallbackGenerateUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations-postgres",
  },
  datasource: {
    url: datasourceUrl,
  },
});
