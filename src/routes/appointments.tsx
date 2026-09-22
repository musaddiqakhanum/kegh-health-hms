import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { WEEKDAY_SHORT, doctorsAvailableOn, sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  DoctorSchedule,
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

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [
      { title: "Appointments — KEGH HMS" },
      {
        name: "description",
        content:
          "Schedule, confirm and track patient appointments with doctor roster and department.",
      },
      { property: "og:title", content: "Appointments — KEGH HMS" },
      {
        property: "og:description",
        content: "Schedule and manage patient appointments — KEGH Health Records.",
      },
    ],
  }),
  component: AppointmentsPage,
});

const TYPES: AppointmentType[] = ["OPD", "Follow-up", "Consultation", "IPD", "Emergency"];
const STATUSES: AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "Completed",
  "Cancelled",
  "NoShow",
];
/** Monday-first ordering for the roster UI (JS day numbers). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

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

const blankSchedule = (): Partial<DoctorSchedule> => ({
  doctor: "",
  department: "",
  days: [1, 2, 3, 4, 5, 6],
  slots: "",
  active: true,
});

function statusTone(s: AppointmentStatus): "green" | "amber" | "red" | "neutral" {
  if (s === "Completed" || s === "Confirmed") return "green";
  if (s === "Scheduled" || s === "CheckedIn") return "amber";
  if (s === "Cancelled" || s === "NoShow") return "red";
  return "neutral";
}

function daysLabel(days: number[] | undefined): string {
  if (!days || days.length === 0) return "—";
  if (days.length === 7) return "Daily";
  return [...days]
    .sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
    .map((d) => WEEKDAY_SHORT[d])
    .join(" ");
}

function AppointmentsPage() {
  const { state, settings, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Appointment>>(blank);
  const [showCustomDoctor, setShowCustomDoctor] = useState(false);
  const [filterStatus, setFilterStatus] = useState<AppointmentStatus | "All">("All");
  const [filterDate, setFilterDate] = useState("");
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterForm, setRosterForm] = useState<Partial<DoctorSchedule>>(blankSchedule);

  const schedules = useMemo(
    () => Object.values(state.doctorSchedules ?? {}),
    [state.doctorSchedules],
  );

  const rows = useMemo(() => {
    let list = sortByDateDesc(
      Object.values(state.appointments ?? {}) as (Appointment & {
        date: string;
        createdAt: number;
      })[],
    );
    if (filterStatus !== "All") list = list.filter((a) => a.status === filterStatus);
    if (filterDate) list = list.filter((a) => a.date === filterDate);
    // Sort by date+time desc, but keep time ordering within same date
    return [...list].sort((a, b) => {
      const da = `${a.date}T${a.time || "00:00"}`;
      const db = `${b.date}T${b.time || "00:00"}`;
      return db.localeCompare(da) || b.createdAt - a.createdAt;
    });
  }, [state.appointments, filterStatus, filterDate]);

  const set = (k: keyof Appointment, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /** Roster doctors available on the selected appointment day. */
  const available = useMemo(
    () => doctorsAvailableOn(schedules, form.date ?? ""),
    [schedules, form.date],
  );
  const isCustomDoctor = Boolean(form.doctor) && !available.some((s) => s.doctor === form.doctor);

  const pickRosterDoctor = (value: string) => {
    if (value === "__custom") {
      setShowCustomDoctor(true);
      setForm((f) => ({ ...f, doctor: "" }));
      return;
    }
    setShowCustomDoctor(false);
    const match = available.find((s) => s.doctor === value);
    setForm((f) => ({
      ...f,
      doctor: value,
      department: match?.department ?? f.department ?? "",
    }));
  };

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.date) {
      toast.error("Appointment date is required");
      return;
    }
    upsert<Appointment>("appointments", form as Appointment);
    toast.success(form.id ? "Appointment updated" : "Appointment scheduled");
    setOpen(false);
  };

  const saveSchedule = () => {
    if (!rosterForm.doctor?.trim()) {
      toast.error("Doctor name is required");
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
      active: rosterForm.active !== false,
    } as DoctorSchedule);
    toast.success(rosterForm.id ? "Roster updated" : "Roster added");
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

  const today = todayISO();
  const todayCount = Object.values(state.appointments ?? {}).filter((a) => a.date === today).length;
  const canManageRoster = settings.role === "Admin" || settings.role === "Reception";

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle={`${rows.length} appointment${rows.length === 1 ? "" : "s"}${todayCount ? ` · ${todayCount} today` : ""}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setShowCustomDoctor(false);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New appointment
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Filter by status">
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as AppointmentStatus | "All")}
          >
            <option value="All">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Filter by date">
          <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
        </Field>
        <div className="flex items-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setFilterStatus("All");
              setFilterDate("");
            }}
          >
            Clear filters
          </Button>
          <Button variant="ghost" onClick={() => setFilterDate(today)}>
            <CalendarDays className="h-4 w-4" /> Today
          </Button>
        </div>
      </div>

      <DataTable
        columns={["Date", "Time", "Patient", "Doctor", "Dept", "Type", "Status", ""]}
        rowCount={rows.length}
      >
        {rows.map((a) => (
          <tr key={a.id}>
            <Td>{fmtDate(a.date)}</Td>
            <Td>{a.time || "—"}</Td>
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
              <Badge tone={a.type === "Emergency" ? "red" : a.type === "IPD" ? "amber" : "neutral"}>
                {a.type}
              </Badge>
            </Td>
            <Td>
              <Badge tone={statusTone(a.status)}>{a.status}</Badge>
            </Td>
            <Td className="whitespace-nowrap">
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(a);
                  setShowCustomDoctor(false);
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
            </Td>
          </tr>
        ))}
      </DataTable>

      {/* Weekly doctor roster */}
      <Card className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Doctor roster — weekly availability
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The appointment form only lists doctors who are on roster for the chosen day.
            </p>
          </div>
          {canManageRoster ? (
            <Button
              variant="outline"
              onClick={() => {
                setRosterForm(blankSchedule());
                setRosterOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add availability
            </Button>
          ) : null}
        </div>
        {schedules.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No roster entries yet.
            {canManageRoster
              ? " Add weekly availability so Reception can book against real OPD days."
              : ""}
          </p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-md ring-1 ring-border/60">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr>
                  {["Doctor", "Department", "Days", "Time slots", "Status", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
                {[...schedules]
                  .sort((a, b) => a.doctor.localeCompare(b.doctor))
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium">{s.doctor}</td>
                      <td className="px-3 py-2">{s.department || "—"}</td>
                      <td className="px-3 py-2">{daysLabel(s.days)}</td>
                      <td className="px-3 py-2">{s.slots || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge tone={s.active === false ? "neutral" : "green"}>
                          {s.active === false ? "Inactive" : "Active"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {canManageRoster ? (
                          <>
                            <button
                              className="mr-2 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setRosterForm(s);
                                setRosterOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                if (confirmDelete(`roster for ${s.doctor}`)) {
                                  remove("doctorSchedules", s.id);
                                  toast.success("Roster entry deleted");
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title={form.id ? "Edit appointment" : "Schedule appointment"}
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
          <Field
            label={`Doctor${form.date ? ` — ${available.length} on roster` : ""}`}
            {...(showCustomDoctor || isCustomDoctor ? {} : { className: "sm:col-span-2" })}
          >
            <Select
              value={showCustomDoctor || isCustomDoctor ? "__custom" : (form.doctor ?? "")}
              onChange={(e) => pickRosterDoctor(e.target.value)}
            >
              <option value="">Select doctor…</option>
              {available.map((s) => (
                <option key={s.id} value={s.doctor}>
                  {s.doctor}
                  {s.department ? ` · ${s.department}` : ""}
                  {s.slots ? ` (${s.slots})` : ""}
                </option>
              ))}
              <option value="__custom">Other / not on roster…</option>
            </Select>
            {form.date && available.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No doctors on roster for this day — choose “Other” or add availability below.
              </p>
            ) : null}
          </Field>
          {showCustomDoctor || isCustomDoctor ? (
            <Field label="Other doctor name">
              <Input
                value={form.doctor ?? ""}
                onChange={(e) => set("doctor", e.target.value)}
                placeholder="Dr. Name"
              />
            </Field>
          ) : null}
          <Field label="Department">
            <Input
              value={form.department ?? ""}
              onChange={(e) => set("department", e.target.value)}
              placeholder="General Medicine"
            />
          </Field>
          <Field label="Type">
            <Select value={form.type ?? "OPD"} onChange={(e) => set("type", e.target.value)}>
              {TYPES.map((t) => (
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
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Reason for visit, instructions..."
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save appointment</Button>
        </div>
      </Modal>

      <Modal
        open={rosterOpen}
        title={rosterForm.id ? "Edit roster entry" : "Add doctor availability"}
        onClose={() => setRosterOpen(false)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Doctor" required>
            <Input
              value={rosterForm.doctor ?? ""}
              placeholder="Dr. Name"
              onChange={(e) => setRosterForm((f) => ({ ...f, doctor: e.target.value }))}
            />
          </Field>
          <Field label="Department">
            <Input
              value={rosterForm.department ?? ""}
              placeholder="General Medicine"
              onChange={(e) => setRosterForm((f) => ({ ...f, department: e.target.value }))}
            />
          </Field>
          <Field label="Available days" required className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {WEEK_ORDER.map((d) => {
                const on = (rosterForm.days ?? []).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
                      on
                        ? "bg-primary text-primary-foreground ring-primary"
                        : "bg-card text-muted-foreground ring-border hover:bg-muted"
                    }`}
                  >
                    {WEEKDAY_SHORT[d]}
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
          <Field label="Status">
            <Select
              value={rosterForm.active === false ? "inactive" : "active"}
              onChange={(e) =>
                setRosterForm((f) => ({ ...f, active: e.target.value === "active" }))
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRosterOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveSchedule}>Save roster</Button>
        </div>
      </Modal>
    </div>
  );
}
