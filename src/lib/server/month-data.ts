import { AvailabilityStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeCoverageSegments, getGapSegments, splitCoverageByDay } from "@/lib/coverage";
import { getPlanningMonthWindow, listMonthDays } from "@/lib/time";

export async function getMonthSnapshot(monthId: string) {
  const month = await prisma.planningMonth.findUnique({
    where: { id: monthId },
    include: {
      assignments: {
        include: {
          volunteer: true,
        },
        orderBy: {
          startTime: "asc",
        },
      },
      availabilities: {
        where: {
          status: AvailabilityStatus.APPROVED,
        },
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
      notes: {
        include: {
          volunteer: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      assignmentEvents: {
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      },
    },
  });

  if (!month) {
    return null;
  }

  const window = getPlanningMonthWindow(month);
  const dayBoundaries = listMonthDays(window.displayStart, window.displayEnd);

  const segments = computeCoverageSegments({
    rangeStart: window.coverageStart,
    rangeEnd: window.coverageEnd,
    assignments: month.assignments.map((assignment) => ({
      id: assignment.id,
      volunteerId: assignment.volunteerId,
      volunteerName: assignment.volunteer.name,
      volunteerColor: assignment.volunteer.color,
      lane: assignment.lane,
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
    extraBoundaries: dayBoundaries,
    forceHourlyBoundaries: true,
  });

  const dayTimelines = splitCoverageByDay(window.displayStart, window.displayEnd, segments);
  const gaps = getGapSegments(segments);

  return {
    month: {
      ...month,
      startsAt: window.displayStart,
      endsAt: window.displayEnd,
      coverageStartsAt: window.coverageStart,
      coverageEndsAt: window.coverageEnd,
    },
    segments,
    dayTimelines,
    gaps,
  };
}
