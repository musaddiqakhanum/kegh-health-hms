import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type { Appointment, AppointmentStatus, AppointmentType } from "@/lib/hms/types";
import {
  Badge,
  Button,
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
        content: "Schedule, confirm and track patient appointments with doctor and department.",
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

function statusTone(s: AppointmentStatus): "green" | "amber" | "red" | "neutral" {
  if (s === "Completed" || s === "Confirmed") return "green";
  if (s === "Scheduled" || s === "CheckedIn") return "amber";
  if (s === "Cancelled" || s === "NoShow") return "red";
  return "neutral";
}

function AppointmentsPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Appointment>>(blank);
  const [filterStatus, setFilterStatus] = useState<AppointmentStatus | "All">("All");
  const [filterDate, setFilterDate] = useState("");

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

  const today = todayISO();
  const todayCount = Object.values(state.appointments ?? {}).filter((a) => a.date === today).length;

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle={`${rows.length} appointment${rows.length === 1 ? "" : "s"}${todayCount ? ` · ${todayCount} today` : ""}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
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
          <Field label="Doctor">
            <Input
              value={form.doctor ?? ""}
              onChange={(e) => set("doctor", e.target.value)}
              placeholder="Dr. Name"
            />
          </Field>
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
    </div>
  );
}
