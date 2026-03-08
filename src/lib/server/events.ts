import type { AssignmentEventType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function logAssignmentEvent(params: {
  planningMonthId: string;
  assignmentId?: string | null;
  eventType: AssignmentEventType;
  payload?: Prisma.InputJsonValue;
}) {
  await prisma.assignmentEvent.create({
    data: {
      planningMonthId: params.planningMonthId,
      assignmentId: params.assignmentId ?? null,
      eventType: params.eventType,
      payload: params.payload,
    },
  });
}
