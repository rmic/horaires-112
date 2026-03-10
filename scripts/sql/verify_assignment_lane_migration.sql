SELECT COUNT(*) AS assignment_count
FROM assignments;

SELECT
  COUNT(*) AS total_assignments,
  COUNT(lane) AS assignments_with_lane,
  COUNT(*) FILTER (WHERE lane IS NULL) AS assignments_without_lane
FROM assignments;

SELECT lane, COUNT(*) AS count
FROM assignments
GROUP BY lane
ORDER BY lane;

SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assignments'
  AND column_name = 'lane';
