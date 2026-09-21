import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { ageFromDob, fmtDate, money } from "@/lib/hms/format";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { downloadCsv } from "@/lib/hms/csv";
import { Badge, Button, Card, PageHeader } from "@/components/hms/ui";
import { PrintOverlay } from "@/components/hms/PrintOverlay";

export const Route = createFileRoute("/patients/$patientId")({
  head: () => ({
    meta: [
      { title: "Patient record — KEGH HMS" },
      { name: "description", content: "Complete 360° patient record across visits, lab, radiology, pharmacy and billing." },
      { property: "og:title", content: "Patient record — KEGH HMS" },
      { property: "og:description", content: "Complete 360° patient record across all hospital sections." },
    ],
  }),
  component: Patient360,
});

const flagTone = (f: string) =>
  f === "normal" ? "green" : f === "critical" ? "red" : "amber";

function Patient360() {
  const { patientId } = Route.useParams();
  const { state } = useHms();
  const [print, setPrint] = useState(false);
  const patient = state.patients[patientId];

  const visits = useMemo(
    () => sortByDateDesc(Object.values(state.visits).filter((v) => v.patientId === patientId)),
    [state.visits, patientId],
  );
  const labs = Object.values(state.labs).filter((l) => l.patientId === patientId);
  const rads = Object.values(state.rads).filter((r) => r.patientId === patientId);
  const pharms = Object.values(state.pharms).filter((p) => p.patientId === patientId);
  const bills = Object.values(state.bills).filter((b) => b.patientId === patientId);

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
        <Link to="/patients" className="mt-2 inline-block text-accent underline">
          Back to patients
        </Link>
      </Card>
    );
  }

  const exportCsv = () => {
    const rows: (string | number)[][] = [["Section", "Date", "Detail 1", "Detail 2", "Detail 3"]];
    visits.forEach((v) => rows.push(["Visit", v.date, v.type, v.doctor, v.diagnosis]));
    labs.forEach((l) => rows.push(["Lab", l.date, l.testName, `${l.result} ${l.unit}`, l.flag]));
    rads.forEach((r) => rows.push(["Radiology", r.date, r.studyType, r.impression, r.radiologist]));
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
            <Link to="/patients">
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
          <p><span className="text-muted-foreground">Phone:</span> {patient.phone || "—"}</p>
          <p><span className="text-muted-foreground">DOB:</span> {fmtDate(patient.dob)}</p>
          <p><span className="text-muted-foreground">Blood group:</span> {patient.bloodGroup || "—"}</p>
          <p><span className="text-muted-foreground">Father / guardian:</span> {patient.fatherName || "—"}</p>
          <p className="sm:col-span-2"><span className="text-muted-foreground">Address:</span> {patient.address || "—"}</p>
          <p className="sm:col-span-3"><span className="text-muted-foreground">Allergies:</span> {patient.allergies || "None recorded"}</p>
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
        <Link to="/visits"><Button variant="outline">Add visit</Button></Link>
        <Link to="/laboratory"><Button variant="outline">Add lab</Button></Link>
        <Link to="/radiology"><Button variant="outline">Add radiology</Button></Link>
        <Link to="/pharmacy"><Button variant="outline">Add pharmacy</Button></Link>
        <Link to="/billing"><Button variant="outline">Add bill</Button></Link>
      </div>

      <div className="space-y-4">
        {visits.length === 0 ? (
          <Card><p className="text-sm text-muted-foreground">No visits recorded yet.</p></Card>
        ) : null}
        {visits.map((v) => {
          const s = sectionsFor(v.id);
          return (
            <Card key={v.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={v.type === "Emergency" ? "red" : v.type === "IPD" ? "amber" : "green"}>{v.type}</Badge>
                <span className="font-semibold">{fmtDate(v.date)}</span>
                <span className="text-sm text-muted-foreground">{v.doctor} {v.department ? `· ${v.department}` : ""}</span>
              </div>
              {v.diagnosis ? <p className="mt-2 text-sm"><strong>Diagnosis:</strong> {v.diagnosis}</p> : null}
              {v.notes ? <p className="mt-1 text-sm text-muted-foreground">{v.notes}</p> : null}
              {v.type === "IPD" ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Admitted {fmtDate(v.admissionDate)} · Discharged {v.dischargeDate ? fmtDate(v.dischargeDate) : "still admitted"}
                </p>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Laboratory</p>
                  {s.labs.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : s.labs.map((l) => (
                    <p key={l.id} className="text-sm">
                      {l.testName}: {l.result} {l.unit} <Badge tone={flagTone(l.flag) as never}>{l.flag}</Badge>
                    </p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Radiology</p>
                  {s.rads.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : s.rads.map((r) => (
                    <p key={r.id} className="text-sm">{r.studyType}: {r.impression || r.findings}</p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Pharmacy</p>
                  {s.pharms.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : s.pharms.map((p) => (
                    <p key={p.id} className="text-sm">
                      {p.medication} {p.dosage} · {p.frequency} · {p.duration} · {p.qty} × {money(p.rate)} = {money(p.qty * p.rate)}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Billing</p>
                  {s.bills.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : s.bills.map((b) => (
                    <p key={b.id} className="text-sm">
                      {money(b.totalAmount)} · paid {money(b.paid)}{" "}
                      <Badge tone={b.due > 0 ? "red" : "green"}>{b.due > 0 ? `due ${money(b.due)}` : "paid"}</Badge>
                    </p>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <PrintOverlay open={print} title={`Patient Record — ${patient.name}`} onClose={() => setPrint(false)}>
        <table className="mb-4">
          <tbody>
            <tr><th>Name</th><td>{patient.name}</td><th>MRN</th><td>{patient.mrn}</td></tr>
            <tr><th>Age / Gender</th><td>{ageFromDob(patient.dob)} / {patient.gender}</td><th>Phone</th><td>{patient.phone || "—"}</td></tr>
            <tr><th>Blood group</th><td>{patient.bloodGroup || "—"}</td><th>Allergies</th><td>{patient.allergies || "None"}</td></tr>
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Visits</h3>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Doctor</th><th>Diagnosis</th></tr></thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id}><td>{fmtDate(v.date)}</td><td>{v.type}</td><td>{v.doctor}</td><td>{v.diagnosis}</td></tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Laboratory</h3>
        <table>
          <thead><tr><th>Date</th><th>Test</th><th>Result</th><th>Flag</th></tr></thead>
          <tbody>
            {labs.map((l) => (
              <tr key={l.id}><td>{fmtDate(l.date)}</td><td>{l.testName}</td><td>{l.result} {l.unit}</td><td>{l.flag}</td></tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Radiology</h3>
        <table>
          <thead><tr><th>Date</th><th>Study</th><th>Impression</th></tr></thead>
          <tbody>
            {rads.map((r) => (
              <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.studyType}</td><td>{r.impression}</td></tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Pharmacy</h3>
        <table>
          <thead><tr><th>Date</th><th>Medication</th><th>Qty</th><th>Amount</th></tr></thead>
          <tbody>
            {pharms.map((p) => (
              <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.medication}</td><td>{p.qty}</td><td>{money(p.qty * p.rate)}</td></tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 font-semibold">Billing</h3>
        <table>
          <thead><tr><th>Date</th><th>Total</th><th>Paid</th><th>Due</th></tr></thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id}><td>{fmtDate(b.date)}</td><td>{money(b.totalAmount)}</td><td>{money(b.paid)}</td><td>{money(b.due)}</td></tr>
            ))}
            <tr><th>Total</th><th>{money(totals.billed)}</th><th>{money(totals.paid)}</th><th>{money(totals.due)}</th></tr>
          </tbody>
        </table>
      </PrintOverlay>
    </div>
  );
}
