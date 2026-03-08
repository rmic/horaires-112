import { addHours, differenceInMinutes, eachHourOfInterval, isAfter, isBefore } from "date-fns";
import { clampInterval, type Interval, listMonthDays } from "@/lib/time";

type VolunteerAssignment = {
  id: string;
  volunteerId: string;
  volunteerName: string;
  volunteerColor: string;
  status: "CONFIRMED" | "PROVISIONAL";
  startTime: Date;
  endTime: Date;
};

type EmployeeBlock = {
  id: string;
  label: string;
  startTime: Date;
  endTime: Date;
};

export type CoverageSegment = {
  startTime: Date;
  endTime: Date;
  volunteerAssignments: VolunteerAssignment[];
  employeeBlocks: EmployeeBlock[];
  volunteerCount: number;
  employeeCount: number;
  totalCoverage: number;
  missingCount: number;
};

export type DayTimeline = {
  dayStart: Date;
  dayEnd: Date;
  segments: CoverageSegment[];
};

type ComputeCoverageInput = {
  rangeStart: Date;
  rangeEnd: Date;
  assignments: VolunteerAssignment[];
  employeeBlocks: EmployeeBlock[];
  forceHourlyBoundaries?: boolean;
  extraBoundaries?: Date[];
};

function overlaps(interval: Interval, startTime: Date, endTime: Date) {
  return isBefore(interval.startTime, endTime) && isAfter(interval.endTime, startTime);
}

function uniqueSortedTimestamps(dates: Date[]) {
  return [...new Set(dates.map((value) => value.getTime()))]
    .sort((a, b) => a - b)
    .map((value) => new Date(value));
}

export function computeCoverageSegments(input: ComputeCoverageInput): CoverageSegment[] {
  const boundaries: Date[] = [input.rangeStart, input.rangeEnd];

  for (const assignment of input.assignments) {
    const clamped = clampInterval(assignment, {
      startTime: input.rangeStart,
      endTime: input.rangeEnd,
    });

    if (!clamped) continue;
    boundaries.push(clamped.startTime, clamped.endTime);
  }

  for (const block of input.employeeBlocks) {
    const clamped = clampInterval(block, {
      startTime: input.rangeStart,
      endTime: input.rangeEnd,
    });

    if (!clamped) continue;
    boundaries.push(clamped.startTime, clamped.endTime);
  }

  if (input.forceHourlyBoundaries) {
    const hourBoundaries = eachHourOfInterval({
      start: input.rangeStart,
      end: input.rangeEnd,
    });
    boundaries.push(...hourBoundaries);
  }

  if (input.extraBoundaries?.length) {
    boundaries.push(...input.extraBoundaries);
  }

  const sortedBoundaries = uniqueSortedTimestamps(boundaries).filter(
    (boundary) => !isBefore(boundary, input.rangeStart) && !isAfter(boundary, input.rangeEnd),
  );

  const segments: CoverageSegment[] = [];

  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const startTime = sortedBoundaries[i];
    const endTime = sortedBoundaries[i + 1];

    if (!isBefore(startTime, endTime)) continue;

    const volunteerAssignments = input.assignments.filter((assignment) =>
      overlaps(assignment, startTime, endTime),
    );
    const employeeBlocks = input.employeeBlocks.filter((block) => overlaps(block, startTime, endTime));

    const volunteerCount = volunteerAssignments.length;
    const employeeCount = employeeBlocks.length;
    const totalCoverage = volunteerCount + employeeCount;

    segments.push({
      startTime,
      endTime,
      volunteerAssignments,
      employeeBlocks,
      volunteerCount,
      employeeCount,
      totalCoverage,
      missingCount: Math.max(0, 2 - totalCoverage),
    });
  }

  return segments;
}

export function splitCoverageByDay(rangeStart: Date, rangeEnd: Date, segments: CoverageSegment[]): DayTimeline[] {
  const days = listMonthDays(rangeStart, rangeEnd);

  return days.map((dayStart) => {
    const dayEnd = addHours(dayStart, 24);
    const daySegments = segments
      .filter((segment) => overlaps(segment, dayStart, dayEnd))
      .map((segment) => {
        const clippedStart = isBefore(segment.startTime, dayStart) ? dayStart : segment.startTime;
        const clippedEnd = isAfter(segment.endTime, dayEnd) ? dayEnd : segment.endTime;
        return {
          ...segment,
          startTime: clippedStart,
          endTime: clippedEnd,
        };
      })
      .filter((segment) => differenceInMinutes(segment.endTime, segment.startTime) > 0);

    return {
      dayStart,
      dayEnd,
      segments: daySegments,
    };
  });
}

export function getGapSegments(segments: CoverageSegment[]) {
  return segments.filter((segment) => segment.missingCount > 0);
}
