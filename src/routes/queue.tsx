import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { CheckCircle2, FileText, RefreshCcw, SkipForward, UserCheck } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { todaysQueue } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type { Appointment } from "@/lib/hms/types";
import { Badge, Button, Card, PageHeader } from "@/components/hms/ui";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "OPD Token Queue — KEGH HMS" },
      {
        name: "description",
        content: "Daily OPD token queue derived from today's confirmed appointments.",
      },
      { property: "og:title", content: "OPD Token Queue — KEGH HMS" },
      {
        property: "og:description",
        content: "Daily OPD token queue with next, skip and complete actions.",
      },
    ],
  }),
  component: QueuePage,
});

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusTone(s: Appointment["status"]): "green" | "amber" | "red" | "neutral" {
  if (s === "Completed" || s === "Confirmed") return "green";
  if (s === "CheckedIn") return "amber";
  if (s === "Cancelled" || s === "NoShow") return "red";
  return "neutral";
}

function QueuePage() {
  const { state, settings, upsert } = useHms();
  const navigate = useNavigate();
  const today = todayISO();

  const queue = useMemo(
    () => todaysQueue(state.appointments ?? {}, today),
    [state.appointments, today],
  );

  const waiting = queue.filter((a) => a.status === "Confirmed" || a.status === "CheckedIn");
  const done = queue.filter(
    (a) => a.status === "Completed" || a.status === "Cancelled" || a.status === "NoShow",
  );

  /** First patient still waiting. */
  const next = waiting.find((a) => a.status === "CheckedIn") ?? waiting[0] ?? null;
  const isDoctor = settings.role === "Doctor";

  const updateAppointment = (a: Appointment, patch: Partial<Appointment>) =>
    upsert<Appointment>("appointments", { ...a, ...patch });

  const checkIn = (a: Appointment) => {
    const idx = queue.findIndex((q) => q.id === a.id);
    const tokenNo = idx >= 0 ? idx + 1 : (a.tokenNo ?? 1);
    updateAppointment(a, { status: "CheckedIn", tokenNo, tokenTime: hhmmNow() });
  };

  const nextPatient = (a: Appointment) => updateAppointment(a, { status: "Completed" });

  const skip = (a: Appointment) => updateAppointment(a, { status: "NoShow" });

  const reopen = (a: Appointment) =>
    updateAppointment(a, { status: "CheckedIn", tokenTime: hhmmNow() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="OPD token queue"
        subtitle={`${fmtDate(today)} · ${waiting.length} waiting · ${queue.length} on today's list`}
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/appointments" })}>
            Manage appointments
          </Button>
        }
      />

      {next ? (
        <Card className="sidebar-gradient text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-white/70">
                Now serving · token {next.tokenNo}
              </p>
              <h2 className="text-xl font-bold">{state.patients[next.patientId]?.name ?? "—"}</h2>
              <p className="mt-1 text-sm text-white/80">
                {next.time || "—"} · {next.doctor || "No doctor"} · {next.type}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {next.status !== "CheckedIn" ? (
                <Button onClick={() => checkIn(next)}>
                  <UserCheck className="h-4 w-4" /> Call next
                </Button>
              ) : (
                <Link
                  to="/visits"
                  className="inline-flex items-center gap-2 rounded-md bg-white/90 px-3.5 py-2 text-sm font-medium text-[#0b3a44]"
                >
                  <FileText className="h-4 w-4" /> Record visit
                </Link>
              )}
              {isDoctor ? (
                <Link
                  to="/prescriptions"
                  className="inline-flex items-center gap-2 rounded-md bg-white/20 px-3.5 py-2 text-sm font-medium text-white"
                >
                  <FileText className="h-4 w-4" /> Prescription
                </Link>
              ) : null}
              <Button
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10"
                onClick={() => skip(next)}
              >
                <SkipForward className="h-4 w-4" /> Skip
              </Button>
              <Button
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10"
                onClick={() => nextPatient(next)}
              >
                <CheckCircle2 className="h-4 w-4" /> Complete
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">
            No patients waiting. Confirm today's appointments (Appointments → status Confirmed) to
            build the queue.
          </p>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Today's queue
          </h3>
          <Badge tone={waiting.length ? "amber" : "neutral"}>{waiting.length} waiting</Badge>
        </div>
        {queue.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Queue is empty — no confirmed appointments today.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((a) => {
              const p = state.patients[a.patientId];
              const isNext = next?.id === a.id;
              return (
                <div
                  key={a.id}
                  className={`flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    isNext ? "bg-secondary ring-1 ring-accent/40" : "bg-muted/40"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      isNext ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                    }`}
                  >
                    {a.tokenNo}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <Link
                        to="/patients/$patientId"
                        params={{ patientId: a.patientId }}
                        className="text-accent underline"
                      >
                        {p?.name ?? "—"}
                      </Link>
                      <span className="text-muted-foreground"> · {p?.mrn ?? "—"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.time || "—"} · {a.doctor || "No doctor"}
                      {a.tokenTime ? ` · checked in ${a.tokenTime}` : ""}
                    </p>
                  </div>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  <div className="flex shrink-0 gap-1">
                    {a.status === "Confirmed" ? (
                      <>
                        <button
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                          onClick={() => checkIn(a)}
                        >
                          Check in
                        </button>
                        <button
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                          onClick={() => skip(a)}
                        >
                          Skip
                        </button>
                      </>
                    ) : a.status === "CheckedIn" ? (
                      <button
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => nextPatient(a)}
                      >
                        Complete
                      </button>
                    ) : a.status === "Completed" ? (
                      <button
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => reopen(a)}
                      >
                        <RefreshCcw className="h-3 w-3" /> Reopen
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {done.length > 0 ? (
        <Card>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Completed / skipped today
          </h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {done.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span>
                  {a.tokenNo}. {state.patients[a.patientId]?.name ?? "—"}
                </span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
