import { getRoleCapabilitiesCatalog } from "@/lib/server/permissions";

export function getBusinessRules() {
  return {
    coverage: {
      requiredStaffPerSegment: 2,
      employeeBlocks: [
        {
          start: "06:00",
          end: "18:00",
          durationHours: 12,
          label: "Salarié",
        },
        {
          start: "18:00",
          end: "06:00+1",
          durationHours: 12,
          label: "Salarié",
        },
      ],
    },
    volunteerAssignments: {
      minHours: 1,
      maxHours: 12,
      hourAligned: true,
      canCrossMidnight: true,
      monthlyGuardLimitOptional: true,
      recommendedRestHours: 11,
      recommendedRestIsBlocking: false,
    },
    availabilities: {
      intervalStorage: "[start_time, end_time]",
      assignmentsMustBeContained: true,
      hourAligned: true,
      statusWorkflow: ["PENDING", "APPROVED", "REJECTED"],
    },
    planning: {
      singleAmbulanceDeparture: true,
      timelineSegmentationBasedCoverage: true,
      draftBeforeSensitiveWrite: true,
    },
  };
}

export function explainAvailabilityStatuses() {
  return [
    {
      status: "PENDING",
      description: "Disponibilité reçue et committée depuis un brouillon, en attente de validation explicite.",
    },
    {
      status: "APPROVED",
      description: "Disponibilité active, utilisée pour les propositions et la validation des gardes.",
    },
    {
      status: "REJECTED",
      description: "Disponibilité refusée; elle reste historisée mais n'est pas utilisée pour le planning.",
    },
  ];
}

export function getRoleCapabilities() {
  return getRoleCapabilitiesCatalog();
}
