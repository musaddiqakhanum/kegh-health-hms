import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardCheck, Download, Pencil, Plus, Printer, Scan, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { fmtDate, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import {
  COMMON_IMAGING_STUDIES,
  IMAGING_ORDER_STATUSES,
  LAB_ORDER_PRIORITIES,
  type ImagingOrder,
  type ImagingOrderStatus,
  type Rad,
} from "@/lib/hms/types";
import {
  imagingQueueStats,
  nextImagingAction,
  searchImagingOrders,
  sortImagingOrders,
} from "@/lib/hms/imaging";
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
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/imaging-orders")({
  head: () => ({
    meta: [
      { title: "Imaging Orders — KEGH HMS" },
      {
        name: "description",
        content:
          "Imaging order queue — doctors order X-Ray / USG / CT / MRI, studies are performed, reports entered and linked.",
      },
      { property: "og:title", content: "Imaging Orders — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Imaging order queue — doctors order X-Ray / USG / CT / MRI, studies are performed, reports entered and linked.",
      },
    ],
  }),
  component: ImagingOrdersPage,
});

const blankOrder = (): Partial<ImagingOrder> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  study: "",
  priority: "Routine",
  status: "Ordered",
  orderedBy: "",
  notes: "",
});

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ImagingOrdersPage() {
  const { state, settings, upsert, remove } = useHms();
  const { user } = useSession();
  const [status, setStatus] = useState<"" | ImagingOrderStatus>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<ImagingOrder>>(blankOrder);
  const [chips, setChips] = useState<string[]>([]);
  const [reportFor, setReportFor] = useState<ImagingOrder | null>(null);
  const [printOrder, setPrintOrder] = useState<ImagingOrder | null>(null);

  const all = useMemo(
    () => sortImagingOrders(Object.values(state.imagingOrders ?? {})),
    [state.imagingOrders],
  );
  const stats = useMemo(() => imagingQueueStats(state), [state]);
  const filtered = searchImagingOrders(status ? all.filter((o) => o.status === status) : all, q);

  const openNew = () => {
    setForm({ ...blankOrder(), orderedBy: user?.displayName ?? "" });
    setChips([]);
    setOpen(true);
  };

  const openEdit = (o: ImagingOrder) => {
    setForm(o);
    const known: string[] = [];
    for (const t of (o.study || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (COMMON_IMAGING_STUDIES.includes(t)) known.push(t);
    }
    setChips(known);
    setOpen(true);
  };

  const toggleChip = (t: string) =>
    setChips((cs) => (cs.includes(t) ? cs.filter((c) => c !== t) : [...cs, t]));

  const saveOrder = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    const known = chips.join(", ");
    const extra = (form.study ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && !chips.includes(x))
      .join(", ");
    const study = [known, extra].filter(Boolean).join(", ");
    if (!study) {
      toast.error("Pick or type at least one study");
      return;
    }
    upsert<ImagingOrder>("imagingOrders", { ...form, study } as ImagingOrder);
    toast.success(form.id ? "Order updated" : "Imaging order placed");
    setOpen(false);
  };

  const markScanned = (o: ImagingOrder) => {
    upsert<ImagingOrder>("imagingOrders", {
      id: o.id,
      status: "Study done",
      performedDate: todayISO(),
      performedTime: hhmmNow(),
      performedBy: user?.displayName ?? settings.deviceName,
    });
    toast.success(`Study done — ${o.study}`);
  };

  const setStatusOf = (o: ImagingOrder, s: ImagingOrderStatus) => {
    upsert<ImagingOrder>("imagingOrders", { id: o.id, status: s });
    toast.success(`Order → ${s}`);
  };

  const del = (o: ImagingOrder) => {
    if (confirmDelete("this imaging order")) {
      remove("imagingOrders", o.id);
      toast.success("Order deleted");
    }
  };

  const exportCsv = () => {
    downloadCsv("imaging-orders.csv", [
      ["Date", "Patient", "Study", "Priority", "Status", "Ordered by", "Performed", "Performed by"],
      ...filtered.map((o) => [
        o.date,
        state.patients[o.patientId]?.name ?? "",
        o.study,
        o.priority,
        o.status,
        o.orderedBy,
        o.performedDate ? `${o.performedDate} ${o.performedTime ?? ""}`.trim() : "",
        o.performedBy ?? "",
      ]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Imaging Orders"
        subtitle={`${stats.awaitingScan} awaiting scan · ${stats.awaitingReport} awaiting report`}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> New order
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          className="w-56"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="">All orders ({all.length})</option>
          {IMAGING_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          className="max-w-xs"
          placeholder="Search study / doctor / notes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {stats.urgent > 0 ? <Badge tone="red">{stats.urgent} urgent in queue</Badge> : null}
      </div>

      <DataTable
        columns={[
          "Date",
          "Patient",
          "Study",
          "Priority",
          "Status",
          "Ordered by",
          "Performed",
          "Actions",
          "",
        ]}
        rowCount={filtered.length}
        empty="No imaging orders yet — order one from this page or the Doctor workspace."
      >
        {filtered.map((o) => {
          const action = nextImagingAction(o.status);
          const rad = o.radId ? state.rads[o.radId] : undefined;
          return (
            <tr key={o.id}>
              <Td className="whitespace-nowrap">{fmtDate(o.date)}</Td>
              <Td>
                <span className="font-medium">{state.patients[o.patientId]?.name ?? "—"}</span>
                <div className="text-xs text-muted-foreground">
                  {state.patients[o.patientId]?.mrn ?? ""}
                </div>
              </Td>
              <Td className="max-w-56">{o.study}</Td>
              <Td>
                {o.priority === "Urgent" ? (
                  <Badge tone="red">Urgent</Badge>
                ) : (
                  <Badge tone="neutral">Routine</Badge>
                )}
              </Td>
              <Td>
                <Select
                  className="w-40 py-1 text-xs"
                  value={o.status}
                  onChange={(e) => setStatusOf(o, e.target.value as ImagingOrderStatus)}
                >
                  {IMAGING_ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td>{o.orderedBy || "—"}</Td>
              <Td className="text-xs">
                {o.performedDate ? (
                  <>
                    {fmtDate(o.performedDate)} {o.performedTime}
                    <div className="text-muted-foreground">{o.performedBy}</div>
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {action === "scan" ? (
                  <Button
                    variant="outline"
                    className="mr-1 px-2 py-1 text-xs"
                    onClick={() => markScanned(o)}
                  >
                    <Scan className="h-3.5 w-3.5" /> Scan done
                  </Button>
                ) : null}
                {action === "report" ? (
                  <Button
                    variant="outline"
                    className="mr-1 px-2 py-1 text-xs"
                    onClick={() => setReportFor(o)}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Report
                  </Button>
                ) : null}
                {o.status === "Report ready" ? (
                  <Badge tone="green">
                    {rad?.radiologist ? `Ready — ${rad.radiologist}` : "Ready"}
                  </Badge>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  title="Print requisition slip"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setPrintOrder(o)}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  title="Edit order"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(o)}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  title="Delete order"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => del(o)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          );
        })}
      </DataTable>

      {/* order modal */}
      <Modal
        open={open}
        title={form.id ? "Edit imaging order" : "New imaging order"}
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
          <Field label="Order date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </Field>
          <Field label="Studies" required className="sm:col-span-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {COMMON_IMAGING_STUDIES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleChip(t)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
                    chips.includes(t)
                      ? "bg-accent text-accent-foreground ring-accent"
                      : "bg-background text-foreground ring-border hover:bg-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <Input
              placeholder="Selected chips + any extra studies, comma separated"
              value={form.study ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, study: e.target.value }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={form.priority ?? "Routine"}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: e.target.value as ImagingOrder["priority"] }))
              }
            >
              {LAB_ORDER_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ordered by">
            <Input
              placeholder="Doctor name"
              value={form.orderedBy ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, orderedBy: e.target.value }))}
            />
          </Field>
          <Field label="Clinical notes" className="sm:col-span-2">
            <Textarea
              placeholder="History, provisional diagnosis, views needed…"
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveOrder}>Save order</Button>
        </div>
      </Modal>

      {/* report modal */}
      <ReportModal order={reportFor} onClose={() => setReportFor(null)} />

      {/* printable requisition slip */}
      <PrintOverlay
        open={Boolean(printOrder)}
        title="Radiology Requisition"
        onClose={() => setPrintOrder(null)}
      >
        {printOrder ? (
          <div>
            <table className="mb-3">
              <tbody>
                <tr>
                  <td style={{ width: "40%" }}>
                    <strong>Patient:</strong> {state.patients[printOrder.patientId]?.name ?? "—"}
                  </td>
                  <td>
                    <strong>MRN:</strong> {state.patients[printOrder.patientId]?.mrn ?? "—"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Order date:</strong> {fmtDate(printOrder.date)}
                  </td>
                  <td>
                    <strong>Priority:</strong> {printOrder.priority}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Ordered by:</strong> {printOrder.orderedBy || "—"}
                  </td>
                  <td>
                    <strong>Status:</strong> {printOrder.status}
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              <strong>Studies requested:</strong> {printOrder.study}
            </p>
            {printOrder.notes ? (
              <p className="mt-2">
                <strong>Clinical notes:</strong> {printOrder.notes}
              </p>
            ) : null}
            <div className="mt-8 flex justify-between text-sm">
              <span>
                ______________________
                <br />
                Ordering doctor
              </span>
              <span>
                ______________________
                <br />
                Study performed by / time
              </span>
            </div>
          </div>
        ) : null}
      </PrintOverlay>
    </div>
  );
}

/* --------------------------------------------------------- report modal */

const blankReport = () => ({
  studyType: "",
  findings: "",
  impression: "",
  radiologist: "",
});

function ReportModal({ order, onClose }: { order: ImagingOrder | null; onClose: () => void }) {
  const { state, upsert } = useHms();
  const { user } = useSession();
  const [form, setForm] = useState(blankReport);

  /* Re-seed the form whenever a different order is opened. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (order && order.id !== seededFor) {
    setSeededFor(order.id);
    setForm({
      ...blankReport(),
      studyType: order.study.split(",")[0]?.trim() ?? "",
      radiologist: user?.displayName ?? "",
    });
  }
  if (!order) return null;

  const save = () => {
    if (!form.studyType.trim()) {
      toast.error("Study type is required");
      return;
    }
    if (!form.impression.trim()) {
      toast.error("Enter at least the impression");
      return;
    }
    const radId = upsert<Rad>("rads", {
      patientId: order.patientId,
      visitId: order.visitId || "",
      date: order.performedDate || todayISO(),
      studyType: form.studyType.trim(),
      findings: form.findings.trim(),
      impression: form.impression.trim(),
      radiologist: form.radiologist.trim(),
    } as Rad);
    upsert<ImagingOrder>("imagingOrders", { id: order.id, status: "Report ready", radId });
    toast.success("Report saved — order marked Report ready");
    onClose();
  };

  return (
    <Modal open title={`Report — ${order.study}`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-muted-foreground">
        Patient:{" "}
        <strong className="text-foreground">{state.patients[order.patientId]?.name ?? "—"}</strong>
        {order.study.includes(",") ? " — one study per report; repeat for each study." : ""}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Study type" required>
          <Input
            value={form.studyType}
            onChange={(e) => setForm((f) => ({ ...f, studyType: e.target.value }))}
          />
        </Field>
        <Field label="Radiologist">
          <Input
            value={form.radiologist}
            onChange={(e) => setForm((f) => ({ ...f, radiologist: e.target.value }))}
          />
        </Field>
        <Field label="Findings" className="sm:col-span-2">
          <Textarea
            rows={4}
            value={form.findings}
            onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))}
          />
        </Field>
        <Field label="Impression" required className="sm:col-span-2">
          <Textarea
            rows={3}
            value={form.impression}
            onChange={(e) => setForm((f) => ({ ...f, impression: e.target.value }))}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save report</Button>
      </div>
    </Modal>
  );
}
