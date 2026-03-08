"use client";

import { CalendarDays, Download, Link as LinkIcon, LogOut, Plus, RefreshCw, Sparkles, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvailabilityGrid } from "@/components/manager/availability-grid";
import { MonthTimeline } from "@/components/manager/month-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatHour, toDateTimeInputValue } from "@/lib/time";

type Volunteer = {
  id: string;
  name: string;
  color: string;
  monthMaxGuardsPerMonth?: number | null;
};

type Assignment = {
  id: string;
  volunteerId: string;
  startTime: string;
  endTime: string;
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

type EmployeeBlock = {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
};

type Note = {
  id: string;
  body: string;
  createdAt: string;
};

type AssignmentEvent = {
  id: string;
  eventType: string;
  createdAt: string;
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

type MonthModel = {
  id: string;
  year: number;
  month: number;
  startsAt: string;
  endsAt: string;
  status: "DRAFT" | "PUBLISHED";
  assignments: Assignment[];
  availabilities: Availability[];
  employeeBlocks: EmployeeBlock[];
  notes: Note[];
  assignmentEvents: AssignmentEvent[];
};

type MonthResponse = {
  month: MonthModel;
  volunteers: Volunteer[];
  dayTimelines: DayTimeline[];
  publicUrl: string;
};

type MonthSummary = {
  id: string;
  year: number;
  month: number;
  status: "DRAFT" | "PUBLISHED";
  _count: {
    assignments: number;
    availabilities: number;
    employeeBlocks: number;
  };
};

type GapVolunteerSuggestion = {
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
  fullCoverageSuggestions: GapVolunteerSuggestion[];
  partialCoverageSuggestions: GapVolunteerSuggestion[];
};

type ApiErrorLike = {
  message: string;
  status?: number;
  details?: unknown;
};

function getError(error: unknown): ApiErrorLike {
  if (typeof error === "object" && error !== null && "message" in error) {
    return error as ApiErrorLike;
  }

  return {
    message: "Erreur inconnue",
  };
}

function formatDurationLabel(durationMinutes: number) {
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

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response
    .json()
    .catch(() => ({ error: `HTTP ${response.status}` }))) as Record<string, unknown>;

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      const nextPath = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/manager/login?next=${encodeURIComponent(nextPath)}`);
    }

    throw {
      message: String(body.error ?? `HTTP ${response.status}`),
      status: response.status,
      details: body.details,
    };
  }

  return body as T;
}

function VolunteerRow({
  volunteer,
  onSave,
  onDelete,
}: {
  volunteer: Volunteer;
  onSave: (payload: { id: string; name: string; color: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(volunteer.name);
  const [color, setColor] = useState(volunteer.color);

  return (
    <tr>
      <TableCell>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </TableCell>
      <TableCell>
        <Input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </TableCell>
      <TableCell className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onSave({
              id: volunteer.id,
              name,
              color,
            })
          }
        >
          Sauver
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(volunteer.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </tr>
  );
}

function AssignmentRow({
  assignment,
  volunteers,
  onSave,
  onDelete,
}: {
  assignment: Assignment;
  volunteers: Volunteer[];
  onSave: (payload: {
    id: string;
    volunteerId: string;
    startTime: string;
    endTime: string;
    status: "CONFIRMED" | "PROVISIONAL";
  }) => void;
  onDelete: (id: string) => void;
}) {
  const [volunteerId, setVolunteerId] = useState(assignment.volunteerId);
  const [startTime, setStartTime] = useState(toDateTimeInputValue(new Date(assignment.startTime)));
  const [endTime, setEndTime] = useState(toDateTimeInputValue(new Date(assignment.endTime)));
  const [status, setStatus] = useState<"CONFIRMED" | "PROVISIONAL">(assignment.status);

  return (
    <tr>
      <TableCell>
        <Select value={volunteerId} onChange={(event) => setVolunteerId(event.target.value)}>
          {volunteers.map((volunteer) => (
            <option key={volunteer.id} value={volunteer.id}>
              {volunteer.name}
            </option>
          ))}
        </Select>
      </TableCell>
      <TableCell>
        <Input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      </TableCell>
      <TableCell>
        <Input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
      </TableCell>
      <TableCell>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as "CONFIRMED" | "PROVISIONAL")}
        >
          <option value="CONFIRMED">Confirmée</option>
          <option value="PROVISIONAL">Provisoire</option>
        </Select>
      </TableCell>
      <TableCell className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onSave({ id: assignment.id, volunteerId, startTime, endTime, status })}
        >
          Sauver
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(assignment.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </tr>
  );
}

export function ManagerDashboard({ managerAuthEnabled = false }: { managerAuthEnabled?: boolean }) {
  const today = new Date();
  const latestMonthRequestId = useRef(0);

  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [selectedMonthId, setSelectedMonthId] = useState("");
  const [monthData, setMonthData] = useState<MonthResponse | null>(null);
  const [gapSuggestions, setGapSuggestions] = useState<GapSuggestion[]>([]);

  const [availabilityVolunteerId, setAvailabilityVolunteerId] = useState("");
  const [timelineVolunteerFilter, setTimelineVolunteerFilter] = useState("");
  const [managerTab, setManagerTab] = useState<"planning" | "volunteers">("planning");

  const [newVolunteerName, setNewVolunteerName] = useState("");
  const [newVolunteerColor, setNewVolunteerColor] = useState("#0ea5e9");
  const [availabilityMaxGuards, setAvailabilityMaxGuards] = useState("");

  const [createYear, setCreateYear] = useState(today.getFullYear());
  const [createMonth, setCreateMonth] = useState(today.getMonth() + 1);

  const [publishPassword, setPublishPassword] = useState("");

  const [newAssignmentVolunteerId, setNewAssignmentVolunteerId] = useState("");
  const [newAssignmentSecondVolunteerId, setNewAssignmentSecondVolunteerId] = useState("");
  const [newAssignmentStart, setNewAssignmentStart] = useState("");
  const [newAssignmentEnd, setNewAssignmentEnd] = useState("");
  const [newAssignmentStatus, setNewAssignmentStatus] = useState<"CONFIRMED" | "PROVISIONAL">("CONFIRMED");
  const [editingTimelineSegment, setEditingTimelineSegment] = useState<DayTimeline["segments"][number] | null>(null);

  const [newEmployeeStart, setNewEmployeeStart] = useState("");
  const [newEmployeeEnd, setNewEmployeeEnd] = useState("");

  const [newNote, setNewNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const availableAvailabilityRanges = useMemo(() => {
    if (!monthData || !availabilityVolunteerId) return [];
    return monthData.month.availabilities.filter((availability) => availability.volunteerId === availabilityVolunteerId);
  }, [availabilityVolunteerId, monthData]);

  const loadBase = useCallback(async () => {
    const [volunteerResponse, monthResponse] = await Promise.all([
      api<{ volunteers: Volunteer[] }>("/api/volunteers"),
      api<{ months: MonthSummary[] }>("/api/months"),
    ]);

    setVolunteers(volunteerResponse.volunteers);
    setMonths(monthResponse.months);

    if (!selectedMonthId && monthResponse.months.length > 0) {
      setSelectedMonthId(monthResponse.months[0].id);
    }

    if (selectedMonthId && !monthResponse.months.some((month) => month.id === selectedMonthId)) {
      setSelectedMonthId(monthResponse.months[0]?.id ?? "");
    }
  }, [selectedMonthId]);

  const loadSelectedMonth = useCallback(async () => {
    if (!selectedMonthId) {
      latestMonthRequestId.current += 1;
      setMonthData(null);
      return;
    }

    const requestId = latestMonthRequestId.current + 1;
    latestMonthRequestId.current = requestId;

    const [monthResponse, gapResponse] = await Promise.all([
      api<MonthResponse>(`/api/months/${selectedMonthId}`),
      api<{ gaps: GapSuggestion[] }>(`/api/months/${selectedMonthId}/coverage`),
    ]);

    if (latestMonthRequestId.current !== requestId) {
      return;
    }

    setMonthData(monthResponse);
    setGapSuggestions(gapResponse.gaps);
    setVolunteers(monthResponse.volunteers);

    if (!availabilityVolunteerId && monthResponse.volunteers.length > 0) {
      setAvailabilityVolunteerId(monthResponse.volunteers[0].id);
    }

    if (!newAssignmentVolunteerId && monthResponse.volunteers.length > 0) {
      const defaultStart = new Date(monthResponse.month.startsAt);
      defaultStart.setHours(6, 0, 0, 0);
      setNewAssignmentVolunteerId(monthResponse.volunteers[0].id);
      setNewAssignmentSecondVolunteerId("");
      setNewAssignmentStart(toDateTimeInputValue(defaultStart));
      setNewAssignmentEnd(toDateTimeInputValue(new Date(defaultStart.getTime() + 4 * 3_600_000)));

      setNewEmployeeStart(toDateTimeInputValue(defaultStart));
      setNewEmployeeEnd(toDateTimeInputValue(new Date(defaultStart.getTime() + 12 * 3_600_000)));
    }
  }, [availabilityVolunteerId, newAssignmentVolunteerId, selectedMonthId]);

  useEffect(() => {
    setBusy(true);
    loadBase()
      .then(() => setError(""))
      .catch((value) => setError(getError(value).message))
      .finally(() => setBusy(false));
  }, [loadBase]);

  useEffect(() => {
    if (!selectedMonthId) return;
    setBusy(true);
    loadSelectedMonth()
      .then(() => setError(""))
      .catch((value) => setError(getError(value).message))
      .finally(() => setBusy(false));
  }, [loadSelectedMonth, selectedMonthId]);

  useEffect(() => {
    const selectedVolunteer = volunteers.find((volunteer) => volunteer.id === availabilityVolunteerId);
    setAvailabilityMaxGuards(
      selectedVolunteer?.monthMaxGuardsPerMonth ? String(selectedVolunteer.monthMaxGuardsPerMonth) : "",
    );
  }, [availabilityVolunteerId, volunteers]);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    try {
      await loadBase();
      await loadSelectedMonth();
      setError("");
    } catch (value) {
      setError(getError(value).message);
    } finally {
      setBusy(false);
    }
  }, [loadBase, loadSelectedMonth]);

  const deleteSelectedMonth = useCallback(async () => {
    if (!monthData) {
      return;
    }

    const confirmed = window.confirm(
      `Supprimer le planning ${String(monthData.month.month).padStart(2, "0")}/${monthData.month.year} ?\n\nToutes les disponibilités, gardes, blocs salarié, notes et l'historique de ce mois seront supprimés.`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);

    try {
      await api(`/api/months/${monthData.month.id}`, {
        method: "DELETE",
      });

      const monthResponse = await api<{ months: MonthSummary[] }>("/api/months");
      setMonths(monthResponse.months);

      const nextMonthId = monthResponse.months[0]?.id ?? "";
                    setSelectedMonthId(nextMonthId);

                    if (!nextMonthId) {
                      setMonthData(null);
                      setGapSuggestions([]);
                      setAvailabilityVolunteerId("");
                      setAvailabilityMaxGuards("");
                      setTimelineVolunteerFilter("");
                      setPublishPassword("");
                    }

      setFeedback("Mois supprimé.");
      setError("");
    } catch (value) {
      setError(getError(value).message);
    } finally {
      setBusy(false);
    }
  }, [monthData]);

  const createAssignments = useCallback(
    async (params: {
      volunteerIds: string[];
      startTime: string;
      endTime: string;
      status: "CONFIRMED" | "PROVISIONAL";
    }) => {
      try {
        await api(`/api/months/${monthData?.month.id}/assignments`, {
          method: "POST",
          body: JSON.stringify({
            volunteerIds: params.volunteerIds,
            startTime: params.startTime,
            endTime: params.endTime,
            status: params.status,
            source: "MANUAL",
          }),
        });
      } catch (value) {
        const err = getError(value);
        if (err.status === 409 && (err.details as { type?: string } | undefined)?.type === "REST_WARNING") {
          const proceed = window.confirm(
            `${err.message}\n\nForcer malgré la recommandation de 11h de repos ?`,
          );

          if (proceed) {
            await api(`/api/months/${monthData?.month.id}/assignments`, {
              method: "POST",
              body: JSON.stringify({
                volunteerIds: params.volunteerIds,
                startTime: params.startTime,
                endTime: params.endTime,
                status: params.status,
                source: "MANUAL",
                ignoreRestWarning: true,
              }),
            });
            return;
          }
        }

        throw value;
      }
    },
    [monthData?.month.id],
  );

  const loadSegmentInEditor = useCallback((segment: DayTimeline["segments"][number]) => {
    const volunteerIds = segment.volunteerAssignments.map((assignment) => assignment.volunteerId);
    const provisional = segment.volunteerAssignments.some((assignment) => assignment.status === "PROVISIONAL");

    setEditingTimelineSegment(segment);
    setNewAssignmentVolunteerId(volunteerIds[0] ?? "");
    setNewAssignmentSecondVolunteerId(volunteerIds[1] ?? "");
    setNewAssignmentStart(toDateTimeInputValue(new Date(segment.startTime)));
    setNewAssignmentEnd(toDateTimeInputValue(new Date(segment.endTime)));
    setNewAssignmentStatus(provisional ? "PROVISIONAL" : "CONFIRMED");
    setError("");
    setFeedback("Plage chargée dans l'éditeur.");
  }, []);

  const createOrUpdateAssignment = useCallback(
    async (params: {
      url: string;
      method: "POST" | "PATCH";
      payload: {
        volunteerId: string;
        startTime: string;
        endTime: string;
        status: "CONFIRMED" | "PROVISIONAL";
        source?: "MANUAL";
        id?: string;
      };
    }) => {
      try {
        await api(params.url, {
          method: params.method,
          body: JSON.stringify(params.payload),
        });
      } catch (value) {
        const err = getError(value);
        if (err.status === 409 && (err.details as { type?: string } | undefined)?.type === "REST_WARNING") {
          const proceed = window.confirm(
            `${err.message}\n\nForcer malgré la recommandation de 11h de repos ?`,
          );
          if (proceed) {
            await api(params.url, {
              method: params.method,
              body: JSON.stringify({ ...params.payload, ignoreRestWarning: true }),
            });
            return;
          }
        }

        throw value;
      }
    },
    [],
  );

  const syncEditedSegment = useCallback(
    async (params: {
      volunteerIds: string[];
      startTime: string;
      endTime: string;
      status: "CONFIRMED" | "PROVISIONAL";
    }) => {
      if (!monthData) {
        return;
      }

      const exactAssignments = monthData.month.assignments.filter(
        (assignment) => assignment.startTime === params.startTime && assignment.endTime === params.endTime,
      );
      const coveringAssignments = monthData.month.assignments.filter(
        (assignment) => assignment.startTime <= params.startTime && assignment.endTime >= params.endTime,
      );

      const desiredVolunteerIds = new Set(params.volunteerIds);

      for (const assignment of exactAssignments) {
        if (!desiredVolunteerIds.has(assignment.volunteerId)) {
          await api(`/api/assignments/${assignment.id}`, {
            method: "DELETE",
          });
        }
      }

      for (const assignment of exactAssignments) {
        if (desiredVolunteerIds.has(assignment.volunteerId) && assignment.status !== params.status) {
          await createOrUpdateAssignment({
            url: `/api/assignments/${assignment.id}`,
            method: "PATCH",
            payload: {
              volunteerId: assignment.volunteerId,
              startTime: params.startTime,
              endTime: params.endTime,
              status: params.status,
            },
          });
        }
      }

      const coveredVolunteerIds = new Set(coveringAssignments.map((assignment) => assignment.volunteerId));
      const volunteerIdsToCreate = params.volunteerIds.filter((volunteerId) => !coveredVolunteerIds.has(volunteerId));

      if (volunteerIdsToCreate.length > 0) {
        await createAssignments({
          volunteerIds: volunteerIdsToCreate,
          startTime: params.startTime,
          endTime: params.endTime,
          status: params.status,
        });
      }
    },
    [createAssignments, createOrUpdateAssignment, monthData],
  );

  const assignSuggestedVolunteer = useCallback(
    async (suggestion: GapVolunteerSuggestion) => {
      setBusy(true);

      try {
        await createAssignments({
          volunteerIds: [suggestion.id],
          startTime: suggestion.startTime,
          endTime: suggestion.endTime,
          status: "CONFIRMED",
        });
        await loadSelectedMonth();
        setFeedback(
          `${suggestion.name} affecté du ${formatDateTime(new Date(suggestion.startTime))} au ${formatDateTime(new Date(suggestion.endTime))}.`,
        );
        setError("");
      } catch (value) {
        setError(getError(value).message);
      } finally {
        setBusy(false);
      }
    },
    [createAssignments, loadSelectedMonth],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6 md:px-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-amber-100 via-white to-sky-100 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Horaire 112 - Manager</h1>
            <p className="text-sm text-slate-700">
              V1 mono-ambulance: saisie rapide des disponibilités, planning mensuel, vue publique lecture seule.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void refreshAll()} disabled={busy}>
              <RefreshCw className="h-4 w-4" />
              Actualiser
            </Button>
            {managerAuthEnabled && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await fetch("/api/auth/manager/logout", {
                      method: "POST",
                    });
                    await signOut({
                      redirect: false,
                    });
                  } finally {
                    window.location.assign("/manager/login");
                  }
                }}
              >
                <LogOut className="h-4 w-4" />
                Déconnexion
              </Button>
            )}
          </div>
        </div>
        {feedback && <p className="mt-2 text-sm font-semibold text-emerald-700">{feedback}</p>}
        {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant={managerTab === "planning" ? "default" : "secondary"}
            onClick={() => setManagerTab("planning")}
          >
            <CalendarDays className="h-4 w-4" />
            Planning
          </Button>
          <Button
            variant={managerTab === "volunteers" ? "default" : "secondary"}
            onClick={() => setManagerTab("volunteers")}
          >
            <Users className="h-4 w-4" />
            Volontaires
          </Button>
        </div>
      </div>

      {managerTab === "volunteers" ? (
        <Card>
          <CardHeader>
            <CardTitle>Volontaires</CardTitle>
            <CardDescription>
              Liste séparée du planning pour garder un maximum d&apos;espace sur l&apos;écran de construction du mois.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_88px_auto]">
              <Input
                data-testid="new-volunteer-name"
                placeholder="Nom"
                value={newVolunteerName}
                onChange={(event) => setNewVolunteerName(event.target.value)}
              />
              <Input
                data-testid="new-volunteer-color"
                type="color"
                value={newVolunteerColor}
                onChange={(event) => setNewVolunteerColor(event.target.value)}
              />
              <Button
                data-testid="create-volunteer"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/api/volunteers", {
                      method: "POST",
                      body: JSON.stringify({
                        name: newVolunteerName,
                        color: newVolunteerColor,
                      }),
                    });
                    setNewVolunteerName("");
                    await refreshAll();
                    setFeedback("Volontaire créé.");
                  } catch (value) {
                    setError(getError(value).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>

            <div className="max-h-[70vh] overflow-auto rounded-md border border-slate-200">
              <Table>
                <thead>
                  <tr>
                    <TableHead>Nom</TableHead>
                    <TableHead>Couleur</TableHead>
                    <TableHead />
                  </tr>
                </thead>
                <tbody>
                  {volunteers.map((volunteer) => (
                    <VolunteerRow
                      key={volunteer.id}
                      volunteer={volunteer}
                      onSave={(payload) => {
                        void api(`/api/volunteers/${payload.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            name: payload.name,
                            color: payload.color,
                          }),
                        })
                          .then(() => refreshAll())
                          .catch((value) => setError(getError(value).message));
                      }}
                      onDelete={(id) => {
                        void api(`/api/volunteers/${id}`, {
                          method: "DELETE",
                        })
                          .then(() => refreshAll())
                          .catch((value) => setError(getError(value).message));
                      }}
                    />
                  ))}
                </tbody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
          <div className="space-y-5">
            <Card>
            <CardHeader>
              <CardTitle>Mois</CardTitle>
              <CardDescription>Création mensuelle + actions de publication</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  data-testid="create-month-year"
                  type="number"
                  value={createYear}
                  onChange={(event) => setCreateYear(Number(event.target.value))}
                />
                <Select
                  data-testid="create-month-month"
                  value={String(createMonth)}
                  onChange={(event) => setCreateMonth(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }).map((_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {String(index + 1).padStart(2, "0")}
                    </option>
                  ))}
                </Select>
                <Button
                  data-testid="create-month"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api("/api/months", {
                        method: "POST",
                        body: JSON.stringify({
                          year: createYear,
                          month: createMonth,
                          autoGenerateEmployeeBlocks: false,
                        }),
                      });
                      await refreshAll();
                      setFeedback("Mois créé.");
                    } catch (value) {
                      setError(getError(value).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Créer
                </Button>
              </div>

              <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                {months.map((month) => (
                  <button
                    key={month.id}
                    type="button"
                    data-testid={`month-row-${month.year}-${String(month.month).padStart(2, "0")}`}
                    onClick={() => setSelectedMonthId(month.id)}
                    className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${
                      selectedMonthId === month.id ? "bg-slate-100" : ""
                    }`}
                  >
                    <span className="font-semibold text-slate-800">
                      {String(month.month).padStart(2, "0")}/{month.year}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={month.status === "PUBLISHED" ? "success" : "warning"}>
                        {month.status === "PUBLISHED" ? "Publié" : "Brouillon"}
                      </Badge>
                      <span className="text-xs text-slate-500">{month._count.assignments} gardes</span>
                    </span>
                  </button>
                ))}
              </div>

              {monthData && (
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">
                    Actif: {String(monthData.month.month).padStart(2, "0")}/{monthData.month.year}
                  </p>

                  <div>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`/api/months/${monthData.month.id}/draft`, {
                            method: "POST",
                            body: JSON.stringify({ replaceExistingDraft: true }),
                          });
                          await loadSelectedMonth();
                          setFeedback("Brouillon généré.");
                        } catch (value) {
                          setError(getError(value).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Sparkles className="h-4 w-4" />
                      Brouillon auto
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Mot de passe partagé (optionnel)</Label>
                    <Input
                      data-testid="publish-password"
                      placeholder="Vide = lien secret seul"
                      value={publishPassword}
                      onChange={(event) => setPublishPassword(event.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      data-testid="publish-month"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`/api/months/${monthData.month.id}/publish`, {
                            method: "POST",
                            body: JSON.stringify({ publish: true, password: publishPassword || null }),
                          });
                          await refreshAll();
                          setFeedback("Planning publié.");
                        } catch (value) {
                          setError(getError(value).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Publier
                    </Button>
                    <Button
                      data-testid="unpublish-month"
                      variant="secondary"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`/api/months/${monthData.month.id}/publish`, {
                            method: "POST",
                            body: JSON.stringify({ publish: false }),
                          });
                          await refreshAll();
                          setFeedback("Planning repassé en brouillon.");
                        } catch (value) {
                          setError(getError(value).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Dépublier
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      data-testid="download-pdf"
                      variant="secondary"
                      onClick={() => window.open(`/api/months/${monthData.month.id}/pdf`, "_blank")}
                    >
                      <Download className="h-4 w-4" />
                      PDF
                    </Button>
                    <Button
                      data-testid="copy-public-link"
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(monthData.publicUrl);
                        setFeedback("Lien public copié.");
                      }}
                    >
                      <LinkIcon className="h-4 w-4" />
                      Copier lien
                    </Button>
                    <Button
                      data-testid="delete-month"
                      variant="destructive"
                      onClick={() => void deleteSelectedMonth()}
                    >
                      <Trash2 className="h-4 w-4" />
                      Supprimer ce mois
                    </Button>
                  </div>

                  <Link href={monthData.publicUrl} target="_blank" className="block truncate text-sm text-sky-700 underline">
                    {monthData.publicUrl}
                  </Link>
                </div>
              )}
            </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            {!monthData ? (
              <Card>
                <CardContent className="p-6 text-center text-slate-600">Créez ou sélectionnez un mois.</CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Saisie des disponibilités</CardTitle>
                    <CardDescription>1h de résolution, click-drag, suppression rapide</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
                      <div>
                        <Label>Volontaire</Label>
                        <Select
                          data-testid="availability-volunteer-select"
                          value={availabilityVolunteerId}
                          onChange={(event) => setAvailabilityVolunteerId(event.target.value)}
                        >
                          {volunteers.map((volunteer) => (
                            <option key={volunteer.id} value={volunteer.id}>
                              {volunteer.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <p className="text-sm text-slate-600">
                        Les gardes doivent être entièrement contenues dans les disponibilités.
                      </p>
                    </div>

                    <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[260px_auto_1fr] md:items-end">
                      <div>
                        <Label>Gardes max sur ce mois</Label>
                        <Input
                          data-testid="availability-month-max"
                          type="number"
                          min={1}
                          max={62}
                          placeholder="illimité"
                          value={availabilityMaxGuards}
                          onChange={(event) => setAvailabilityMaxGuards(event.target.value)}
                          disabled={!availabilityVolunteerId}
                        />
                      </div>
                      <Button
                        data-testid="save-availability-month-max"
                        variant="secondary"
                        disabled={!availabilityVolunteerId || busy}
                        onClick={async () => {
                          if (!availabilityVolunteerId) {
                            return;
                          }

                          setBusy(true);
                          try {
                            await api(`/api/months/${monthData.month.id}/volunteer-settings`, {
                              method: "POST",
                              body: JSON.stringify({
                                volunteerId: availabilityVolunteerId,
                                maxGuardsPerMonth: availabilityMaxGuards ? Number(availabilityMaxGuards) : null,
                              }),
                            });
                            await loadSelectedMonth();
                            setFeedback("Plafond mensuel mis à jour.");
                            setError("");
                          } catch (value) {
                            setError(getError(value).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Sauver plafond
                      </Button>
                      <p className="text-sm text-slate-600">
                        Ce plafond s&apos;applique uniquement au mois actif pour le volontaire sélectionné. Vide = illimité.
                      </p>
                    </div>

                    <AvailabilityGrid
                      monthStart={monthData.month.startsAt}
                      monthEnd={monthData.month.endsAt}
                      availabilities={availableAvailabilityRanges}
                      disabled={!availabilityVolunteerId || busy}
                      onCreateRange={async (startTime, endTime) => {
                        if (!availabilityVolunteerId) return;
                        setBusy(true);
                        try {
                          await api(`/api/months/${monthData.month.id}/availabilities`, {
                            method: "POST",
                            body: JSON.stringify({ volunteerId: availabilityVolunteerId, startTime, endTime }),
                          });
                          await loadSelectedMonth();
                          setFeedback("Disponibilité ajoutée.");
                        } catch (value) {
                          setError(getError(value).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      onDeleteRange={async (availabilityId) => {
                        setBusy(true);
                        try {
                          await api(`/api/availabilities/${availabilityId}`, {
                            method: "DELETE",
                          });
                          await loadSelectedMonth();
                          setFeedback("Disponibilité supprimée.");
                        } catch (value) {
                          setError(getError(value).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </CardContent>
                </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Éditeur des gardes</CardTitle>
                  <CardDescription>Ajout d&apos;une garde simple ou d&apos;un binôme sur la même plage</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {editingTimelineSegment && (
                    <div className="flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                      <span>
                        Édition directe: {formatDateTime(new Date(editingTimelineSegment.startTime))} -{" "}
                        {formatDateTime(new Date(editingTimelineSegment.endTime))}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingTimelineSegment(null);
                          setFeedback("Mode édition directe fermé.");
                        }}
                      >
                        Fermer
                      </Button>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-[220px_220px_1fr_1fr_180px_auto]">
                    <div>
                      <Label>Ambulancier 1</Label>
                      <Select
                        data-testid="new-assignment-volunteer"
                        value={newAssignmentVolunteerId}
                        onChange={(event) => setNewAssignmentVolunteerId(event.target.value)}
                      >
                        <option value="">Choisir</option>
                        {volunteers.map((volunteer) => (
                          <option key={volunteer.id} value={volunteer.id}>
                            {volunteer.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Ambulancier 2</Label>
                      <Select
                        data-testid="new-assignment-volunteer-2"
                        value={newAssignmentSecondVolunteerId}
                        onChange={(event) => setNewAssignmentSecondVolunteerId(event.target.value)}
                      >
                        <option value="">Aucun</option>
                        {volunteers
                          .filter((volunteer) => volunteer.id !== newAssignmentVolunteerId)
                          .map((volunteer) => (
                            <option key={volunteer.id} value={volunteer.id}>
                              {volunteer.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Début</Label>
                      <Input
                        data-testid="new-assignment-start"
                        type="datetime-local"
                        value={newAssignmentStart}
                        onChange={(event) => setNewAssignmentStart(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Fin</Label>
                      <Input
                        data-testid="new-assignment-end"
                        type="datetime-local"
                        value={newAssignmentEnd}
                        onChange={(event) => setNewAssignmentEnd(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Statut</Label>
                      <Select
                        data-testid="new-assignment-status"
                        value={newAssignmentStatus}
                        onChange={(event) => setNewAssignmentStatus(event.target.value as "CONFIRMED" | "PROVISIONAL")}
                      >
                        <option value="CONFIRMED">Confirmée</option>
                        <option value="PROVISIONAL">Provisoire</option>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        data-testid="add-assignment"
                        className="w-full"
                        onClick={async () => {
                          const volunteerIds = [newAssignmentVolunteerId, newAssignmentSecondVolunteerId].filter(Boolean);

                          if (volunteerIds.length === 0) {
                            setError("Sélectionnez au moins un ambulancier.");
                            return;
                          }

                          if (new Set(volunteerIds).size !== volunteerIds.length) {
                            setError("Choisissez deux ambulanciers différents pour une garde en binôme.");
                            return;
                          }

                          setBusy(true);
                          try {
                            const startTime = new Date(newAssignmentStart).toISOString();
                            const endTime = new Date(newAssignmentEnd).toISOString();

                            if (editingTimelineSegment) {
                              await syncEditedSegment({
                                volunteerIds,
                                startTime,
                                endTime,
                                status: newAssignmentStatus,
                              });
                            } else {
                              await createAssignments({
                                volunteerIds,
                                startTime,
                                endTime,
                                status: newAssignmentStatus,
                              });
                            }

                            await loadSelectedMonth();
                            setEditingTimelineSegment(null);
                            setFeedback(
                              editingTimelineSegment
                                ? "Plage mise à jour."
                                : volunteerIds.length === 2
                                  ? "Binôme ajouté."
                                  : "Garde ajoutée.",
                            );
                          } catch (value) {
                            setError(getError(value).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {editingTimelineSegment ? "Enregistrer la plage" : "Ajouter"}
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                    <Table>
                      <thead>
                        <tr>
                          <TableHead>Volontaire</TableHead>
                          <TableHead>Début</TableHead>
                          <TableHead>Fin</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead>Actions</TableHead>
                        </tr>
                      </thead>
                      <tbody>
                        {monthData.month.assignments.map((assignment) => (
                          <AssignmentRow
                            key={assignment.id}
                            assignment={assignment}
                            volunteers={volunteers}
                            onSave={(payload) => {
                              void createOrUpdateAssignment({
                                url: `/api/assignments/${payload.id}`,
                                method: "PATCH",
                                payload: {
                                  volunteerId: payload.volunteerId,
                                  startTime: new Date(payload.startTime).toISOString(),
                                  endTime: new Date(payload.endTime).toISOString(),
                                  status: payload.status,
                                },
                              })
                                .then(() => loadSelectedMonth())
                                .then(() => setFeedback("Garde modifiée."))
                                .catch((value) => setError(getError(value).message));
                            }}
                            onDelete={(id) => {
                              void api(`/api/assignments/${id}`, {
                                method: "DELETE",
                              })
                                .then(() => loadSelectedMonth())
                                .then(() => setFeedback("Garde supprimée."))
                                .catch((value) => setError(getError(value).message));
                            }}
                          />
                        ))}
                        {monthData.month.assignments.length === 0 && (
                          <tr>
                            <TableCell colSpan={5} className="text-center text-slate-500">
                              Aucune garde.
                            </TableCell>
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-700">Blocs Salarié</p>
                    <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <Input
                        type="datetime-local"
                        value={newEmployeeStart}
                        onChange={(event) => setNewEmployeeStart(event.target.value)}
                      />
                      <Input
                        type="datetime-local"
                        value={newEmployeeEnd}
                        onChange={(event) => setNewEmployeeEnd(event.target.value)}
                      />
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await api(`/api/months/${monthData.month.id}/employee-blocks`, {
                              method: "POST",
                              body: JSON.stringify({
                                mode: "manual",
                                startTime: new Date(newEmployeeStart).toISOString(),
                                endTime: new Date(newEmployeeEnd).toISOString(),
                              }),
                            });
                            await loadSelectedMonth();
                            setFeedback("Bloc Salarié ajouté.");
                          } catch (value) {
                            setError(getError(value).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Ajouter bloc
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {monthData.month.employeeBlocks.map((block) => (
                        <button
                          key={block.id}
                          type="button"
                          className="rounded-md border border-slate-400 bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api(`/api/employee-blocks/${block.id}`, {
                                method: "DELETE",
                              });
                              await loadSelectedMonth();
                              setFeedback("Bloc Salarié supprimé.");
                            } catch (value) {
                              setError(getError(value).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {formatDateTime(new Date(block.startTime))} - {formatDateTime(new Date(block.endTime))}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
                </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Planning mensuel</CardTitle>
                  <CardDescription>
                    Chaque jour est affiché sur deux lignes de couverture. Cliquez un bloc pour le reprendre dans l&apos;éditeur.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid max-w-sm grid-cols-[120px_1fr] items-end gap-2">
                    <Label>Filtre volontaire</Label>
                    <Select
                      value={timelineVolunteerFilter}
                      onChange={(event) => setTimelineVolunteerFilter(event.target.value)}
                    >
                      <option value="">Tous</option>
                      {volunteers.map((volunteer) => (
                        <option key={volunteer.id} value={volunteer.id}>
                          {volunteer.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <MonthTimeline
                    dayTimelines={monthData.dayTimelines}
                    volunteerFilterId={timelineVolunteerFilter || undefined}
                    gapSuggestions={gapSuggestions}
                    onSegmentClick={loadSegmentInEditor}
                  />
                </CardContent>
              </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Aide à la couverture</CardTitle>
                  <CardDescription>
                    Noms disponibles par créneau à couvrir, séparés entre couverture complète et partielle. Cliquez un nom pour affecter automatiquement la plage proposée.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {gapSuggestions.length === 0 && <p className="text-sm text-emerald-700">Aucun créneau à couvrir.</p>}
                  {gapSuggestions.slice(0, 40).map((gap) => (
                    <div key={`${gap.startTime}-${gap.endTime}`} className="rounded-md border border-red-300 bg-red-50 p-2">
                      <p className="text-sm font-black text-red-800">
                        {formatDateTime(new Date(gap.startTime))} - {formatDateTime(new Date(gap.endTime))}: couverture incomplète, {gap.missingCount} personne{gap.missingCount > 1 ? "s" : ""} manquante{gap.missingCount > 1 ? "s" : ""}
                      </p>
                      <div className="mt-2 grid gap-2 lg:grid-cols-2">
                        <div className="rounded-md border border-emerald-200 bg-white/80 p-2">
                          <p className="text-xs font-black uppercase tracking-wide text-emerald-800">Couvre tout le créneau</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {gap.fullCoverageSuggestions.map((suggestion) => (
                              <button
                                key={`${gap.startTime}-${gap.endTime}-full-${suggestion.id}`}
                                type="button"
                                data-testid={`gap-full-${suggestion.id}`}
                                className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={busy}
                                onClick={() => void assignSuggestedVolunteer(suggestion)}
                              >
                                <span
                                  className="h-2.5 w-2.5 rounded-full border border-black/10"
                                  style={{ backgroundColor: suggestion.color }}
                                />
                                <span>{suggestion.name}</span>
                                <span className="text-[11px] font-medium text-emerald-700">
                                  {suggestion.currentGuards}
                                  {suggestion.limit ? `/${suggestion.limit}` : ""}
                                </span>
                              </button>
                            ))}
                            {gap.fullCoverageSuggestions.length === 0 && (
                              <p className="text-xs text-slate-600">Aucun volontaire ne couvre l&apos;intégralité du créneau.</p>
                            )}
                          </div>
                        </div>

                        <div className="rounded-md border border-amber-200 bg-white/80 p-2">
                          <p className="text-xs font-black uppercase tracking-wide text-amber-800">Couvre partiellement</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {gap.partialCoverageSuggestions.map((suggestion) => (
                              <button
                                key={`${gap.startTime}-${gap.endTime}-partial-${suggestion.id}`}
                                type="button"
                                data-testid={`gap-partial-${suggestion.id}`}
                                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1 text-left text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={busy}
                                onClick={() => void assignSuggestedVolunteer(suggestion)}
                              >
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                                  style={{ backgroundColor: suggestion.color }}
                                />
                                <span>
                                  {suggestion.name}
                                  <span className="ml-1 text-[11px] font-medium text-amber-700">
                                    {formatHour(new Date(suggestion.startTime))} - {formatHour(new Date(suggestion.endTime))} ({formatDurationLabel(suggestion.durationMinutes)})
                                  </span>
                                </span>
                              </button>
                            ))}
                            {gap.partialCoverageSuggestions.length === 0 && (
                              <p className="text-xs text-slate-600">Aucune couverture partielle exploitable.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
                </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Notes & Historique</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    placeholder="Note opérationnelle"
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (!newNote.trim()) return;
                      setBusy(true);
                      try {
                        await api(`/api/months/${monthData.month.id}/notes`, {
                          method: "POST",
                          body: JSON.stringify({ body: newNote }),
                        });
                        setNewNote("");
                        await loadSelectedMonth();
                        setFeedback("Note ajoutée.");
                      } catch (value) {
                        setError(getError(value).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Ajouter note
                  </Button>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="max-h-60 overflow-auto rounded-md border border-slate-200">
                      {monthData.month.notes.map((note) => (
                        <div key={note.id} className="border-b border-slate-100 p-2">
                          <p className="text-xs font-semibold text-slate-500">{formatDateTime(new Date(note.createdAt))}</p>
                          <p className="text-sm text-slate-800">{note.body}</p>
                        </div>
                      ))}
                      {monthData.month.notes.length === 0 && <p className="p-3 text-sm text-slate-500">Aucune note.</p>}
                    </div>

                    <div className="max-h-60 overflow-auto rounded-md border border-slate-200">
                      {monthData.month.assignmentEvents.map((event) => (
                        <div key={event.id} className="border-b border-slate-100 p-2">
                          <p className="text-xs font-semibold text-slate-500">{formatDateTime(new Date(event.createdAt))}</p>
                          <p className="text-sm font-semibold text-slate-800">{event.eventType}</p>
                        </div>
                      ))}
                      {monthData.month.assignmentEvents.length === 0 && (
                        <p className="p-3 text-sm text-slate-500">Aucun événement.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
