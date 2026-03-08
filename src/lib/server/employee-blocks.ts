import { addHours, isAfter, isBefore } from "date-fns";

export function generateFixedEmployeeBlocks(startsAt: Date, endsAt: Date) {
  const blocks: Array<{ startTime: Date; endTime: Date; label: string }> = [];

  const cursor = new Date(startsAt);
  cursor.setHours(6, 0, 0, 0);
  if (isAfter(cursor, startsAt)) {
    cursor.setHours(cursor.getHours() - 12);
  }

  while (isBefore(cursor, endsAt)) {
    const startTime = new Date(cursor);
    const endTime = addHours(startTime, 12);

    if (isAfter(endTime, startsAt) && isBefore(startTime, addHours(endsAt, 12))) {
      blocks.push({
        startTime,
        endTime,
        label: "Salarié",
      });
    }

    cursor.setHours(cursor.getHours() + 12);
  }

  return blocks;
}
