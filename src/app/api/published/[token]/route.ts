import { ApiError, ok, withApiError } from "@/lib/api";
import { computeCoverageSegments, getGapSegments, splitCoverageByDay } from "@/lib/coverage";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { getPlanningMonthWindow, listMonthDays } from "@/lib/time";

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

    const window = getPlanningMonthWindow(month);
    const boundaries = listMonthDays(window.displayStart, window.displayEnd);

    const segments = computeCoverageSegments({
      rangeStart: window.coverageStart,
      rangeEnd: window.coverageEnd,
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
      month: {
        ...month,
        startsAt: window.displayStart,
        endsAt: window.displayEnd,
        coverageStartsAt: window.coverageStart,
        coverageEndsAt: window.coverageEnd,
      },
      volunteers,
      coverageSegments: segments,
      dayTimelines: splitCoverageByDay(window.displayStart, window.displayEnd, segments),
      gaps: getGapSegments(segments),
    });
  });
