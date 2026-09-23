import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, Download, Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import {
  DAY_NAMES,
  appointmentStats,
  appointmentsOn,
  doctorsOnDuty,
  nextTokenNo,
  rosterList,
  sortByDateDesc,
  upcomingAppointments,
} from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  DEPARTMENTS,
  type Appointment,
  type AppointmentStatus,
  type DoctorSchedule,
} from "@/lib/hms/types";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Td,
  Textarea,
} from "@/components/hms/ui";
import { PatientPicker, confirmDelete } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [
      { title: "Appointments — KEGH HMS" },
      {
        name: "description",
        content:
          "Book appointments against the weekly doctor roster, issue OPD tokens and track the day.",
      },
      { property: "og:title", content: "Appointments — KEGH HMS" },
      {
        property: "og:description",
        content: "Book appointments, issue OPD tokens and manage the doctor roster — KEGH HMS.",
      },
    ],
  }),
  component: AppointmentsPage,
});

type View = "day" | "upcoming" | "all";

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const blank = (): Partial<Appointment> => ({
  patientId: "",
  date: todayISO(),
  time: "09:00",
  doctor: "",
  department: "",
  type: "OPD",
  status: "Scheduled",
  notes: "",
});

/** Roster defaults: Mon–Fri, active. */
const blankSchedule = (): Partial<DoctorSchedule> => ({
  doctor: "",
  department: "",
  days: [1, 2, 3, 4, 5],
  slots: "",
  active: true,
});

function statusTone(s: AppointmentStatus): "green" | "amber" | "red" | "neutral" {
  if (s === "Completed" || s === "Confirmed") return "green";
  if (s === "Scheduled" || s === "CheckedIn") return "amber";
  if (s === "Cancelled" || s === "NoShow") return "red";
  return "neutral";
}

/** "Daily", or the short weekday names in calendar order. */
function daysLabel(days: number[] | undefined): string {
  if (!days || days.length === 0) return "—";
  if (days.length === 7) return "Daily";
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d] ?? "")
    .join(" ");
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function AppointmentsPage() {
  const { state, settings, upsert, remove } = useHms();
  const today = todayISO();

  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [filterDoctor, setFilterDoctor] = useState("");
  const [filterStatus, setFilterStatus] = useState<AppointmentStatus | "All">("All");
  const [q, setQ] = useState("");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Appointment>>(blank);
  const [error, setError] = useState("");

  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterForm, setRosterForm] = useState<Partial<DoctorSchedule>>(blankSchedule);

  const all = useMemo(() => Object.values(state.appointments ?? {}), [state.appointments]);
  const roster = useMemo(() => rosterList(state), [state]);
  const dayStats = useMemo(() => appointmentStats(appointmentsOn(state, date)), [state, date]);

  /** Rows for the active view, before the doctor / status / search filters. */
  const viewRows = useMemo(() => {
    if (view === "day") return appointmentsOn(state, date);
    if (view === "upcoming") return upcomingAppointments(state, today);
    return sortByDateDesc(all);
  }, [state, view, date, today, all]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return viewRows.filter((a) => {
      if (filterDoctor && a.doctor !== filterDoctor) return false;
      if (filterStatus !== "All" && a.status !== filterStatus) return false;
      if (!s) return true;
      return [state.patients[a.patientId]?.name ?? "", a.doctor ?? "", a.department ?? ""].some(
        (v) => v.toLowerCase().includes(s),
      );
    });
  }, [viewRows, filterDoctor, filterStatus, q, state.patients]);

  /** Doctors known to the filter dropdown. */
  const doctorOptions = useMemo(() => {
    const set = new Set<string>();
    (settings.doctors ?? []).forEach((d) => d && set.add(d));
    Object.values(state.doctorSchedules ?? {}).forEach((s) => s.doctor && set.add(s.doctor));
    all.forEach((a) => a.doctor && set.add(a.doctor));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [settings.doctors, state.doctorSchedules, all]);

  /** Roster doctors on duty for the day chosen in the booking form. */
  const onDuty = useMemo(() => doctorsOnDuty(state, form.date ?? ""), [state, form.date]);
  const offRoster =
    Boolean(form.doctor) &&
    !onDuty.some((s) => s.doctor.trim().toLowerCase() === (form.doctor ?? "").trim().toLowerCase());

  const set = (k: keyof Appointment, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.date) {
      toast.error("Appointment date is required");
      return;
    }
    const clash = all.find(
      (a) =>
        a.id !== form.id &&
        a.doctor === form.doctor &&
        a.date === form.date &&
        (a.time || "") === (form.time || "") &&
        a.status !== "Cancelled" &&
        a.status !== "NoShow",
    );
    if (form.doctor && form.time && clash) {
      setError(
        `${form.doctor} already has an appointment at ${form.time} on ${fmtDate(form.date)} — pick another slot.`,
      );
      return;
    }
    upsert<Appointment>("appointments", {
      ...form,
      notes: form.notes?.trim() ?? "",
    } as Appointment);
    toast.success(form.id ? "Appointment updated" : "Appointment booked");
    setOpen(false);
  };

  const openNew = () => {
    setForm({ ...blank(), date: view === "day" ? date : todayISO() });
    setError("");
    setOpen(true);
  };

  const checkIn = (a: Appointment) => {
    const token = nextTokenNo(state, a.date);
    upsert<Appointment>("appointments", {
      ...a,
      status: "CheckedIn",
      tokenNo: token,
      tokenTime: hhmmNow(),
    });
    toast.success(`Token ${token} issued to ${state.patients[a.patientId]?.name ?? "patient"}`);
  };

  const saveSchedule = () => {
    if (!rosterForm.doctor?.trim()) {
      toast.error("Choose the doctor");
      return;
    }
    if (!rosterForm.days || rosterForm.days.length === 0) {
      toast.error("Select at least one weekday");
      return;
    }
    upsert<DoctorSchedule>("doctorSchedules", {
      ...rosterForm,
      doctor: rosterForm.doctor.trim(),
      department: rosterForm.department?.trim() ?? "",
      slots: rosterForm.slots?.trim() ?? "",
      days: [...rosterForm.days].sort((a, b) => a - b),
      active: rosterForm.active !== false,
    } as DoctorSchedule);
    toast.success(rosterForm.id ? "Roster updated" : "Availability added");
    setRosterOpen(false);
  };

  const toggleDay = (day: number) => {
    setRosterForm((f) => {
      const days = f.days ?? [];
      return {
        ...f,
        days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
      };
    });
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const out: (string | number)[][] = [
      [
        "Date",
        "Time",
        "Token",
        "CheckedInAt",
        "Patient",
        "MRN",
        "Doctor",
        "Department",
        "Type",
        "Status",
        "Notes",
      ],
    ];
    for (const a of rows) {
      const p = state.patients[a.patientId];
      out.push([
        a.date,
        a.time || "",
        a.tokenNo ?? "",
        a.tokenTime ?? "",
        p?.name ?? "",
        p?.mrn ?? "",
        a.doctor ?? "",
        a.department ?? "",
        a.type,
        a.status,
        a.notes ?? "",
      ]);
    }
    const suffix = view === "day" ? date : view;
    downloadCsv(`appointments-${suffix}.csv`, out);
  };

  const subtitle =
    view === "day"
      ? `${fmtDate(date)} · ${rows.length} appointment${rows.length === 1 ? "" : "s"}`
      : view === "upcoming"
        ? `${rows.length} open appointment${rows.length === 1 ? "" : "s"} from today onward`
        : `${rows.length} appointment${rows.length === 1 ? "" : "s"} in total`;

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle={subtitle}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> New appointment
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {(
            [
              ["day", "One day"],
              ["upcoming", "Upcoming"],
              ["all", "All"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                view === v
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "day" ? (
          <Field label="Date" className="w-44">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        ) : null}
      </div>

      {view === "day" ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={`Booked · ${fmtDate(date)}`} value={dayStats.total} />
          <Stat label="Confirmed" value={dayStats.confirmed} />
          <Stat label="Waiting" value={dayStats.checkedIn} />
          <Stat label="Completed" value={dayStats.completed} />
          <Stat label="Cancelled" value={dayStats.cancelled} />
          <Stat label="Tokens issued" value={dayStats.tokens} />
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Doctor">
          <Select value={filterDoctor} onChange={(e) => setFilterDoctor(e.target.value)}>
            <option value="">All doctors</option>
            {doctorOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as AppointmentStatus | "All")}
          >
            <option value="All">All statuses</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search">
          <Input
            placeholder="Patient, doctor or department…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
      </div>

      <DataTable
        columns={[
          "Date",
          "Time",
          "Token",
          "Patient",
          "Doctor",
          "Department",
          "Type",
          "Status",
          "Notes",
          "",
        ]}
        rowCount={rows.length}
        empty={
          view === "day"
            ? `Nothing booked on ${fmtDate(date)}.`
            : view === "upcoming"
              ? "No open appointments from today onward."
              : "No appointments booked yet."
        }
      >
        {rows.map((a) => (
          <tr key={a.id}>
            <Td className="whitespace-nowrap">{fmtDate(a.date)}</Td>
            <Td>{a.time || "—"}</Td>
            <Td>{a.tokenNo ? <Badge tone="neutral">{a.tokenNo}</Badge> : "—"}</Td>
            <Td>
              <Link
                to="/patients/$patientId"
                params={{ patientId: a.patientId }}
                className="text-accent underline"
              >
                {state.patients[a.patientId]?.name ?? "—"}
              </Link>
            </Td>
            <Td>{a.doctor || "—"}</Td>
            <Td>{a.department || "—"}</Td>
            <Td>
              <Badge tone={a.type === "IPD" ? "amber" : "neutral"}>{a.type}</Badge>
            </Td>
            <Td>
              <Badge tone={statusTone(a.status)}>{a.status}</Badge>
            </Td>
            <Td className="max-w-40 truncate">{a.notes || "—"}</Td>
            <Td className="whitespace-nowrap">
              <div className="flex flex-wrap items-center gap-1">
                {a.status === "Scheduled" || a.status === "Confirmed" ? (
                  <button
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => checkIn(a)}
                  >
                    <UserCheck className="h-3 w-3" /> Check in
                  </button>
                ) : null}
                {a.status === "Scheduled" ||
                a.status === "Confirmed" ||
                a.status === "CheckedIn" ? (
                  <>
                    <button
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      onClick={() => {
                        upsert<Appointment>("appointments", { ...a, status: "Completed" });
                        toast.success("Marked completed");
                      }}
                    >
                      Complete
                    </button>
                    <button
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      onClick={() => {
                        upsert<Appointment>("appointments", { ...a, status: "Cancelled" });
                        toast.success("Appointment cancelled");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setForm(a);
                    setError("");
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirmDelete("this appointment")) {
                      remove("appointments", a.id);
                      toast.success("Appointment deleted");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Td>
          </tr>
        ))}
      </DataTable>

      {/* Weekly doctor availability roster */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Weekly availability roster
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Which doctors sit on which weekdays. The booking form uses this to suggest who is on
              duty and to warn when a booking falls outside the roster.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setRosterForm(blankSchedule());
              setRosterOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add availability
          </Button>
        </div>
        {roster.length === 0 ? (
          <Card>
            <p className="py-4 text-center text-sm text-muted-foreground">
              No roster entries yet. Add each doctor&rsquo;s weekly OPD days so Reception books
              against real availability and the queue knows who is on duty.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{s.doctor}</p>
                    <p className="text-sm text-muted-foreground">{s.department || "—"}</p>
                  </div>
                  <Badge tone={s.active === false ? "neutral" : "green"}>
                    {s.active === false ? "Paused" : "Active"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-foreground">{daysLabel(s.days)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.slots || "No slots noted"}
                </p>
                <div className="mt-3 flex gap-3 text-xs">
                  <button
                    className="text-accent underline"
                    onClick={() => {
                      setRosterForm(s);
                      setRosterOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-destructive underline"
                    onClick={() => {
                      if (confirmDelete(`availability for ${s.doctor}`)) {
                        remove("doctorSchedules", s.id);
                        toast.success("Roster entry removed");
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Booking modal */}
      <Modal
        open={open}
        title={form.id ? "Edit appointment" : "Book appointment"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker value={form.patientId ?? ""} onChange={(id) => set("patientId", id)} />
          </Field>
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="Time">
            <Input
              type="time"
              value={form.time ?? ""}
              onChange={(e) => set("time", e.target.value)}
            />
          </Field>
          <Field label="Doctor" className="sm:col-span-2">
            <DoctorSelect value={form.doctor ?? ""} onChange={(d) => set("doctor", d)} />
          </Field>
          {form.date ? (
            <div
              className={`sm:col-span-2 rounded-md px-3 py-2 text-xs ${
                onDuty.length === 0
                  ? "bg-muted text-muted-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
              <span className="font-medium">
                On duty on {DAY_NAMES[new Date(`${form.date}T00:00:00`).getDay()] ?? ""}:
              </span>{" "}
              {onDuty.length === 0
                ? "nobody is rostered — add weekly availability below."
                : onDuty.map((s) => s.doctor + (s.slots ? ` (${s.slots})` : "")).join(", ")}
              {offRoster ? (
                <p className="mt-1 font-medium text-amber-700">
                  {form.doctor} is not rostered on this day.
                </p>
              ) : null}
            </div>
          ) : null}
          <Field label="Department">
            <Input
              list="appointment-departments"
              value={form.department ?? ""}
              placeholder="OPD"
              onChange={(e) => set("department", e.target.value)}
            />
          </Field>
          <Field label="Type">
            <Select value={form.type ?? "OPD"} onChange={(e) => set("type", e.target.value)}>
              {form.type && !APPOINTMENT_TYPES.includes(form.type) ? (
                <option value={form.type}>{form.type}</option>
              ) : null}
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={form.status ?? "Scheduled"}
              onChange={(e) => set("status", e.target.value)}
            >
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              value={form.notes ?? ""}
              placeholder="Reason for visit, instructions…"
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{form.id ? "Save appointment" : "Book appointment"}</Button>
        </div>
      </Modal>

      {/* Roster entry modal */}
      <Modal
        open={rosterOpen}
        title={rosterForm.id ? "Edit availability" : "Add availability"}
        onClose={() => setRosterOpen(false)}
      >
        <div className="grid gap-4">
          <Field label="Doctor" required>
            <DoctorSelect
              value={rosterForm.doctor ?? ""}
              onChange={(d) => setRosterForm((f) => ({ ...f, doctor: d }))}
            />
          </Field>
          <Field label="Department">
            <Input
              list="appointment-departments"
              value={rosterForm.department ?? ""}
              placeholder="OPD"
              onChange={(e) => setRosterForm((f) => ({ ...f, department: e.target.value }))}
            />
          </Field>
          <Field label="Working days" required>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((name, d) => {
                const on = (rosterForm.days ?? []).includes(d);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
                      on
                        ? "bg-primary text-primary-foreground ring-primary"
                        : "bg-card text-muted-foreground ring-border hover:bg-muted"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Time slots">
            <Input
              value={rosterForm.slots ?? ""}
              placeholder="09:00-13:00, 17:00-20:00"
              onChange={(e) => setRosterForm((f) => ({ ...f, slots: e.target.value }))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={rosterForm.active !== false}
              onChange={(e) => setRosterForm((f) => ({ ...f, active: e.target.checked }))}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Active — paused entries stay visible but stop suggesting the doctor.
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRosterOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveSchedule}>
            {rosterForm.id ? "Save roster" : "Add availability"}
          </Button>
        </div>
      </Modal>

      <datalist id="appointment-departments">
        {DEPARTMENTS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}
