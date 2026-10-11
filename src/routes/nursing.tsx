import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ClipboardList, Download, HeartPulse, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { ageFromDob, fmtDate, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import { admissionsForPatient, stayDays } from "@/lib/hms/ipd";
import {
  filterVitals,
  formatVital,
  nursingStats,
  notesForPatient,
  roundsDue,
  searchNotes,
  shiftForTime,
  sortNotes,
  sortVitals,
  noteList,
  vitalFlags,
  vitalRange,
  validateVitals,
  vitalsList,
  vitalsSeverity,
  wardRounds,
  type VitalKey,
} from "@/lib/hms/nursing";
import {
  NURSING_NOTE_CATEGORIES,
  NURSING_SHIFTS,
  type NursingNote,
  type NursingShift,
  type VitalSeverity,
  type Vitals,
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
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/nursing")({
  validateSearch: (search: Record<string, unknown>) => ({
    patient: (search["patient"] as string) || "",
    admission: (search["admission"] as string) || "",
    tab: (search["tab"] as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Nursing — KEGH HMS" },
      {
        name: "description",
        content:
          "Nursing station — ward vitals rounds, TPR charts with abnormal flags, and nursing progress notes.",
      },
      { property: "og:title", content: "Nursing — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Nursing station — ward vitals rounds, TPR charts with abnormal flags, and nursing progress notes.",
      },
    ],
  }),
  component: NursingPage,
});

type Tab = "rounds" | "vitals" | "notes";

/** Deep links from the IPD page open straight on the tab they asked for. */
function initialTab(tab: string): Tab {
  return tab === "vitals" || tab === "notes" ? tab : "rounds";
}

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const severityTone = (s: VitalSeverity): "green" | "amber" | "red" =>
  s === "critical" ? "red" : s === "abnormal" ? "amber" : "green";

const blankVitals = (): Partial<Vitals> => ({
  patientId: "",
  visitId: "",
  admissionId: "",
  date: todayISO(),
  time: hhmmNow(),
  shift: shiftForTime(hhmmNow()),
  temperature: 0,
  pulse: 0,
  respRate: 0,
  bpSystolic: 0,
  bpDiastolic: 0,
  spo2: 0,
  painScore: undefined,
  weightKg: 0,
  intakeMl: 0,
  outputMl: 0,
  recordedBy: "",
  notes: "",
});

const blankNote = (): Partial<NursingNote> => ({
  patientId: "",
  visitId: "",
  admissionId: "",
  date: todayISO(),
  time: hhmmNow(),
  shift: shiftForTime(hhmmNow()),
  category: NURSING_NOTE_CATEGORIES[0] ?? "Progress note",
  author: "",
  text: "",
});

function NursingPage() {
  const { state } = useHms();
  const { patient, admission, tab } = Route.useSearch();
  const [active, setActive] = useState<Tab>(initialTab(tab));
  useEffect(() => setActive(initialTab(tab)), [tab]);
  const stats = useMemo(() => nursingStats(state), [state]);
  const [vitalsForm, setVitalsForm] = useState<Partial<Vitals> | null>(null);
  const [noteForm, setNoteForm] = useState<Partial<NursingNote> | null>(null);

  return (
    <div>
      <PageHeader
        title="Nursing station"
        subtitle={
          stats.admitted > 0
            ? `${stats.admitted} in-patients · ${stats.chartedToday} charted today · ${stats.dueToday} round${stats.dueToday === 1 ? "" : "s"} due${stats.abnormalToday > 0 ? ` · ${stats.abnormalToday} flagged` : ""}`
            : "Record vitals, chart the TPR sheet and keep nursing notes — IPD or OPD"
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setNoteForm(blankNote())}>
              <ClipboardList className="h-4 w-4" /> Add note
            </Button>
            <Button onClick={() => setVitalsForm(blankVitals())}>
              <Plus className="h-4 w-4" /> Record vitals
            </Button>
          </>
        }
      />

      <div className="mb-4 inline-flex flex-wrap rounded-lg bg-muted p-1">
        {(
          [
            ["rounds", `Ward round (${stats.admitted})`],
            ["vitals", "Vitals chart"],
            ["notes", `Nursing notes (${noteList(state).length})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              active === t
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {active === "rounds" ? (
        <RoundsTab onRecord={(v) => setVitalsForm(v)} onNote={(n) => setNoteForm(n)} />
      ) : null}
      {active === "vitals" ? (
        <VitalsTab
          initialPatient={patient}
          initialAdmission={admission}
          onEdit={(v) => setVitalsForm(v)}
          onRecord={(v) => setVitalsForm(v)}
        />
      ) : null}
      {active === "notes" ? (
        <NotesTab initialPatient={patient} onEdit={(n) => setNoteForm(n)} />
      ) : null}

      {vitalsForm ? <VitalsModal form={vitalsForm} onClose={() => setVitalsForm(null)} /> : null}
      {noteForm ? <NoteModal form={noteForm} onClose={() => setNoteForm(null)} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------- ward round */

function RoundsTab({
  onRecord,
  onNote,
}: {
  onRecord: (v: Partial<Vitals>) => void;
  onNote: (n: Partial<NursingNote>) => void;
}) {
  const { state } = useHms();
  const rows = useMemo(() => wardRounds(state), [state]);
  const due = useMemo(() => roundsDue(state), [state]);

  const recordFor = (patientId: string, admissionId: string) =>
    onRecord({
      ...blankVitals(),
      patientId,
      admissionId,
      visitId: state.admissions[admissionId]?.visitId ?? "",
      shift: shiftForTime(hhmmNow()),
    });

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          Nobody is admitted right now — vitals can still be recorded for OPD and emergency patients
          from the <strong>Vitals chart</strong> tab.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {due.length > 0 ? (
        <Card className="border-l-4 border-l-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Rounds due today ({due.length}) — nothing charted yet
          </p>
          <ul className="space-y-1 text-sm">
            {due.map((r) => (
              <li key={r.admission.id} className="flex flex-wrap items-center gap-2">
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: r.admission.patientId }}
                  className="font-medium text-accent underline"
                >
                  {r.patient?.name ?? "—"}
                </Link>
                <span className="text-muted-foreground">
                  {r.bed ? `${r.bed.ward} · ${r.bed.label}` : "—"} · day{" "}
                  {stayDays(r.admission.admitDate)}
                  {r.admission.doctor ? ` · ${r.admission.doctor}` : ""}
                </span>
                <button
                  className="ml-auto text-xs font-medium text-accent underline"
                  onClick={() => recordFor(r.admission.patientId, r.admission.id)}
                >
                  Record vitals →
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/60">
          <p className="text-sm text-foreground">
            Rounds complete — every in-patient has vitals charted today.
          </p>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => {
          const flags = r.last ? vitalFlags(r.last) : [];
          return (
            <Card key={r.admission.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: r.admission.patientId }}
                    className="font-semibold text-accent underline"
                  >
                    {r.patient?.name ?? "—"}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {r.bed ? `${r.bed.ward} · ${r.bed.label}` : "No bed"} · day{" "}
                    {stayDays(r.admission.admitDate)}
                    {r.patient?.bloodGroup ? ` · ${r.patient.bloodGroup}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.today ? (
                    <Badge tone="green">charted {r.today.time}</Badge>
                  ) : (
                    <Badge tone="amber">due today</Badge>
                  )}
                  {r.severity !== "normal" ? (
                    <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                  ) : null}
                </div>
              </div>

              {r.last ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <VitalCell k="temperature" v={r.last} />
                    <VitalCell k="pulse" v={r.last} />
                    <VitalCell k="respRate" v={r.last} />
                    <VitalCell k="spo2" v={r.last} />
                    <VitalCell k="bpSystolic" v={r.last} />
                    <VitalCell k="bpDiastolic" v={r.last} />
                    <VitalCell k="painScore" v={r.last} />
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">I / O</p>
                      <p className="font-medium">
                        {Number(r.last.intakeMl || 0)} / {Number(r.last.outputMl || 0)} ml
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last set {fmtDate(r.last.date)} {r.last.time} · {r.last.shift} shift
                    {r.last.recordedBy ? ` · ${r.last.recordedBy}` : ""}
                  </p>
                  {flags.length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {flags.map((f) => (
                        <Badge key={f.key} tone={severityTone(f.severity)}>
                          {f.label} {f.value}
                        </Badge>
                      ))}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No observations charted for this stay yet.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="px-2.5 py-1 text-xs"
                  onClick={() => recordFor(r.admission.patientId, r.admission.id)}
                >
                  <HeartPulse className="h-3.5 w-3.5" /> Record vitals
                </Button>
                <Button
                  variant="outline"
                  className="px-2.5 py-1 text-xs"
                  onClick={() =>
                    onNote({
                      ...blankNote(),
                      patientId: r.admission.patientId,
                      admissionId: r.admission.id,
                      visitId: r.admission.visitId || "",
                    })
                  }
                >
                  <ClipboardList className="h-3.5 w-3.5" /> Note
                </Button>
                <Link
                  to="/nursing"
                  search={{
                    patient: r.admission.patientId,
                    admission: r.admission.id,
                    tab: "vitals",
                  }}
                  className="ml-auto self-center text-xs font-medium text-accent underline"
                >
                  Full chart →
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function VitalCell({ k, v }: { k: VitalKey; v: Vitals }) {
  const range = vitalRange(k);
  const severity = vitalFlags(v).find((flag) => flag.key === k)?.severity ?? "normal";
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{range?.label ?? k}</p>
      <p
        className={cn(
          "font-medium",
          severity === "critical" && "text-red-700",
          severity === "abnormal" && "text-amber-700",
        )}
      >
        {formatVital(k, v[k])}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ vitals chart */

function VitalsTab({
  initialPatient,
  initialAdmission,
  onEdit,
  onRecord,
}: {
  initialPatient: string;
  initialAdmission: string;
  onEdit: (v: Partial<Vitals>) => void;
  onRecord: (v: Partial<Vitals>) => void;
}) {
  const { state, remove } = useHms();
  const [patientId, setPatientId] = useState(initialPatient);
  useEffect(() => setPatientId(initialPatient), [initialPatient]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [shift, setShift] = useState<"" | NursingShift>("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [printFor, setPrintFor] = useState<{
    patientId: string;
    admissionId: string;
    from: string;
    to: string;
  } | null>(null);

  const rows = useMemo(
    () =>
      filterVitals(sortVitals(vitalsList(state)), {
        patientId: patientId || undefined,
        admissionId: patientId === initialPatient ? initialAdmission || undefined : undefined,
        from: from || undefined,
        to: to || undefined,
        shift: shift || undefined,
        abnormalOnly,
      }),
    [state, patientId, initialPatient, initialAdmission, from, to, shift, abnormalOnly],
  );

  const exportCsv = () => {
    downloadCsv("nursing-vitals.csv", [
      [
        "Date",
        "Time",
        "Patient",
        "MRN",
        "Shift",
        "Temp (F)",
        "Pulse",
        "Resp",
        "BP sys",
        "BP dia",
        "SpO2",
        "Pain",
        "Weight (kg)",
        "Intake (ml)",
        "Output (ml)",
        "Flags",
        "Recorded by",
        "Notes",
      ],
      ...rows.map((v) => [
        v.date,
        v.time,
        state.patients[v.patientId]?.name ?? "",
        state.patients[v.patientId]?.mrn ?? "",
        v.shift,
        Number(v.temperature || 0) || "",
        Number(v.pulse || 0) || "",
        Number(v.respRate || 0) || "",
        Number(v.bpSystolic || 0) || "",
        Number(v.bpDiastolic || 0) || "",
        Number(v.spo2 || 0) || "",
        v.painScore ?? "",
        Number(v.weightKg || 0) || "",
        Number(v.intakeMl || 0) || "",
        Number(v.outputMl || 0) || "",
        vitalFlags(v)
          .map((f) => `${f.label} ${f.value} (${f.severity})`)
          .join("; "),
        v.recordedBy,
        v.notes,
      ]),
    ]);
  };

  const del = (v: Vitals) => {
    if (confirmDelete("this set of vitals")) {
      remove("vitals", v.id);
      toast.success("Vitals deleted");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56">
          <Field label="Patient">
            <PatientPicker value={patientId} onChange={setPatientId} />
          </Field>
        </div>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Shift">
          <Select value={shift} onChange={(e) => setShift(e.target.value as "" | NursingShift)}>
            <option value="">All shifts</option>
            {NURSING_SHIFTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={abnormalOnly}
            onChange={(e) => setAbnormalOnly(e.target.checked)}
          />
          Flagged only
        </label>
        <div className="ml-auto flex flex-wrap gap-2 pb-2">
          <Button
            variant="outline"
            onClick={() => {
              if (!patientId) {
                toast.error("Pick a patient first — the chart prints one patient at a time");
                return;
              }
              setPrintFor({
                patientId,
                admissionId: patientId === initialPatient ? initialAdmission : "",
                from,
                to,
              });
            }}
          >
            <Printer className="h-4 w-4" /> TPR chart
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button onClick={() => onRecord(blankVitals())}>
            <Plus className="h-4 w-4" /> Record vitals
          </Button>
        </div>
      </div>

      <DataTable
        columns={[
          "Date / time",
          "Patient",
          "Shift",
          "Temp",
          "Pulse",
          "Resp",
          "BP",
          "SpO₂",
          "Pain",
          "I / O",
          "By",
          "",
        ]}
        rowCount={rows.length}
        empty="No observations recorded yet — use Record vitals to chart the first set."
      >
        {rows.map((v) => {
          const severity = vitalsSeverity(v);
          const flags = vitalFlags(v);
          return (
            <tr key={v.id}>
              <Td className="whitespace-nowrap">
                {fmtDate(v.date)}
                <div className="text-xs text-muted-foreground">{v.time || "—"}</div>
              </Td>
              <Td>
                <span className="font-medium">{state.patients[v.patientId]?.name ?? "—"}</span>
                <div className="text-xs text-muted-foreground">
                  {state.patients[v.patientId]?.mrn ?? ""}
                </div>
              </Td>
              <Td>
                <Badge tone="neutral">{v.shift}</Badge>
              </Td>
              <Td>{vitalValue(v, "temperature")}</Td>
              <Td>{vitalValue(v, "pulse")}</Td>
              <Td>{vitalValue(v, "respRate")}</Td>
              <Td className="whitespace-nowrap">
                {Number(v.bpSystolic || 0) > 0 && Number(v.bpDiastolic || 0) > 0 ? bpCell(v) : "—"}
              </Td>
              <Td>{vitalValue(v, "spo2")}</Td>
              <Td>{vitalValue(v, "painScore")}</Td>
              <Td className="whitespace-nowrap text-xs">
                {Number(v.intakeMl || 0)} / {Number(v.outputMl || 0)}
              </Td>
              <Td className="max-w-32 text-xs text-muted-foreground">{v.recordedBy || "—"}</Td>
              <Td className="whitespace-nowrap">
                {severity !== "normal" ? (
                  <span title={flags.map((f) => `${f.label} ${f.value}`).join(", ")}>
                    <Badge tone={severityTone(severity)}>{severity}</Badge>
                  </span>
                ) : null}
                <button
                  title="Edit"
                  className="ml-2 text-muted-foreground hover:text-foreground"
                  onClick={() => onEdit(v)}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  title="Delete"
                  className="ml-2 text-muted-foreground hover:text-destructive"
                  onClick={() => del(v)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          );
        })}
      </DataTable>

      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {rows.length} set{rows.length === 1 ? "" : "s"} charted · adult reference bands flag
          out-of-range readings in amber and critical ones in red.
        </p>
      ) : null}

      {printFor ? (
        <FlowSheetPrint
          patientId={printFor.patientId}
          admissionId={printFor.admissionId}
          from={printFor.from}
          to={printFor.to}
          onClose={() => setPrintFor(null)}
        />
      ) : null}
    </div>
  );
}

function vitalValue(v: Vitals, k: VitalKey) {
  const severity = vitalFlags(v).find((f) => f.key === k)?.severity;
  return (
    <span
      className={cn(
        severity === "critical" && "font-semibold text-red-700",
        severity === "abnormal" && "text-amber-700",
      )}
    >
      {formatVital(k, v[k])}
    </span>
  );
}

function bpCell(v: Vitals) {
  const sysFlag = vitalFlags(v).some((f) => f.key === "bpSystolic" && f.severity === "critical");
  const diaFlag = vitalFlags(v).some((f) => f.key === "bpDiastolic" && f.severity === "critical");
  const anyFlag = vitalFlags(v).some(
    (f) => (f.key === "bpSystolic" || f.key === "bpDiastolic") && f.severity === "abnormal",
  );
  return (
    <span
      className={cn(
        (sysFlag || diaFlag) && "font-semibold text-red-700",
        !(sysFlag || diaFlag) && anyFlag && "text-amber-700",
      )}
    >
      {v.bpSystolic}/{v.bpDiastolic}
    </span>
  );
}

/* --------------------------------------------------------- printed TPR chart */

function FlowSheetPrint({
  patientId,
  admissionId,
  from,
  to,
  onClose,
}: {
  patientId: string;
  admissionId: string;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const { state } = useHms();
  const patient = state.patients[patientId];
  const rows = useMemo(
    () =>
      filterVitals(sortVitals(vitalsList(state)), {
        patientId,
        admissionId: admissionId || undefined,
        from: from || undefined,
        to: to || undefined,
      }).reverse(),
    [state, patientId, admissionId, from, to],
  );

  return (
    <PrintOverlay open title="Vitals / TPR chart" onClose={onClose}>
      <table className="mb-3 w-full border-collapse">
        <tbody>
          <tr>
            <th className="w-32">Patient</th>
            <td>
              <strong>{patient?.name ?? "—"}</strong>
              {patient?.mrn ? ` · ${patient.mrn}` : ""}
            </td>
            <th className="w-32">Age / Sex</th>
            <td>
              {ageFromDob(patient?.dob)} · {patient?.gender || "—"}
            </td>
          </tr>
          <tr>
            <th>Blood group</th>
            <td>{patient?.bloodGroup || "—"}</td>
            <th>Period</th>
            <td>
              {from || "start"} → {to || "today"}
            </td>
          </tr>
          <tr>
            <th>Allergies</th>
            <td colSpan={3}>{patient?.allergies || "None recorded"}</td>
          </tr>
        </tbody>
      </table>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Shift</th>
            <th>Temp</th>
            <th>Pulse</th>
            <th>Resp</th>
            <th>BP</th>
            <th>SpO₂</th>
            <th>Pain</th>
            <th>In</th>
            <th>Out</th>
            <th>Remarks</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={13}>No observations in this period.</td>
            </tr>
          ) : (
            rows.map((v) => {
              const flags = vitalFlags(v);
              return (
                <tr key={v.id}>
                  <td>{fmtDate(v.date)}</td>
                  <td>{v.time || "—"}</td>
                  <td>{v.shift}</td>
                  <td>{formatVital("temperature", v.temperature)}</td>
                  <td>{formatVital("pulse", v.pulse)}</td>
                  <td>{formatVital("respRate", v.respRate)}</td>
                  <td>
                    {Number(v.bpSystolic || 0) > 0 && Number(v.bpDiastolic || 0) > 0
                      ? `${v.bpSystolic}/${v.bpDiastolic}`
                      : "—"}
                  </td>
                  <td>{formatVital("spo2", v.spo2)}</td>
                  <td>{formatVital("painScore", v.painScore)}</td>
                  <td>{Number(v.intakeMl || 0) || "—"}</td>
                  <td>{Number(v.outputMl || 0) || "—"}</td>
                  <td>
                    {v.notes || "—"}
                    {flags.length > 0
                      ? ` [${flags.map((f) => `${f.label} ${f.value} ${f.severity}`).join(", ")}]`
                      : ""}
                  </td>
                  <td>{v.recordedBy || "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <p className="mt-3 text-xs">
        Adult reference bands: temp 97–99 °F · pulse 60–100 /min · resp 12–20 /min · BP 90/60–139/89
        mmHg · SpO₂ 95–100 % · pain 0–3. Readings outside the band are marked abnormal, readings
        beyond the wider critical limits are marked critical.
      </p>
    </PrintOverlay>
  );
}

/* --------------------------------------------------------- vitals entry form */

function VitalsModal({ form, onClose }: { form: Partial<Vitals>; onClose: () => void }) {
  const { state, settings, upsert } = useHms();
  const { user } = useSession();
  const [f, setF] = useState<Partial<Vitals>>({
    ...form,
    recordedBy: form.recordedBy || user?.displayName || "",
  });
  const [showAdvanced, setShowAdvanced] = useState(
    [f.weightKg, f.intakeMl, f.outputMl, f.painScore].some((x) => Number(x || 0) > 0),
  );

  const admissions = useMemo(
    () => (f.patientId ? admissionsForPatient(state, f.patientId) : []),
    [state, f.patientId],
  );

  const set = <K extends keyof Vitals>(key: K, value: Vitals[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));

  /** Number input bound to one vital: blank → 0, which reads as "not taken". */
  const num = (key: keyof Vitals) => ({
    value: key === "painScore" ? (f.painScore ?? "") : Number(f[key] ?? 0) || "",
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setF((prev) => ({
        ...prev,
        [key]: key === "painScore" && !e.target.value ? undefined : Number(e.target.value),
      })),
  });

  /* Live preview: the flags the set will raise once saved. */
  const preview = vitalFlags(f as Vitals);

  const save = () => {
    if (!f.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!f.date || !f.time) {
      toast.error("Enter an observation date and time");
      return;
    }
    if (f.admissionId && state.admissions[f.admissionId]?.patientId !== f.patientId) {
      toast.error("This IPD stay does not belong to the selected patient");
      return;
    }
    const invalid = validateVitals(f);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    upsert<Vitals>("vitals", {
      ...f,
      time: f.time || hhmmNow(),
      shift: (f.shift || shiftForTime(f.time || hhmmNow())) as NursingShift,
      recordedBy: f.recordedBy || user?.displayName || settings.deviceName,
    } as Vitals);
    toast.success(f.id ? "Vitals updated" : "Vitals charted");
    onClose();
  };

  return (
    <Modal open wide title={f.id ? "Edit vitals" : "Record vitals"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient" required>
          <PatientPicker
            value={f.patientId ?? ""}
            onChange={(id) =>
              setF((prev) => ({
                ...prev,
                patientId: id,
                visitId: prev.patientId === id ? (prev.visitId ?? "") : "",
                admissionId:
                  prev.patientId === id
                    ? (prev.admissionId ?? "")
                    : (admissionsForPatient(state, id).find((a) => a.status === "Admitted")?.id ??
                      ""),
              }))
            }
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {admissions.length > 0 ? (
            <Field label="IPD stay">
              <Select
                value={f.admissionId ?? ""}
                onChange={(e) => {
                  set("admissionId", e.target.value);
                  if (e.target.value)
                    set("visitId", state.admissions[e.target.value]?.visitId ?? "");
                }}
              >
                <option value="">Not linked to a stay</option>
                {admissions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {fmtDate(a.admitDate)} · {state.beds[a.bedId]?.label ?? "—"} · {a.status}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Linked visit">
            <VisitPicker
              patientId={f.patientId ?? ""}
              value={f.visitId ?? ""}
              onChange={(id) => set("visitId", id)}
            />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Time" required>
            <Input
              type="time"
              value={f.time ?? ""}
              onChange={(e) => {
                set("time", e.target.value);
                set("shift", shiftForTime(e.target.value));
              }}
            />
          </Field>
          <Field label="Shift">
            <Select
              value={f.shift ?? "Morning"}
              onChange={(e) => set("shift", e.target.value as NursingShift)}
            >
              {NURSING_SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Temperature (°F)">
            <Input type="number" step="0.1" placeholder="98.6" {...num("temperature")} />
          </Field>
          <Field label="Pulse (/min)">
            <Input type="number" placeholder="80" {...num("pulse")} />
          </Field>
          <Field label="Respiration (/min)">
            <Input type="number" placeholder="18" {...num("respRate")} />
          </Field>
          <Field label="BP systolic">
            <Input type="number" placeholder="120" {...num("bpSystolic")} />
          </Field>
          <Field label="BP diastolic">
            <Input type="number" placeholder="80" {...num("bpDiastolic")} />
          </Field>
          <Field label="SpO₂ (%)">
            <Input type="number" placeholder="98" {...num("spo2")} />
          </Field>
        </div>

        {showAdvanced ? (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Pain (0–10)">
              <Input type="number" min={0} max={10} placeholder="0" {...num("painScore")} />
            </Field>
            <Field label="Weight (kg)">
              <Input type="number" step="0.1" placeholder="60" {...num("weightKg")} />
            </Field>
            <Field label="Intake (ml)">
              <Input type="number" placeholder="0" {...num("intakeMl")} />
            </Field>
            <Field label="Output (ml)">
              <Input type="number" placeholder="0" {...num("outputMl")} />
            </Field>
          </div>
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-accent underline"
            onClick={() => setShowAdvanced(true)}
          >
            + Pain score, weight and intake / output
          </button>
        )}

        <Field label="Recorded by">
          <Input
            value={f.recordedBy ?? ""}
            onChange={(e) => set("recordedBy", e.target.value)}
            placeholder={user?.displayName || "Nurse on duty"}
          />
        </Field>
        <Field label="Remarks">
          <Textarea
            value={f.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Dressing dry, tolerated feeds, ambulating…"
          />
        </Field>

        {preview.length > 0 ? (
          <div className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              This set will be flagged:
            </p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {preview.map((flag) => (
                <Badge key={flag.key} tone={severityTone(flag.severity)}>
                  {flag.label} {flag.value} · {flag.severity}
                </Badge>
              ))}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{f.id ? "Save changes" : "Chart vitals"}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- nursing notes */

function NotesTab({
  initialPatient,
  onEdit,
}: {
  initialPatient: string;
  onEdit: (n: Partial<NursingNote>) => void;
}) {
  const { state, remove } = useHms();
  const [patientId, setPatientId] = useState(initialPatient);
  useEffect(() => setPatientId(initialPatient), [initialPatient]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = patientId ? notesForPatient(state, patientId) : sortNotes(noteList(state));
    const byCat = category ? list.filter((n) => n.category === category) : list;
    return searchNotes(byCat, q);
  }, [state, patientId, category, q]);

  const exportCsv = () => {
    downloadCsv("nursing-notes.csv", [
      ["Date", "Time", "Patient", "Shift", "Category", "Author", "Note"],
      ...rows.map((n) => [
        n.date,
        n.time,
        state.patients[n.patientId]?.name ?? "",
        n.shift,
        n.category,
        n.author,
        n.text,
      ]),
    ]);
  };

  const del = (n: NursingNote) => {
    if (confirmDelete("this nursing note")) {
      remove("nursingNotes", n.id);
      toast.success("Note deleted");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56">
          <Field label="Patient">
            <PatientPicker value={patientId} onChange={setPatientId} />
          </Field>
        </div>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {NURSING_NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Input
          className="max-w-xs"
          placeholder="Search notes / author"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="ml-auto flex flex-wrap gap-2 pb-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      <DataTable
        columns={["Date / time", "Patient", "Shift", "Category", "Note", "Author", ""]}
        rowCount={rows.length}
        empty="No nursing notes yet — chart rounds, medication given and family updates here."
      >
        {rows.map((n) => (
          <tr key={n.id}>
            <Td className="whitespace-nowrap">
              {fmtDate(n.date)}
              <div className="text-xs text-muted-foreground">{n.time || "—"}</div>
            </Td>
            <Td>
              <span className="font-medium">{state.patients[n.patientId]?.name ?? "—"}</span>
            </Td>
            <Td>
              <Badge tone="neutral">{n.shift}</Badge>
            </Td>
            <Td className="whitespace-nowrap">
              <Badge tone={n.category === "Incident" ? "red" : "neutral"}>{n.category}</Badge>
            </Td>
            <Td className="max-w-md whitespace-pre-wrap">{n.text}</Td>
            <Td className="text-xs text-muted-foreground">{n.author || "—"}</Td>
            <Td className="whitespace-nowrap">
              <button
                title="Edit"
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(n)}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                title="Delete"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => del(n)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function NoteModal({ form, onClose }: { form: Partial<NursingNote>; onClose: () => void }) {
  const { state, upsert } = useHms();
  const { user } = useSession();
  const [f, setF] = useState<Partial<NursingNote>>({
    ...form,
    author: form.author || user?.displayName || "",
  });

  const admissions = useMemo(
    () => (f.patientId ? admissionsForPatient(state, f.patientId) : []),
    [state, f.patientId],
  );

  const save = () => {
    if (!f.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!(f.text ?? "").trim()) {
      toast.error("Write the note");
      return;
    }
    if (!f.date || !f.time) {
      toast.error("Enter the note date and time");
      return;
    }
    if (f.admissionId && state.admissions[f.admissionId]?.patientId !== f.patientId) {
      toast.error("This IPD stay does not belong to the selected patient");
      return;
    }
    upsert<NursingNote>("nursingNotes", {
      ...f,
      time: f.time || hhmmNow(),
      shift: (f.shift || shiftForTime(f.time || hhmmNow())) as NursingShift,
      author: f.author || user?.displayName || "",
      category: f.category || NURSING_NOTE_CATEGORIES[0] || "Progress note",
    } as NursingNote);
    toast.success(f.id ? "Note updated" : "Note added to the chart");
    onClose();
  };

  return (
    <Modal open title={f.id ? "Edit nursing note" : "Add nursing note"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient" required>
          <PatientPicker
            value={f.patientId ?? ""}
            onChange={(id) =>
              setF((prev) => ({
                ...prev,
                patientId: id,
                visitId: prev.patientId === id ? (prev.visitId ?? "") : "",
                admissionId:
                  prev.patientId === id
                    ? (prev.admissionId ?? "")
                    : (admissionsForPatient(state, id).find((a) => a.status === "Admitted")?.id ??
                      ""),
              }))
            }
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            <Input
              type="date"
              value={f.date ?? ""}
              onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))}
            />
          </Field>
          <Field label="Time" required>
            <Input
              type="time"
              value={f.time ?? ""}
              onChange={(e) =>
                setF((p) => ({ ...p, time: e.target.value, shift: shiftForTime(e.target.value) }))
              }
            />
          </Field>
          <Field label="Shift">
            <Select
              value={f.shift ?? "Morning"}
              onChange={(e) => setF((p) => ({ ...p, shift: e.target.value as NursingShift }))}
            >
              {NURSING_SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={f.category ?? NURSING_NOTE_CATEGORIES[0]}
              onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}
            >
              {NURSING_NOTE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {admissions.length > 0 ? (
            <Field label="IPD stay">
              <Select
                value={f.admissionId ?? ""}
                onChange={(e) =>
                  setF((p) => ({
                    ...p,
                    admissionId: e.target.value,
                    visitId: e.target.value
                      ? (state.admissions[e.target.value]?.visitId ?? "")
                      : (p.visitId ?? ""),
                  }))
                }
              >
                <option value="">Not linked to a stay</option>
                {admissions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {fmtDate(a.admitDate)} · {state.beds[a.bedId]?.label ?? "—"} · {a.status}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Author">
            <Input
              value={f.author ?? ""}
              onChange={(e) => setF((p) => ({ ...p, author: e.target.value }))}
              placeholder={user?.displayName || "Nurse on duty"}
            />
          </Field>
        </div>
        <Field label="Note" required>
          <Textarea
            value={f.text ?? ""}
            onChange={(e) => setF((p) => ({ ...p, text: e.target.value }))}
            placeholder="Post-op day 1 — afebrile, wound dry, passed urine 1200 ml…"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{f.id ? "Save changes" : "Add note"}</Button>
        </div>
      </div>
    </Modal>
  );
}
