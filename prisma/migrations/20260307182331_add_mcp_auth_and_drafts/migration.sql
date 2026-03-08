-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "oidc_issuer" TEXT NOT NULL,
    "oidc_subject" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "availability_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "committed_availability_id" TEXT,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validation_summary" JSONB,
    "source_note" TEXT,
    "validated_at" DATETIME,
    "committed_at" DATETIME,
    "cancelled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "availability_drafts_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "availability_drafts_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "availability_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "availability_drafts_committed_availability_id_fkey" FOREIGN KEY ("committed_availability_id") REFERENCES "availabilities" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedule_adjustment_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planning_month_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "title" TEXT,
    "change_set" JSONB NOT NULL,
    "preview" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "previewed_at" DATETIME,
    "committed_at" DATETIME,
    "cancelled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "schedule_adjustment_drafts_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "schedule_adjustment_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" TEXT NOT NULL,
    "details" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_availabilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "review_comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "availabilities_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "availabilities_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_availabilities" ("created_at", "end_time", "id", "planning_month_id", "start_time", "updated_at", "volunteer_id") SELECT "created_at", "end_time", "id", "planning_month_id", "start_time", "updated_at", "volunteer_id" FROM "availabilities";
DROP TABLE "availabilities";
ALTER TABLE "new_availabilities" RENAME TO "availabilities";
CREATE INDEX "availabilities_planning_month_id_volunteer_id_idx" ON "availabilities"("planning_month_id", "volunteer_id");
CREATE INDEX "availabilities_planning_month_id_status_idx" ON "availabilities"("planning_month_id", "status");
CREATE INDEX "availabilities_planning_month_id_start_time_end_time_idx" ON "availabilities"("planning_month_id", "start_time", "end_time");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_oidc_issuer_oidc_subject_key" ON "app_users"("oidc_issuer", "oidc_subject");

-- CreateIndex
CREATE UNIQUE INDEX "availability_drafts_committed_availability_id_key" ON "availability_drafts"("committed_availability_id");

-- CreateIndex
CREATE INDEX "availability_drafts_planning_month_id_status_idx" ON "availability_drafts"("planning_month_id", "status");

-- CreateIndex
CREATE INDEX "availability_drafts_volunteer_id_planning_month_id_idx" ON "availability_drafts"("volunteer_id", "planning_month_id");

-- CreateIndex
CREATE INDEX "schedule_adjustment_drafts_planning_month_id_status_idx" ON "schedule_adjustment_drafts"("planning_month_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_created_at_idx" ON "audit_logs"("resource_type", "created_at");
