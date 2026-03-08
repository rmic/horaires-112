-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlanningMonthStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('CONFIRMED', 'PROVISIONAL');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('MANUAL', 'DRAFT');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AppUserRole" AS ENUM ('PLANNER', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "AvailabilityDraftStatus" AS ENUM ('DRAFT', 'VALIDATED', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleAdjustmentDraftStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditLogOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "AuthIdentityType" AS ENUM ('WEB_OAUTH', 'MCP_OIDC');

-- CreateEnum
CREATE TYPE "AssignmentEventType" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "oidc_issuer" TEXT,
    "oidc_subject" TEXT,
    "role" "AppUserRole" NOT NULL DEFAULT 'READ_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user_identities" (
    "id" TEXT NOT NULL,
    "app_user_id" TEXT NOT NULL,
    "type" "AuthIdentityType" NOT NULL DEFAULT 'WEB_OAUTH',
    "provider_key" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "app_user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_access" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "AppUserRole" NOT NULL DEFAULT 'PLANNER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volunteers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "max_guards_per_month" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "volunteers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_months" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "PlanningMonthStatus" NOT NULL DEFAULT 'DRAFT',
    "public_token" TEXT NOT NULL,
    "public_password_hash" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volunteer_month_settings" (
    "id" TEXT NOT NULL,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "max_guards_per_month" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "volunteer_month_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availabilities" (
    "id" TEXT NOT NULL,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'APPROVED',
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_drafts" (
    "id" TEXT NOT NULL,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "committed_availability_id" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "AvailabilityDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "validation_summary" JSONB,
    "source_note" TEXT,
    "validated_at" TIMESTAMP(3),
    "committed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "AssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_blocks" (
    "id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Salarié',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_events" (
    "id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "assignment_id" TEXT,
    "event_type" "AssignmentEventType" NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "volunteer_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_adjustment_drafts" (
    "id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "title" TEXT,
    "change_set" JSONB NOT NULL,
    "preview" JSONB,
    "status" "ScheduleAdjustmentDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "previewed_at" TIMESTAMP(3),
    "committed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_adjustment_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" "AuditLogOutcome" NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE INDEX "app_users_oidc_issuer_oidc_subject_idx" ON "app_users"("oidc_issuer", "oidc_subject");

-- CreateIndex
CREATE INDEX "app_user_identities_app_user_id_idx" ON "app_user_identities"("app_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_identities_provider_key_subject_key" ON "app_user_identities"("provider_key", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "manager_access_email_key" ON "manager_access"("email");

-- CreateIndex
CREATE UNIQUE INDEX "planning_months_public_token_key" ON "planning_months"("public_token");

-- CreateIndex
CREATE UNIQUE INDEX "planning_months_year_month_key" ON "planning_months"("year", "month");

-- CreateIndex
CREATE INDEX "volunteer_month_settings_volunteer_id_planning_month_id_idx" ON "volunteer_month_settings"("volunteer_id", "planning_month_id");

-- CreateIndex
CREATE UNIQUE INDEX "volunteer_month_settings_planning_month_id_volunteer_id_key" ON "volunteer_month_settings"("planning_month_id", "volunteer_id");

-- CreateIndex
CREATE INDEX "availabilities_planning_month_id_volunteer_id_idx" ON "availabilities"("planning_month_id", "volunteer_id");

-- CreateIndex
CREATE INDEX "availabilities_planning_month_id_status_idx" ON "availabilities"("planning_month_id", "status");

-- CreateIndex
CREATE INDEX "availabilities_planning_month_id_start_time_end_time_idx" ON "availabilities"("planning_month_id", "start_time", "end_time");

-- CreateIndex
CREATE UNIQUE INDEX "availability_drafts_committed_availability_id_key" ON "availability_drafts"("committed_availability_id");

-- CreateIndex
CREATE INDEX "availability_drafts_planning_month_id_status_idx" ON "availability_drafts"("planning_month_id", "status");

-- CreateIndex
CREATE INDEX "availability_drafts_volunteer_id_planning_month_id_idx" ON "availability_drafts"("volunteer_id", "planning_month_id");

-- CreateIndex
CREATE INDEX "assignments_planning_month_id_start_time_end_time_idx" ON "assignments"("planning_month_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "assignments_volunteer_id_start_time_end_time_idx" ON "assignments"("volunteer_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "employee_blocks_planning_month_id_start_time_end_time_idx" ON "employee_blocks"("planning_month_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "assignment_events_planning_month_id_created_at_idx" ON "assignment_events"("planning_month_id", "created_at");

-- CreateIndex
CREATE INDEX "assignment_events_assignment_id_idx" ON "assignment_events"("assignment_id");

-- CreateIndex
CREATE INDEX "notes_planning_month_id_created_at_idx" ON "notes"("planning_month_id", "created_at");

-- CreateIndex
CREATE INDEX "schedule_adjustment_drafts_planning_month_id_status_idx" ON "schedule_adjustment_drafts"("planning_month_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_created_at_idx" ON "audit_logs"("resource_type", "created_at");

-- AddForeignKey
ALTER TABLE "app_user_identities" ADD CONSTRAINT "app_user_identities_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_month_settings" ADD CONSTRAINT "volunteer_month_settings_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_month_settings" ADD CONSTRAINT "volunteer_month_settings_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availabilities" ADD CONSTRAINT "availabilities_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availabilities" ADD CONSTRAINT "availabilities_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_drafts" ADD CONSTRAINT "availability_drafts_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_drafts" ADD CONSTRAINT "availability_drafts_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_drafts" ADD CONSTRAINT "availability_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_drafts" ADD CONSTRAINT "availability_drafts_committed_availability_id_fkey" FOREIGN KEY ("committed_availability_id") REFERENCES "availabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_blocks" ADD CONSTRAINT "employee_blocks_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_events" ADD CONSTRAINT "assignment_events_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_events" ADD CONSTRAINT "assignment_events_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_adjustment_drafts" ADD CONSTRAINT "schedule_adjustment_drafts_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_adjustment_drafts" ADD CONSTRAINT "schedule_adjustment_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

