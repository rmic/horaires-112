import { addHours, addMonths, endOfDay, format, isAfter, isBefore, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";

export type Interval = {
  startTime: Date;
  endTime: Date;
};

function capitalizeLabel(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatFrench(date: Date, pattern: string) {
  return format(date, pattern, { locale: fr });
}

export function formatFrenchWeekdayShort(date: Date) {
  return capitalizeLabel(formatFrench(date, "EEE").replace(/\.$/, ""));
}

export function getMonthBounds(year: number, month: number) {
  const startsAt = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const endsAt = addMonths(startsAt, 1);
  return { startsAt, endsAt };
}

export function getMonthLabel(year: number, month: number) {
  return capitalizeLabel(formatFrench(new Date(year, month - 1, 1), "MMMM yyyy"));
}

export function parseDateInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

export function toDateTimeInputValue(date: Date) {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function listMonthDays(startsAt: Date, endsAt: Date) {
  const days: Date[] = [];
  const cursor = new Date(startsAt);

  while (cursor < endsAt) {
    days.push(new Date(cursor));
    cursor.setTime(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return days;
}

export function listHourStarts(startsAt: Date, endsAt: Date) {
  const hours: Date[] = [];
  const cursor = new Date(startsAt);

  while (cursor < endsAt) {
    hours.push(new Date(cursor));
    cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
  }

  return hours;
}

export function clampInterval(interval: Interval, bounds: Interval): Interval | null {
  const startTime = isBefore(interval.startTime, bounds.startTime)
    ? bounds.startTime
    : interval.startTime;
  const endTime = isAfter(interval.endTime, bounds.endTime) ? bounds.endTime : interval.endTime;

  if (!isBefore(startTime, endTime)) {
    return null;
  }

  return { startTime, endTime };
}

export function getDayBounds(date: Date) {
  return {
    start: startOfDay(date),
    end: addHours(endOfDay(date), 1),
  };
}

export function formatShortDate(date: Date) {
  return `${formatFrenchWeekdayShort(date)} ${formatFrench(date, "dd/MM")}`;
}

export function formatShortDay(date: Date) {
  return `${formatFrenchWeekdayShort(date)} ${formatFrench(date, "dd")}`;
}

export function formatHour(date: Date) {
  return formatFrench(date, "HH:mm");
}

export function formatDateTime(date: Date) {
  return formatFrench(date, "dd/MM HH:mm");
}

export function formatWeekLabel(start: Date, end: Date) {
  return `Semaine ${formatFrench(start, "dd/MM")} - ${formatFrench(end, "dd/MM")}`;
}

export function remapToDisplayAxis(date: Date, axisStart: Date) {
  const displayAxisStart = new Date(axisStart);
  displayAxisStart.setHours(0, 0, 0, 0);

  return new Date(displayAxisStart.getTime() + (date.getTime() - axisStart.getTime()));
}

export function remapFromDisplayAxis(date: Date, axisStart: Date) {
  const displayAxisStart = new Date(axisStart);
  displayAxisStart.setHours(0, 0, 0, 0);

  return new Date(axisStart.getTime() + (date.getTime() - displayAxisStart.getTime()));
}

export function formatAxisDateTime(date: Date, axisStart: Date) {
  return formatDateTime(remapToDisplayAxis(date, axisStart));
}

export function formatAxisHour(date: Date, axisStart: Date) {
  return formatHour(remapToDisplayAxis(date, axisStart));
}
