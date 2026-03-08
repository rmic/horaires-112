import { addHours, differenceInHours, isBefore } from "date-fns";
import { hasOverlap, intervalContainedIn } from "@/lib/constraints";
import { listHourStarts, type Interval } from "@/lib/time";

type VolunteerInput = {
  id: string;
  name: string;
  color: string;
  maxGuardsPerMonth: number | null;
  availabilities: Interval[];
};

type AssignmentInput = Interval & {
  id: string;
  volunteerId: string;
};

type EmployeeBlockInput = Interval & {
  id: string;
};

type GenerateDraftInput = {
  monthStart: Date;
  monthEnd: Date;
  volunteers: VolunteerInput[];
  assignments: AssignmentInput[];
  employeeBlocks: EmployeeBlockInput[];
};

export type DraftAssignment = {
  volunteerId: string;
  startTime: Date;
  endTime: Date;
};

function hourlyKey(date: Date) {
  return date.getTime();
}

function intervalCoversHour(interval: Interval, hourStart: Date) {
  const hourEnd = addHours(hourStart, 1);
  return !isBefore(interval.endTime, hourEnd) && !isBefore(hourStart, interval.startTime);
}

function hydrateCoverageMap(
  hours: Date[],
  assignments: AssignmentInput[],
  employeeBlocks: EmployeeBlockInput[],
) {
  const map = new Map<number, number>();
  for (const hour of hours) {
    map.set(hourlyKey(hour), 0);
  }

  const sourceIntervals: Interval[] = [...assignments, ...employeeBlocks];

  for (const interval of sourceIntervals) {
    for (const hour of hours) {
      if (intervalCoversHour(interval, hour)) {
        map.set(hourlyKey(hour), (map.get(hourlyKey(hour)) ?? 0) + 1);
      }
    }
  }

  return map;
}

function canStart(
  volunteer: VolunteerInput,
  existingIntervals: Interval[],
  hour: Date,
  guardCounter: Map<string, number>,
) {
  const maxGuards = volunteer.maxGuardsPerMonth;
  const currentGuards = guardCounter.get(volunteer.id) ?? 0;

  if (maxGuards !== null && currentGuards >= maxGuards) {
    return false;
  }

  const oneHourInterval = {
    startTime: hour,
    endTime: addHours(hour, 1),
  };

  if (!intervalContainedIn(oneHourInterval, volunteer.availabilities)) {
    return false;
  }

  if (hasOverlap(oneHourInterval, existingIntervals)) {
    return false;
  }

  return true;
}

function findEndTime(
  volunteer: VolunteerInput,
  existingIntervals: Interval[],
  coverageMap: Map<number, number>,
  monthEnd: Date,
  hourStarts: Date[],
  startTime: Date,
) {
  let endTime = addHours(startTime, 1);

  while (isBefore(endTime, monthEnd) && differenceInHours(endTime, startTime) < 12) {
    const nextEnd = addHours(endTime, 1);
    if (!isBefore(nextEnd, addHours(monthEnd, 1)) || nextEnd > monthEnd) {
      break;
    }

    const candidateInterval = {
      startTime,
      endTime: nextEnd,
    };

    if (!intervalContainedIn(candidateInterval, volunteer.availabilities)) {
      break;
    }

    if (hasOverlap(candidateInterval, existingIntervals)) {
      break;
    }

    const futureHour = hourStarts.find((hour) => hour.getTime() === endTime.getTime());
    if (!futureHour) break;

    if ((coverageMap.get(hourlyKey(futureHour)) ?? 0) >= 2) {
      break;
    }

    endTime = nextEnd;
  }

  return endTime;
}

export function generateDraftAssignments(input: GenerateDraftInput) {
  const hours = listHourStarts(input.monthStart, input.monthEnd);
  const coverage = hydrateCoverageMap(hours, input.assignments, input.employeeBlocks);

  const assignmentsByVolunteer = new Map<string, Interval[]>();
  const guardCounter = new Map<string, number>();
  const assignedHours = new Map<string, number>();

  for (const volunteer of input.volunteers) {
    const existing = input.assignments
      .filter((assignment) => assignment.volunteerId === volunteer.id)
      .map((assignment) => ({
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      }));

    assignmentsByVolunteer.set(volunteer.id, existing);
    guardCounter.set(volunteer.id, existing.length);

    const hoursCount = existing.reduce(
      (total, assignment) => total + differenceInHours(assignment.endTime, assignment.startTime),
      0,
    );
    assignedHours.set(volunteer.id, hoursCount);
  }

  const created: DraftAssignment[] = [];

  for (const hour of hours) {
    while ((coverage.get(hourlyKey(hour)) ?? 0) < 2) {
      const candidates = input.volunteers
        .filter((volunteer) =>
          canStart(volunteer, assignmentsByVolunteer.get(volunteer.id) ?? [], hour, guardCounter),
        )
        .map((volunteer) => {
          const existingIntervals = assignmentsByVolunteer.get(volunteer.id) ?? [];
          const endTime = findEndTime(
            volunteer,
            existingIntervals,
            coverage,
            input.monthEnd,
            hours,
            hour,
          );

          const duration = differenceInHours(endTime, hour);
          if (duration < 1) return null;

          const fairnessScore = (assignedHours.get(volunteer.id) ?? 0) * 10 + (guardCounter.get(volunteer.id) ?? 0) * 6;
          const score = fairnessScore - duration;

          return {
            volunteer,
            endTime,
            duration,
            score,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((a, b) => a.score - b.score);

      const selected = candidates[0];
      if (!selected) {
        break;
      }

      const newAssignment: DraftAssignment = {
        volunteerId: selected.volunteer.id,
        startTime: hour,
        endTime: selected.endTime,
      };

      created.push(newAssignment);
      assignmentsByVolunteer.set(selected.volunteer.id, [
        ...(assignmentsByVolunteer.get(selected.volunteer.id) ?? []),
        {
          startTime: newAssignment.startTime,
          endTime: newAssignment.endTime,
        },
      ]);

      guardCounter.set(selected.volunteer.id, (guardCounter.get(selected.volunteer.id) ?? 0) + 1);
      assignedHours.set(
        selected.volunteer.id,
        (assignedHours.get(selected.volunteer.id) ?? 0) + selected.duration,
      );

      for (const slot of hours) {
        if (slot >= newAssignment.startTime && slot < newAssignment.endTime) {
          coverage.set(hourlyKey(slot), (coverage.get(hourlyKey(slot)) ?? 0) + 1);
        }
      }
    }
  }

  return mergeAdjacentDrafts(created);
}

function mergeAdjacentDrafts(assignments: DraftAssignment[]) {
  const sorted = [...assignments].sort((a, b) => {
    if (a.volunteerId === b.volunteerId) {
      return a.startTime.getTime() - b.startTime.getTime();
    }
    return a.volunteerId.localeCompare(b.volunteerId);
  });

  const merged: DraftAssignment[] = [];

  for (const assignment of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.volunteerId === assignment.volunteerId &&
      previous.endTime.getTime() === assignment.startTime.getTime() &&
      differenceInHours(assignment.endTime, previous.startTime) <= 12
    ) {
      previous.endTime = assignment.endTime;
    } else {
      merged.push({ ...assignment });
    }
  }

  return merged;
}
