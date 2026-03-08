-- CreateTable
CREATE TABLE "volunteers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "max_guards_per_month" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "planning_months" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "starts_at" DATETIME NOT NULL,
    "ends_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "public_token" TEXT NOT NULL,
    "public_password_hash" TEXT,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "availabilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "availabilities_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "availabilities_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "assignments_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "assignments_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "employee_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planning_month_id" TEXT NOT NULL,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Salarié',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "employee_blocks_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assignment_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planning_month_id" TEXT NOT NULL,
    "assignment_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignment_events_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_events_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planning_month_id" TEXT NOT NULL,
    "volunteer_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notes_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notes_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "planning_months_public_token_key" ON "planning_months"("public_token");

-- CreateIndex
CREATE UNIQUE INDEX "planning_months_year_month_key" ON "planning_months"("year", "month");

-- CreateIndex
CREATE INDEX "availabilities_planning_month_id_volunteer_id_idx" ON "availabilities"("planning_month_id", "volunteer_id");

-- CreateIndex
CREATE INDEX "availabilities_planning_month_id_start_time_end_time_idx" ON "availabilities"("planning_month_id", "start_time", "end_time");

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
