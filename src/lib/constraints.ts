import { addHours, differenceInHours, isAfter, isBefore } from "date-fns";
import type { Interval } from "@/lib/time";

type AssignmentLike = Interval & {
  volunteerId: string;
  id: string;
};

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
  return candidates.some(
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
  return assignments.filter((assignment) => assignment.volunteerId === volunteerId).length;
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

    const gapAfterExisting = assignment.startTime.getTime() - existing.endTime.getTime();
    const gapBeforeExisting = existing.startTime.getTime() - assignment.endTime.getTime();

    if (gapAfterExisting >= 0 && gapAfterExisting < warningMs) {
      return `Repos recommandé non respecté (${recommendedHours}h) entre deux gardes.`;
    }

    if (gapBeforeExisting >= 0 && gapBeforeExisting < warningMs) {
      return `Repos recommandé non respecté (${recommendedHours}h) entre deux gardes.`;
    }
  }

  return null;
}
