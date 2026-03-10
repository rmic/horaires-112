import { differenceInMinutes, isBefore } from "date-fns";
import { AvailabilityStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Interval = {
  startTime: Date;
  endTime: Date;
};

export type GapSegment = Interval & {
  missingCount: number;
};

export type VolunteerCandidateContext = {
  id: string;
  name: string;
  color: string;
  maxGuardsPerMonth: number | null;
  availabilities: Interval[];
  assignments: Interval[];
};

export type CandidateSuggestion = {
  id: string;
  name: string;
  color: string;
  currentGuards: number;
  limit: number | null;
  availabilityCount: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  fullyCoversGap: boolean;
};

function overlaps(left: Interval, right: Interval) {
  return left.startTime < right.endTime && left.endTime > right.startTime;
}

function clipInterval(interval: Interval, bounds: Interval) {
  const startTime = new Date(Math.max(interval.startTime.getTime(), bounds.startTime.getTime()));
  const endTime = new Date(Math.min(interval.endTime.getTime(), bounds.endTime.getTime()));

  if (!isBefore(startTime, endTime)) {
    return null;
  }

  return { startTime, endTime };
}

function subtractIntervals(base: Interval, blockers: Interval[]) {
  const relevantBlockers = blockers
    .filter((blocker) => overlaps(base, blocker))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  let windows = [base];

  for (const blocker of relevantBlockers) {
    windows = windows.flatMap((window) => {
      const clippedBlocker = clipInterval(blocker, window);

      if (!clippedBlocker) {
        return [window];
      }

      const nextWindows: Interval[] = [];

      if (window.startTime < clippedBlocker.startTime) {
        nextWindows.push({
          startTime: window.startTime,
          endTime: clippedBlocker.startTime,
        });
      }

      if (clippedBlocker.endTime < window.endTime) {
        nextWindows.push({
          startTime: clippedBlocker.endTime,
          endTime: window.endTime,
        });
      }

      return nextWindows;
    });
  }

  return windows;
}

function mergeAdjacentIntervals(intervals: Interval[]) {
  const sorted = [...intervals].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (previous && previous.endTime.getTime() === interval.startTime.getTime()) {
      previous.endTime = interval.endTime;
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

export function mergeGapSegments(gaps: GapSegment[], axisStart?: Date) {
  const isShiftBoundary = (time: Date) => {
    if (axisStart) {
      const diffMinutes = (time.getTime() - axisStart.getTime()) / (60 * 1000);
      const normalized = ((diffMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
      return normalized === 6 * 60 || normalized === 18 * 60;
    }

    return time.getUTCHours() === 6 || time.getUTCHours() === 18;
  };

  const splitGaps = gaps.flatMap((gap) => {
    const boundaries = [gap.startTime.getTime(), gap.endTime.getTime()];
    const dayMilliseconds = 24 * 60 * 60 * 1000;
    const baseStart = axisStart?.getTime();

    if (baseStart !== undefined) {
      const firstDayIndex = Math.floor((gap.startTime.getTime() - baseStart) / dayMilliseconds) - 1;
      const lastDayIndex = Math.ceil((gap.endTime.getTime() - baseStart) / dayMilliseconds) + 1;

      for (let dayIndex = firstDayIndex; dayIndex <= lastDayIndex; dayIndex += 1) {
        for (const hourOffset of [6, 18]) {
          const boundaryTime = baseStart + dayIndex * dayMilliseconds + hourOffset * 60 * 60 * 1000;
          if (boundaryTime > gap.startTime.getTime() && boundaryTime < gap.endTime.getTime()) {
            boundaries.push(boundaryTime);
          }
        }
      }
    } else {
      const cursor = new Date(gap.startTime);
      cursor.setUTCHours(0, 0, 0, 0);
      cursor.setUTCDate(cursor.getUTCDate() - 1);

      while (cursor < gap.endTime) {
        const sixOClock = new Date(cursor);
        sixOClock.setUTCHours(6, 0, 0, 0);
        if (sixOClock > gap.startTime && sixOClock < gap.endTime) {
          boundaries.push(sixOClock.getTime());
        }

        const eighteenOClock = new Date(cursor);
        eighteenOClock.setUTCHours(18, 0, 0, 0);
        if (eighteenOClock > gap.startTime && eighteenOClock < gap.endTime) {
          boundaries.push(eighteenOClock.getTime());
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const sortedBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
    const segments: GapSegment[] = [];

    for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
      const startTime = new Date(sortedBoundaries[index]);
      const endTime = new Date(sortedBoundaries[index + 1]);

      if (!isBefore(startTime, endTime)) {
        continue;
      }

      segments.push({
        startTime,
        endTime,
        missingCount: gap.missingCount,
      });
    }

    return segments;
  });

  const sorted = splitGaps.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const merged: GapSegment[] = [];

  for (const gap of sorted) {
    const previous = merged.at(-1);

    if (
      previous &&
      previous.missingCount === gap.missingCount &&
      previous.endTime.getTime() === gap.startTime.getTime() &&
      !isShiftBoundary(gap.startTime)
    ) {
      previous.endTime = gap.endTime;
    } else {
      merged.push({ ...gap });
    }
  }

  return merged;
}

export function getAssignableWindows(gap: Interval, volunteer: VolunteerCandidateContext) {
  const candidateWindows = volunteer.availabilities
    .map((availability) => clipInterval(availability, gap))
    .filter((value): value is Interval => Boolean(value))
    .flatMap((availability) => subtractIntervals(availability, volunteer.assignments));

  return mergeAdjacentIntervals(candidateWindows).filter(
    (interval) => differenceInMinutes(interval.endTime, interval.startTime) >= 60,
  );
}

export function suggestCandidatesForGap(
  gap: GapSegment,
  volunteers: VolunteerCandidateContext[],
  limits = { full: 8, partial: 8 },
) {
  const volunteerSuggestions = volunteers
    .filter((volunteer) => {
      if (volunteer.maxGuardsPerMonth === null) {
        return true;
      }

      return volunteer.assignments.length < volunteer.maxGuardsPerMonth;
    })
    .map((volunteer) => {
      const assignableWindows = getAssignableWindows(gap, volunteer);
      if (assignableWindows.length === 0) {
        return null;
      }

      const fullCoverageWindow = assignableWindows.find(
        (window) =>
          window.startTime.getTime() === gap.startTime.getTime() &&
          window.endTime.getTime() === gap.endTime.getTime(),
      );

      const bestWindow =
        fullCoverageWindow ??
        [...assignableWindows].sort((left, right) => {
          const durationDiff =
            differenceInMinutes(right.endTime, right.startTime) -
            differenceInMinutes(left.endTime, left.startTime);

          if (durationDiff !== 0) {
            return durationDiff;
          }

          return left.startTime.getTime() - right.startTime.getTime();
        })[0];

      return {
        id: volunteer.id,
        name: volunteer.name,
        color: volunteer.color,
        currentGuards: volunteer.assignments.length,
        limit: volunteer.maxGuardsPerMonth,
        availabilityCount: volunteer.availabilities.length,
        startTime: bestWindow.startTime,
        endTime: bestWindow.endTime,
        durationMinutes: differenceInMinutes(bestWindow.endTime, bestWindow.startTime),
        fullyCoversGap: Boolean(fullCoverageWindow),
      } satisfies CandidateSuggestion;
    })
    .filter((value): value is CandidateSuggestion => Boolean(value));

  const fullCoverageSuggestions = volunteerSuggestions
    .filter((suggestion) => suggestion.fullyCoversGap)
    .sort((left, right) => {
      if (left.currentGuards !== right.currentGuards) {
        return left.currentGuards - right.currentGuards;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, limits.full);

  const partialCoverageSuggestions = volunteerSuggestions
    .filter((suggestion) => !suggestion.fullyCoversGap)
    .sort((left, right) => {
      if (left.durationMinutes !== right.durationMinutes) {
        return right.durationMinutes - left.durationMinutes;
      }

      if (left.currentGuards !== right.currentGuards) {
        return left.currentGuards - right.currentGuards;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, limits.partial);

  return {
    fullCoverageSuggestions,
    partialCoverageSuggestions,
  };
}

export async function getVolunteerCandidateContexts(planningMonthId: string) {
  const volunteers = await prisma.volunteer.findMany({
    include: {
      monthSettings: {
        where: {
          planningMonthId,
        },
        take: 1,
      },
      availabilities: {
        where: {
          planningMonthId,
          status: AvailabilityStatus.APPROVED,
        },
        orderBy: {
          startTime: "asc",
        },
      },
      assignments: {
        where: {
          planningMonthId,
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  return volunteers.map(
    (volunteer): VolunteerCandidateContext => ({
      id: volunteer.id,
      name: volunteer.name,
      color: volunteer.color,
      maxGuardsPerMonth: volunteer.monthSettings[0]?.maxGuardsPerMonth ?? null,
      availabilities: volunteer.availabilities.map((availability) => ({
        startTime: availability.startTime,
        endTime: availability.endTime,
      })),
      assignments: volunteer.assignments.map((assignment) => ({
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      })),
    }),
  );
}
