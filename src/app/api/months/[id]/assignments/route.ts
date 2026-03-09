import { AssignmentSource, AssignmentStatus } from "@prisma/client";
import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import { createAssignments, listAssignments } from "@/lib/server/assignment-service";
import { requirePlannerAccess } from "@/lib/server/web-manager-auth";
import { parseDateInput } from "@/lib/time";

export const runtime = "nodejs";

const createAssignmentSchema = z
  .object({
    volunteerId: z.string().min(1).optional(),
    volunteerIds: z.array(z.string().min(1)).min(1).max(2).optional(),
    startTime: z.string(),
    endTime: z.string(),
    status: z.nativeEnum(AssignmentStatus).default(AssignmentStatus.CONFIRMED),
    source: z.nativeEnum(AssignmentSource).default(AssignmentSource.MANUAL),
    ignoreRestWarning: z.boolean().optional().default(false),
  })
  .refine((value) => value.volunteerId || value.volunteerIds, {
    message: "Au moins un volontaire est requis.",
    path: ["volunteerId"],
  });

export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    const { id: planningMonthId } = await context.params;
    const assignments = await listAssignments(planningMonthId);
    return ok({ assignments });
  });

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  withApiError(async () => {
    await requirePlannerAccess();
    const { id: planningMonthId } = await context.params;

    const body = createAssignmentSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Garde invalide.", body.error.flatten());
    }

    const volunteerIds = body.data.volunteerIds ?? (body.data.volunteerId ? [body.data.volunteerId] : []);
    const assignments = await createAssignments({
      planningMonthId,
      volunteerIds,
      startTime: parseDateInput(body.data.startTime),
      endTime: parseDateInput(body.data.endTime),
      status: body.data.status,
      source: body.data.source,
      ignoreRestWarning: body.data.ignoreRestWarning,
    });

    return ok(
      {
        assignment: assignments[0],
        assignments,
      },
      { status: 201 },
    );
  });
