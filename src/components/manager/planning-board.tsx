"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { formatShortDate, formatAxisHour, remapToDisplayAxis } from "@/lib/time";
import {
  buildPlanningAvailabilityBlocks,
  buildPlanningPlacementPlan,
  getPlanningLaneConflicts,
  PLANNING_LANES,
  projectAssignmentsToLanes,
  type PlanningAssignment,
  type PlanningAvailability,
  type PlanningLane,
  type PlanningPlacementConflict,
  type PlanningPlacementResolution,
} from "@/lib/planning-lanes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Volunteer = {
  id: string;
  name: string;
  color: string;
};

type Assignment = {
  id: string;
  volunteerId: string;
  startTime: string;
  endTime: string;
  lane?: PlanningLane | null;
  status: "CONFIRMED" | "PROVISIONAL";
  source: "MANUAL" | "DRAFT";
  volunteer: Volunteer;
};

type Availability = {
  id: string;
  volunteerId: string;
  startTime: string;
  endTime: string;
  volunteer: Volunteer;
};

type ConflictDialogState = {
  lane: PlanningLane;
  volunteerId: string;
  volunteerName: string;
  volunteerColor: string;
  startTime: string;
  endTime: string;
  conflicts: PlanningPlacementConflict[];
  resolutions: Record<string, "existing" | "new">;
};

type AssignmentMenuState = {
  assignmentId: string;
  lane: PlanningLane;
};

type PlanningBoardProps = {
  monthAxisStart: string;
  coverageStart: string;
  coverageEnd: string;
  volunteers: Volunteer[];
  availabilities: Availability[];
  assignments: Assignment[];
  busy?: boolean;
  onPlaceAssignment: (params: {
    volunteerId: string;
    volunteerName: string;
    volunteerColor: string;
    lane: PlanningLane;
    startTime: string;
    endTime: string;
    resolutions?: PlanningPlacementResolution[];
  }) => Promise<void> | void;
  onRemoveAssignment: (params: {
    assignmentId: string;
    volunteerName: string;
    lane: PlanningLane;
    startTime: string;
    endTime: string;
  }) => Promise<void> | void;
};

const HOUR_WIDTH = 24;
const LABEL_WIDTH = 240;
const ROW_HEIGHT = 32;

function toPlanningAssignments(assignments: Assignment[]): PlanningAssignment[] {
  return assignments.map((assignment) => ({
    id: assignment.id,
    volunteerId: assignment.volunteerId,
    volunteerName: assignment.volunteer.name,
    volunteerColor: assignment.volunteer.color,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    lane: assignment.lane ?? null,
    status: assignment.status,
    source: assignment.source,
  }));
}

function toPlanningAvailabilities(availabilities: Availability[]): PlanningAvailability[] {
  return availabilities.map((availability) => ({
    id: availability.id,
    volunteerId: availability.volunteerId,
    volunteerName: availability.volunteer.name,
    volunteerColor: availability.volunteer.color,
    startTime: availability.startTime,
    endTime: availability.endTime,
  }));
}

function formatRangeLabel(startTime: string, endTime: string, axisStart: Date) {
  return `${formatAxisHour(new Date(startTime), axisStart)} - ${formatAxisHour(new Date(endTime), axisStart)}`;
}

export function PlanningBoard({
  monthAxisStart,
  coverageStart,
  coverageEnd,
  volunteers,
  availabilities,
  assignments,
  busy = false,
  onPlaceAssignment,
  onRemoveAssignment,
}: PlanningBoardProps) {
  const axisStartDate = useMemo(() => new Date(monthAxisStart), [monthAxisStart]);
  const coverageStartDate = useMemo(() => new Date(coverageStart), [coverageStart]);
  const coverageEndDate = useMemo(() => new Date(coverageEnd), [coverageEnd]);
  const totalHours = Math.max(1, Math.round((coverageEndDate.getTime() - coverageStartDate.getTime()) / 3_600_000));
  const timelineWidth = totalHours * HOUR_WIDTH;
  const dayCount = Math.ceil(totalHours / 24);
  const baseAssignments = useMemo(() => toPlanningAssignments(assignments), [assignments]);
  const assignmentsKey = useMemo(
    () =>
      assignments
        .map((assignment) => `${assignment.id}:${assignment.startTime}:${assignment.endTime}:${assignment.lane ?? ""}:${assignment.status}`)
        .join("|"),
    [assignments],
  );
  const [optimisticAssignments, setOptimisticAssignments] = useState<{
    sourceKey: string;
    items: PlanningAssignment[];
  } | null>(null);
  const [draggingBlock, setDraggingBlock] = useState<{
    volunteerId: string;
    volunteerName: string;
    volunteerColor: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [hoverLane, setHoverLane] = useState<PlanningLane | null>(null);
  const [assignmentMenu, setAssignmentMenu] = useState<AssignmentMenuState | null>(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState | null>(null);
  const [suppressedAssignmentIds, setSuppressedAssignmentIds] = useState<{
    sourceKey: string;
    ids: string[];
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const displayAssignments =
    optimisticAssignments?.sourceKey === assignmentsKey ? optimisticAssignments.items : baseAssignments;
  const activeSuppressedAssignmentIds = useMemo(
    () => (suppressedAssignmentIds?.sourceKey === assignmentsKey ? suppressedAssignmentIds.ids : []),
    [assignmentsKey, suppressedAssignmentIds],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setAssignmentMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAssignmentMenu(null);
        setConflictDialog(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const planningAvailabilities = useMemo(() => toPlanningAvailabilities(availabilities), [availabilities]);
  const availabilityBlocks = useMemo(
    () => buildPlanningAvailabilityBlocks(planningAvailabilities, coverageStart),
    [coverageStart, planningAvailabilities],
  );
  const availabilityBlocksByVolunteer = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildPlanningAvailabilityBlocks>>();
    for (const volunteer of volunteers) {
      map.set(
        volunteer.id,
        availabilityBlocks.filter((block) => block.volunteerId === volunteer.id),
      );
    }
    return map;
  }, [availabilityBlocks, volunteers]);

  const laneBlocks = useMemo(
    () =>
      projectAssignmentsToLanes(
        displayAssignments.filter((assignment) => !activeSuppressedAssignmentIds.includes(assignment.id)),
      ),
    [activeSuppressedAssignmentIds, displayAssignments],
  );

  const dayHeaders = useMemo(
    () =>
      Array.from({ length: dayCount }).map((_, index) => {
        const hour = new Date(coverageStartDate.getTime() + index * 24 * 3_600_000);
        const dayEnd = new Date(hour.getTime() + Math.min(24, totalHours - index * 24) * 3_600_000);
        const display = remapToDisplayAxis(hour, axisStartDate);
        const width = Math.min(24, totalHours - index * 24) * HOUR_WIDTH;
        return {
          key: hour.toISOString(),
          label: formatShortDate(display),
          startTime: hour.toISOString(),
          endTime: dayEnd.toISOString(),
          width,
        };
      }),
    [axisStartDate, coverageStartDate, dayCount, totalHours],
  );

  const hourHeaders = useMemo(
    () =>
      Array.from({ length: totalHours }).map((_, index) => {
        const hour = new Date(coverageStartDate.getTime() + index * 3_600_000);
        const nextHour = new Date(hour.getTime() + 3_600_000);
        return {
          key: hour.toISOString(),
          label: formatAxisHour(hour, axisStartDate).slice(0, 2),
          startTime: hour.toISOString(),
          endTime: nextHour.toISOString(),
        };
      }),
    [axisStartDate, coverageStartDate, totalHours],
  );

  const draggedInterval = useMemo(
    () =>
      draggingBlock
        ? {
            startTime: new Date(draggingBlock.startTime).getTime(),
            endTime: new Date(draggingBlock.endTime).getTime(),
          }
        : null,
    [draggingBlock],
  );

  function intervalIntersectsDragged(startTime: string, endTime: string) {
    if (!draggedInterval) {
      return false;
    }

    return new Date(startTime).getTime() < draggedInterval.endTime && new Date(endTime).getTime() > draggedInterval.startTime;
  }

  function positionForInterval(startTime: string, endTime: string) {
    const startOffsetHours = (new Date(startTime).getTime() - coverageStartDate.getTime()) / 3_600_000;
    const endOffsetHours = (new Date(endTime).getTime() - coverageStartDate.getTime()) / 3_600_000;

    return {
      left: startOffsetHours * HOUR_WIDTH,
      width: Math.max(HOUR_WIDTH, (endOffsetHours - startOffsetHours) * HOUR_WIDTH),
    };
  }

  function getDraggedPayload(event?: DragEvent<HTMLDivElement>) {
    const raw = event?.dataTransfer.getData("application/x-horaire112-planning-block");

    if (raw) {
      return JSON.parse(raw) as {
        volunteerId: string;
        volunteerName: string;
        volunteerColor: string;
        startTime: string;
        endTime: string;
      };
    }

    return draggingBlock;
  }

  function handleDropOnLane(lane: PlanningLane, event?: DragEvent<HTMLDivElement>) {
    const payload = getDraggedPayload(event);

    setHoverLane(null);
    setDraggingBlock(null);

    if (!payload) {
      return;
    }

    void applyPlacement({
      ...payload,
      lane,
    }).catch(() => undefined);
  }

  async function applyPlacement(params: {
    volunteerId: string;
    volunteerName: string;
    volunteerColor: string;
    lane: PlanningLane;
    startTime: string;
    endTime: string;
    resolutions?: PlanningPlacementResolution[];
  }) {
    const plan = buildPlanningPlacementPlan({
      assignments: displayAssignments,
      lane: params.lane,
      volunteerId: params.volunteerId,
      volunteerName: params.volunteerName,
      volunteerColor: params.volunteerColor,
      startTime: params.startTime,
      endTime: params.endTime,
      resolutions: params.resolutions,
    });

    if (plan.missingResolutionIds.length > 0) {
      const conflicts = getPlanningLaneConflicts(displayAssignments, params.lane, params.startTime, params.endTime);
      const initialResolutions = Object.fromEntries(
        conflicts.map((conflict) => [conflict.assignmentId, "existing" as const]),
      );

      setConflictDialog({
        lane: params.lane,
        volunteerId: params.volunteerId,
        volunteerName: params.volunteerName,
        volunteerColor: params.volunteerColor,
        startTime: params.startTime,
        endTime: params.endTime,
        conflicts,
        resolutions: initialResolutions,
      });
      return;
    }

    const previousAssignments = displayAssignments;
    setOptimisticAssignments({
      sourceKey: assignmentsKey,
      items: plan.previewAssignments,
    });
    setConflictDialog(null);

    try {
      await onPlaceAssignment(params);
    } catch {
      setOptimisticAssignments({
        sourceKey: assignmentsKey,
        items: previousAssignments,
      });
      return;
    }
  }

  return (
    <Card ref={wrapperRef}>
      <CardHeader>
        <CardTitle>Planning</CardTitle>
        <CardDescription>
          Glissez une disponibilité vers A1, A2 ou A3. Les disponibilités sont pré-découpées aux bornes 06h / 18h pour que le glisser-déposer reste strictement vertical.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="max-h-[78vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div style={{ minWidth: LABEL_WIDTH + timelineWidth }}>
            <div className="sticky top-0 z-30 border-b border-slate-200 bg-slate-100 shadow-sm">
              <div className="grid" style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${timelineWidth}px` }}>
                <div className="sticky left-0 z-40 border-r border-slate-200 bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-600">
                  Disponibilités
                </div>
                <div className="overflow-hidden">
                  <div className="flex border-b border-slate-200">
                    {dayHeaders.map((day) => (
                      <div
                        key={day.key}
                        className={cn(
                          "border-r border-slate-200 px-2 py-2 text-xs font-bold text-slate-700 transition",
                          intervalIntersectsDragged(day.startTime, day.endTime) ? "bg-amber-200 text-slate-900" : "",
                        )}
                        style={{ width: day.width }}
                      >
                        {day.label}
                      </div>
                    ))}
                  </div>
                  <div className="flex">
                    {hourHeaders.map((hour, index) => (
                      <div
                        key={hour.key}
                        className={cn(
                          "border-r border-slate-200 px-0 py-1 text-center text-[10px] font-semibold text-slate-500 transition",
                          index % 12 === 0 ? "bg-slate-100" : "bg-slate-50",
                          intervalIntersectsDragged(hour.startTime, hour.endTime)
                            ? "bg-amber-300 text-slate-900"
                            : "",
                        )}
                        style={{ width: HOUR_WIDTH }}
                      >
                        {hour.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-b border-slate-200">
              {volunteers.map((volunteer) => (
                <div
                  key={`availability-row-${volunteer.id}`}
                  className="grid border-b border-slate-100"
                  style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${timelineWidth}px`, minHeight: ROW_HEIGHT }}
                >
                  <div className="sticky left-0 z-10 flex items-center overflow-hidden border-r border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{volunteer.name}</span>
                  </div>
                  <div
                    className="relative bg-white"
                    style={{
                      minHeight: ROW_HEIGHT,
                      backgroundImage:
                        "repeating-linear-gradient(to right, rgba(226,232,240,0.7) 0, rgba(226,232,240,0.7) 1px, transparent 1px, transparent 24px)",
                    }}
                  >
                    {(availabilityBlocksByVolunteer.get(volunteer.id) ?? []).map((block) => {
                      const position = positionForInterval(block.startTime, block.endTime);
                      return (
                        <div
                          key={block.key}
                          draggable={!busy}
                          onDragStart={(event) => {
                            setDraggingBlock({
                              volunteerId: block.volunteerId,
                              volunteerName: block.volunteerName,
                              volunteerColor: block.volunteerColor,
                              startTime: block.startTime,
                              endTime: block.endTime,
                            });
                            event.dataTransfer.effectAllowed = "copyMove";
                            event.dataTransfer.setData(
                              "application/x-horaire112-planning-block",
                              JSON.stringify({
                                volunteerId: block.volunteerId,
                                volunteerName: block.volunteerName,
                                volunteerColor: block.volunteerColor,
                                startTime: block.startTime,
                                endTime: block.endTime,
                              }),
                            );
                          }}
                          onDragEnd={() => {
                            setDraggingBlock(null);
                            setHoverLane(null);
                          }}
                          className="absolute top-1 bottom-1 rounded-md border border-emerald-600 bg-emerald-500/85 transition hover:bg-emerald-500"
                          style={{
                            left: position.left,
                            width: position.width,
                          }}
                          title={`${volunteer.name} ${formatRangeLabel(block.startTime, block.endTime, axisStartDate)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="grid bg-slate-100" style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${timelineWidth}px` }}>
                <div className="border-r border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-600">
                  Affectations
                </div>
                <div
                  className={cn(
                    "border-b border-slate-200 px-3 py-3 text-xs font-semibold text-slate-500 transition",
                    hoverLane === "A1" && draggingBlock ? "bg-sky-50" : "",
                  )}
                  onDragOver={(event) => {
                    if (!draggingBlock) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setHoverLane("A1");
                  }}
                  onDragLeave={() => {
                    setHoverLane((current) => (current === "A1" ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDropOnLane("A1", event);
                  }}
                >
                  Déposez verticalement sur A1, A2 ou A3. Les conflits ouvrent une fenêtre d&apos;arbitrage avant l&apos;enregistrement.
                </div>
              </div>

              {PLANNING_LANES.map((lane) => (
                <div
                  key={lane}
                  className="grid border-b border-slate-100"
                  style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${timelineWidth}px`, minHeight: ROW_HEIGHT }}
                >
                  <div className="sticky left-0 z-10 flex items-center border-r border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
                    {lane}
                  </div>
                  <div
                    className={cn(
                      "relative bg-white transition",
                      hoverLane === lane && draggingBlock ? "bg-sky-50" : "",
                    )}
                    style={{
                      minHeight: ROW_HEIGHT,
                      backgroundImage:
                        "repeating-linear-gradient(to right, rgba(226,232,240,0.7) 0, rgba(226,232,240,0.7) 1px, transparent 1px, transparent 24px)",
                    }}
                    onDragOver={(event) => {
                      if (!draggingBlock) {
                        return;
                      }
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setHoverLane(lane);
                    }}
                    onDragLeave={() => {
                      setHoverLane((current) => (current === lane ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDropOnLane(lane, event);
                    }}
                  >
                    {draggingBlock && hoverLane === lane ? (
                      <div
                        className="pointer-events-none absolute top-1 bottom-1 rounded-md border-2 border-dashed border-sky-500 bg-sky-200/40"
                        style={positionForInterval(draggingBlock.startTime, draggingBlock.endTime)}
                      />
                    ) : null}

                    {laneBlocks[lane].map((block) => {
                      const position = positionForInterval(block.startTime, block.endTime);
                      const menuOpen =
                        assignmentMenu?.assignmentId === block.id && assignmentMenu?.lane === block.projectedLane;

                      return (
                        <div
                          key={`${lane}-${block.id}-${block.startTime}`}
                          className="absolute top-1 bottom-1"
                          style={{
                            left: position.left,
                            width: position.width,
                          }}
                        >
                          <button
                            type="button"
                            className={cn(
                              "group absolute inset-0 rounded-md border px-2 text-left text-xs font-bold transition",
                              block.status === "PROVISIONAL"
                                ? "border-orange-700 bg-orange-500 text-white hover:bg-orange-400"
                                : "border-emerald-800 bg-emerald-600 text-white hover:bg-emerald-500",
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentMenu((current) =>
                                current?.assignmentId === block.id && current.lane === block.projectedLane
                                  ? null
                                  : {
                                      assignmentId: block.id,
                                      lane: block.projectedLane,
                                    },
                              );
                            }}
                          >
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                              {block.volunteerName}
                            </span>
                          </button>
                          {menuOpen ? (
                            <div
                              className="absolute left-1/2 top-full z-30 mt-1 min-w-44 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                disabled={busy}
                                className="block w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                                onClick={() => {
                                  setAssignmentMenu(null);
                                  const previousAssignments = displayAssignments;
                                  const previousSuppressedIds = activeSuppressedAssignmentIds;
                                  setSuppressedAssignmentIds({
                                    sourceKey: assignmentsKey,
                                    ids: [...activeSuppressedAssignmentIds, block.id],
                                  });
                                  setOptimisticAssignments({
                                    sourceKey: assignmentsKey,
                                    items: displayAssignments.filter((assignment) => assignment.id !== block.id),
                                  });
                                  void Promise.resolve(
                                    onRemoveAssignment({
                                      assignmentId: block.id,
                                      volunteerName: block.volunteerName,
                                      lane: block.projectedLane,
                                      startTime: block.startTime,
                                      endTime: block.endTime,
                                    }),
                                  ).catch(() => {
                                    setSuppressedAssignmentIds({
                                      sourceKey: assignmentsKey,
                                      ids: previousSuppressedIds,
                                    });
                                    setOptimisticAssignments({
                                      sourceKey: assignmentsKey,
                                      items: previousAssignments,
                                    });
                                  });
                                }}
                              >
                                Désinscrire
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {conflictDialog ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-4">
            <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="text-lg font-black text-slate-900">Arbitrage de conflit</h3>
              <p className="mt-1 text-sm text-slate-600">
                Dépôt de {conflictDialog.volunteerName} sur {conflictDialog.lane}{" "}
                ({formatRangeLabel(conflictDialog.startTime, conflictDialog.endTime, axisStartDate)}).
              </p>

              <div className="mt-4 space-y-3">
                {conflictDialog.conflicts.map((conflict) => (
                  <div key={conflict.assignmentId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">
                          Conflit {formatRangeLabel(conflict.overlapStartTime, conflict.overlapEndTime, axisStartDate)}
                        </p>
                        <p className="text-sm text-slate-600">
                          {conflict.volunteerName} occupe déjà{" "}
                          {formatRangeLabel(conflict.startTime, conflict.endTime, axisStartDate)} sur {conflict.projectedLane}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={conflictDialog.resolutions[conflict.assignmentId] === "existing" ? "default" : "secondary"}
                          onClick={() =>
                            setConflictDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    resolutions: {
                                      ...current.resolutions,
                                      [conflict.assignmentId]: "existing",
                                    },
                                  }
                                : current,
                            )
                          }
                        >
                          Garder {conflict.volunteerName}
                        </Button>
                        <Button
                          size="sm"
                          variant={conflictDialog.resolutions[conflict.assignmentId] === "new" ? "warning" : "secondary"}
                          onClick={() =>
                            setConflictDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    resolutions: {
                                      ...current.resolutions,
                                      [conflict.assignmentId]: "new",
                                    },
                                  }
                                : current,
                            )
                          }
                        >
                          Donner à {conflictDialog.volunteerName}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConflictDialog(null)}>
                  Annuler
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (!conflictDialog) {
                      return;
                    }

                    void applyPlacement({
                      volunteerId: conflictDialog.volunteerId,
                      volunteerName: conflictDialog.volunteerName,
                      volunteerColor: conflictDialog.volunteerColor,
                      lane: conflictDialog.lane,
                      startTime: conflictDialog.startTime,
                      endTime: conflictDialog.endTime,
                      resolutions: Object.entries(conflictDialog.resolutions).map(([assignmentId, winner]) => ({
                        assignmentId,
                        winner,
                      })),
                    }).catch(() => undefined);
                  }}
                >
                  Appliquer l&apos;arbitrage
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
