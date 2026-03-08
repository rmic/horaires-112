"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime, formatShortDay } from "@/lib/time";
import { cn } from "@/lib/utils";

type AvailabilityItem = {
  id: string;
  startTime: string;
  endTime: string;
};

type AvailabilityGridProps = {
  monthStart: string;
  monthEnd: string;
  availabilities: AvailabilityItem[];
  disabled?: boolean;
  onCreateRange: (startTime: string, endTime: string) => Promise<void> | void;
  onDeleteRange: (availabilityId: string) => Promise<void> | void;
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
  const monthStartDate = useMemo(() => new Date(monthStart), [monthStart]);
  const monthEndDate = useMemo(() => new Date(monthEnd), [monthEnd]);

  const totalHours = Math.max(1, Math.round((monthEndDate.getTime() - monthStartDate.getTime()) / 3_600_000));
  const daysCount = Math.round(totalHours / 24);

  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const availabilityByHour = useMemo(() => {
    const map = new Map<number, string>();
    for (const availability of availabilities) {
      const startIndex = Math.max(
        0,
        Math.round((new Date(availability.startTime).getTime() - monthStartDate.getTime()) / 3_600_000),
      );
      const endIndex = Math.min(
        totalHours,
        Math.round((new Date(availability.endTime).getTime() - monthStartDate.getTime()) / 3_600_000),
      );

      for (let index = startIndex; index < endIndex; index += 1) {
        if (!map.has(index)) {
          map.set(index, availability.id);
        }
      }
    }
    return map;
  }, [availabilities, monthStartDate, totalHours]);

  const previewRange = useMemo(() => {
    if (dragStart === null || dragCurrent === null) return null;
    const start = Math.min(dragStart, dragCurrent);
    const end = Math.max(dragStart, dragCurrent) + 1;
    return { start, end };
  }, [dragCurrent, dragStart]);

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

      const startTime = new Date(monthStartDate.getTime() + start * 3_600_000);
      const endTime = new Date(monthStartDate.getTime() + end * 3_600_000);

      if (startTime < endTime) {
        void onCreateRange(toIso(startTime), toIso(endTime));
      }

      setDragging(false);
      setDragStart(null);
      setDragCurrent(null);
    };

    window.addEventListener("mouseup", onWindowUp);
    return () => window.removeEventListener("mouseup", onWindowUp);
  }, [disabled, dragCurrent, dragStart, dragging, monthStartDate, onCreateRange]);

  const sortedRanges = useMemo(
    () =>
      [...availabilities].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      ),
    [availabilities],
  );

  return (
    <div className="space-y-3">
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
              const date = new Date(monthStartDate.getTime() + dayIndex * 24 * 3_600_000);

              return (
                <div key={dayIndex} className="grid grid-cols-[90px_repeat(24,minmax(0,1fr))] gap-1">
                  <div className="flex items-center text-xs font-semibold text-slate-600">{formatShortDay(date)}</div>

                  {Array.from({ length: 24 }).map((__, hour) => {
                    const index = dayIndex * 24 + hour;
                    const rangeId = availabilityByHour.get(index);
                    const isSelected =
                      previewRange !== null && index >= previewRange.start && index < previewRange.end;

                    return (
                      <button
                        key={hour}
                        type="button"
                        data-testid={`availability-cell-${dayIndex}-${hour}`}
                        disabled={disabled}
                        onMouseDown={(event) => {
                          if (event.button !== 0 || disabled) return;
                          setDragging(true);
                          setDragStart(index);
                          setDragCurrent(index);
                        }}
                        onMouseEnter={() => {
                          if (!dragging) return;
                          setDragCurrent(index);
                        }}
                        onDoubleClick={() => {
                          if (disabled || !rangeId) return;
                          void onDeleteRange(rangeId);
                        }}
                        className={cn(
                          "h-6 rounded-sm border border-slate-200 text-[9px] transition",
                          rangeId ? "bg-emerald-500 text-white" : "bg-slate-50 hover:bg-slate-100",
                          isSelected && "bg-sky-500 text-white",
                        )}
                        title={rangeId ? "Double-cliquez pour supprimer cette plage" : "Cliquez-glissez pour ajouter"}
                      >
                        {rangeId ? "OK" : ""}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Raccourci: glissez pour créer, double-cliquez une case verte pour supprimer.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {sortedRanges.map((range) => (
            <button
              key={range.id}
              type="button"
              disabled={disabled}
              onClick={() => onDeleteRange(range.id)}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
            >
              {formatDateTime(new Date(range.startTime))} - {formatDateTime(new Date(range.endTime))}
            </button>
          ))}
          {sortedRanges.length === 0 && <span className="text-xs text-slate-500">Aucune disponibilité.</span>}
        </div>
      </div>
    </div>
  );
}
