import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCheck, Download, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import {
  RANGE_LABELS,
  prescriptionSummary,
  prescriptionsInRange,
  sortByDateDesc,
  type RangeKey,
} from "@/lib/hms/selectors";
import { ageFromDob, fmtDate, fmtDateTime, todayISO } from "@/lib/hms/format";
import { fulfilStatus, itemFlags, matchMedicine } from "@/lib/hms/fulfil";
import { composeMedText, formsForName, suggestNames } from "@/lib/hms/medcatalog";
import { currentMonth, expiryStatus, sellableStock, suggestedRate } from "@/lib/hms/inventory";
import { downloadCsv } from "@/lib/hms/csv";
import type { Pharm, Prescription, PrescriptionItem, StockBatch, StockDraw } from "@/lib/hms/types";
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
import { DoctorSelect } from "@/components/hms/DoctorSelect";
import { PrintOverlay } from "@/components/hms/PrintOverlay";

export const Route = createFileRoute("/prescriptions")({
  head: () => ({
    meta: [
      { title: "Prescriptions — KEGH HMS" },
      {
        name: "description",
        content: "Write prescriptions with allergy warnings and print them on the KEGH letterhead.",
      },
      { property: "og:title", content: "Prescriptions — KEGH HMS" },
      {
        property: "og:description",
        content: "Write prescriptions with allergy warnings and print them on the KEGH letterhead.",
      },
    ],
  }),
  component: PrescriptionsPage,
});

const blankItem = (): PrescriptionItem => ({
  medication: "",
  dosage: "",
  frequency: "",
  duration: "",
});

const blank = (): Partial<Prescription> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  doctor: "",
  diagnosis: "",
  items: [blankItem()],
  notes: "",
  signOff: "",
});

/** Quick picks for the frequency and duration fields (1-0-1 = morning & night). */
const FREQUENCY_SUGGESTIONS = ["1-0-0", "0-0-1", "1-0-1", "0-1-0", "1-1-1", "1-1-1-1", "SOS"];
const DURATION_SUGGESTIONS = [
  "3 days",
  "5 days",
  "7 days",
  "10 days",
  "14 days",
  "1 month",
  "3 months",
];

function PrescriptionsPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Prescription>>(blank);
  const [error, setError] = useState("");
  const [printRx, setPrintRx] = useState<Prescription | null>(null);
  const [dispenseRx, setDispenseRx] = useState<Prescription | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const [fulfil, setFulfil] = useState<"" | "open" | "dispensed">("");
  const [q, setQ] = useState("");

  const total = Object.keys(state.prescriptions ?? {}).length;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inRange = prescriptionsInRange(state, range);
    const filtered = !s
      ? inRange
      : inRange.filter((r) =>
          [
            state.patients[r.patientId]?.name ?? "",
            r.doctor ?? "",
            r.diagnosis ?? "",
            ...(r.items ?? []).map((i) => i.medication),
          ].some((v) => (v || "").toLowerCase().includes(s)),
        );
    return sortByDateDesc(filtered);
  }, [state, range, q]);

  /* Fulfilment filter: open = Pending or Partially handed over. */
  const visible = useMemo(() => {
    if (fulfil === "open")
      return rows.filter((r) => (r.dispenseStatus ?? "Pending") !== "Dispensed");
    if (fulfil === "dispensed")
      return rows.filter((r) => (r.dispenseStatus ?? "Pending") === "Dispensed");
    return rows;
  }, [rows, fulfil]);

  const items = form.items ?? [];
  const allergyPatient = form.patientId ? state.patients[form.patientId] : undefined;
  const allergies = (allergyPatient?.allergies ?? "").trim();

  const set = (patch: Partial<Prescription>) => setForm((f) => ({ ...f, ...patch }));

  const setItem = (idx: number, patch: Partial<PrescriptionItem>) =>
    setForm((f) => {
      const next = [...(f.items ?? [])];
      next[idx] = { ...blankItem(), ...next[idx], ...patch };
      return { ...f, items: next };
    });

  const save = () => {
    if (!form.patientId) {
      setError("Select a patient before saving the prescription.");
      return;
    }
    const cleaned = items
      .map((i) => ({ ...i, medication: i.medication?.trim() ?? "" }))
      .filter((i) => i.medication);
    if (cleaned.length === 0) {
      setError("Add at least one medicine before saving the prescription.");
      return;
    }
    upsert<Prescription>("prescriptions", {
      ...form,
      doctor: form.doctor?.trim() ?? "",
      diagnosis: form.diagnosis?.trim() ?? "",
      notes: form.notes?.trim() ?? "",
      signOff: form.signOff?.trim() ?? "",
      items: cleaned,
    } as Prescription);
    toast.success(form.id ? "Prescription updated" : "Prescription saved");
    setOpen(false);
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const out: (string | number)[][] = [
      [
        "Date",
        "Patient",
        "MRN",
        "Doctor",
        "Diagnosis",
        "Medicine",
        "Dosage",
        "Frequency",
        "Duration",
        "Advice",
        "Fulfilment",
      ],
    ];
    for (const r of rows) {
      const p = state.patients[r.patientId];
      for (const item of r.items ?? []) {
        out.push([
          r.date,
          p?.name ?? "",
          p?.mrn ?? "",
          r.doctor ?? "",
          r.diagnosis ?? "",
          item.medication,
          item.dosage,
          item.frequency,
          item.duration,
          r.notes ?? "",
          r.dispenseStatus ?? "Pending",
        ]);
      }
    }
    downloadCsv(`prescriptions-${range}.csv`, out);
  };

  const printPatient = printRx ? state.patients[printRx.patientId] : undefined;

  return (
    <div>
      <PageHeader
        title="Prescriptions"
        subtitle={`${rows.length} in this range · ${total} total`}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button
              onClick={() => {
                setForm(blank());
                setError("");
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New prescription
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Search">
          <Input
            placeholder="Patient, doctor, diagnosis or medicine…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Field label="Date range">
          <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
            {Object.entries(RANGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fulfilment">
          <Select value={fulfil} onChange={(e) => setFulfil(e.target.value as typeof fulfil)}>
            <option value="">All</option>
            <option value="open">Awaiting pharmacy</option>
            <option value="dispensed">Dispensed</option>
          </Select>
        </Field>
      </div>

      <DataTable
        columns={["Date", "Patient", "Doctor", "Diagnosis", "Medicines", "Fulfilment", ""]}
        rowCount={visible.length}
        empty="No prescriptions in this range."
      >
        {visible.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{fmtDate(r.date)}</Td>
            <Td>
              <Link
                to="/patients/$patientId"
                params={{ patientId: r.patientId }}
                className="text-accent underline"
              >
                {state.patients[r.patientId]?.name ?? "—"}
              </Link>
            </Td>
            <Td>{r.doctor || "—"}</Td>
            <Td>{r.diagnosis || "—"}</Td>
            <Td>{prescriptionSummary(r)}</Td>
            <Td className="whitespace-nowrap">
              {(() => {
                const st = r.dispenseStatus ?? "Pending";
                return (
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={st === "Dispensed" ? "green" : st === "Partial" ? "amber" : "red"}>
                      {st === "Dispensed" ? "Dispensed" : st === "Partial" ? "Partial" : "Pending"}
                    </Badge>
                    {st !== "Dispensed" ? (
                      <Button
                        variant="outline"
                        className="px-2 py-1 text-xs"
                        onClick={() => setDispenseRx(r)}
                      >
                        <CheckCheck className="h-3.5 w-3.5" /> Dispense
                      </Button>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title={fmtDateTime(r.dispensedAt)}
                      >
                        {r.dispensedBy}
                      </span>
                    )}
                  </div>
                );
              })()}
            </Td>
            <Td className="whitespace-nowrap">
              <div className="flex items-center gap-1">
                <button
                  className="text-muted-foreground hover:text-foreground"
                  title="Print"
                  onClick={() => setPrintRx(r)}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  title="Edit"
                  onClick={() => {
                    setForm({ ...r, items: r.items?.map((i) => ({ ...i })) ?? [] });
                    setError("");
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete"
                  onClick={() => {
                    if (confirmDelete("this prescription")) {
                      remove("prescriptions", r.id);
                      toast.success("Prescription deleted");
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

      {/* Editor */}
      <Modal
        open={open}
        title={form.id ? "Edit prescription" : "New prescription"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker
              value={form.patientId ?? ""}
              onChange={(id) => set({ patientId: id, visitId: "" })}
            />
          </Field>
          {allergies ? (
            <p className="sm:col-span-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800">
              Allergies on record: {allergies}
            </p>
          ) : null}
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field label="Doctor">
            <DoctorSelect value={form.doctor ?? ""} onChange={(d) => set({ doctor: d })} />
          </Field>
          <Field label="Diagnosis" className="sm:col-span-2">
            <Input
              value={form.diagnosis ?? ""}
              placeholder="Working diagnosis"
              onChange={(e) => set({ diagnosis: e.target.value })}
            />
          </Field>
          <Field label="Linked visit" className="sm:col-span-2">
            <VisitPicker
              patientId={form.patientId ?? ""}
              value={form.visitId ?? ""}
              onChange={(id) => set({ visitId: id })}
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-foreground">Medicines</p>
          <div className="space-y-2">
            {items.map((item, idx) => {
              const variants = formsForName(state, item.medication);
              return (
                <div key={idx} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-4 space-y-1">
                    <Input
                      placeholder="Medicine — type 2+ letters for suggestions"
                      list={`rx-catalog-${idx}`}
                      value={item.medication}
                      onChange={(e) => setItem(idx, { medication: e.target.value })}
                    />
                    <datalist id={`rx-catalog-${idx}`}>
                      {suggestNames(state, item.medication).map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    {variants.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {variants.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            title="Use this form / strength"
                            className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/30 transition-colors hover:bg-accent/20"
                            onClick={() => setItem(idx, { medication: composeMedText(c) })}
                          >
                            {c.form || "Use"}
                            {c.strength ? ` · ${c.strength}` : ""}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Input
                    className="col-span-2"
                    placeholder="Dosage"
                    value={item.dosage}
                    onChange={(e) => setItem(idx, { dosage: e.target.value })}
                  />
                  <Input
                    className="col-span-2"
                    placeholder="Frequency"
                    list="rx-frequency"
                    value={item.frequency}
                    onChange={(e) => setItem(idx, { frequency: e.target.value })}
                  />
                  <Input
                    className="col-span-3"
                    placeholder="Duration"
                    list="rx-duration"
                    value={item.duration}
                    onChange={(e) => setItem(idx, { duration: e.target.value })}
                  />
                  <button
                    className="col-span-1 text-muted-foreground hover:text-destructive"
                    title="Remove medicine"
                    onClick={() =>
                      setForm((f) => ({ ...f, items: (f.items ?? []).filter((_, i) => i !== idx) }))
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => setForm((f) => ({ ...f, items: [...(f.items ?? []), blankItem()] }))}
          >
            <Plus className="h-4 w-4" /> Add medicine
          </Button>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Advice / notes">
            <Textarea
              value={form.notes ?? ""}
              placeholder="Take after food, review in 5 days…"
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Field>
          <Field label="Sign off (defaults to the doctor)">
            <Input
              value={form.signOff ?? ""}
              placeholder={form.doctor?.trim() || "Doctor's name"}
              onChange={(e) => set({ signOff: e.target.value })}
            />
          </Field>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{form.id ? "Save changes" : "Save prescription"}</Button>
        </div>
      </Modal>

      {/* Letterhead print */}
      <PrintOverlay open={Boolean(printRx)} title="Prescription" onClose={() => setPrintRx(null)}>
        {printRx ? (
          <div>
            {printPatient ? (
              <table className="mb-4">
                <tbody>
                  <tr>
                    <th className="w-36">Name</th>
                    <td>{printPatient.name}</td>
                    <th className="w-36">MRN</th>
                    <td>{printPatient.mrn}</td>
                  </tr>
                  <tr>
                    <th>Age / Gender</th>
                    <td>
                      {ageFromDob(printPatient.dob)} / {printPatient.gender}
                    </td>
                    <th>Date</th>
                    <td>{fmtDate(printRx.date)}</td>
                  </tr>
                  <tr>
                    <th>Allergies</th>
                    <td colSpan={3}>{printPatient.allergies || "None recorded"}</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <table className="mb-4">
              <tbody>
                <tr>
                  <th className="w-36">Attending doctor</th>
                  <td>{printRx.doctor || "—"}</td>
                </tr>
                {printRx.diagnosis ? (
                  <tr>
                    <th>Diagnosis</th>
                    <td>{printRx.diagnosis}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <p className="mb-1 font-semibold">℞ Medicines</p>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>Frequency</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {(printRx.items ?? []).map((m, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{m.medication || "—"}</td>
                    <td>{m.dosage || "—"}</td>
                    <td>{m.frequency || "—"}</td>
                    <td>{m.duration || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {printRx.notes ? (
              <p className="mb-4">
                <strong>Advice:</strong> {printRx.notes}
              </p>
            ) : null}

            <div className="mt-8 flex justify-end">
              <div className="w-56 text-center">
                <p className="border-t border-slate-400 pt-1 font-semibold">
                  {(printRx.signOff || "").trim() || printRx.doctor || "—"}
                </p>
                <p className="text-xs text-slate-500">Doctor's signature</p>
              </div>
            </div>
          </div>
        ) : null}
      </PrintOverlay>

      <DispenseModal rx={dispenseRx} onClose={() => setDispenseRx(null)} />

      <datalist id="rx-frequency">
        {FREQUENCY_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id="rx-duration">
        {DURATION_SUGGESTIONS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}

/* ------------------------------------------------------- dispense modal */

interface DispenseLine {
  include: boolean;
  qty: number;
  rate: number;
}

/**
 * The pharmacy counter: tick the medicines being handed over with qty and
 * rate. Catalog medicines draw stock down FEFO-style; each line becomes a
 * Pharmacy dispense entry; the prescription flips to Partial / Dispensed.
 */
function DispenseModal({ rx, onClose }: { rx: Prescription | null; onClose: () => void }) {
  const { state, upsert } = useHms();
  const { user } = useSession();
  const [lines, setLines] = useState<DispenseLine[]>([]);
  const [seeded, setSeeded] = useState<string | null>(null);

  /* Re-seed the lines each time a different prescription opens. */
  if (rx && rx.id !== seeded) {
    setSeeded(rx.id);
    setLines(
      (rx.items ?? []).map((it, i) => {
        const med = matchMedicine(state, it.medication);
        return {
          include: rx.itemDispensed?.[i] !== true,
          qty: 1,
          rate: med ? suggestedRate(state, med) : 0,
        };
      }),
    );
  }
  if (!rx) return null;

  const items = rx.items ?? [];
  const setLine = (i: number, patch: Partial<DispenseLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const total = lines.reduce((s, l) => (l.include ? s + l.qty * l.rate : s), 0);

  const save = () => {
    const chosen = items
      .map((it, i) => ({ it, i, line: lines[i] }))
      .filter(
        (x): x is { it: PrescriptionItem; i: number; line: DispenseLine } =>
          x.line?.include === true && rx.itemDispensed?.[x.i] !== true,
      );
    if (chosen.length === 0) {
      toast.error("Nothing selected to dispense");
      return;
    }

    /* Plan every stock draw in memory first; bail out without writing if any
       line can't be covered (expired batches never count). */
    const working = new Map<string, StockBatch>();
    const ref = currentMonth();
    const plans: { i: number; med: ReturnType<typeof matchMedicine>; draws: StockDraw[] }[] = [];
    for (const { it, i, line } of chosen) {
      const qty = Number(line.qty || 0);
      if (qty <= 0) {
        toast.error(`Quantity for ${it.medication} must be above zero`);
        return;
      }
      const med = matchMedicine(state, it.medication);
      let draws: StockDraw[] = [];
      if (med) {
        const sellable = Object.values(state.batches ?? {})
          .filter((b) => b.medicineId === med.id)
          .map((b) => working.get(b.id) ?? b)
          .filter((b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, ref) !== "expired")
          .sort(
            (a, b) => (a.expiry || "").localeCompare(b.expiry || "") || a.createdAt - b.createdAt,
          );
        let remaining = qty;
        const ds: StockDraw[] = [];
        for (const b of sellable) {
          if (remaining <= 0) break;
          const use = Math.min(Number(b.qtyOnHand || 0), remaining);
          if (use > 0) {
            ds.push({ batchId: b.id, qty: use });
            working.set(b.id, { ...b, qtyOnHand: Number(b.qtyOnHand || 0) - use });
            remaining -= use;
          }
        }
        if (remaining > 0) {
          toast.error(
            `Not enough stock for ${it.medication} — ${qty - remaining} sellable, ${qty} needed`,
          );
          return;
        }
        draws = ds;
      }
      plans.push({ i, med, draws });
    }

    for (const { i, med, draws } of plans) {
      const it = items[i]!;
      const line = lines[i]!;
      upsert<Pharm>("pharms", {
        patientId: rx.patientId,
        visitId: rx.visitId || "",
        date: todayISO(),
        medication: it.medication,
        dosage: it.dosage ?? "",
        frequency: it.frequency ?? "",
        duration: it.duration ?? "",
        qty: Number(line.qty || 0),
        rate: Number(line.rate || 0),
        medicineId: med?.id,
        stockDraws: draws.length > 0 ? draws : undefined,
      } as Pharm);
    }
    for (const b of working.values()) upsert<StockBatch>("batches", b);

    const flags = itemFlags(rx);
    for (const p of plans) flags[p.i] = true;
    upsert<Prescription>("prescriptions", {
      id: rx.id,
      itemDispensed: flags,
      dispenseStatus: fulfilStatus(flags, items.length),
      dispensedBy: user?.displayName ?? "Pharmacy",
      dispensedAt: Date.now(),
    });
    toast.success(`Dispensed ${plans.length} item${plans.length === 1 ? "" : "s"} — stock updated`);
    onClose();
  };

  return (
    <Modal
      open
      title={`Dispense — ${state.patients[rx.patientId]?.name ?? "patient"}`}
      onClose={onClose}
      wide
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {fmtDate(rx.date)} · {rx.doctor || "—"} · unticked lines stay on the counter queue.
      </p>
      <div className="space-y-2">
        {items.map((it, i) => {
          const already = rx.itemDispensed?.[i] === true;
          const med = matchMedicine(state, it.medication);
          const stock = med ? sellableStock(state, med.id) : null;
          const line = lines[i] ?? { include: false, qty: 1, rate: 0 };
          return (
            <div
              key={i}
              className={`flex flex-wrap items-center gap-2 rounded-lg border border-border/70 p-2.5 ${already ? "opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                className="ml-1 h-4 w-4"
                disabled={already}
                checked={already || line.include}
                onChange={(e) => setLine(i, { include: e.target.checked })}
              />
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium text-foreground">{it.medication}</p>
                <p className="text-xs text-muted-foreground">
                  {[it.dosage, it.frequency, it.duration].filter(Boolean).join(" · ") || "—"}
                  {already ? " · already dispensed" : ""}
                  {!already && med ? ` · ${stock} in stock` : ""}
                  {!already && !med ? " · not in catalog (no stock tracking)" : ""}
                </p>
              </div>
              {!already && med !== undefined && (stock ?? 0) < line.qty ? (
                <Badge tone="red">short</Badge>
              ) : null}
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Qty
                <Input
                  type="number"
                  min={0}
                  className="w-20 px-2 py-1"
                  disabled={already}
                  value={line.qty}
                  onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                ₹
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-24 px-2 py-1"
                  disabled={already}
                  value={line.rate}
                  onChange={(e) => setLine(i, { rate: Number(e.target.value) })}
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
        Selected total: <strong>₹{total.toFixed(2)}</strong>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>
          <CheckCheck className="h-4 w-4" /> Dispense selected
        </Button>
      </div>
    </Modal>
  );
}
