"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatShortDay } from "@/lib/time";
import { cn } from "@/lib/utils";

type AvailabilityItem = {
  id: string;
  startTime: string;
  endTime: string;
};

type GridAvailabilityItem = AvailabilityItem & {
  pendingAction?: "create" | "delete";
};

type MergedAvailabilityItem = {
  key: string;
  availabilityIds: string[];
  startTime: string;
  endTime: string;
  pendingAction?: "create" | "delete";
};

type AvailabilityGridProps = {
  monthStart: string;
  monthEnd: string;
  availabilities: AvailabilityItem[];
  disabled?: boolean;
  onCreateRange: (startTime: string, endTime: string) => Promise<void> | void;
  onDeleteRange: (availabilityIds: string[]) => Promise<void> | void;
};

type DurationPreset = {
  hours: number;
  label: string;
  chipClassName: string;
};

const DURATION_PRESETS: DurationPreset[] = [
  {
    hours: 4,
    label: "4h",
    chipClassName: "border-sky-300 bg-sky-50 text-sky-800",
  },
  {
    hours: 6,
    label: "6h",
    chipClassName: "border-emerald-300 bg-emerald-50 text-emerald-800",
  },
  {
    hours: 8,
    label: "8h",
    chipClassName: "border-violet-300 bg-violet-50 text-violet-800",
  },
  {
    hours: 12,
    label: "12h",
    chipClassName: "border-amber-300 bg-amber-50 text-amber-800",
  },
];

type CellMenuState = {
  index: number;
  rangeIds: string[];
  pending: boolean;
};

function toIso(date: Date) {
  return date.toISOString();
}

export function AvailabilityGrid({
  monthStart,
  monthEnd,
  availabilities,
  disabled,
  onCreateRange,
  onDeleteRange,
}: AvailabilityGridProps) {
  const storageAxisStart = useMemo(() => new Date(monthStart), [monthStart]);
  const storageAxisEnd = useMemo(() => new Date(monthEnd), [monthEnd]);
  const displayAxisStart = useMemo(() => {
    const date = new Date(monthStart);
    date.setHours(0, 0, 0, 0);
    return date;
  }, [monthStart]);

  const totalHours = Math.max(1, Math.round((storageAxisEnd.getTime() - storageAxisStart.getTime()) / 3_600_000));
  const daysCount = Math.round(totalHours / 24);

  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingCreates, setPendingCreates] = useState<GridAvailabilityItem[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [dropPreview, setDropPreview] = useState<{ start: number; end: number } | null>(null);
  const [draggedPresetHours, setDraggedPresetHours] = useState<number | null>(null);
  const activePendingCreates = useMemo(
    () =>
      pendingCreates.filter(
        (item) =>
          !availabilities.some(
            (availability) =>
              availability.startTime === item.startTime && availability.endTime === item.endTime,
          ),
      ),
    [availabilities, pendingCreates],
  );
  const activePendingDeletes = useMemo(
    () => pendingDeletes.filter((id) => availabilities.some((availability) => availability.id === id)),
    [availabilities, pendingDeletes],
  );

  const visibleAvailabilities = useMemo(() => {
    const base: GridAvailabilityItem[] = availabilities.map((availability) => ({
      ...availability,
      pendingAction: activePendingDeletes.includes(availability.id) ? "delete" : undefined,
    }));

    return [...base, ...activePendingCreates];
  }, [activePendingCreates, activePendingDeletes, availabilities]);

  const mergedAvailabilities = useMemo(() => {
    const sorted = [...visibleAvailabilities].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    const merged: MergedAvailabilityItem[] = [];

    for (const availability of sorted) {
      const previous = merged.at(-1);
      const currentStartTime = new Date(availability.startTime).getTime();
      const previousEndTime = previous ? new Date(previous.endTime).getTime() : null;

      if (
        previous &&
        previous.pendingAction === availability.pendingAction &&
        previousEndTime !== null &&
        previousEndTime >= currentStartTime
      ) {
        if (new Date(availability.endTime).getTime() > previousEndTime) {
          previous.endTime = availability.endTime;
        }
        previous.availabilityIds.push(availability.id);
        previous.key = `${previous.availabilityIds[0]}:${previous.endTime}`;
      } else {
        merged.push({
          key: availability.id,
          availabilityIds: [availability.id],
          startTime: availability.startTime,
          endTime: availability.endTime,
          pendingAction: availability.pendingAction,
        });
      }
    }

    return merged;
  }, [visibleAvailabilities]);

  const availabilityByHour = useMemo(() => {
    const map = new Map<number, { ids: string[]; pendingAction?: "create" | "delete" }>();
    for (const availability of mergedAvailabilities) {
      const startIndex = Math.max(
        0,
        Math.round((new Date(availability.startTime).getTime() - storageAxisStart.getTime()) / 3_600_000),
      );
      const endIndex = Math.min(
        totalHours,
        Math.round((new Date(availability.endTime).getTime() - storageAxisStart.getTime()) / 3_600_000),
      );

      for (let index = startIndex; index < endIndex; index += 1) {
        if (!map.has(index)) {
          map.set(index, {
            ids: availability.availabilityIds,
            pendingAction: availability.pendingAction,
          });
        }
      }
    }
    return map;
  }, [mergedAvailabilities, storageAxisStart, totalHours]);

  const previewRange = useMemo(() => {
    if (dragStart === null || dragCurrent === null) return null;
    const start = Math.min(dragStart, dragCurrent);
    const end = Math.max(dragStart, dragCurrent) + 1;
    return { start, end };
  }, [dragCurrent, dragStart]);

  function closeCellMenu() {
    setCellMenu(null);
  }

  function getDraggedDuration(event?: { dataTransfer?: DataTransfer | null }) {
    if (draggedPresetHours !== null) {
      return draggedPresetHours;
    }

    const durationValue =
      event?.dataTransfer?.getData("application/x-horaire112-duration") ??
      event?.dataTransfer?.getData("text/plain") ??
      "";
    const durationHours = Number(durationValue);
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      return null;
    }
    return durationHours;
  }

  useEffect(() => {
    const onWindowDown = () => {
      closeCellMenu();
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCellMenu();
      }
    };

    window.addEventListener("pointerdown", onWindowDown);
    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onWindowDown);
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, []);

  const canCreatePresetAt = useCallback((index: number, durationHours: number) => {
    const end = index + durationHours;

    if (end > totalHours) {
      return false;
    }

    for (let cursor = index; cursor < end; cursor += 1) {
      if (availabilityByHour.has(cursor)) {
        return false;
      }
    }

    return true;
  }, [availabilityByHour, totalHours]);

  const commitCreateRange = useCallback((startIndex: number, durationHours: number) => {
    const endIndex = startIndex + durationHours;
    if (!canCreatePresetAt(startIndex, durationHours)) {
      return;
    }

    const startTime = new Date(storageAxisStart.getTime() + startIndex * 3_600_000);
    const endTime = new Date(storageAxisStart.getTime() + endIndex * 3_600_000);

    if (startTime >= endTime) {
      return;
    }

    const pendingId = `pending-${startTime.getTime()}-${endTime.getTime()}`;
    setPendingCreates((current) => [
      ...current,
      {
        id: pendingId,
        startTime: toIso(startTime),
        endTime: toIso(endTime),
        pendingAction: "create",
      },
    ]);

    Promise.resolve(onCreateRange(toIso(startTime), toIso(endTime)))
      .then(() => {
        setPendingCreates((current) => current.filter((item) => item.id !== pendingId));
      })
      .catch(() => {
        setPendingCreates((current) => current.filter((item) => item.id !== pendingId));
      });
  }, [canCreatePresetAt, onCreateRange, storageAxisStart]);

  function commitDeleteRange(rangeIds: string[]) {
    const uniqueIds = [...new Set(rangeIds)];
    setPendingDeletes((current) => [...new Set([...current, ...uniqueIds])]);
    Promise.resolve(onDeleteRange(uniqueIds)).catch(() => {
      setPendingDeletes((current) => current.filter((id) => !uniqueIds.includes(id)));
    });
  }

  useEffect(() => {
    const onWindowUp = () => {
      if (disabled || !dragging || dragStart === null || dragCurrent === null) {
        setDragging(false);
        setDragStart(null);
        setDragCurrent(null);
        return;
      }

      const start = Math.min(dragStart, dragCurrent);
      const end = Math.max(dragStart, dragCurrent) + 1;

      let hasConflict = false;
      for (let cursor = start; cursor < end; cursor += 1) {
        if (availabilityByHour.has(cursor)) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        commitCreateRange(start, end - start);
      }

      setDragging(false);
      setDragStart(null);
      setDragCurrent(null);
    };

    window.addEventListener("mouseup", onWindowUp);
    return () => window.removeEventListener("mouseup", onWindowUp);
  }, [availabilityByHour, commitCreateRange, disabled, dragCurrent, dragStart, dragging]);

  const sortedRanges = useMemo(() => mergedAvailabilities, [mergedAvailabilities]);

  function getDisplayRangeLabel(range: Pick<MergedAvailabilityItem, "startTime" | "endTime">) {
    const startIndex = Math.max(
      0,
      Math.round((new Date(range.startTime).getTime() - storageAxisStart.getTime()) / 3_600_000),
    );
    const endIndex = Math.min(
      totalHours,
      Math.round((new Date(range.endTime).getTime() - storageAxisStart.getTime()) / 3_600_000),
    );

    const start = new Date(displayAxisStart.getTime() + startIndex * 3_600_000);
    const end = new Date(displayAxisStart.getTime() + endIndex * 3_600_000);

    return `${formatDateTime(start)} - ${formatDateTime(end)}`;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Blocs rapides: glissez un bloc sur l&apos;heure de départ pour créer une disponibilité.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset.hours}
              type="button"
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(event) => {
                setDraggedPresetHours(preset.hours);
                event.dataTransfer.setData("application/x-horaire112-duration", String(preset.hours));
                event.dataTransfer.setData("text/plain", String(preset.hours));
                event.dataTransfer.effectAllowed = "copy";
              }}
              onDragEnd={() => {
                setDraggedPresetHours(null);
                setDropPreview(null);
              }}
              className={cn(
                "cursor-grab rounded-md border px-3 py-1 text-sm font-semibold shadow-sm transition active:cursor-grabbing",
                preset.chipClassName,
                disabled && "opacity-50",
              )}
              title={`Glissez pour créer ${preset.hours}h`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="min-w-[1050px] select-none p-3">
          <div className="mb-2 grid grid-cols-[90px_repeat(24,minmax(0,1fr))] gap-1 text-[10px] font-bold uppercase text-slate-500">
            <div />
            {Array.from({ length: 24 }).map((_, hour) => (
              <div key={hour} className="text-center">
                {hour}
              </div>
            ))}
          </div>

          <div className="space-y-1">
            {Array.from({ length: daysCount }).map((_, dayIndex) => {
              const date = new Date(displayAxisStart.getTime() + dayIndex * 24 * 3_600_000);

              return (
                <div key={dayIndex} className="grid grid-cols-[90px_repeat(24,minmax(0,1fr))] gap-1">
                  <div className="flex items-center text-xs font-semibold text-slate-600">{formatShortDay(date)}</div>

                  {Array.from({ length: 24 }).map((__, hour) => {
                    const index = dayIndex * 24 + hour;
                    const range = availabilityByHour.get(index);
                    const isSelected =
                      previewRange !== null && index >= previewRange.start && index < previewRange.end;
                    const isDropPreview =
                      dropPreview !== null && index >= dropPreview.start && index < dropPreview.end;

                    return (
                      <div
                        key={hour}
                        className="group relative"
                        onDragOver={(event) => {
                          if (disabled || range) return;
                          const durationHours = getDraggedDuration(event);
                          if (durationHours === null) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                          setDropPreview({
                            start: index,
                            end: Math.min(totalHours, index + durationHours),
                          });
                        }}
                        onDragLeave={() => {
                          setDropPreview((current) => (current?.start === index ? null : current));
                        }}
                        onDrop={(event) => {
                          setDropPreview(null);
                          const durationHours = getDraggedDuration(event);
                          setDraggedPresetHours(null);
                          if (disabled || range || durationHours === null) return;
                          event.preventDefault();
                          closeCellMenu();
                          commitCreateRange(index, durationHours);
                        }}
                      >
                        <button
                          type="button"
                          data-testid={`availability-cell-${dayIndex}-${hour}`}
                          disabled={disabled}
                          onMouseDown={(event) => {
                            if (event.button !== 0 || disabled || range) return;
                            closeCellMenu();
                            setDragging(true);
                            setDragStart(index);
                            setDragCurrent(index);
                          }}
                          onMouseEnter={() => {
                            if (!dragging) return;
                            setDragCurrent(index);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (
                              disabled ||
                              !range ||
                              range.pendingAction === "create" ||
                              range.pendingAction === "delete"
                            ) {
                              return;
                            }
                            closeCellMenu();
                            commitDeleteRange(range.ids);
                          }}
                          className={cn(
                            "flex h-6 w-full items-center justify-center rounded-sm border border-slate-200 text-[9px] transition",
                            range
                              ? range.pendingAction === "create"
                                ? "bg-emerald-700 text-white"
                                : range.pendingAction === "delete"
                                  ? "border-slate-300 bg-slate-200 text-slate-500"
                                : "bg-emerald-500 text-white"
                              : "bg-slate-50 hover:bg-slate-100",
                            isSelected && "bg-sky-500 text-white",
                            isDropPreview && "bg-sky-100 ring-1 ring-sky-400",
                          )}
                          title={range ? "Double-cliquez pour supprimer cette plage" : "Cliquez-glissez pour ajouter"}
                        >
                          {range ? (range.pendingAction ? "" : "OK") : ""}
                        </button>

                        <button
                          type="button"
                          disabled={disabled}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setCellMenu((current) =>
                              current?.index === index
                                ? null
                                : {
                                    index,
                                    rangeIds: range?.ids ?? [],
                                    pending: Boolean(range?.pendingAction),
                                  },
                            );
                          }}
                          className={cn(
                            "absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded text-slate-500 transition",
                            range
                              ? "opacity-80 hover:bg-white/20 hover:text-white"
                              : "opacity-0 group-hover:opacity-70 hover:bg-slate-200 hover:text-slate-700",
                          )}
                          title="Actions"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </button>

                        {cellMenu?.index === index && (
                          <div
                            className="absolute top-7 right-0 z-30 min-w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            {range ? (
                              <button
                                type="button"
                                disabled={Boolean(range.pendingAction)}
                                onClick={() => {
                                  if (!range.pendingAction) {
                                    commitDeleteRange(range.ids);
                                  }
                                  closeCellMenu();
                                }}
                                className="w-full rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                              >
                                Supprimer cette disponibilité
                              </button>
                            ) : (
                              DURATION_PRESETS.map((preset) => {
                                const allowed = canCreatePresetAt(index, preset.hours);
                                return (
                                  <button
                                    key={preset.hours}
                                    type="button"
                                    disabled={!allowed}
                                    onClick={() => {
                                      if (allowed) {
                                        commitCreateRange(index, preset.hours);
                                      }
                                      closeCellMenu();
                                    }}
                                    className="w-full rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Ajouter {preset.label} à partir d&apos;ici
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Raccourcis: glissez pour créer, glissez un bloc rapide sur la grille, double-cliquez une case verte pour supprimer.
          </p>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={closeCellMenu}>
            Fermer menus
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {sortedRanges.map((range) => (
            <button
              key={range.key}
              type="button"
              disabled={disabled || Boolean(range.pendingAction)}
              onClick={() => {
                if (range.pendingAction) return;
                commitDeleteRange(range.availabilityIds);
              }}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                range.pendingAction === "create"
                  ? "border-emerald-700 bg-emerald-100 text-emerald-900"
                  : range.pendingAction === "delete"
                    ? "border-slate-300 bg-slate-100 text-slate-500"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
              )}
            >
              {getDisplayRangeLabel(range)}
            </button>
          ))}
          {sortedRanges.length === 0 && <span className="text-xs text-slate-500">Aucune disponibilité.</span>}
        </div>
      </div>
    </div>
  );
}
