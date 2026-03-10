CREATE TYPE "AssignmentLane" AS ENUM ('A1', 'A2', 'A3');

ALTER TABLE "assignments"
ADD COLUMN "lane" "AssignmentLane";

CREATE INDEX "assignments_planning_month_id_lane_start_time_end_time_idx"
ON "assignments"("planning_month_id", "lane", "start_time", "end_time");
