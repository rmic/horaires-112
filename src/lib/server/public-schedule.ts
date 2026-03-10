import { prisma } from "@/lib/prisma";
import { getMonthSnapshot } from "@/lib/server/month-data";

type ManagerPreviewPayload = {
  requiresPassword: boolean;
  month?: {
    year: number;
    month: number;
  };
  volunteers?: Array<{
    id: string;
    name: string;
  }>;
  dayTimelines?: Array<{
    dayStart: string;
    dayEnd: string;
    segments: Array<{
      startTime: string;
      endTime: string;
      missingCount: number;
      volunteerAssignments: Array<{
        volunteerId: string;
        volunteerName: string;
        volunteerColor: string;
        lane?: "A1" | "A2" | "A3" | null;
        status: "CONFIRMED" | "PROVISIONAL";
      }>;
      employeeBlocks: Array<{
        id: string;
        label: string;
      }>;
    }>;
  }>;
  gaps?: Array<{
    startTime: string;
    endTime: string;
    missingCount: number;
  }>;
};

export async function getManagerPreviewPayload(monthId: string): Promise<ManagerPreviewPayload | null> {
  const snapshot = await getMonthSnapshot(monthId);
  if (!snapshot) {
    return null;
  }

  const volunteers = await prisma.volunteer.findMany({
    orderBy: {
      name: "asc",
    },
  });

  return {
    requiresPassword: false,
    month: {
      year: snapshot.month.year,
      month: snapshot.month.month,
    },
    volunteers: volunteers.map((volunteer) => ({
      id: volunteer.id,
      name: volunteer.name,
    })),
    dayTimelines: snapshot.dayTimelines.map((timeline) => ({
      dayStart: timeline.dayStart.toISOString(),
      dayEnd: timeline.dayEnd.toISOString(),
      segments: timeline.segments.map((segment) => ({
        startTime: segment.startTime.toISOString(),
        endTime: segment.endTime.toISOString(),
        missingCount: segment.missingCount,
        volunteerAssignments: segment.volunteerAssignments.map((assignment) => ({
          volunteerId: assignment.volunteerId,
          volunteerName: assignment.volunteerName,
          volunteerColor: assignment.volunteerColor,
          lane: assignment.lane,
          status: assignment.status,
        })),
        employeeBlocks: segment.employeeBlocks.map((block) => ({
          id: block.id,
          label: block.label,
        })),
      })),
    })),
    gaps: snapshot.gaps.map((gap) => ({
      startTime: gap.startTime.toISOString(),
      endTime: gap.endTime.toISOString(),
      missingCount: gap.missingCount,
    })),
  };
}
