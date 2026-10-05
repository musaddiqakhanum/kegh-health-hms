import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Download, Printer, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { ageFromDob, fmtDate, fmtDateTime, money } from "@/lib/hms/format";
import { prescriptionSummary, prescriptionsForPatient, sortByDateDesc } from "@/lib/hms/selectors";
import { admissionsForPatient } from "@/lib/hms/ipd";
import { ordersForPatient } from "@/lib/hms/laborders";
import { imagingOrdersForPatient } from "@/lib/hms/imaging";
import { notesForPatient } from "@/lib/hms/handover";
import { downloadCsv } from "@/lib/hms/csv";
import { formatAbhaNumber } from "@/lib/abdm/healthId";
import type { AppointmentStatus, Patient } from "@/lib/hms/types";
import { Badge, Button, Card, Modal, PageHeader } from "@/components/hms/ui";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { AbhaVerify } from "@/components/hms/AbhaVerify";

export const Route = createFileRoute("/patients/$patientId")({
  head: () => ({
    meta: [
      { title: "Patient record — KEGH HMS" },
      {
        name: "description",
        content:
          "Complete 360° patient record across visits, lab, radiology, pharmacy and billing.",
      },
      { property: "og:title", content: "Patient record — KEGH HMS" },
      {
        property: "og:description",
        content: "Complete 360° patient record across all hospital sections.",
      },
    ],
  }),
  component: Patient360,
});

const flagTone = (f: string) => (f === "normal" ? "green" : f === "critical" ? "red" : "amber");

const apptTone = (s: AppointmentStatus): "green" | "amber" | "red" | "neutral" =>
  s === "Completed" || s === "Confirmed"
    ? "green"
    : s === "Scheduled" || s === "CheckedIn"
      ? "amber"
      : "red";

/** Queue-order badges: done → green, open → amber, cancelled → neutral. */
const orderTone = (s: string): "green" | "amber" | "neutral" =>
  s === "Result ready" || s === "Report ready" ? "green" : s === "Cancelled" ? "neutral" : "amber";

function Patient360() {
  const { patientId } = Route.useParams();
  const { state, upsert } = useHms();
  const [print, setPrint] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const patient = state.patients[patientId];

  const visits = useMemo(
    () => sortByDateDesc(Object.values(state.visits).filter((v) => v.patientId === patientId)),
    [state.visits, patientId],
  );
  const labs = Object.values(state.labs).filter((l) => l.patientId === patientId);
  const rads = Object.values(state.rads).filter((r) => r.patientId === patientId);
  const pharms = Object.values(state.pharms).filter((p) => p.patientId === patientId);
  const bills = Object.values(state.bills).filter((b) => b.patientId === patientId);
  const appointments = useMemo(
    () =>
      sortByDateDesc(
        Object.values(state.appointments ?? {}).filter((a) => a.patientId === patientId),
      ),
    [state.appointments, patientId],
  );
  const prescriptions = useMemo(
    () => prescriptionsForPatient(state, patientId),
    [state, patientId],
  );
  const admissions = useMemo(() => admissionsForPatient(state, patientId), [state, patientId]);
  const labOrderRows = useMemo(() => ordersForPatient(state, patientId), [state, patientId]);
  const imagingOrderRows = useMemo(
    () => imagingOrdersForPatient(state, patientId),
    [state, patientId],
  );
  const handoverRows = useMemo(() => notesForPatient(state, patientId), [state, patientId]);

  const totals = {
    billed: bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0),
    paid: bills.reduce((s, b) => s + Number(b.paid || 0), 0),
    due: bills.reduce((s, b) => s + Number(b.due || 0), 0),
    pharmacy: pharms.reduce((s, p) => s + Number(p.qty || 0) * Number(p.rate || 0), 0),
  };

  if (!patient) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Patient not found.</p>
        <Link to="/patients" search={{ q: "" }} className="mt-2 inline-block text-accent underline">
          Back to patients
        </Link>
      </Card>
    );
  }

  const exportCsv = () => {
    const rows: (string | number)[][] = [["Section", "Date", "Detail 1", "Detail 2", "Detail 3"]];
    visits.forEach((v) => rows.push(["Visit", v.date, v.type, v.doctor, v.diagnosis]));
    appointments.forEach((a) =>
      rows.push([
        "Appointment",
        a.date,
        `${a.time || ""} · ${a.doctor || ""}`,
        a.tokenNo ? `Token ${a.tokenNo}` : "",
        a.status,
      ]),
    );
    prescriptions.forEach((r) =>
      rows.push(["Prescription", r.date, r.doctor, r.diagnosis, prescriptionSummary(r, 99)]),
    );
    labs.forEach((l) => rows.push(["Lab", l.date, l.testName, `${l.result} ${l.unit}`, l.flag]));
    rads.forEach((r) => rows.push(["Radiology", r.date, r.studyType, r.impression, r.radiologist]));
    admissions.forEach((a) =>
      rows.push([
        "Admission",
        a.admitDate,
        a.status,
        state.beds[a.bedId] ? `${state.beds[a.bedId]!.ward} · ${state.beds[a.bedId]!.label}` : "",
        a.dischargeDate ? `Discharged ${a.dischargeDate}` : "",
      ]),
    );
    labOrderRows.forEach((o) =>
      rows.push(["Lab order", o.date, o.tests, `${o.priority} · ${o.status}`, o.orderedBy]),
    );
    imagingOrderRows.forEach((o) =>
      rows.push(["Imaging order", o.date, o.study, `${o.priority} · ${o.status}`, o.orderedBy]),
    );
    handoverRows.forEach((n) =>
      rows.push([
        "Handover note",
        n.date,
        `${n.category}${n.resolved ? " (handled)" : ""}`,
        n.text.replace(/\s+/g, " ").slice(0, 120),
        n.author,
      ]),
    );
    pharms.forEach((p) =>
      rows.push(["Pharmacy", p.date, p.medication, `${p.qty} x ${p.rate}`, p.qty * p.rate]),
    );
    bills.forEach((b) => rows.push(["Bill", b.date, b.totalAmount, b.paid, b.due]));
    downloadCsv(`${patient.mrn.replace(/\//g, "-")}-record.csv`, rows);
  };

  const sectionsFor = (visitId: string) => ({
    labs: labs.filter((l) => l.visitId === visitId),
    rads: rads.filter((r) => r.visitId === visitId),
    pharms: pharms.filter((p) => p.visitId === visitId),
    bills: bills.filter((b) => b.visitId === visitId),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={patient.name}
        subtitle={`${patient.mrn} · ${ageFromDob(patient.dob)} · ${patient.gender}`}
        actions={
          <>
            <Link to="/patients" search={{ q: "" }}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </Link>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={() => setPrint(true)}>
              <Printer className="h-4 w-4" /> Print record
            </Button>
          </>
        }
      />

      <Card>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">Phone:</span> {patient.phone || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">DOB:</span> {fmtDate(patient.dob)}
          </p>
          <p>
            <span className="text-muted-foreground">Blood group:</span> {patient.bloodGroup || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Assigned doctor:</span> {patient.doctor || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Father / guardian:</span>{" "}
            {patient.fatherName || "—"}
          </p>
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">Address:</span> {patient.address || "—"}
          </p>
          <p className="sm:col-span-3">
            <span className="text-muted-foreground">Allergies:</span>{" "}
            {patient.allergies || "None recorded"}
          </p>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Health IDs
          </h2>
          <Button variant="outline" onClick={() => setVerifyOpen(true)}>
            <ShieldCheck className="h-4 w-4" />{" "}
            {patient.abhaVerified ? "Re-verify ABHA" : "Verify ABHA"}
          </Button>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p className="flex items-center gap-1.5 sm:col-span-1">
            <span className="text-muted-foreground">ABHA:</span>
            {patient.abhaNumber ? formatAbhaNumber(patient.abhaNumber) : "—"}
            {patient.abhaVerified ? (
              <Badge tone="green">
                <ShieldCheck className="mr-1 inline h-3 w-3" />
                Verified
              </Badge>
            ) : patient.abhaNumber ? (
              <Badge tone="amber">
                <ShieldAlert className="mr-1 inline h-3 w-3" />
                Not verified
              </Badge>
            ) : null}
          </p>
          <p>
            <span className="text-muted-foreground">ABHA address:</span>{" "}
            {patient.abhaAddress || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Verified on:</span>{" "}
            {patient.abhaVerifiedAt ? fmtDateTime(patient.abhaVerifiedAt) : "—"}
          </p>
          <p>
            <span className="text-muted-foreground">PM-JAY card:</span> {patient.pmjayCardId || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Family / ration ID:</span>{" "}
            {patient.pmjayFamilyId || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Scheme:</span> {patient.pmjayScheme || "—"}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="text-muted-foreground">PM-JAY status:</span>
            <Badge
              tone={
                patient.pmjayVerified
                  ? "green"
                  : patient.pmjayStatus === "Enrolled" || patient.pmjayStatus === "Applied"
                    ? "amber"
                    : "neutral"
              }
            >
              {patient.pmjayStatus || "Not enrolled"}
              {patient.pmjayVerified ? " · checked" : ""}
            </Badge>
          </p>
          <p>
            <span className="text-muted-foreground">Card checked on:</span>{" "}
            {patient.pmjayVerifiedAt ? fmtDateTime(patient.pmjayVerifiedAt) : "—"}
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Total billed", money(totals.billed)],
          ["Paid", money(totals.paid)],
          ["Due", money(totals.due)],
          ["Pharmacy value", money(totals.pharmacy)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/appointments">
          <Button variant="outline">Book appointment</Button>
        </Link>
        <Link to="/prescriptions">
          <Button variant="outline">Add prescription</Button>
        </Link>
        <Link to="/visits">
          <Button variant="outline">Add visit</Button>
        </Link>
        <Link to="/laboratory">
          <Button variant="outline">Add lab</Button>
        </Link>
        <Link to="/radiology">
          <Button variant="outline">Add radiology</Button>
        </Link>
        <Link to="/pharmacy">
          <Button variant="outline">Add pharmacy</Button>
        </Link>
        <Link to="/billing">
          <Button variant="outline">Add bill</Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Appointments
          </h3>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments booked.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fmtDate(a.date)}</span>
                  <span className="text-muted-foreground">{a.time || "—"}</span>
                  <span>{a.doctor || "—"}</span>
                  {a.tokenNo ? <Badge tone="neutral">Token {a.tokenNo}</Badge> : null}
                  <span className="ml-auto">
                    <Badge tone={apptTone(a.status)}>{a.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Prescriptions
          </h3>
          {prescriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prescriptions written.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {prescriptions.map((r) => (
                <li key={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{fmtDate(r.date)}</span>
                    <span className="text-muted-foreground">{r.doctor || "—"}</span>
                    {r.diagnosis ? <Badge tone="neutral">{r.diagnosis}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {prescriptionSummary(r, 4)}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              IPD admissions ({admissions.length})
            </h3>
            <Link to="/ipd" className="text-xs font-medium text-accent underline">
              IPD & beds →
            </Link>
          </div>
          {admissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Never admitted.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {admissions.slice(0, 6).map((a) => {
                const bed = state.beds[a.bedId];
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{fmtDate(a.admitDate)}</span>
                    <span className="text-muted-foreground">
                      {bed ? `${bed.ward} · ${bed.label}` : "—"}
                    </span>
                    {a.dischargeDate ? (
                      <span className="text-muted-foreground">→ {fmtDate(a.dischargeDate)}</span>
                    ) : null}
                    <span className="ml-auto">
                      <Badge tone={a.status === "Admitted" ? "amber" : "green"}>{a.status}</Badge>
                    </span>
                  </li>
                );
              })}
              {admissions.length > 6 ? (
                <li className="text-xs text-muted-foreground">
                  + {admissions.length - 6} earlier stay{admissions.length - 6 === 1 ? "" : "s"}
                </li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Lab orders ({labOrderRows.length})
            </h3>
            <Link to="/lab-orders" className="text-xs font-medium text-accent underline">
              Order queue →
            </Link>
          </div>
          {labOrderRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lab orders placed.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {labOrderRows.slice(0, 6).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fmtDate(o.date)}</span>
                  <span className="max-w-48 truncate">{o.tests}</span>
                  {o.priority === "Urgent" ? <Badge tone="red">Urgent</Badge> : null}
                  <span className="ml-auto">
                    <Badge tone={orderTone(o.status)}>{o.status}</Badge>
                  </span>
                </li>
              ))}
              {labOrderRows.length > 6 ? (
                <li className="text-xs text-muted-foreground">+ {labOrderRows.length - 6} more</li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Imaging orders ({imagingOrderRows.length})
            </h3>
            <Link to="/imaging-orders" className="text-xs font-medium text-accent underline">
              Order queue →
            </Link>
          </div>
          {imagingOrderRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imaging ordered.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {imagingOrderRows.slice(0, 6).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fmtDate(o.date)}</span>
                  <span className="max-w-48 truncate">{o.study}</span>
                  {o.priority === "Urgent" ? <Badge tone="red">Urgent</Badge> : null}
                  <span className="ml-auto">
                    <Badge tone={orderTone(o.status)}>{o.status}</Badge>
                  </span>
                </li>
              ))}
              {imagingOrderRows.length > 6 ? (
                <li className="text-xs text-muted-foreground">
                  + {imagingOrderRows.length - 6} more
                </li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Handover notes ({handoverRows.length})
            </h3>
            <Link to="/handover" className="text-xs font-medium text-accent underline">
              Noticeboard →
            </Link>
          </div>
          {handoverRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shift notes pinned to this patient.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {handoverRows.slice(0, 6).map((n) => (
                <li key={n.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {fmtDate(n.date)} {n.time}
                    </span>
                    <Badge tone={n.category === "Urgent" ? "red" : "neutral"}>{n.category}</Badge>
                    {!n.resolved ? (
                      <span className="ml-auto">
                        <Badge tone="amber">Open</Badge>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {n.text.length > 90 ? `${n.text.slice(0, 90)}…` : n.text}
                    {n.author ? ` — ${n.author}` : ""}
                  </p>
                </li>
              ))}
              {handoverRows.length > 6 ? (
                <li className="text-xs text-muted-foreground">+ {handoverRows.length - 6} more</li>
              ) : null}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        {visits.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">No visits recorded yet.</p>
          </Card>
        ) : null}
        {visits.map((v) => {
          const s = sectionsFor(v.id);
          return (
            <Card key={v.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={v.type === "Emergency" ? "red" : v.type === "IPD" ? "amber" : "green"}>
                  {v.type}
                </Badge>
                <span className="font-semibold">{fmtDate(v.date)}</span>
                <span className="text-sm text-muted-foreground">
                  {v.doctor} {v.department ? `· ${v.department}` : ""}
                </span>
              </div>
              {v.diagnosis ? (
                <p className="mt-2 text-sm">
                  <strong>Diagnosis:</strong> {v.diagnosis}
                </p>
              ) : null}
              {v.notes ? <p className="mt-1 text-sm text-muted-foreground">{v.notes}</p> : null}
              {v.type === "IPD" ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Admitted {fmtDate(v.admissionDate)} · Discharged{" "}
                  {v.dischargeDate ? fmtDate(v.dischargeDate) : "still admitted"}
                </p>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Laboratory
                  </p>
                  {s.labs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    s.labs.map((l) => (
                      <p key={l.id} className="text-sm">
                        {l.testName}: {l.result} {l.unit}{" "}
                        <Badge tone={flagTone(l.flag) as never}>{l.flag}</Badge>
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Radiology</p>
                  {s.rads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    s.rads.map((r) => (
                      <p key={r.id} className="text-sm">
                        {r.studyType}: {r.impression || r.findings}
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Pharmacy</p>
                  {s.pharms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    s.pharms.map((p) => (
                      <p key={p.id} className="text-sm">
                        {p.medication} {p.dosage} · {p.frequency} · {p.duration} · {p.qty} ×{" "}
                        {money(p.rate)} = {money(p.qty * p.rate)}
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Billing</p>
                  {s.bills.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    s.bills.map((b) => (
                      <p key={b.id} className="text-sm">
                        {money(b.totalAmount)} · paid {money(b.paid)}{" "}
                        <Badge tone={b.due > 0 ? "red" : "green"}>
                          {b.due > 0 ? `due ${money(b.due)}` : "paid"}
                        </Badge>
                      </p>
                    ))
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal
        open={verifyOpen}
        title={`Verify ABHA — ${patient.name}`}
        onClose={() => setVerifyOpen(false)}
      >
        <AbhaVerify
          abhaNumber={patient.abhaNumber || undefined}
          abhaAddress={patient.abhaAddress || undefined}
          abhaVerified={patient.abhaVerified}
          abhaVerifiedAt={patient.abhaVerifiedAt}
          onApply={(p) => {
            const { demo: _demo, ...rest } = p;
            upsert<Patient>("patients", { id: patient.id, ...rest });
            if (p.demo) toast.info("Demo data saved — ABHA is not marked verified.");
            else toast.success("ABHA verified and saved to the patient record");
            setVerifyOpen(false);
          }}
        />
      </Modal>

      <PrintOverlay
        open={print}
        title={`Patient Record — ${patient.name}`}
        onClose={() => setPrint(false)}
      >
        <table className="mb-4">
          <tbody>
            <tr>
              <th>Name</th>
              <td>{patient.name}</td>
              <th>MRN</th>
              <td>{patient.mrn}</td>
            </tr>
            <tr>
              <th>Age / Gender</th>
              <td>
                {ageFromDob(patient.dob)} / {patient.gender}
              </td>
              <th>Phone</th>
              <td>{patient.phone || "—"}</td>
            </tr>
            <tr>
              <th>Blood group</th>
              <td>{patient.bloodGroup || "—"}</td>
              <th>Allergies</th>
              <td>{patient.allergies || "None"}</td>
            </tr>
            <tr>
              <th>ABHA</th>
              <td>
                {patient.abhaNumber
                  ? `${formatAbhaNumber(patient.abhaNumber)}${patient.abhaVerified ? " ✓" : ""}`
                  : "—"}
              </td>
              <th>PM-JAY card</th>
              <td>
                {patient.pmjayCardId || "—"}
                {patient.pmjayStatus
                  ? ` (${patient.pmjayStatus}${patient.pmjayVerified ? ", checked" : ""})`
                  : ""}
              </td>
            </tr>
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Visits</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Doctor</th>
              <th>Diagnosis</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id}>
                <td>{fmtDate(v.date)}</td>
                <td>{v.type}</td>
                <td>{v.doctor}</td>
                <td>{v.diagnosis}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Appointments</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Doctor</th>
              <th>Token</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => (
              <tr key={a.id}>
                <td>{fmtDate(a.date)}</td>
                <td>{a.time || "—"}</td>
                <td>{a.doctor || "—"}</td>
                <td>{a.tokenNo ?? "—"}</td>
                <td>{a.status}</td>
              </tr>
            ))}
            {appointments.length === 0 ? (
              <tr>
                <td colSpan={5}>No appointments booked.</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Laboratory</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Test</th>
              <th>Result</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {labs.map((l) => (
              <tr key={l.id}>
                <td>{fmtDate(l.date)}</td>
                <td>{l.testName}</td>
                <td>
                  {l.result} {l.unit}
                </td>
                <td>{l.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Radiology</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Study</th>
              <th>Impression</th>
            </tr>
          </thead>
          <tbody>
            {rads.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.date)}</td>
                <td>{r.studyType}</td>
                <td>{r.impression}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Pharmacy</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Medication</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {pharms.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.date)}</td>
                <td>{p.medication}</td>
                <td>{p.qty}</td>
                <td>{money(p.qty * p.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Prescriptions</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Doctor</th>
              <th>Diagnosis</th>
              <th>Medicines</th>
            </tr>
          </thead>
          <tbody>
            {prescriptions.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.date)}</td>
                <td>{r.doctor || "—"}</td>
                <td>{r.diagnosis || "—"}</td>
                <td>{prescriptionSummary(r, 99)}</td>
              </tr>
            ))}
            {prescriptions.length === 0 ? (
              <tr>
                <td colSpan={4}>No prescriptions written.</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Billing</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id}>
                <td>{fmtDate(b.date)}</td>
                <td>{money(b.totalAmount)}</td>
                <td>{money(b.paid)}</td>
                <td>{money(b.due)}</td>
              </tr>
            ))}
            <tr>
              <th>Total</th>
              <th>{money(totals.billed)}</th>
              <th>{money(totals.paid)}</th>
              <th>{money(totals.due)}</th>
            </tr>
          </tbody>
        </table>
      </PrintOverlay>
    </div>
  );
}
