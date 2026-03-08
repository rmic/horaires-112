import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test-auth-secret";
process.env.NEXTAUTH_URL = "http://localhost:3000";

let prisma: typeof import("@/lib/prisma").prisma;
let provisionAuthorizedManagerFromExternalIdentity: typeof import("@/lib/server/app-user-identities").provisionAuthorizedManagerFromExternalIdentity;
let provisionAppUserForMcpIdentity: typeof import("@/lib/server/app-user-identities").provisionAppUserForMcpIdentity;
let resolveAppUserByExternalIdentity: typeof import("@/lib/server/app-user-identities").resolveAppUserByExternalIdentity;

before(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({
    provisionAuthorizedManagerFromExternalIdentity,
    provisionAppUserForMcpIdentity,
    resolveAppUserByExternalIdentity,
  } = await import("@/lib/server/app-user-identities"));
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
  delete process.env.MANAGER_ALLOWED_EMAILS;
});

after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
});

test("refuses OAuth sign-in for an email that is not pre-authorized", async () => {
  const result = await provisionAuthorizedManagerFromExternalIdentity({
    email: "intrus@example.com",
    displayName: "Intrus",
    providerKey: "nextauth:google",
    providerName: "google",
    subject: "sub-intrus",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "not-authorized",
  });
});

test("creates internal app user and web identity for an authorized manager from DB", async () => {
  await prisma.managerAccess.create({
    data: {
      email: "planner@example.com",
      displayName: "Planning Manager",
      role: "PLANNER",
    },
  });

  const result = await provisionAuthorizedManagerFromExternalIdentity({
    email: "planner@example.com",
    displayName: "Planning Manager",
    providerKey: "nextauth:azure-ad",
    providerName: "azure-ad",
    subject: "ms-sub-1",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected authorized manager.");
  }

  const appUser = await prisma.appUser.findUnique({
    where: {
      email: "planner@example.com",
    },
  });

  const identity = await prisma.appUserIdentity.findUnique({
    where: {
      providerKey_subject: {
        providerKey: "nextauth:azure-ad",
        subject: "ms-sub-1",
      },
    },
  });

  assert.equal(appUser?.role, "PLANNER");
  assert.equal(appUser?.active, true);
  assert.equal(identity?.appUserId, appUser?.id);
  assert.equal(identity?.type, "WEB_OAUTH");
});

test("env allowlist authorizes manager and defaults role to PLANNER", async () => {
  process.env.MANAGER_ALLOWED_EMAILS = "manager@example.com";

  const result = await provisionAuthorizedManagerFromExternalIdentity({
    email: "manager@example.com",
    displayName: "Manager",
    providerKey: "nextauth:google",
    providerName: "google",
    subject: "google-sub-1",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected allowed manager.");
  }

  assert.equal(result.appUser.role, "PLANNER");
});

test("resolves MCP identity through the shared app user identity table", async () => {
  const appUser = await provisionAppUserForMcpIdentity({
    email: "mcp@example.com",
    displayName: "MCP Manager",
    role: "PLANNER",
    providerKey: "https://issuer.example.com/",
    providerName: "Issuer",
    subject: "oidc-sub-42",
  });

  const resolved = await resolveAppUserByExternalIdentity({
    providerKey: "https://issuer.example.com/",
    subject: "oidc-sub-42",
    email: "mcp@example.com",
  });

  assert.equal(resolved?.id, appUser.id);
  assert.equal(resolved?.email, "mcp@example.com");
});
