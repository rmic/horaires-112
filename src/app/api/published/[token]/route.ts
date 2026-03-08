import { eachDayOfInterval } from "date-fns";
import { ApiError, ok, withApiError } from "@/lib/api";
import { computeCoverageSegments, getGapSegments, splitCoverageByDay } from "@/lib/coverage";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export const GET = (request: Request, context: { params: Promise<{ token: string }> }) =>
  withApiError(async () => {
    const { token } = await context.params;
    const password = new URL(request.url).searchParams.get("password") ?? "";

    const month = await prisma.planningMonth.findUnique({
      where: {
        publicToken: token,
      },
      include: {
        assignments: {
          include: {
            volunteer: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
        employeeBlocks: {
          orderBy: {
            startTime: "asc",
          },
        },
      },
    });

    if (!month || month.status !== "PUBLISHED") {
      throw new ApiError(404, "Planning publié introuvable.");
    }

    if (month.publicPasswordHash) {
      if (!password) {
        return ok({
          requiresPassword: true,
        });
      }

      const valid = await verifyPassword(password, month.publicPasswordHash);
      if (!valid) {
        throw new ApiError(401, "Mot de passe invalide.", {
          requiresPassword: true,
        });
      }
    }

    const boundaries = eachDayOfInterval({
      start: month.startsAt,
      end: month.endsAt,
    });

    const segments = computeCoverageSegments({
      rangeStart: month.startsAt,
      rangeEnd: month.endsAt,
      assignments: month.assignments.map((assignment) => ({
        id: assignment.id,
        volunteerId: assignment.volunteerId,
        volunteerName: assignment.volunteer.name,
        volunteerColor: assignment.volunteer.color,
        status: assignment.status,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      })),
      employeeBlocks: month.employeeBlocks.map((block) => ({
        id: block.id,
        label: block.label,
        startTime: block.startTime,
        endTime: block.endTime,
      })),
      extraBoundaries: boundaries,
      forceHourlyBoundaries: true,
    });

    const volunteers = await prisma.volunteer.findMany({
      orderBy: {
        name: "asc",
      },
    });

    return ok({
      requiresPassword: false,
      month,
      volunteers,
      coverageSegments: segments,
      dayTimelines: splitCoverageByDay(month.startsAt, month.endsAt, segments),
      gaps: getGapSegments(segments),
    });
  });
