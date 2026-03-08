-- CreateTable
CREATE TABLE "volunteer_month_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "volunteer_id" TEXT NOT NULL,
    "planning_month_id" TEXT NOT NULL,
    "max_guards_per_month" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "volunteer_month_settings_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "volunteer_month_settings_planning_month_id_fkey" FOREIGN KEY ("planning_month_id") REFERENCES "planning_months" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "volunteer_month_settings_planning_month_id_volunteer_id_key"
ON "volunteer_month_settings"("planning_month_id", "volunteer_id");

-- CreateIndex
CREATE INDEX "volunteer_month_settings_volunteer_id_planning_month_id_idx"
ON "volunteer_month_settings"("volunteer_id", "planning_month_id");
