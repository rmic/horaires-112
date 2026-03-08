"use client";

import { endOfWeek, startOfWeek } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { MonthTimeline } from "@/components/manager/month-timeline";
import { formatDateTime, formatWeekLabel } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Volunteer = {
  id: string;
  name: string;
};

type DayTimeline = {
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
      status: "CONFIRMED" | "PROVISIONAL";
    }>;
    employeeBlocks: Array<{
      id: string;
      label: string;
    }>;
  }>;
};

type Gap = {
  startTime: string;
  endTime: string;
  missingCount: number;
};

type PublicPayload = {
  requiresPassword: boolean;
  month?: {
    year: number;
    month: number;
  };
  volunteers?: Volunteer[];
  dayTimelines?: DayTimeline[];
  gaps?: Gap[];
};

export function PublicScheduleView({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [volunteerFilterId, setVolunteerFilterId] = useState("");

  const load = async (passwordValue?: string) => {
    setLoading(true);
    try {
      const query = passwordValue ? `?password=${encodeURIComponent(passwordValue)}` : "";
      const response = await fetch(`/api/published/${token}${query}`);
      const data = (await response.json()) as PublicPayload & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Erreur de chargement");
      }

      setPayload(data);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const groupedByWeek = useMemo(() => {
    if (!payload?.dayTimelines) return [] as Array<{ label: string; timelines: DayTimeline[] }>;

    const visibleTimelines = volunteerFilterId
      ? payload.dayTimelines.filter((timeline) =>
          timeline.segments.some((segment) =>
            segment.volunteerAssignments.some((assignment) => assignment.volunteerId === volunteerFilterId),
          ),
        )
      : payload.dayTimelines;

    const groups = new Map<string, DayTimeline[]>();

    for (const timeline of visibleTimelines) {
      const day = new Date(timeline.dayStart);
      const weekStart = startOfWeek(day, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(day, { weekStartsOn: 1 });
      const key = `${weekStart.toISOString()}|${weekEnd.toISOString()}`;
      const list = groups.get(key) ?? [];
      list.push(timeline);
      groups.set(key, list);
    }

    return [...groups.entries()].map(([key, timelines]) => {
      const [start, end] = key.split("|");
      return {
        label: formatWeekLabel(new Date(start), new Date(end)),
        timelines,
      };
    });
  }, [payload?.dayTimelines, volunteerFilterId]);

  if (loading) {
    return <main className="p-6 text-center text-slate-600">Chargement...</main>;
  }

  if (!payload) {
    return <main className="p-6 text-center text-red-700">Impossible de charger le planning.</main>;
  }

  if (payload.requiresPassword) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Planning protégé</CardTitle>
            <CardDescription>Entrez le mot de passe partagé par le manager.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button className="w-full" onClick={() => void load(password)}>
              Ouvrir
            </Button>
            {error && <p className="text-sm text-red-700">{error}</p>}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 md:px-6">
      <Card>
        <CardHeader>
          <CardTitle>
            Planning publié {String(payload.month?.month).padStart(2, "0")}/{payload.month?.year}
          </CardTitle>
          <CardDescription>Lecture seule volontaires</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="success">Vert = confirmé</Badge>
          <Badge variant="warning">Orange = provisoire</Badge>
          <Badge variant="danger">Rouge = à couvrir</Badge>
          <Badge variant="muted">Gris = salarié</Badge>
          <div className="ml-auto grid max-w-sm grid-cols-[120px_1fr] items-center gap-2">
            <Label>Filtre volontaire</Label>
            <Select value={volunteerFilterId} onChange={(event) => setVolunteerFilterId(event.target.value)}>
              <option value="">Tous</option>
              {payload.volunteers?.map((volunteer) => (
                <option key={volunteer.id} value={volunteer.id}>
                  {volunteer.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {groupedByWeek.map((week) => (
        <Card key={week.label}>
          <CardHeader>
            <CardTitle>{week.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthTimeline
              dayTimelines={week.timelines}
              volunteerFilterId={volunteerFilterId || undefined}
              filterMode="volunteer-only"
            />
          </CardContent>
        </Card>
      ))}

      {volunteerFilterId && groupedByWeek.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-slate-600">
            Aucune garde pour ce volontaire sur ce mois.
          </CardContent>
        </Card>
      )}

      {!volunteerFilterId && (
        <Card>
          <CardHeader>
            <CardTitle>Liste des créneaux à couvrir</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(payload.gaps ?? []).map((gap) => (
              <div key={`${gap.startTime}-${gap.endTime}`} className="rounded-md border border-red-300 bg-red-50 p-2">
                <p className="font-black text-red-800">
                  {formatDateTime(new Date(gap.startTime))} - {formatDateTime(new Date(gap.endTime))}:{" "}
                  {gap.missingCount === 1
                    ? "couverture incomplète, 1 personne manquante"
                    : "couverture incomplète, 2 personnes manquantes"}
                </p>
              </div>
            ))}
            {(payload.gaps ?? []).length === 0 && <p className="text-sm text-emerald-700">Aucun créneau à couvrir.</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
