import { addHours, differenceInHours, isAfter, isBefore } from "date-fns";
import type { Interval } from "@/lib/time";

type AssignmentLike = Interval & {
  volunteerId: string;
  id: string;
};

export function mergeContiguousIntervals<T extends Interval>(intervals: T[]) {
  return [...intervals]
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime())
    .reduce<Interval[]>((merged, candidate) => {
      const previous = merged.at(-1);

      if (!previous) {
        merged.push({
          startTime: candidate.startTime,
          endTime: candidate.endTime,
        });
        return merged;
      }

      if (candidate.startTime.getTime() <= previous.endTime.getTime()) {
        if (candidate.endTime.getTime() > previous.endTime.getTime()) {
          previous.endTime = candidate.endTime;
        }
        return merged;
      }

      merged.push({
        startTime: candidate.startTime,
        endTime: candidate.endTime,
      });
      return merged;
    }, []);
}

export function validateVolunteerShift(startTime: Date, endTime: Date) {
  if (!isBefore(startTime, endTime)) {
    return "La fin doit être après le début.";
  }

  const duration = differenceInHours(endTime, startTime);

  if (duration < 1) {
    return "Une garde volontaire doit durer au moins 1 heure.";
  }

  if (duration > 12) {
    return "Une garde volontaire ne peut pas dépasser 12 heures.";
  }

  if (startTime.getMinutes() !== 0 || endTime.getMinutes() !== 0) {
    return "Les heures doivent être alignées sur des heures pleines (00 minutes).";
  }

  return null;
}

export function validateEmployeeBlock(startTime: Date, endTime: Date) {
  if (!isBefore(startTime, endTime)) {
    return "La fin doit être après le début.";
  }

  if (differenceInHours(endTime, startTime) !== 12) {
    return "Un bloc salarié doit durer exactement 12 heures.";
  }

  if (startTime.getMinutes() !== 0 || endTime.getMinutes() !== 0) {
    return "Les blocs salariés doivent commencer et finir à :00.";
  }

  if (![6, 18].includes(startTime.getHours())) {
    return "Un bloc salarié doit commencer à 06:00 ou 18:00.";
  }

  const expectedEnd = addHours(startTime, 12);
  if (expectedEnd.getTime() !== endTime.getTime()) {
    return "Un bloc salarié doit suivre le format 06:00-18:00 ou 18:00-06:00.";
  }

  return null;
}

export function intervalContainedIn(interval: Interval, candidates: Interval[]) {
  const normalized = mergeContiguousIntervals(candidates);

  return normalized.some(
    (candidate) =>
      !isAfter(candidate.startTime, interval.startTime) &&
      !isBefore(candidate.endTime, interval.endTime),
  );
}

export function hasOverlap(interval: Interval, others: Interval[]) {
  return others.some(
    (other) => isBefore(interval.startTime, other.endTime) && isAfter(interval.endTime, other.startTime),
  );
}

export function guardCount(assignments: AssignmentLike[], volunteerId: string) {
  return mergeContiguousIntervals(assignments.filter((assignment) => assignment.volunteerId === volunteerId)).length;
}

export function projectedGuardCount(
  assignment: Interval,
  volunteerAssignments: Interval[],
) {
  return mergeContiguousIntervals([...volunteerAssignments, assignment]).length;
}

export function getRestWarning(
  assignment: Interval,
  volunteerAssignments: Interval[],
  recommendedHours = 11,
) {
  const warningMs = recommendedHours * 60 * 60 * 1000;

  for (const existing of volunteerAssignments) {
    if (hasOverlap(assignment, [existing])) {
      return "Chevauchement avec une autre garde du volontaire.";
    }
  }

  const merged = mergeContiguousIntervals([...volunteerAssignments, assignment]);
  const currentIndex = merged.findIndex(
    (interval) =>
      interval.startTime.getTime() <= assignment.startTime.getTime() &&
      interval.endTime.getTime() >= assignment.endTime.getTime(),
  );

  if (currentIndex === -1) {
    return null;
  }

  const currentInterval = merged[currentIndex];
  const continuousDuration = differenceInHours(currentInterval.endTime, currentInterval.startTime);
  if (continuousDuration > 12) {
    return "Cette garde continue dépasserait 12 heures sans interruption.";
  }

  const previousInterval = currentIndex > 0 ? merged[currentIndex - 1] : null;
  const nextInterval = currentIndex < merged.length - 1 ? merged[currentIndex + 1] : null;

  if (previousInterval) {
    const gapAfterPrevious = currentInterval.startTime.getTime() - previousInterval.endTime.getTime();
    if (gapAfterPrevious >= 0 && gapAfterPrevious < warningMs) {
      return `Repos recommandé non respecté (${recommendedHours}h) entre deux gardes.`;
    }
  }

  if (nextInterval) {
    const gapBeforeNext = nextInterval.startTime.getTime() - currentInterval.endTime.getTime();
    if (gapBeforeNext >= 0 && gapBeforeNext < warningMs) {
      return `Repos recommandé non respecté (${recommendedHours}h) entre deux gardes.`;
    }
  }

  return null;
}
