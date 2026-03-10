import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test-auth-secret";
process.env.NEXTAUTH_URL = "http://localhost:3000";

let prisma: typeof import("@/lib/prisma").prisma;
let createAssignments: typeof import("@/lib/server/assignment-service").createAssignments;

before(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({ createAssignments } = await import("@/lib/server/assignment-service"));
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.assignmentEvent.deleteMany();
  await prisma.scheduleAdjustmentDraft.deleteMany();
  await prisma.availabilityDraft.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.employeeBlock.deleteMany();
  await prisma.note.deleteMany();
  await prisma.volunteerMonthSetting.deleteMany();
  await prisma.planningMonth.deleteMany();
  await prisma.appUserIdentity.deleteMany();
  await prisma.managerAccess.deleteMany();
  await prisma.appUser.deleteMany();
  await prisma.volunteer.deleteMany();
});

after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
});

async function seedPlanningMonth() {
  const month = await prisma.planningMonth.create({
    data: {
      year: 2026,
      month: 4,
      startsAt: new Date("2026-03-31T22:00:00.000Z"),
      endsAt: new Date("2026-04-30T22:00:00.000Z"),
    },
  });

  const [alice, bob] = await Promise.all([
    prisma.volunteer.create({
      data: {
        name: "Alice Lane Test",
        color: "#16a34a",
      },
    }),
    prisma.volunteer.create({
      data: {
        name: "Bob Lane Test",
        color: "#f97316",
      },
    }),
  ]);

  await prisma.availability.createMany({
    data: [
      {
        planningMonthId: month.id,
        volunteerId: alice.id,
        startTime: new Date("2026-04-01T04:00:00.000Z"),
        endTime: new Date("2026-04-01T16:00:00.000Z"),
        status: "APPROVED",
      },
      {
        planningMonthId: month.id,
        volunteerId: bob.id,
        startTime: new Date("2026-04-01T04:00:00.000Z"),
        endTime: new Date("2026-04-01T16:00:00.000Z"),
        status: "APPROVED",
      },
    ],
  });

  return { month, alice, bob };
}

test("stores explicit A1/A2 lanes without altering legacy assignments", async () => {
  const { month, alice, bob } = await seedPlanningMonth();

  await prisma.assignment.create({
    data: {
      planningMonthId: month.id,
      volunteerId: alice.id,
      startTime: new Date("2026-04-01T04:00:00.000Z"),
      endTime: new Date("2026-04-01T10:00:00.000Z"),
      status: "CONFIRMED",
      source: "MANUAL",
    },
  });

  await createAssignments({
    planningMonthId: month.id,
    volunteerIds: [bob.id],
    startTime: new Date("2026-04-01T10:00:00.000Z"),
    endTime: new Date("2026-04-01T16:00:00.000Z"),
    lane: "A2",
    status: "CONFIRMED",
    source: "MANUAL",
  });

  const assignments = await prisma.assignment.findMany({
    where: {
      planningMonthId: month.id,
    },
    orderBy: {
      startTime: "asc",
    },
  });

  assert.equal(assignments.length, 2);
  assert.equal(assignments[0]?.lane, null);
  assert.equal(assignments[1]?.lane, "A2");
});

test("rejects overlapping explicit assignments on the same lane", async () => {
  const { month, alice, bob } = await seedPlanningMonth();

  await createAssignments({
    planningMonthId: month.id,
    volunteerIds: [alice.id],
    startTime: new Date("2026-04-01T04:00:00.000Z"),
    endTime: new Date("2026-04-01T10:00:00.000Z"),
    lane: "A1",
    status: "CONFIRMED",
    source: "MANUAL",
  });

  await assert.rejects(
    () =>
      createAssignments({
        planningMonthId: month.id,
        volunteerIds: [bob.id],
        startTime: new Date("2026-04-01T04:00:00.000Z"),
        endTime: new Date("2026-04-01T10:00:00.000Z"),
        lane: "A1",
        status: "CONFIRMED",
        source: "MANUAL",
      }),
    /Le rôle A1 est déjà occupé/,
  );

  const secondLaneAssignments = await createAssignments({
    planningMonthId: month.id,
    volunteerIds: [bob.id],
    startTime: new Date("2026-04-01T04:00:00.000Z"),
    endTime: new Date("2026-04-01T10:00:00.000Z"),
    lane: "A2",
    status: "CONFIRMED",
    source: "MANUAL",
  });

  assert.equal(secondLaneAssignments[0]?.lane, "A2");
});
