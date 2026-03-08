import type { AuditLogOutcome, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function writeAuditLog(params: {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: AuditLogOutcome;
  details?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: params.actorUserId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      outcome: params.outcome,
      details: params.details,
    },
  });
}
