-- CreateTable
CREATE TABLE "app_user_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "app_user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'WEB_OAUTH',
    "provider_key" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME,
    CONSTRAINT "app_user_identities_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_app_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "oidc_issuer" TEXT,
    "oidc_subject" TEXT,
    "role" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_app_users" ("active", "created_at", "display_name", "email", "id", "oidc_issuer", "oidc_subject", "role", "updated_at") SELECT "active", "created_at", "display_name", "email", "id", "oidc_issuer", "oidc_subject", "role", "updated_at" FROM "app_users";
DROP TABLE "app_users";
ALTER TABLE "new_app_users" RENAME TO "app_users";
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");
CREATE INDEX "app_users_oidc_issuer_oidc_subject_idx" ON "app_users"("oidc_issuer", "oidc_subject");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "app_user_identities_app_user_id_idx" ON "app_user_identities"("app_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_identities_provider_key_subject_key" ON "app_user_identities"("provider_key", "subject");
