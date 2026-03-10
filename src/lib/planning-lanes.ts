import { differenceInHours } from "date-fns";
import { remapFromDisplayAxis, remapToDisplayAxis } from "@/lib/time";

export const PLANNING_LANES = ["A1", "A2", "A3"] as const;

export type PlanningLane = (typeof PLANNING_LANES)[number];

export type PlanningAvailability = {
  id: string;
  volunteerId: string;
  volunteerName: string;
  volunteerColor: string;
  startTime: string;
  endTime: string;
};

export type PlanningAssignment = {
  id: string;
  volunteerId: string;
  volunteerName: string;
  volunteerColor: string;
  startTime: string;
  endTime: string;
  lane?: PlanningLane | null;
  status: "CONFIRMED" | "PROVISIONAL";
  source?: "MANUAL" | "DRAFT";
};

export type PlanningAvailabilityBlock = PlanningAvailability & {
  key: string;
};

export type PlanningLaneBlock = PlanningAssignment & {
  key: string;
  projectedLane: PlanningLane;
  explicitLane: boolean;
};

export type PlanningPlacementResolution = {
  assignmentId: string;
  winner: "existing" | "new";
};

export type PlanningPlacementConflict = {
  assignmentId: string;
  volunteerId: string;
  volunteerName: string;
  volunteerColor: string;
  projectedLane: PlanningLane;
  explicitLane: boolean;
  startTime: string;
  endTime: string;
  overlapStartTime: string;
  overlapEndTime: string;
  status: "CONFIRMED" | "PROVISIONAL";
  source?: "MANUAL" | "DRAFT";
};

export type PlanningPlacementMutation =
  | {
      kind: "delete";
      assignmentId: string;
    }
  | {
      kind: "update";
      assignmentId: string;
      volunteerId: string;
      volunteerName: string;
      volunteerColor: string;
      startTime: string;
      endTime: string;
      lane: PlanningLane;
      status: "CONFIRMED" | "PROVISIONAL";
      source?: "MANUAL" | "DRAFT";
    }
  | {
      kind: "create";
      tempId: string;
      volunteerId: string;
      volunteerName: string;
      volunteerColor: string;
      startTime: string;
      endTime: string;
      lane: PlanningLane;
      status: "CONFIRMED" | "PROVISIONAL";
      source?: "MANUAL" | "DRAFT";
      originAssignmentId?: string;
    };

type IsoInterval = {
  startTime: string;
  endTime: string;
};

function sortByStartTime<T extends IsoInterval>(items: T[]) {
  return [...items].sort((left, right) => {
    const startDiff = new Date(left.startTime).getTime() - new Date(right.startTime).getTime();
    if (startDiff !== 0) {
      return startDiff;
    }

    return new Date(left.endTime).getTime() - new Date(right.endTime).getTime();
  });
}

function overlaps(left: IsoInterval, right: IsoInterval) {
  return new Date(left.startTime) < new Date(right.endTime) && new Date(left.endTime) > new Date(right.startTime);
}

function intersection(left: IsoInterval, right: IsoInterval): IsoInterval | null {
  if (!overlaps(left, right)) {
    return null;
  }

  const startTime = new Date(Math.max(new Date(left.startTime).getTime(), new Date(right.startTime).getTime()));
  const endTime = new Date(Math.min(new Date(left.endTime).getTime(), new Date(right.endTime).getTime()));

  if (startTime >= endTime) {
    return null;
  }

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
}

function subtractInterval(base: IsoInterval, blocker: IsoInterval) {
  const clipped = intersection(base, blocker);
  if (!clipped) {
    return [base];
  }

  const intervals: IsoInterval[] = [];
  if (new Date(base.startTime) < new Date(clipped.startTime)) {
    intervals.push({
      startTime: base.startTime,
      endTime: clipped.startTime,
    });
  }

  if (new Date(clipped.endTime) < new Date(base.endTime)) {
    intervals.push({
      startTime: clipped.endTime,
      endTime: base.endTime,
    });
  }

  return intervals;
}

function mergeIntervals<T extends IsoInterval>(items: T[]) {
  const sorted = sortByStartTime(items);
  const merged: T[] = [];

  for (const item of sorted) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...item });
      continue;
    }

    if (new Date(previous.endTime).getTime() >= new Date(item.startTime).getTime()) {
      if (new Date(item.endTime).getTime() > new Date(previous.endTime).getTime()) {
        previous.endTime = item.endTime;
      }
      continue;
    }

    merged.push({ ...item });
  }

  return merged;
}

function laneHasOverlap(blocks: PlanningLaneBlock[], interval: IsoInterval) {
  return blocks.some((block) => overlaps(block, interval));
}

export function splitIntervalOnPlanningBoundaries(
  startTime: string,
  endTime: string,
  axisStart: string,
) {
  const actualStart = new Date(startTime);
  const actualEnd = new Date(endTime);
  const axisStartDate = new Date(axisStart);
  const displayStart = remapToDisplayAxis(actualStart, axisStartDate);
  const displayEnd = remapToDisplayAxis(actualEnd, axisStartDate);
  const boundaries = [actualStart.getTime(), actualEnd.getTime()];
  const firstBoundaryIndex = Math.floor(differenceInHours(displayStart, remapToDisplayAxis(axisStartDate, axisStartDate)) / 12);
  const lastBoundaryIndex = Math.ceil(differenceInHours(displayEnd, remapToDisplayAxis(axisStartDate, axisStartDate)) / 12) + 1;

  for (let index = firstBoundaryIndex; index <= lastBoundaryIndex; index += 1) {
    const boundaryDisplay = new Date(remapToDisplayAxis(axisStartDate, axisStartDate).getTime() + index * 12 * 60 * 60 * 1000);
    const boundaryActual = remapFromDisplayAxis(boundaryDisplay, axisStartDate);
    const boundaryTime = boundaryActual.getTime();
    if (boundaryTime > actualStart.getTime() && boundaryTime < actualEnd.getTime()) {
      boundaries.push(boundaryTime);
    }
  }

  const sorted = [...new Set(boundaries)].sort((left, right) => left - right);
  return sorted.slice(0, -1).map((value, index) => ({
    startTime: new Date(value).toISOString(),
    endTime: new Date(sorted[index + 1]).toISOString(),
  }));
}

export function buildPlanningAvailabilityBlocks(
  availabilities: PlanningAvailability[],
  axisStart: string,
) {
  const axisStartDate = new Date(axisStart);
  const blocksByVolunteer = new Map<string, PlanningAvailabilityBlock[]>();
  const merged: PlanningAvailabilityBlock[] = [];

  const isShiftBoundary = (value: string) => {
    const display = remapToDisplayAxis(new Date(value), axisStartDate);
    return display.getMinutes() === 0 && display.getSeconds() === 0 && (display.getHours() === 0 || display.getHours() === 12);
  };

  for (const availability of availabilities) {
    const splitBlocks = splitIntervalOnPlanningBoundaries(
      availability.startTime,
      availability.endTime,
      axisStart,
    ).map((interval) => ({
      ...availability,
      ...interval,
      key: `${availability.id}:${interval.startTime}:${interval.endTime}`,
    }));

    blocksByVolunteer.set(availability.volunteerId, [
      ...(blocksByVolunteer.get(availability.volunteerId) ?? []),
      ...splitBlocks,
    ]);
  }

  for (const [volunteerId, blocks] of blocksByVolunteer.entries()) {
    const volunteerBlocks = sortByStartTime(blocks);
    const mergedVolunteerBlocks: PlanningAvailabilityBlock[] = [];

    for (const block of volunteerBlocks) {
      const previous = mergedVolunteerBlocks.at(-1);

      if (previous && previous.endTime === block.startTime && !isShiftBoundary(block.startTime)) {
        previous.endTime = block.endTime;
        previous.key = `${volunteerId}:${previous.startTime}:${previous.endTime}`;
        continue;
      }

      mergedVolunteerBlocks.push({
        ...block,
        key: `${volunteerId}:${block.startTime}:${block.endTime}`,
      });
    }

    merged.push(...mergedVolunteerBlocks);
  }

  return sortByStartTime(merged);
}

export function projectAssignmentsToLanes(assignments: PlanningAssignment[]) {
  const lanes: Record<PlanningLane, PlanningLaneBlock[]> = {
    A1: [],
    A2: [],
    A3: [],
  };

  for (const assignment of sortByStartTime(assignments)) {
    const explicitLane = assignment.lane ?? null;
    let projectedLane: PlanningLane = explicitLane ?? "A1";

    if (!explicitLane) {
      projectedLane =
        PLANNING_LANES.find((lane) => !laneHasOverlap(lanes[lane], assignment)) ??
        PLANNING_LANES[PLANNING_LANES.length - 1];
    }

    lanes[projectedLane].push({
      ...assignment,
      key: assignment.id,
      projectedLane,
      explicitLane: Boolean(explicitLane),
    });
  }

  return lanes;
}

export function getPlanningLaneConflicts(
  assignments: PlanningAssignment[],
  lane: PlanningLane,
  startTime: string,
  endTime: string,
) {
  return projectAssignmentsToLanes(assignments)[lane]
    .filter((block) => overlaps(block, { startTime, endTime }))
    .map<PlanningPlacementConflict>((block) => {
      const overlap = intersection(block, { startTime, endTime });

      if (!overlap) {
        throw new Error("Expected overlap.");
      }

      return {
        assignmentId: block.id,
        volunteerId: block.volunteerId,
        volunteerName: block.volunteerName,
        volunteerColor: block.volunteerColor,
        projectedLane: block.projectedLane,
        explicitLane: block.explicitLane,
        startTime: block.startTime,
        endTime: block.endTime,
        overlapStartTime: overlap.startTime,
        overlapEndTime: overlap.endTime,
        status: block.status,
        source: block.source,
      };
    });
}

function applyMutations(
  assignments: PlanningAssignment[],
  mutations: PlanningPlacementMutation[],
) {
  let nextAssignments = [...assignments];

  for (const mutation of mutations) {
    if (mutation.kind === "delete") {
      nextAssignments = nextAssignments.filter((assignment) => assignment.id !== mutation.assignmentId);
      continue;
    }

    if (mutation.kind === "update") {
      nextAssignments = nextAssignments.map((assignment) =>
        assignment.id === mutation.assignmentId
          ? {
              ...assignment,
              volunteerId: mutation.volunteerId,
              volunteerName: mutation.volunteerName,
              volunteerColor: mutation.volunteerColor,
              startTime: mutation.startTime,
              endTime: mutation.endTime,
              lane: mutation.lane,
              status: mutation.status,
              source: mutation.source,
            }
          : assignment,
      );
      continue;
    }

    nextAssignments = [
      ...nextAssignments,
      {
        id: mutation.tempId,
        volunteerId: mutation.volunteerId,
        volunteerName: mutation.volunteerName,
        volunteerColor: mutation.volunteerColor,
        startTime: mutation.startTime,
        endTime: mutation.endTime,
        lane: mutation.lane,
        status: mutation.status,
        source: mutation.source,
      },
    ];
  }

  return sortByStartTime(nextAssignments);
}

export function buildPlanningPlacementPlan(params: {
  assignments: PlanningAssignment[];
  lane: PlanningLane;
  volunteerId: string;
  volunteerName: string;
  volunteerColor: string;
  startTime: string;
  endTime: string;
  resolutions?: PlanningPlacementResolution[];
}) {
  const conflicts = getPlanningLaneConflicts(params.assignments, params.lane, params.startTime, params.endTime);
  const resolutionMap = new Map((params.resolutions ?? []).map((resolution) => [resolution.assignmentId, resolution.winner]));
  const missingResolutionIds = conflicts
    .map((conflict) => conflict.assignmentId)
    .filter((assignmentId) => !resolutionMap.has(assignmentId));

  if (missingResolutionIds.length > 0) {
    return {
      conflicts,
      missingResolutionIds,
      mutations: [] as PlanningPlacementMutation[],
      previewAssignments: params.assignments,
    };
  }

  const mutations: PlanningPlacementMutation[] = [];
  let newSegments: IsoInterval[] = [
    {
      startTime: params.startTime,
      endTime: params.endTime,
    },
  ];

  for (const conflict of conflicts) {
    const winner = resolutionMap.get(conflict.assignmentId);
    const overlap = {
      startTime: conflict.overlapStartTime,
      endTime: conflict.overlapEndTime,
    };

    if (winner === "existing") {
      newSegments = newSegments.flatMap((segment) => subtractInterval(segment, overlap));
      continue;
    }

    const conflictAssignment = params.assignments.find((assignment) => assignment.id === conflict.assignmentId);
    if (!conflictAssignment) {
      continue;
    }

    const remainingPieces = subtractInterval(conflictAssignment, overlap);
    const nextLane = conflictAssignment.lane ?? params.lane;

    if (remainingPieces.length === 0) {
      mutations.push({
        kind: "delete",
        assignmentId: conflictAssignment.id,
      });
      continue;
    }

    mutations.push({
      kind: "update",
      assignmentId: conflictAssignment.id,
      volunteerId: conflictAssignment.volunteerId,
      volunteerName: conflictAssignment.volunteerName,
      volunteerColor: conflictAssignment.volunteerColor,
      startTime: remainingPieces[0].startTime,
      endTime: remainingPieces[0].endTime,
      lane: nextLane,
      status: conflictAssignment.status,
      source: conflictAssignment.source,
    });

    if (remainingPieces[1]) {
      mutations.push({
        kind: "create",
        tempId: `split:${conflictAssignment.id}:${remainingPieces[1].startTime}`,
        originAssignmentId: conflictAssignment.id,
        volunteerId: conflictAssignment.volunteerId,
        volunteerName: conflictAssignment.volunteerName,
        volunteerColor: conflictAssignment.volunteerColor,
        startTime: remainingPieces[1].startTime,
        endTime: remainingPieces[1].endTime,
        lane: nextLane,
        status: conflictAssignment.status,
        source: conflictAssignment.source,
      });
    }
  }

  for (const segment of mergeIntervals(newSegments)) {
    mutations.push({
      kind: "create",
      tempId: `new:${params.volunteerId}:${params.lane}:${segment.startTime}`,
      volunteerId: params.volunteerId,
      volunteerName: params.volunteerName,
      volunteerColor: params.volunteerColor,
      startTime: segment.startTime,
      endTime: segment.endTime,
      lane: params.lane,
      status: "CONFIRMED",
      source: "MANUAL",
    });
  }

  return {
    conflicts,
    missingResolutionIds: [] as string[],
    mutations,
    previewAssignments: applyMutations(params.assignments, mutations),
  };
}
