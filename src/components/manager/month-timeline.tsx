"use client";

import { useEffect, useState } from "react";
import { differenceInMinutes, format } from "date-fns";
import { formatAxisHour, formatHour, formatShortDate, remapFromDisplayAxis, remapToDisplayAxis } from "@/lib/time";
import { cn } from "@/lib/utils";

type Segment = {
  startTime: string;
  endTime: string;
  missingCount: number;
  volunteerAssignments: Array<{
    assignmentId?: string;
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
};

type DayTimeline = {
  dayStart: string;
  dayEnd: string;
  segments: Segment[];
};

type GapCoverageSuggestion = {
  id: string;
  name: string;
  color: string;
  currentGuards: number;
  limit: number | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
};

type GapSuggestion = {
  startTime: string;
  endTime: string;
  missingCount: number;
  fullCoverageSuggestions: GapCoverageSuggestion[];
  partialCoverageSuggestions: GapCoverageSuggestion[];
};

type GapCoverageHint = {
  variant: "gap-coverable-full" | "gap-coverable-partial";
  label: string;
  title: string;
  fullSuggestions: GapCoverageSuggestion[];
  partialSuggestions: GapCoverageSuggestion[];
};

type MonthTimelineProps = {
  dayTimelines: DayTimeline[];
  axisStart?: string;
  volunteerFilterId?: string;
  gapSuggestions?: GapSuggestion[];
  filterMode?: "contextual" | "volunteer-only";
  busy?: boolean;
  onSegmentClick?: (segment: Segment) => void;
  onConfirmSuggestion?: (params: {
    laneIndex: number;
    laneLabel: "A1" | "A2";
    volunteerId: string;
    volunteerName: string;
    startTime: string;
    endTime: string;
  }) => Promise<void> | void;
  onRemoveAssignment?: (params: {
    laneIndex: number;
    laneLabel: "A1" | "A2";
    assignmentId: string;
    volunteerId: string;
    volunteerName: string;
    startTime: string;
    endTime: string;
  }) => Promise<void> | void;
};

type LaneVariant =
  | "gap"
  | "gap-coverable-full"
  | "gap-coverable-partial"
  | "employee"
  | "volunteer"
  | "provisional";

type LaneBlock = {
  key: string;
  startTime: string;
  endTime: string;
  label: string;
  variant: LaneVariant;
  editorSegment: Segment;
  logicalStartTime?: string;
  logicalEndTime?: string;
  continuedFromPreviousDay?: boolean;
};

type CoverageItem = {
  key: string;
  label: string;
  variant: LaneVariant;
  editorSegment: Segment;
  preferredLane: 0 | 1 | null;
};

function formatDurationLabel(startTime: string, endTime: string) {
  const durationMinutes = Math.max(0, differenceInMinutes(new Date(endTime), new Date(startTime)));
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function shouldHideForFilter(
  segment: Segment,
  volunteerFilterId?: string,
  filterMode: "contextual" | "volunteer-only" = "contextual",
) {
  if (!volunteerFilterId) {
    return false;
  }

  const volunteerPresent = segment.volunteerAssignments.some(
    (assignment) => assignment.volunteerId === volunteerFilterId,
  );

  if (filterMode === "volunteer-only") {
    return !volunteerPresent;
  }

  return segment.missingCount === 0 && segment.volunteerAssignments.length > 0 && !volunteerPresent;
}

function getVolunteerCoverageItems(segment: Segment) {
  return [...segment.volunteerAssignments]
    .filter((assignment) => assignment.lane !== "A3")
    .sort((a, b) => a.volunteerName.localeCompare(b.volunteerName))
    .map<CoverageItem>((assignment) => ({
      key: assignment.assignmentId
        ? `assignment:${assignment.assignmentId}`
        : `volunteer:${assignment.volunteerId}:${assignment.status}`,
      label: assignment.volunteerName,
      variant: assignment.status === "PROVISIONAL" ? "provisional" : "volunteer",
      preferredLane: assignment.lane === "A1" ? 0 : assignment.lane === "A2" ? 1 : null,
      editorSegment: {
        ...segment,
        volunteerAssignments: [assignment],
        employeeBlocks: [],
      },
    }));
}

function getEmployeeCoverageItems(segment: Segment) {
  return segment.employeeBlocks.map<CoverageItem>((block) => ({
    key: `employee:${block.id}`,
    label: block.label,
    variant: "employee",
    preferredLane: null,
    editorSegment: {
      ...segment,
      employeeBlocks: [],
    },
  }));
}

function createGapBlock(segment: Segment, laneIndex: number): LaneBlock {
  const coverageContext = [
    ...segment.volunteerAssignments.map((assignment) => `v:${assignment.volunteerId}`),
    ...segment.employeeBlocks.map((block) => `e:${block.id}`),
  ]
    .sort()
    .join("|");

  return {
    key: `gap:${laneIndex}:${coverageContext}`,
    startTime: segment.startTime,
    endTime: segment.endTime,
    label: formatDurationLabel(segment.startTime, segment.endTime),
    variant: "gap",
    editorSegment: {
      ...segment,
      employeeBlocks: [],
    },
  };
}

function intervalsOverlap(startA: string, endA: string, startB: string, endB: string) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

function intervalCovers(outerStart: string, outerEnd: string, innerStart: string, innerEnd: string) {
  return new Date(outerStart) <= new Date(innerStart) && new Date(outerEnd) >= new Date(innerEnd);
}

function formatSuggestionLabel(names: string[]) {
  if (names.length === 0) {
    return "";
  }

  if (names.length <= 2) {
    return names.join(", ");
  }

  return `${names.length} possibles`;
}

function formatGapHintLabel(
  fullSuggestions: GapCoverageSuggestion[],
  partialSuggestions: GapCoverageSuggestion[],
) {
  const fullNames = fullSuggestions.map((suggestion) => suggestion.name);
  const partialNames = partialSuggestions.map((suggestion) => `${suggestion.name}*`);
  const combinedNames = [...fullNames, ...partialNames];

  if (partialSuggestions.length === 0) {
    return formatSuggestionLabel(fullNames);
  }

  if (combinedNames.length <= 3) {
    return combinedNames.join(", ");
  }

  if (partialNames.length <= 2) {
    return [fullNames.length > 0 ? `${fullNames.length} complets` : "", partialNames.join(", ")]
      .filter(Boolean)
      .join(" + ");
  }

  if (fullNames.length === 0) {
    return `${partialNames.length} partiels`;
  }

  return `${fullNames.length} complets + ${partialNames.length} partiels`;
}

function formatSuggestionWindow(suggestion: GapCoverageSuggestion, axisStart?: Date) {
  const startTime = new Date(suggestion.startTime);
  const endTime = new Date(suggestion.endTime);

  const startLabel = axisStart ? formatAxisHour(startTime, axisStart) : formatHour(startTime);
  const endLabel = axisStart ? formatAxisHour(endTime, axisStart) : formatHour(endTime);

  return `${suggestion.name} ${startLabel}-${endLabel}`;
}

function getGapCoverageHint(
  block: LaneBlock,
  gapSuggestions: GapSuggestion[],
  axisStart?: Date,
): GapCoverageHint | null {
  const fullCandidates = new Map<string, GapCoverageSuggestion>();
  const partialCandidates = new Map<string, GapCoverageSuggestion>();

  for (const gap of gapSuggestions) {
    if (!intervalsOverlap(block.startTime, block.endTime, gap.startTime, gap.endTime)) {
      continue;
    }

    for (const suggestion of [...gap.fullCoverageSuggestions, ...gap.partialCoverageSuggestions]) {
      if (!intervalsOverlap(block.startTime, block.endTime, suggestion.startTime, suggestion.endTime)) {
        continue;
      }

      if (intervalCovers(suggestion.startTime, suggestion.endTime, block.startTime, block.endTime)) {
        fullCandidates.set(suggestion.id, suggestion);
      } else {
        partialCandidates.set(suggestion.id, suggestion);
      }
    }
  }

  for (const volunteerId of fullCandidates.keys()) {
    partialCandidates.delete(volunteerId);
  }

  const fullSuggestions = [...fullCandidates.values()].sort((left, right) => left.name.localeCompare(right.name));
  const partialSuggestions = [...partialCandidates.values()].sort((left, right) => left.name.localeCompare(right.name));
  const fullNames = fullSuggestions.map((suggestion) => suggestion.name);
  const partialNames = partialSuggestions.map((suggestion) => suggestion.name);

  if (fullNames.length > 0) {
    const titleSections = [
      `Créneau à couvrir ${formatDurationLabel(block.startTime, block.endTime)}.`,
      "Couverture complète possible:",
      ...fullSuggestions.map((suggestion) => `- ${formatSuggestionWindow(suggestion, axisStart)}`),
    ];

    if (partialSuggestions.length > 0) {
      titleSections.push(
        "Couverture partielle possible:",
        ...partialSuggestions.map((suggestion) => `- ${formatSuggestionWindow(suggestion, axisStart)}`),
      );
    }

    return {
      variant: "gap-coverable-full" as const,
      label: formatGapHintLabel(fullSuggestions, partialSuggestions),
      title: titleSections.join("\n"),
      fullSuggestions,
      partialSuggestions,
    };
  }

  if (partialNames.length > 0) {
    return {
      variant: "gap-coverable-partial" as const,
      label: formatGapHintLabel([], partialSuggestions),
      title: `Créneau à couvrir ${formatDurationLabel(block.startTime, block.endTime)}.\nCouverture partielle possible:\n${partialSuggestions.map((suggestion) => `- ${formatSuggestionWindow(suggestion, axisStart)}`).join("\n")}`,
      fullSuggestions: [],
      partialSuggestions,
    };
  }

  return null;
}

function buildLaneBlocks(
  dayStart: string,
  segments: Segment[],
  axisStart?: string,
  volunteerFilterId?: string,
  filterMode: "contextual" | "volunteer-only" = "contextual",
) {
  const dayStartDate = new Date(dayStart);
  const visibleSegments = segments.filter((segment) => !shouldHideForFilter(segment, volunteerFilterId, filterMode));
  const lanes: LaneBlock[][] = [[], []];
  const previousLaneKeys: Array<string | null> = [null, null];

  for (const segment of visibleSegments) {
    const explicitLaneItems: Array<CoverageItem | null> = [null, null];
    const availableItems = [
      ...getVolunteerCoverageItems(segment),
      ...getEmployeeCoverageItems(segment),
    ].filter((item) => {
      if (item.preferredLane === null) {
        return true;
      }

      if (!explicitLaneItems[item.preferredLane]) {
        explicitLaneItems[item.preferredLane] = item;
        return false;
      }

      return true;
    });
    const laneItems: Array<CoverageItem | null> = [null, null];

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      if (explicitLaneItems[laneIndex]) {
        laneItems[laneIndex] = explicitLaneItems[laneIndex];
        continue;
      }

      const previousLaneKey = previousLaneKeys[laneIndex];
      if (!previousLaneKey) {
        continue;
      }

      const itemIndex = availableItems.findIndex((item) => item.key === previousLaneKey);
      if (itemIndex >= 0) {
        laneItems[laneIndex] = availableItems[itemIndex];
        availableItems.splice(itemIndex, 1);
      }
    }

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      if (laneItems[laneIndex]) {
        continue;
      }

      laneItems[laneIndex] = availableItems.shift() ?? null;
    }

    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      const item = laneItems[laneIndex];
      const nextBlock =
        item === null
          ? createGapBlock(segment, laneIndex)
          : {
              key: item.key,
              startTime: segment.startTime,
              endTime: segment.endTime,
              label: item.label,
              variant: item.variant,
              editorSegment: item.editorSegment,
            };

      const previousBlock = lanes[laneIndex].at(-1);
      const mappedStart = axisStart
        ? remapToDisplayAxis(new Date(nextBlock.startTime), new Date(axisStart))
        : new Date(nextBlock.startTime);
      const mappedDayStart = axisStart ? remapToDisplayAxis(dayStartDate, new Date(axisStart)) : dayStartDate;
      const boundaryMinutes = differenceInMinutes(mappedStart, mappedDayStart);
      const isShiftBoundary = boundaryMinutes === 6 * 60 || boundaryMinutes === 18 * 60;

      if (
        previousBlock &&
        previousBlock.key === nextBlock.key &&
        previousBlock.endTime === nextBlock.startTime &&
        !isShiftBoundary
      ) {
        previousBlock.endTime = nextBlock.endTime;
        previousBlock.editorSegment = {
          ...previousBlock.editorSegment,
          startTime: previousBlock.startTime,
          endTime: nextBlock.endTime,
        };

        if (previousBlock.variant === "gap") {
          previousBlock.label = formatDurationLabel(previousBlock.startTime, previousBlock.endTime);
        }
      } else {
        lanes[laneIndex].push(nextBlock);
      }

      previousLaneKeys[laneIndex] = nextBlock.key;
    }
  }

  return lanes;
}

function splitSegmentsOnShiftBoundariesWithAxis(dayStart: string, segments: Segment[], axisStart?: string) {
  const dayStartDate = new Date(dayStart);
  const mappedDayStart = axisStart ? remapToDisplayAxis(dayStartDate, new Date(axisStart)) : dayStartDate;
  const boundaries = [6, 18].map((hours) => new Date(mappedDayStart.getTime() + hours * 60 * 60 * 1000));

  return segments.flatMap((segment) => {
    const segmentStart = new Date(segment.startTime);
    const segmentEnd = new Date(segment.endTime);
    const mappedSegmentStart = axisStart ? remapToDisplayAxis(segmentStart, new Date(axisStart)) : segmentStart;
    const mappedSegmentEnd = axisStart ? remapToDisplayAxis(segmentEnd, new Date(axisStart)) : segmentEnd;
    const cutPoints = [segmentStart, segmentEnd];

    for (const boundary of boundaries) {
      if (boundary > mappedSegmentStart && boundary < mappedSegmentEnd) {
        cutPoints.push(axisStart ? remapFromDisplayAxis(boundary, new Date(axisStart)) : boundary);
      }
    }

    const sorted = [...new Set(cutPoints.map((value) => value.getTime()))].sort((a, b) => a - b);

    return sorted.slice(0, -1).map((start, index) => ({
      ...segment,
      startTime: new Date(start).toISOString(),
      endTime: new Date(sorted[index + 1]).toISOString(),
    }));
  });
}

function laneClasses(variant: LaneVariant) {
  if (variant === "gap") {
    return "bg-red-600 text-white border-red-800 shadow-[0_0_0_1px_rgba(127,29,29,1)] animate-[pulse_2.2s_ease-in-out_infinite]";
  }

  if (variant === "gap-coverable-full") {
    return "bg-yellow-300 text-yellow-950 border-yellow-500 shadow-[0_0_0_1px_rgba(161,98,7,0.9)]";
  }

  if (variant === "gap-coverable-partial") {
    return "bg-orange-400 text-white border-orange-700 shadow-[0_0_0_1px_rgba(154,52,18,0.9)]";
  }

  if (variant === "employee") {
    return "bg-slate-500 text-white border-slate-700";
  }

  if (variant === "provisional") {
    return "bg-orange-500 text-white border-orange-700";
  }

  return "bg-emerald-600 text-white border-emerald-800";
}

export function MonthTimeline({
  dayTimelines,
  axisStart,
  volunteerFilterId,
  gapSuggestions = [],
  filterMode = "contextual",
  busy = false,
  onSegmentClick,
  onConfirmSuggestion,
  onRemoveAssignment,
}: MonthTimelineProps) {
  const [openAssignmentMenuKey, setOpenAssignmentMenuKey] = useState<string | null>(null);

  useEffect(() => {
    const handlePointerDown = () => {
      setOpenAssignmentMenuKey(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAssignmentMenuKey(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const preparedDays = (() => {
    const days = dayTimelines.map((day) => {
      const splitSegments = splitSegmentsOnShiftBoundariesWithAxis(day.dayStart, day.segments, axisStart);
      const laneBlocks = buildLaneBlocks(day.dayStart, splitSegments, axisStart, volunteerFilterId, filterMode).map(
        (blocks) =>
          blocks.map((block) => ({
            ...block,
            logicalStartTime: block.startTime,
            logicalEndTime: block.endTime,
            continuedFromPreviousDay: false,
          })),
      );

      return {
        ...day,
        laneBlocks,
      };
    });

    const activeChains: Array<
      | {
          key: string;
          endTime: string;
          logicalStartTime: string;
          blocks: LaneBlock[];
        }
      | null
    > = [null, null];

    for (const day of days) {
      for (let laneIndex = 0; laneIndex < day.laneBlocks.length; laneIndex += 1) {
        const blocks = day.laneBlocks[laneIndex];
        const firstBlock = blocks[0];
        const chain = activeChains[laneIndex];

        if (firstBlock && chain && chain.key === firstBlock.key && chain.endTime === firstBlock.startTime) {
          chain.blocks.push(firstBlock);
          chain.endTime = firstBlock.endTime;

          for (const block of chain.blocks) {
            block.logicalStartTime = chain.logicalStartTime;
            block.logicalEndTime = chain.endTime;
          }

          firstBlock.continuedFromPreviousDay = true;
        }

        const lastBlock = blocks.at(-1);
        if (lastBlock && lastBlock.endTime === day.dayEnd) {
          activeChains[laneIndex] = {
            key: lastBlock.key,
            endTime: lastBlock.logicalEndTime ?? lastBlock.endTime,
            logicalStartTime: lastBlock.logicalStartTime ?? lastBlock.startTime,
            blocks: [lastBlock],
          };
        } else {
          activeChains[laneIndex] = null;
        }
      }
    }

    return days;
  })();

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[1100px]">
        <div className="grid grid-cols-[120px_1fr] items-center border-b border-slate-200 bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          <div>Jour</div>
          <div className="grid grid-cols-24 gap-0">
            {Array.from({ length: 24 }).map((_, hour) => (
              <div key={hour} className="text-center">
                {hour}
              </div>
            ))}
          </div>
        </div>

        {preparedDays.map((day) => {
          const dayStart = new Date(day.dayStart);
          const laneBlocks = day.laneBlocks;
          const dayKey = format(dayStart, "yyyy-MM-dd");
          const displayDayStart = axisStart ? remapToDisplayAxis(dayStart, new Date(axisStart)) : dayStart;

          if (laneBlocks.every((blocks) => blocks.length === 0)) {
            return null;
          }

          return (
            <div
              key={day.dayStart}
              className="grid grid-cols-[120px_1fr] items-center gap-0 border-b border-slate-100 px-3 py-1"
            >
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-slate-700">{formatShortDate(dayStart)}</div>
                <div className="grid w-10 grid-rows-2 gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  <span className="rounded bg-slate-100 px-1 py-0.5">A1</span>
                  <span className="rounded bg-slate-100 px-1 py-0.5">A2</span>
                </div>
              </div>

              <div className="space-y-1 py-0.5">
                {laneBlocks.map((blocks, laneIndex) => (
                  <div
                    key={laneIndex}
                    data-testid="timeline-lane"
                    data-day={dayKey}
                    data-lane={laneIndex}
                    className="relative z-0 h-5 rounded-md border border-slate-200 bg-slate-50 hover:z-20"
                  >
                    {blocks.map((block, index) => {
                      const laneLabel = laneIndex === 0 ? "A1" : "A2";
                      const startTime = new Date(block.startTime);
                      const endTime = new Date(block.endTime);
                      const logicalStartTime = new Date(block.logicalStartTime ?? block.startTime);
                      const logicalEndTime = new Date(block.logicalEndTime ?? block.endTime);
                      const displayStart = axisStart ? remapToDisplayAxis(startTime, new Date(axisStart)) : startTime;
                      const displayEnd = axisStart ? remapToDisplayAxis(endTime, new Date(axisStart)) : endTime;
                      const startOffsetMin = differenceInMinutes(displayStart, displayDayStart);
                      const durationMin = Math.max(20, differenceInMinutes(displayEnd, displayStart));
                      const left = (startOffsetMin / (24 * 60)) * 100;
                      const width = (durationMin / (24 * 60)) * 100;
                      const gapHint =
                        block.variant === "gap"
                          ? getGapCoverageHint(
                              block,
                              gapSuggestions,
                              axisStart ? new Date(axisStart) : undefined,
                            )
                          : null;
                      const effectiveVariant = gapHint?.variant ?? block.variant;
                      const startLabel = axisStart
                        ? formatAxisHour(logicalStartTime, new Date(axisStart))
                        : formatHour(logicalStartTime);
                      const endLabel = axisStart
                        ? formatAxisHour(logicalEndTime, new Date(axisStart))
                        : formatHour(logicalEndTime);
                      const title =
                        block.variant === "gap"
                          ? gapHint?.title ??
                            `Créneau à couvrir ${formatDurationLabel(
                              block.logicalStartTime ?? block.startTime,
                              block.logicalEndTime ?? block.endTime,
                            )} ${startLabel} - ${endLabel}`
                          : `${block.label} ${startLabel} - ${endLabel}`;
                      const effectiveLabel = gapHint?.label ?? block.label;
                      const displayLabel =
                        block.variant === "gap" && !gapHint
                          ? formatDurationLabel(block.logicalStartTime ?? block.startTime, block.logicalEndTime ?? block.endTime)
                          : effectiveLabel;
                      const textLabel =
                        (block.variant === "gap" || gapHint) && width < 12
                          ? ""
                          : block.continuedFromPreviousDay && block.variant === "gap"
                            ? ""
                            : displayLabel;
                      const assignment = block.editorSegment.volunteerAssignments[0];
                      const assignmentId = assignment?.assignmentId;
                      const canOpenAssignmentMenu =
                        (block.variant === "volunteer" || block.variant === "provisional") &&
                        Boolean(assignmentId) &&
                        block.editorSegment.volunteerAssignments.length === 1;
                      const assignmentMenuKey = canOpenAssignmentMenu
                        ? `${laneIndex}:${assignmentId}:${block.startTime}:${block.endTime}`
                        : null;
                      const assignmentMenuOpen = assignmentMenuKey !== null && openAssignmentMenuKey === assignmentMenuKey;
                      const handlePrimaryClick = () => {
                        if (assignmentMenuKey) {
                          setOpenAssignmentMenuKey((current) =>
                            current === assignmentMenuKey ? null : assignmentMenuKey,
                          );
                          return;
                        }

                        onSegmentClick?.(block.editorSegment);
                      };

                      return (
                        <div
                          key={`${block.key}-${block.startTime}-${block.endTime}-${index}`}
                          className="group absolute top-0 bottom-0 overflow-visible"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                          }}
                        >
                          <button
                            type="button"
                            data-testid="timeline-block"
                            data-day={dayKey}
                            data-lane={laneIndex}
                            data-start-time={block.startTime}
                            data-end-time={block.endTime}
                            data-label={displayLabel}
                            data-variant={effectiveVariant}
                            aria-label={title}
                            className={cn(
                              "absolute inset-0 overflow-visible rounded-[4px] border px-1 text-left text-[9px] font-bold leading-4 whitespace-nowrap",
                              onSegmentClick || assignmentMenuKey ? "cursor-pointer transition hover:brightness-110" : "",
                              laneClasses(effectiveVariant),
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              handlePrimaryClick();
                            }}
                          >
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{textLabel}</span>
                          </button>
                          {gapHint ? (
                            <span
                              className="invisible absolute left-1/2 top-full z-30 mt-1 w-max min-w-56 max-w-80 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-left text-[11px] font-medium leading-4 text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100"
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              {gapHint.fullSuggestions.length > 0 ? (
                                <span className="block">
                                  <span className="block font-semibold">Couverture complète possible</span>
                                  <span className="mt-1 block space-y-1">
                                    {gapHint.fullSuggestions.map((suggestion) => {
                                      const suggestionStart = new Date(suggestion.startTime);
                                      const suggestionEnd = new Date(suggestion.endTime);
                                      const suggestionStartLabel = axisStart
                                        ? formatAxisHour(suggestionStart, new Date(axisStart))
                                        : formatHour(suggestionStart);
                                      const suggestionEndLabel = axisStart
                                        ? formatAxisHour(suggestionEnd, new Date(axisStart))
                                        : formatHour(suggestionEnd);

                                      return (
                                        <span
                                          key={`full-${suggestion.id}`}
                                          className="flex items-center justify-between gap-3"
                                        >
                                          <span className="block">
                                            {suggestion.name} {suggestionStartLabel}-{suggestionEndLabel}
                                          </span>
                                          {onConfirmSuggestion ? (
                                            <button
                                              type="button"
                                              data-testid={`timeline-confirm-${laneLabel}-${suggestion.id}`}
                                              disabled={busy}
                                              className="rounded bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                void onConfirmSuggestion({
                                                  laneIndex,
                                                  laneLabel,
                                                  volunteerId: suggestion.id,
                                                  volunteerName: suggestion.name,
                                                  startTime: suggestion.startTime,
                                                  endTime: suggestion.endTime,
                                                });
                                              }}
                                            >
                                              Valider {laneLabel}
                                            </button>
                                          ) : null}
                                        </span>
                                      );
                                    })}
                                  </span>
                                </span>
                              ) : null}
                              {gapHint.partialSuggestions.length > 0 ? (
                                <span className={cn("block", gapHint.fullSuggestions.length > 0 ? "mt-2" : "")}>
                                  <span className="block font-semibold">Couverture partielle possible</span>
                                  <span className="mt-1 block space-y-1">
                                    {gapHint.partialSuggestions.map((suggestion) => {
                                      const suggestionStart = new Date(suggestion.startTime);
                                      const suggestionEnd = new Date(suggestion.endTime);
                                      const suggestionStartLabel = axisStart
                                        ? formatAxisHour(suggestionStart, new Date(axisStart))
                                        : formatHour(suggestionStart);
                                      const suggestionEndLabel = axisStart
                                        ? formatAxisHour(suggestionEnd, new Date(axisStart))
                                        : formatHour(suggestionEnd);

                                      return (
                                        <span
                                          key={`partial-${suggestion.id}`}
                                          className="flex items-center justify-between gap-3"
                                        >
                                          <span className="block">
                                            {suggestion.name} {suggestionStartLabel}-{suggestionEndLabel}
                                          </span>
                                          {onConfirmSuggestion ? (
                                            <button
                                              type="button"
                                              data-testid={`timeline-confirm-${laneLabel}-${suggestion.id}`}
                                              disabled={busy}
                                              className="rounded bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                void onConfirmSuggestion({
                                                  laneIndex,
                                                  laneLabel,
                                                  volunteerId: suggestion.id,
                                                  volunteerName: suggestion.name,
                                                  startTime: suggestion.startTime,
                                                  endTime: suggestion.endTime,
                                                });
                                              }}
                                            >
                                              Valider {laneLabel}
                                            </button>
                                          ) : null}
                                        </span>
                                      );
                                    })}
                                  </span>
                                </span>
                              ) : null}
                              {gapHint.partialSuggestions.length > 0 && gapHint.fullSuggestions.length > 0 ? (
                                <span className="mt-2 block text-[10px] text-slate-300">
                                  `*` dans le bloc = couverture partielle uniquement
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          {assignmentMenuOpen && assignment && assignmentId ? (
                            <div
                              className="absolute left-1/2 top-full z-30 mt-1 min-w-44 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-1 text-left shadow-lg"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              {onSegmentClick ? (
                                <button
                                  type="button"
                                  className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                                  onClick={() => {
                                    setOpenAssignmentMenuKey(null);
                                    onSegmentClick(block.editorSegment);
                                  }}
                                >
                                  Charger dans l&apos;éditeur
                                </button>
                              ) : null}
                              {onRemoveAssignment ? (
                                <button
                                  type="button"
                                  data-testid={`timeline-unassign-${laneLabel}-${assignmentId}`}
                                  disabled={busy}
                                  className="block w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => {
                                    setOpenAssignmentMenuKey(null);
                                    void onRemoveAssignment({
                                      laneIndex,
                                      laneLabel,
                                      assignmentId,
                                      volunteerId: assignment.volunteerId,
                                      volunteerName: assignment.volunteerName,
                                      startTime: block.startTime,
                                      endTime: block.endTime,
                                    });
                                  }}
                                >
                                  Désinscrire {laneLabel}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
