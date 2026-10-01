import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  Package,
  PackagePlus,
  Pencil,
  Pill,
  Plus,
  Printer,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import {
  MED_CATEGORIES,
  MED_UNITS,
  type Grn,
  type GrnItem,
  type Med,
  type Pharm,
  type StockBatch,
  type StockDraw,
} from "@/lib/hms/types";
import {
  canDeleteGrn,
  currentMonth,
  expiryStatus,
  fmtExpiry,
  grnList,
  lowStockRows,
  medList,
  medStockRows,
  nextGrnNo,
  searchMeds,
  sellableStock,
  sortMedsByName,
  stockStatus,
  suggestedRate,
} from "@/lib/hms/inventory";
import { downloadCsv } from "@/lib/hms/csv";
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

export const Route = createFileRoute("/pharmacy")({
  head: () => ({
    meta: [
      { title: "Pharmacy — KEGH HMS" },
      {
        name: "description",
        content:
          "Pharmacy inventory with batches, expiry, GRN and reorder alerts, plus medicine dispensing.",
      },
      { property: "og:title", content: "Pharmacy — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Pharmacy inventory with batches, expiry, GRN and reorder alerts, plus medicine dispensing.",
      },
    ],
  }),
  component: PharmPage,
});

type Tab = "inventory" | "batches" | "grn" | "dispense";

/* ------------------------------------------------------------ blank forms */

const blankMed = (): Partial<Med> => ({
  name: "",
  genericName: "",
  category: "Tablet",
  unit: "tablet",
  reorderLevel: 0,
  saleRate: 0,
  supplier: "",
  hsn: "",
  active: true,
  notes: "",
});

const blankBatch = (): Partial<StockBatch> => ({
  medicineId: "",
  batchNo: "",
  expiry: "",
  qtyOnHand: 0,
  qtyReceived: 0,
  purchaseRate: 0,
  mrp: 0,
  supplier: "",
  notes: "",
});

const blankGrnRow = (): Partial<GrnItem> => ({
  medicineId: "",
  batchNo: "",
  expiry: "",
  qty: 1,
  freeQty: 0,
  purchaseRate: 0,
  mrp: 0,
});

const blankPharm = (): Partial<Pharm> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  medication: "",
  medicineId: "",
  dosage: "",
  frequency: "",
  duration: "",
  qty: 1,
  rate: 0,
});

/* ----------------------------------------------------------------- page */

function PharmPage() {
  const { state } = useHms();
  const [tab, setTab] = useState<Tab>("inventory");

  const grns = useMemo(() => grnList(state), [state]);
  const expiryRef = currentMonth();
  const allBatches = useMemo(
    () =>
      Object.values(state.batches ?? {}).sort(
        (a, b) => (a.expiry || "").localeCompare(b.expiry || "") || a.createdAt - b.createdAt,
      ),
    [state.batches],
  );
  const expiringCount = allBatches.filter(
    (b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, expiryRef) === "soon",
  ).length;
  const expiredCount = allBatches.filter(
    (b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, expiryRef) === "expired",
  ).length;

  return (
    <div>
      <PageHeader title="Pharmacy" subtitle="Inventory, batches, goods receipts and dispensing" />

      <div className="mb-4 inline-flex flex-wrap rounded-lg bg-muted p-1">
        {(
          [
            ["inventory", "Inventory"],
            ["batches", "Batches"],
            ["grn", `GRN (${grns.length})`],
            ["dispense", "Dispense"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {t === "batches" && expiringCount + expiredCount > 0 ? (
              <span
                className={cn(
                  "ml-1.5 inline-flex rounded-full px-1.5 text-xs font-semibold",
                  expiredCount > 0 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800",
                )}
              >
                {expiredCount + expiringCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "inventory" ? <InventoryTab goBatches={() => setTab("batches")} /> : null}
      {tab === "batches" ? <BatchesTab /> : null}
      {tab === "grn" ? <GrnTab /> : null}
      {tab === "dispense" ? <DispenseTab /> : null}
    </div>
  );
}

/* --------------------------------------------------------- shared pieces */

function StatusBadge({ status }: { status: "out" | "low" | "ok" }) {
  if (status === "out") return <Badge tone="red">Out of stock</Badge>;
  if (status === "low") return <Badge tone="amber">Low stock</Badge>;
  return <Badge tone="green">In stock</Badge>;
}

function ExpiryBadge({ expiry }: { expiry: string }) {
  const s = expiryStatus(expiry);
  if (s === "expired") return <Badge tone="red">Expired · {fmtExpiry(expiry)}</Badge>;
  if (s === "soon") return <Badge tone="amber">Expires {fmtExpiry(expiry)}</Badge>;
  if (s === "none") return <span className="text-muted-foreground">—</span>;
  return <span>{fmtExpiry(expiry)}</span>;
}

function KetStat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: "red" | "amber" | undefined;
  active?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg bg-card p-4 text-left shadow-sm ring-1 transition-shadow hover:shadow-md",
        active ? "ring-2 ring-accent" : "ring-border/60",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold text-foreground",
          tone === "red" && "text-red-700",
          tone === "amber" && "text-amber-700",
        )}
      >
        {value}
      </p>
    </button>
  );
}

/* --------------------------------------------------------- inventory tab */

function InventoryTab({ goBatches }: { goBatches: () => void }) {
  const { state, upsert, remove } = useHms();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "out" | "low">("all");
  const [open, setOpen] = useState(false);
  const [medForm, setMedForm] = useState<Partial<Med>>(blankMed);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState<Partial<StockBatch>>(blankBatch);

  const rows = useMemo(() => medStockRows(state), [state]);
  const alerts = useMemo(() => lowStockRows(state), [state]);
  const outCount = rows.filter((r) => r.status === "out").length;
  const lowCount = rows.filter((r) => r.status === "low").length;
  const expiring = useMemo(
    () =>
      Object.values(state.batches ?? {}).filter(
        (b) => Number(b.qtyOnHand || 0) > 0 && ["expired", "soon"].includes(expiryStatus(b.expiry)),
      ),
    [state.batches],
  );
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  const filtered = rows.filter((r) => {
    if (filter === "out" && r.status !== "out") return false;
    if (filter === "low" && r.status !== "low") return false;
    return searchMeds([r.med], q).length > 0;
  });

  const saveMed = () => {
    if (!medForm.name?.trim()) {
      toast.error("Medicine name is required");
      return;
    }
    upsert<Med>("meds", {
      ...medForm,
      reorderLevel: Number(medForm.reorderLevel || 0),
      saleRate: Number(medForm.saleRate || 0),
    } as Med);
    toast.success(medForm.id ? "Medicine updated" : "Medicine added to catalog");
    setOpen(false);
  };

  const deleteMed = (m: Med) => {
    const hasStock = Object.values(state.batches ?? {}).some((b) => b.medicineId === m.id);
    if (hasStock) {
      toast.error(
        "This medicine has stock batches — delete those first, or mark the medicine inactive.",
      );
      return;
    }
    if (confirmDelete(`"${m.name}" from the catalog`)) {
      remove("meds", m.id);
      toast.success("Medicine removed");
    }
  };

  const addStock = (medId?: string) => {
    const med = medId ? state.meds[medId] : undefined;
    setBatchForm({
      ...blankBatch(),
      medicineId: medId ?? "",
      supplier: med?.supplier ?? "",
      mrp: Number(med?.saleRate || 0),
    });
    setBatchOpen(true);
  };

  const saveBatch = () => {
    if (!batchForm.medicineId) {
      toast.error("Select a medicine");
      return;
    }
    if (!batchForm.batchNo?.trim()) {
      toast.error("Batch number is required");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(batchForm.expiry ?? "")) {
      toast.error("Pick the expiry month");
      return;
    }
    const qty = Number(batchForm.qtyOnHand || 0);
    if (qty <= 0 && !batchForm.id) {
      toast.error("Quantity must be above zero");
      return;
    }
    upsert<StockBatch>("batches", {
      ...batchForm,
      qtyOnHand: qty,
      qtyReceived: batchForm.id
        ? Number(batchForm.qtyReceived || 0)
        : Math.max(qty, Number(batchForm.qtyReceived || 0)),
      purchaseRate: Number(batchForm.purchaseRate || 0),
      mrp: Number(batchForm.mrp || 0),
    } as StockBatch);
    toast.success(batchForm.id ? "Batch updated" : "Stock added");
    setBatchOpen(false);
  };

  const exportCsv = () => {
    downloadCsv("pharmacy-inventory.csv", [
      [
        "Medicine",
        "Generic",
        "Category",
        "Unit",
        "Stock",
        "Sellable",
        "Reorder level",
        "Nearest expiry",
        "Status",
        "Supplier",
        "Stock value (₹)",
      ],
      ...filtered.map((r) => [
        r.med.name,
        r.med.genericName,
        r.med.category,
        r.med.unit,
        r.stock,
        r.sellable,
        r.med.reorderLevel,
        r.expiry ? fmtExpiry(r.expiry) : "",
        r.status,
        r.med.supplier,
        r.value.toFixed(2),
      ]),
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KetStat label="Catalog medicines" value={rows.length} />
        <KetStat
          label="Out of stock"
          value={outCount}
          tone={outCount ? "red" : undefined}
          active={filter === "out"}
          onClick={() => setFilter(filter === "out" ? "all" : "out")}
        />
        <KetStat
          label="Below reorder level"
          value={lowCount}
          tone={lowCount ? "amber" : undefined}
          active={filter === "low"}
          onClick={() => setFilter(filter === "low" ? "all" : "low")}
        />
        <KetStat label="Stock value (purchase)" value={money(totalValue)} />
      </div>

      {alerts.length > 0 || expiring.length > 0 ? (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/60">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              {alerts.length > 0 ? (
                <p className="font-medium text-foreground">
                  Reorder needed:{" "}
                  <span className="text-muted-foreground">
                    {alerts
                      .slice(0, 6)
                      .map((r) => `${r.med.name} (${r.stock} left)`)
                      .join(", ")}
                    {alerts.length > 6 ? ` +${alerts.length - 6} more` : ""}
                  </span>
                </p>
              ) : null}
              {expiring.length > 0 ? (
                <p className="mt-1 font-medium text-foreground">
                  Expiry watch:{" "}
                  <span className="text-muted-foreground">
                    {expiring.length} batch{expiring.length === 1 ? "" : "es"} expired or expiring
                    within 3 months — see the Batches tab.
                  </span>
                </p>
              ) : null}
            </div>
            <Button variant="outline" className="ml-auto" onClick={goBatches}>
              Open batches
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search name / generic / supplier"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => addStock()}>
            <PackagePlus className="h-4 w-4" /> Add stock
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button
            onClick={() => {
              setMedForm(blankMed());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New medicine
          </Button>
        </div>
      </div>

      <DataTable
        columns={[
          "Medicine",
          "Category",
          "Stock",
          "Reorder lvl",
          "Nearest expiry",
          "Sale rate",
          "Value",
          "Status",
          "",
        ]}
        rowCount={filtered.length}
        empty="No medicines in the catalog yet — add one, or post a GRN after creating the catalog."
      >
        {filtered.map((r) => (
          <tr key={r.med.id}>
            <Td>
              <div className="font-medium">
                <Pill className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                {r.med.name}
              </div>
              {r.med.genericName ? (
                <div className="text-xs text-muted-foreground">{r.med.genericName}</div>
              ) : null}
            </Td>
            <Td>
              {r.med.category || "—"}
              <div className="text-xs text-muted-foreground">per {r.med.unit || "unit"}</div>
            </Td>
            <Td className="font-medium">
              {r.stock}
              {r.sellable < r.stock ? (
                <div className="text-xs font-normal text-red-700">{r.sellable} sellable</div>
              ) : null}
            </Td>
            <Td>{r.med.reorderLevel || "—"}</Td>
            <Td>
              <ExpiryBadge expiry={r.expiry} />
            </Td>
            <Td>{r.med.saleRate ? money(r.med.saleRate) : "—"}</Td>
            <Td>{r.value ? money(r.value) : "—"}</Td>
            <Td>
              <StatusBadge status={stockStatus(r.stock, Number(r.med.reorderLevel || 0))} />
            </Td>
            <Td className="whitespace-nowrap">
              <button
                title="Add stock (new batch)"
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => addStock(r.med.id)}
              >
                <PackagePlus className="h-4 w-4" />
              </button>
              <button
                title="Edit medicine"
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMedForm(r.med);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                title="Delete medicine"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => deleteMed(r.med)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      {/* medicine modal */}
      <Modal
        open={open}
        title={medForm.id ? "Edit medicine" : "New medicine"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Medicine name" required>
            <Input
              placeholder="Dolo 650"
              value={medForm.name ?? ""}
              onChange={(e) => setMedForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Generic / salt name">
            <Input
              placeholder="Paracetamol 650 mg"
              value={medForm.genericName ?? ""}
              onChange={(e) => setMedForm((f) => ({ ...f, genericName: e.target.value }))}
            />
          </Field>
          <Field label="Category">
            <Input
              list="med-categories"
              value={medForm.category ?? ""}
              onChange={(e) => setMedForm((f) => ({ ...f, category: e.target.value }))}
            />
            <datalist id="med-categories">
              {MED_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Stock unit">
            <Select
              value={medForm.unit ?? "tablet"}
              onChange={(e) => setMedForm((f) => ({ ...f, unit: e.target.value }))}
            >
              {MED_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              {medForm.unit && !MED_UNITS.includes(medForm.unit) ? (
                <option value={medForm.unit}>{medForm.unit}</option>
              ) : null}
            </Select>
          </Field>
          <Field label="Reorder level">
            <Input
              type="number"
              min={0}
              value={medForm.reorderLevel ?? 0}
              onChange={(e) => setMedForm((f) => ({ ...f, reorderLevel: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Default sale rate (₹ / unit)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={medForm.saleRate ?? 0}
              onChange={(e) => setMedForm((f) => ({ ...f, saleRate: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Preferred supplier">
            <Input
              value={medForm.supplier ?? ""}
              onChange={(e) => setMedForm((f) => ({ ...f, supplier: e.target.value }))}
            />
          </Field>
          <Field label="HSN / product code">
            <Input
              value={medForm.hsn ?? ""}
              onChange={(e) => setMedForm((f) => ({ ...f, hsn: e.target.value }))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input
              value={medForm.notes ?? ""}
              onChange={(e) => setMedForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input
              type="checkbox"
              checked={medForm.active !== false}
              onChange={(e) => setMedForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Active — shown in pickers and stock reports
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveMed}>Save medicine</Button>
        </div>
      </Modal>

      {/* quick add stock modal (shared shape with the Batches tab modal is intentional:
          quantities here create a brand-new batch) */}
      <Modal
        open={batchOpen}
        title="Add stock — new batch"
        onClose={() => setBatchOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Medicine" required className="sm:col-span-2">
            <Select
              value={batchForm.medicineId ?? ""}
              onChange={(e) =>
                setBatchForm((f) => {
                  const med = state.meds[e.target.value];
                  return {
                    ...f,
                    medicineId: e.target.value,
                    supplier: f.supplier || med?.supplier || "",
                    mrp: Number(f.mrp || 0) > 0 ? Number(f.mrp) : Number(med?.saleRate || 0),
                  };
                })
              }
            >
              <option value="">Select medicine…</option>
              {medList(state).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.genericName ? `· ${m.genericName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Batch / lot no." required>
            <Input
              placeholder="B12345"
              value={batchForm.batchNo ?? ""}
              onChange={(e) => setBatchForm((f) => ({ ...f, batchNo: e.target.value }))}
            />
          </Field>
          <Field label="Expiry month" required>
            <Input
              type="month"
              value={batchForm.expiry ?? ""}
              onChange={(e) => setBatchForm((f) => ({ ...f, expiry: e.target.value }))}
            />
          </Field>
          <Field label="Quantity received" required>
            <Input
              type="number"
              min={0}
              value={batchForm.qtyOnHand ?? 0}
              onChange={(e) =>
                setBatchForm((f) => ({
                  ...f,
                  qtyOnHand: Number(e.target.value),
                  qtyReceived: Number(e.target.value),
                }))
              }
            />
          </Field>
          <Field label="Purchase rate (₹ / unit)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={batchForm.purchaseRate ?? 0}
              onChange={(e) =>
                setBatchForm((f) => ({ ...f, purchaseRate: Number(e.target.value) }))
              }
            />
          </Field>
          <Field label="MRP (₹ / unit)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={batchForm.mrp ?? 0}
              onChange={(e) => setBatchForm((f) => ({ ...f, mrp: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Supplier">
            <Input
              value={batchForm.supplier ?? ""}
              onChange={(e) => setBatchForm((f) => ({ ...f, supplier: e.target.value }))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input
              placeholder="Opening stock, free samples…"
              value={batchForm.notes ?? ""}
              onChange={(e) => setBatchForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          For supplier purchases with a bill, use the GRN tab instead — it keeps the invoice
          reference and one batch per bill line.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setBatchOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveBatch}>Add batch</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------- batches tab */

function BatchesTab() {
  const { state, upsert, remove } = useHms();
  const [filter, setFilter] = useState<"all" | "soon" | "expired">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<StockBatch>>(blankBatch);

  const rows = useMemo(
    () =>
      Object.values(state.batches ?? {}).sort(
        (a, b) => (a.expiry || "").localeCompare(b.expiry || "") || a.createdAt - b.createdAt,
      ),
    [state.batches],
  );
  const filtered = rows.filter((b) => {
    const s = expiryStatus(b.expiry);
    if (filter === "soon") return s === "soon" && Number(b.qtyOnHand || 0) > 0;
    if (filter === "expired") return s === "expired" && Number(b.qtyOnHand || 0) > 0;
    return true;
  });
  const medName = (id: string) => state.meds[id]?.name ?? "—";

  const save = () => {
    if (!form.medicineId) {
      toast.error("Select a medicine");
      return;
    }
    if (!form.batchNo?.trim()) {
      toast.error("Batch number is required");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(form.expiry ?? "")) {
      toast.error("Pick the expiry month");
      return;
    }
    upsert<StockBatch>("batches", {
      ...form,
      qtyOnHand: Number(form.qtyOnHand || 0),
      qtyReceived: form.id
        ? Number(form.qtyReceived || 0)
        : Math.max(Number(form.qtyOnHand || 0), Number(form.qtyReceived || 0)),
      purchaseRate: Number(form.purchaseRate || 0),
      mrp: Number(form.mrp || 0),
    } as StockBatch);
    toast.success(form.id ? "Batch updated" : "Stock added");
    setOpen(false);
  };

  const del = (b: StockBatch) => {
    if (Number(b.qtyOnHand || 0) < Number(b.qtyReceived || 0)) {
      toast.error(
        "This batch has already been dispensed from — adjust its quantity on hand instead of deleting.",
      );
      return;
    }
    if (confirmDelete(`batch ${b.batchNo || ""} (${b.qtyOnHand} units)`)) {
      remove("batches", b.id);
      toast.success("Batch deleted");
    }
  };

  const exportCsv = () => {
    downloadCsv("pharmacy-batches.csv", [
      [
        "Medicine",
        "Batch no",
        "Expiry",
        "Qty on hand",
        "Qty received",
        "Purchase rate",
        "MRP",
        "Supplier",
        "Source",
        "Notes",
      ],
      ...filtered.map((b) => [
        medName(b.medicineId),
        b.batchNo,
        fmtExpiry(b.expiry),
        b.qtyOnHand,
        b.qtyReceived,
        b.purchaseRate,
        b.mrp,
        b.supplier,
        b.grnId ? `GRN-${state.grns[b.grnId]?.grnNo ?? "?"}` : "Manual",
        b.notes,
      ]),
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-52"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">All batches ({rows.length})</option>
          <option value="soon">Expiring within 3 months</option>
          <option value="expired">Expired, still in stock</option>
        </Select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button
            onClick={() => {
              setForm(blankBatch());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add stock
          </Button>
        </div>
      </div>

      <DataTable
        columns={[
          "Medicine",
          "Batch",
          "Expiry",
          "On hand",
          "Received",
          "Purchase rate",
          "MRP",
          "Supplier",
          "Source",
          "",
        ]}
        rowCount={filtered.length}
        empty="No stock batches yet — post a GRN or add stock manually."
      >
        {filtered.map((b) => (
          <tr key={b.id}>
            <Td className="font-medium">{medName(b.medicineId)}</Td>
            <Td>{b.batchNo || "—"}</Td>
            <Td>
              <ExpiryBadge expiry={b.expiry} />
            </Td>
            <Td className="font-medium">{b.qtyOnHand}</Td>
            <Td>{b.qtyReceived}</Td>
            <Td>{b.purchaseRate ? money(b.purchaseRate) : "—"}</Td>
            <Td>{b.mrp ? money(b.mrp) : "—"}</Td>
            <Td>{b.supplier || "—"}</Td>
            <Td>
              {b.grnId ? (
                <Badge tone="neutral">GRN-{state.grns[b.grnId]?.grnNo ?? "?"}</Badge>
              ) : (
                <Badge tone="neutral">Manual</Badge>
              )}
              {b.notes ? <div className="mt-1 text-xs text-muted-foreground">{b.notes}</div> : null}
            </Td>
            <Td className="whitespace-nowrap">
              <button
                title="Edit / adjust batch"
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(b);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                title="Delete batch"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => del(b)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal
        open={open}
        title={form.id ? `Adjust batch ${form.batchNo || ""}` : "Add stock — new batch"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Medicine" required className="sm:col-span-2">
            <Select
              value={form.medicineId ?? ""}
              disabled={Boolean(form.id)}
              onChange={(e) => {
                const med = state.meds[e.target.value];
                setForm((f) => ({
                  ...f,
                  medicineId: e.target.value,
                  supplier: f.supplier || med?.supplier || "",
                  mrp: Number(f.mrp || 0) > 0 ? Number(f.mrp) : Number(med?.saleRate || 0),
                }));
              }}
            >
              <option value="">Select medicine…</option>
              {medList(state).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.genericName ? `· ${m.genericName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Batch / lot no." required>
            <Input
              value={form.batchNo ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, batchNo: e.target.value }))}
            />
          </Field>
          <Field label="Expiry month" required>
            <Input
              type="month"
              value={form.expiry ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
            />
          </Field>
          <Field
            label={
              form.id ? `Qty on hand (received ${form.qtyReceived ?? 0})` : "Quantity received"
            }
            required
          >
            <Input
              type="number"
              min={0}
              value={form.qtyOnHand ?? 0}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  qtyOnHand: Number(e.target.value),
                  ...(!f.id ? { qtyReceived: Number(e.target.value) } : {}),
                }))
              }
            />
          </Field>
          <Field label="Purchase rate (₹ / unit)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.purchaseRate ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, purchaseRate: Number(e.target.value) }))}
            />
          </Field>
          <Field label="MRP (₹ / unit)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.mrp ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, mrp: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Supplier">
            <Input
              value={form.supplier ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input
              placeholder="Reason for adjustments, e.g. 5 tabs broken"
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        {form.id ? (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Write-offs (damaged / expired stock) go through the qty on hand here — dispensing never
            touches this field directly.
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{form.id ? "Save batch" : "Add batch"}</Button>
        </div>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- GRN tab */

function GrnTab() {
  const { state, upsert, remove } = useHms();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [head, setHead] = useState<Partial<Grn>>({});
  const [lines, setLines] = useState<Partial<GrnItem>[]>([]);
  const [printGrn, setPrintGrn] = useState<Grn | null>(null);

  const rows = useMemo(() => grnList(state), [state]);
  const meds = useMemo(() => medList(state), [state]);

  const openNew = () => {
    setHead({
      date: todayISO(),
      supplier: "",
      invoiceNo: "",
      invoiceDate: todayISO(),
      receivedBy: user?.displayName ?? "",
      notes: "",
    });
    setLines([blankGrnRow()]);
    setOpen(true);
  };

  const setLine = (i: number, patch: Partial<GrnItem>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.purchaseRate || 0), 0);

  const post = () => {
    if (!head.supplier?.trim()) {
      toast.error("Supplier is required");
      return;
    }
    const usable = lines.filter((l) => l.medicineId);
    if (usable.length === 0) {
      toast.error("Add at least one item line");
      return;
    }
    for (const l of usable) {
      if (!l.batchNo?.trim()) {
        toast.error("Every line needs a batch number");
        return;
      }
      if (!/^\d{4}-\d{2}$/.test(l.expiry ?? "")) {
        toast.error("Every line needs an expiry month");
        return;
      }
      if (Number(l.qty || 0) + Number(l.freeQty || 0) <= 0) {
        toast.error("Every line needs a quantity");
        return;
      }
    }

    const grnId = crypto.randomUUID();
    const postedItems: GrnItem[] = usable.map((l) => {
      const batchId = crypto.randomUUID();
      const received = Number(l.qty || 0) + Number(l.freeQty || 0);
      upsert<StockBatch>("batches", {
        id: batchId,
        medicineId: l.medicineId!,
        batchNo: l.batchNo!.trim(),
        expiry: l.expiry!,
        qtyOnHand: received,
        qtyReceived: received,
        purchaseRate: Number(l.purchaseRate || 0),
        mrp: Number(l.mrp || 0),
        supplier: head.supplier!.trim(),
        grnId,
        notes: "",
      } as StockBatch);
      return {
        medicineId: l.medicineId!,
        medicineName: state.meds[l.medicineId!]?.name ?? "—",
        batchNo: l.batchNo!.trim(),
        expiry: l.expiry!,
        qty: Number(l.qty || 0),
        freeQty: Number(l.freeQty || 0),
        purchaseRate: Number(l.purchaseRate || 0),
        mrp: Number(l.mrp || 0),
        batchId,
      };
    });

    upsert<Grn>("grns", {
      id: grnId,
      grnNo: nextGrnNo(state),
      date: head.date || todayISO(),
      supplier: head.supplier.trim(),
      invoiceNo: head.invoiceNo ?? "",
      invoiceDate: head.invoiceDate ?? "",
      items: postedItems,
      total,
      receivedBy: head.receivedBy ?? "",
      notes: head.notes ?? "",
    } as Grn);
    toast.success(
      `GRN posted — ${postedItems.length} batch${postedItems.length === 1 ? "" : "es"} into stock`,
    );
    setOpen(false);
  };

  const del = (g: Grn) => {
    const check = canDeleteGrn(state, g.id);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    if (!confirmDelete(`GRN-${g.grnNo} along with its ${g.items.length} batch(es)`)) return;
    for (const b of Object.values(state.batches ?? {})) {
      if (b.grnId === g.id) remove("batches", b.id);
    }
    remove("grns", g.id);
    toast.success("GRN deleted and stock reversed");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Goods Receipt Notes — every posted GRN adds one stock batch per line.
        </p>
        <Button onClick={openNew} disabled={meds.length === 0}>
          <Truck className="h-4 w-4" /> New GRN
        </Button>
      </div>
      {meds.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Add medicines to the catalog first (Inventory tab → New medicine), then receive stock
            against them here.
          </p>
        </Card>
      ) : null}

      <DataTable
        columns={[
          "GRN",
          "Received",
          "Supplier",
          "Invoice",
          "Items",
          "Units",
          "Total",
          "Received by",
          "",
        ]}
        rowCount={rows.length}
        empty="No goods receipts posted yet."
      >
        {rows.map((g) => {
          const units = g.items.reduce((s, i) => s + i.qty + i.freeQty, 0);
          return (
            <tr key={g.id}>
              <Td className="font-medium">GRN-{g.grnNo}</Td>
              <Td className="whitespace-nowrap">{fmtDate(g.date)}</Td>
              <Td>{g.supplier}</Td>
              <Td>
                {g.invoiceNo || "—"}
                {g.invoiceDate ? (
                  <div className="text-xs text-muted-foreground">{fmtDate(g.invoiceDate)}</div>
                ) : null}
              </Td>
              <Td>{g.items.length}</Td>
              <Td>{units}</Td>
              <Td className="font-medium">{money(g.total)}</Td>
              <Td>{g.receivedBy || "—"}</Td>
              <Td className="whitespace-nowrap">
                <button
                  title="Print GRN"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setPrintGrn(g)}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  title="Delete GRN"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => del(g)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          );
        })}
      </DataTable>

      {/* new GRN modal */}
      <Modal
        open={open}
        title={`New goods receipt · will post as GRN-${nextGrnNo(state)}`}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier" required className="sm:col-span-2">
            <Input
              value={head.supplier ?? ""}
              onChange={(e) => setHead((h) => ({ ...h, supplier: e.target.value }))}
            />
          </Field>
          <Field label="Received on" required>
            <Input
              type="date"
              value={head.date ?? ""}
              onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))}
            />
          </Field>
          <Field label="Supplier invoice no.">
            <Input
              value={head.invoiceNo ?? ""}
              onChange={(e) => setHead((h) => ({ ...h, invoiceNo: e.target.value }))}
            />
          </Field>
          <Field label="Invoice date">
            <Input
              type="date"
              value={head.invoiceDate ?? ""}
              onChange={(e) => setHead((h) => ({ ...h, invoiceDate: e.target.value }))}
            />
          </Field>
          <Field label="Received by">
            <Input
              value={head.receivedBy ?? ""}
              onChange={(e) => setHead((h) => ({ ...h, receivedBy: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Item lines</h3>
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, blankGrnRow()])}>
              <Plus className="h-4 w-4" /> Add line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-border/70 p-3">
              <div className="grid gap-3 sm:grid-cols-6">
                <Field label="Medicine" required className="sm:col-span-2">
                  <Select
                    value={l.medicineId ?? ""}
                    onChange={(e) => {
                      const med = state.meds[e.target.value];
                      setLine(i, {
                        medicineId: e.target.value,
                        mrp: Number(l.mrp || 0) > 0 ? Number(l.mrp) : Number(med?.saleRate || 0),
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    {meds.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Batch no." required>
                  <Input
                    value={l.batchNo ?? ""}
                    onChange={(e) => setLine(i, { batchNo: e.target.value })}
                  />
                </Field>
                <Field label="Expiry" required>
                  <Input
                    type="month"
                    value={l.expiry ?? ""}
                    onChange={(e) => setLine(i, { expiry: e.target.value })}
                  />
                </Field>
                <Field label="Qty" required>
                  <Input
                    type="number"
                    min={0}
                    value={l.qty ?? 0}
                    onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Free qty">
                  <Input
                    type="number"
                    min={0}
                    value={l.freeQty ?? 0}
                    onChange={(e) => setLine(i, { freeQty: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Purchase rate (₹)">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.purchaseRate ?? 0}
                    onChange={(e) => setLine(i, { purchaseRate: Number(e.target.value) })}
                  />
                </Field>
                <Field label="MRP (₹)">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.mrp ?? 0}
                    onChange={(e) => setLine(i, { mrp: Number(e.target.value) })}
                  />
                </Field>
                <div className="flex items-end justify-between gap-2 sm:col-span-4">
                  <p className="text-sm text-muted-foreground">
                    Line value:{" "}
                    <strong className="text-foreground">
                      {money(Number(l.qty || 0) * Number(l.purchaseRate || 0))}
                    </strong>
                  </p>
                  <button
                    type="button"
                    title="Remove line"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            GRN total (excl. free qty): <strong>{money(total)}</strong>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={post}>
            <Package className="h-4 w-4" /> Post to stock
          </Button>
        </div>
      </Modal>

      {/* printable GRN */}
      <PrintOverlay
        open={Boolean(printGrn)}
        title={`Goods Receipt Note — GRN-${printGrn?.grnNo ?? ""}`}
        onClose={() => setPrintGrn(null)}
      >
        {printGrn ? (
          <div>
            <p>
              <strong>Supplier:</strong> {printGrn.supplier} · <strong>Received on:</strong>{" "}
              {fmtDate(printGrn.date)}
              {printGrn.invoiceNo ? (
                <>
                  {" "}
                  · <strong>Invoice:</strong> {printGrn.invoiceNo}
                  {printGrn.invoiceDate ? ` (${fmtDate(printGrn.invoiceDate)})` : ""}
                </>
              ) : null}
              {printGrn.receivedBy ? (
                <>
                  {" "}
                  · <strong>Received by:</strong> {printGrn.receivedBy}
                </>
              ) : null}
            </p>
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Qty</th>
                  <th>Free</th>
                  <th>Purchase rate</th>
                  <th>MRP</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {printGrn.items.map((i, k) => (
                  <tr key={k}>
                    <td>{i.medicineName}</td>
                    <td>{i.batchNo}</td>
                    <td>{fmtExpiry(i.expiry)}</td>
                    <td>{i.qty}</td>
                    <td>{i.freeQty || "—"}</td>
                    <td>{money(i.purchaseRate)}</td>
                    <td>{money(i.mrp)}</td>
                    <td>{money(i.qty * i.purchaseRate)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={7} style={{ textAlign: "right" }}>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{money(printGrn.total)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            {printGrn.notes ? (
              <p className="mt-2">
                <strong>Notes:</strong> {printGrn.notes}
              </p>
            ) : null}
          </div>
        ) : null}
      </PrintOverlay>
    </div>
  );
}

/* ----------------------------------------------------------- dispense tab */

function DispenseTab() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Pharm>>(blankPharm);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.pharms)), [state.pharms]);
  const meds = useMemo(() => sortMedsByName(Object.values(state.meds ?? {})), [state.meds]);

  const selectedMed = form.medicineId ? state.meds[form.medicineId] : undefined;
  const available = selectedMed ? sellableStock(state, selectedMed.id) : null;

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.medication?.trim()) {
      toast.error("Medication name is required");
      return;
    }
    const qty = Number(form.qty || 0);
    if (qty <= 0) {
      toast.error("Quantity must be above zero");
      return;
    }

    /* Rebuild batch quantities in memory: first return the previous draws of
       this entry to stock, then draw the new quantity FEFO-style. Only once the
       arithmetic works do we persist anything. */
    const prev = form.id ? state.pharms[form.id] : undefined;
    const working = new Map<string, StockBatch>();
    const take = (id: string) => working.get(id) ?? state.batches[id];

    for (const d of prev?.stockDraws ?? []) {
      const b = take(d.batchId);
      if (b) working.set(b.id, { ...b, qtyOnHand: Number(b.qtyOnHand || 0) + d.qty });
    }

    let draws: StockDraw[] = [];
    if (form.medicineId) {
      const ref = currentMonth();
      const sellable = Object.values(state.batches ?? {})
        .filter((b) => b.medicineId === form.medicineId)
        .map((b) => working.get(b.id) ?? b)
        .filter((b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, ref) !== "expired")
        .sort(
          (a, b) => (a.expiry || "").localeCompare(b.expiry || "") || a.createdAt - b.createdAt,
        );
      let remaining = qty;
      const nextDraws: StockDraw[] = [];
      for (const b of sellable) {
        if (remaining <= 0) break;
        const use = Math.min(Number(b.qtyOnHand || 0), remaining);
        if (use > 0) {
          nextDraws.push({ batchId: b.id, qty: use });
          working.set(b.id, { ...b, qtyOnHand: Number(b.qtyOnHand || 0) - use });
          remaining -= use;
        }
      }
      if (remaining > 0) {
        const have = qty - remaining;
        toast.error(
          have > 0
            ? `Only ${have} sellable unit${have === 1 ? "" : "s"} in stock (expired batches can't be dispensed)`
            : "No sellable stock for this medicine — receive stock first",
        );
        return;
      }
      draws = nextDraws;
    }

    for (const b of working.values()) {
      upsert<StockBatch>("batches", b);
    }
    upsert<Pharm>("pharms", {
      ...form,
      qty,
      rate: Number(form.rate || 0),
      medicineId: form.medicineId || undefined,
      stockDraws: draws.length > 0 ? draws : undefined,
    } as Pharm);
    toast.success(form.id ? "Entry updated" : "Dispensed and stock updated");
    setOpen(false);
  };

  const del = (p: Pharm) => {
    if (!confirmDelete("this entry")) return;
    for (const d of p.stockDraws ?? []) {
      const b = state.batches[d.batchId];
      if (b)
        upsert<StockBatch>("batches", { id: b.id, qtyOnHand: Number(b.qtyOnHand || 0) + d.qty });
    }
    remove("pharms", p.id);
    toast.success(
      (p.stockDraws?.length ?? 0) > 0 ? "Entry deleted and stock restored" : "Entry deleted",
    );
  };

  const amount = Number(form.qty || 0) * Number(form.rate || 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"} — catalog medicines draw stock down
          automatically (earliest expiry first).
        </p>
        <Button
          onClick={() => {
            setForm(blankPharm());
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New entry
        </Button>
      </div>

      <DataTable
        columns={["Date", "Patient", "Medication", "Dosage", "Qty", "Rate", "Amount", "Stock", ""]}
        rowCount={rows.length}
      >
        {rows.map((p) => {
          const drawn = (p.stockDraws ?? []).reduce((s, d) => s + d.qty, 0);
          return (
            <tr key={p.id}>
              <Td>{fmtDate(p.date)}</Td>
              <Td>{state.patients[p.patientId]?.name ?? "—"}</Td>
              <Td>
                {p.medication}
                {p.medicineId ? (
                  <div className="text-xs text-emerald-700">catalog · FEFO</div>
                ) : null}
              </Td>
              <Td>{[p.dosage, p.frequency, p.duration].filter(Boolean).join(" · ") || "—"}</Td>
              <Td>{p.qty}</Td>
              <Td>{money(p.rate)}</Td>
              <Td className="font-medium">{money(p.qty * p.rate)}</Td>
              <Td>{drawn > 0 ? <Badge tone="neutral">−{drawn} units</Badge> : "—"}</Td>
              <Td className="whitespace-nowrap">
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setForm(p);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => del(p)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          );
        })}
      </DataTable>

      <Modal
        open={open}
        title={form.id ? "Edit dispense entry" : "New dispense entry"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker
              value={form.patientId ?? ""}
              onChange={(id) => setForm((f) => ({ ...f, patientId: id, visitId: "" }))}
            />
          </Field>
          <Field label="Linked visit">
            <VisitPicker
              patientId={form.patientId ?? ""}
              value={form.visitId ?? ""}
              onChange={(id) => setForm((f) => ({ ...f, visitId: id }))}
            />
          </Field>
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </Field>
          <Field label="Medicine from inventory" className="sm:col-span-2">
            <Select
              value={form.medicineId ?? ""}
              onChange={(e) => {
                const med = state.meds[e.target.value];
                setForm((f) =>
                  med
                    ? {
                        ...f,
                        medicineId: med.id,
                        medication: med.name,
                        rate: suggestedRate(state, med),
                      }
                    : { ...f, medicineId: "" },
                );
              }}
            >
              <option value="">— One-off entry (type name below, no stock tracking) —</option>
              {meds.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.genericName ? ` · ${m.genericName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {selectedMed ? (
            <p
              className={cn(
                "rounded-md px-3 py-2 text-sm sm:col-span-2",
                (available ?? 0) >= Number(form.qty || 0)
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-red-50 text-red-800",
              )}
            >
              Sellable stock: <strong>{available ?? 0}</strong> {selectedMed.unit || "unit"}(s) —
              dispensed earliest-expiry-first.
            </p>
          ) : null}
          <Field label="Medication" required>
            <Input
              value={form.medication ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, medication: e.target.value }))}
            />
          </Field>
          <Field label="Dosage">
            <Input
              placeholder="500 mg"
              value={form.dosage ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, dosage: e.target.value }))}
            />
          </Field>
          <Field label="Frequency">
            <Input
              placeholder="1-0-1"
              value={form.frequency ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
            />
          </Field>
          <Field label="Duration">
            <Input
              placeholder="5 days"
              value={form.duration ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
            />
          </Field>
          <Field label="Quantity">
            <Input
              type="number"
              min={0}
              value={form.qty ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Rate per unit (₹)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.rate ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) }))}
            />
          </Field>
          <div className="rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
            Amount: <strong>{money(amount)}</strong>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save entry</Button>
        </div>
      </Modal>
    </div>
  );
}
