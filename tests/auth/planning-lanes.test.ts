import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanningAvailabilityBlocks,
  buildPlanningPlacementPlan,
  splitIntervalOnPlanningBoundaries,
  type PlanningAssignment,
} from "@/lib/planning-lanes";

test("splits an availability block at the 18h boundary on the planning axis", () => {
  const segments = splitIntervalOnPlanningBoundaries(
    "2026-04-04T12:00:00.000Z",
    "2026-04-04T20:00:00.000Z",
    "2026-04-01T04:00:00.000Z",
  );

  assert.deepEqual(segments, [
    {
      startTime: "2026-04-04T12:00:00.000Z",
      endTime: "2026-04-04T16:00:00.000Z",
    },
    {
      startTime: "2026-04-04T16:00:00.000Z",
      endTime: "2026-04-04T20:00:00.000Z",
    },
  ]);
});

test("builds a truncation plan when a new placement wins a lane conflict", () => {
  const assignments: PlanningAssignment[] = [
    {
      id: "existing-1",
      volunteerId: "v-existing",
      volunteerName: "Existing Volunteer",
      volunteerColor: "#ef4444",
      startTime: "2026-04-04T10:00:00.000Z",
      endTime: "2026-04-04T18:00:00.000Z",
      lane: "A1",
      status: "CONFIRMED",
      source: "MANUAL",
    },
  ];

  const plan = buildPlanningPlacementPlan({
    assignments,
    lane: "A1",
    volunteerId: "v-new",
    volunteerName: "New Volunteer",
    volunteerColor: "#22c55e",
    startTime: "2026-04-04T12:00:00.000Z",
    endTime: "2026-04-04T16:00:00.000Z",
    resolutions: [
      {
        assignmentId: "existing-1",
        winner: "new",
      },
    ],
  });

  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.missingResolutionIds.length, 0);
  assert.deepEqual(plan.mutations, [
    {
      kind: "update",
      assignmentId: "existing-1",
      volunteerId: "v-existing",
      volunteerName: "Existing Volunteer",
      volunteerColor: "#ef4444",
      startTime: "2026-04-04T10:00:00.000Z",
      endTime: "2026-04-04T12:00:00.000Z",
      lane: "A1",
      status: "CONFIRMED",
      source: "MANUAL",
    },
    {
      kind: "create",
      tempId: "split:existing-1:2026-04-04T16:00:00.000Z",
      originAssignmentId: "existing-1",
      volunteerId: "v-existing",
      volunteerName: "Existing Volunteer",
      volunteerColor: "#ef4444",
      startTime: "2026-04-04T16:00:00.000Z",
      endTime: "2026-04-04T18:00:00.000Z",
      lane: "A1",
      status: "CONFIRMED",
      source: "MANUAL",
    },
    {
      kind: "create",
      tempId: "new:v-new:A1:2026-04-04T12:00:00.000Z",
      volunteerId: "v-new",
      volunteerName: "New Volunteer",
      volunteerColor: "#22c55e",
      startTime: "2026-04-04T12:00:00.000Z",
      endTime: "2026-04-04T16:00:00.000Z",
      lane: "A1",
      status: "CONFIRMED",
      source: "MANUAL",
    },
  ]);
});

test("merges contiguous hourly availabilities including midnight, but keeps 06/18 shift boundaries", () => {
  const blocks = buildPlanningAvailabilityBlocks(
    [
      {
        id: "h1",
        volunteerId: "vol-1",
        volunteerName: "Maxime",
        volunteerColor: "#10b981",
        startTime: "2026-04-04T12:00:00.000Z",
        endTime: "2026-04-04T14:00:00.000Z",
      },
      {
        id: "h2",
        volunteerId: "vol-1",
        volunteerName: "Maxime",
        volunteerColor: "#10b981",
        startTime: "2026-04-04T14:00:00.000Z",
        endTime: "2026-04-04T16:00:00.000Z",
      },
      {
        id: "h3",
        volunteerId: "vol-1",
        volunteerName: "Maxime",
        volunteerColor: "#10b981",
        startTime: "2026-04-04T16:00:00.000Z",
        endTime: "2026-04-04T22:00:00.000Z",
      },
      {
        id: "h4",
        volunteerId: "vol-1",
        volunteerName: "Maxime",
        volunteerColor: "#10b981",
        startTime: "2026-04-04T22:00:00.000Z",
        endTime: "2026-04-05T02:00:00.000Z",
      },
    ],
    "2026-04-01T04:00:00.000Z",
  );

  assert.deepEqual(
    blocks.map((block) => ({
      startTime: block.startTime,
      endTime: block.endTime,
    })),
    [
      {
        startTime: "2026-04-04T12:00:00.000Z",
        endTime: "2026-04-04T16:00:00.000Z",
      },
      {
        startTime: "2026-04-04T16:00:00.000Z",
        endTime: "2026-04-05T02:00:00.000Z",
      },
    ],
  );
});

test("merges contiguous blocks per volunteer even when other volunteers have interleaved availability rows", () => {
  const blocks = buildPlanningAvailabilityBlocks(
    [
      {
        id: "a1",
        volunteerId: "axel",
        volunteerName: "Axel",
        volunteerColor: "#10b981",
        startTime: "2026-04-02T04:00:00.000Z",
        endTime: "2026-04-02T05:00:00.000Z",
      },
      {
        id: "b1",
        volunteerId: "bob",
        volunteerName: "Bob",
        volunteerColor: "#ef4444",
        startTime: "2026-04-02T04:00:00.000Z",
        endTime: "2026-04-02T12:00:00.000Z",
      },
      {
        id: "a2",
        volunteerId: "axel",
        volunteerName: "Axel",
        volunteerColor: "#10b981",
        startTime: "2026-04-02T05:00:00.000Z",
        endTime: "2026-04-02T06:00:00.000Z",
      },
      {
        id: "a3",
        volunteerId: "axel",
        volunteerName: "Axel",
        volunteerColor: "#10b981",
        startTime: "2026-04-02T06:00:00.000Z",
        endTime: "2026-04-02T12:00:00.000Z",
      },
    ],
    "2026-04-01T04:00:00.000Z",
  );

  assert.deepEqual(
    blocks
      .filter((block) => block.volunteerId === "axel")
      .map((block) => ({
        startTime: block.startTime,
        endTime: block.endTime,
      })),
    [
      {
        startTime: "2026-04-02T04:00:00.000Z",
        endTime: "2026-04-02T12:00:00.000Z",
      },
    ],
  );
});
