import test from "node:test";
import assert from "node:assert/strict";
import { getRestWarning, intervalContainedIn, projectedGuardCount } from "@/lib/constraints";

test("treats contiguous availability intervals as a continuous coverage window", () => {
  const covered = intervalContainedIn(
    {
      startTime: new Date("2026-04-01T04:00:00.000Z"),
      endTime: new Date("2026-04-01T12:00:00.000Z"),
    },
    [
      {
        startTime: new Date("2026-04-01T04:00:00.000Z"),
        endTime: new Date("2026-04-01T08:00:00.000Z"),
      },
      {
        startTime: new Date("2026-04-01T08:00:00.000Z"),
        endTime: new Date("2026-04-01T12:00:00.000Z"),
      },
    ],
  );

  assert.equal(covered, true);
});

test("does not warn when a volunteer continues the same guard across a 6h/18h split", () => {
  const warning = getRestWarning(
    {
      startTime: new Date("2026-04-04T16:00:00.000Z"),
      endTime: new Date("2026-04-04T20:00:00.000Z"),
    },
    [
      {
        startTime: new Date("2026-04-04T12:00:00.000Z"),
        endTime: new Date("2026-04-04T16:00:00.000Z"),
      },
    ],
  );

  assert.equal(warning, null);
});

test("warns when a continuous chain would exceed 12 hours", () => {
  const warning = getRestWarning(
    {
      startTime: new Date("2026-04-04T16:00:00.000Z"),
      endTime: new Date("2026-04-05T02:00:00.000Z"),
    },
    [
      {
        startTime: new Date("2026-04-04T08:00:00.000Z"),
        endTime: new Date("2026-04-04T16:00:00.000Z"),
      },
    ],
  );

  assert.equal(warning, "Cette garde continue dépasserait 12 heures sans interruption.");
});

test("warns when the rest gap before the next assignment is less than 11 hours", () => {
  const warning = getRestWarning(
    {
      startTime: new Date("2026-04-04T06:00:00.000Z"),
      endTime: new Date("2026-04-04T14:00:00.000Z"),
    },
    [
      {
        startTime: new Date("2026-04-04T20:00:00.000Z"),
        endTime: new Date("2026-04-05T04:00:00.000Z"),
      },
    ],
  );

  assert.equal(warning, "Repos recommandé non respecté (11h) entre deux gardes.");
});

test("projected guard count keeps contiguous split blocks as a single guard", () => {
  const guardCount = projectedGuardCount(
    {
      startTime: new Date("2026-04-04T16:00:00.000Z"),
      endTime: new Date("2026-04-04T20:00:00.000Z"),
    },
    [
      {
        startTime: new Date("2026-04-04T12:00:00.000Z"),
        endTime: new Date("2026-04-04T16:00:00.000Z"),
      },
    ],
  );

  assert.equal(guardCount, 1);
});
