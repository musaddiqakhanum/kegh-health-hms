import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardCheck, Download, Pencil, Plus, Printer, TestTube2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import {
  COMMON_LAB_TESTS,
  LAB_ORDER_PRIORITIES,
  LAB_ORDER_STATUSES,
  type Lab,
  type LabOrder,
  type LabOrderStatus,
} from "@/lib/hms/types";
import { nextAction, orderQueueStats, searchOrders, sortOrders } from "@/lib/hms/laborders";
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

export const Route = createFileRoute("/lab-orders")({
  head: () => ({
    meta: [
      { title: "Lab Orders — KEGH HMS" },
      {
        name: "description",
        content:
          "Lab order queue — doctors order tests, samples are collected, results entered and linked.",
      },
      { property: "og:title", content: "Lab Orders — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Lab order queue — doctors order tests, samples are collected, results entered and linked.",
      },
    ],
  }),
  component: LabOrdersPage,
});

const blankOrder = (): Partial<LabOrder> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  tests: "",
  priority: "Routine",
  status: "Ordered",
  orderedBy: "",
  notes: "",
});

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusTone(s: LabOrderStatus): "green" | "amber" | "red" | "neutral" {
  if (s === "Ordered") return "amber";
  if (s === "Sample collected") return "amber";
  if (s === "Result ready") return "green";
  return "neutral";
}

function LabOrdersPage() {
  const { state, settings, upsert, remove } = useHms();
  const { user } = useSession();
  const [status, setStatus] = useState<"" | LabOrderStatus>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<LabOrder>>(blankOrder);
  const [chips, setChips] = useState<string[]>([]);
  const [resultFor, setResultFor] = useState<LabOrder | null>(null);
  const [printOrder, setPrintOrder] = useState<LabOrder | null>(null);

  const all = useMemo(() => sortOrders(Object.values(state.labOrders ?? {})), [state.labOrders]);
  const stats = useMemo(() => orderQueueStats(state), [state]);
  const filtered = searchOrders(status ? all.filter((o) => o.status === status) : all, q);

  const openNew = () => {
    setForm({ ...blankOrder(), orderedBy: user?.displayName ?? "" });
    setChips([]);
    setOpen(true);
  };

  const openEdit = (o: LabOrder) => {
    setForm(o);
    const known: string[] = [];
    for (const t of (o.tests || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (COMMON_LAB_TESTS.includes(t)) known.push(t);
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
    const extra = (form.tests ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && !chips.includes(x))
      .join(", ");
    const tests = [known, extra].filter(Boolean).join(", ");
    if (!tests) {
      toast.error("Pick or type at least one test");
      return;
    }
    upsert<LabOrder>("labOrders", { ...form, tests } as LabOrder);
    toast.success(form.id ? "Order updated" : "Lab order placed");
    setOpen(false);
  };

  const collectSample = (o: LabOrder) => {
    upsert<LabOrder>("labOrders", {
      id: o.id,
      status: "Sample collected",
      collectedDate: todayISO(),
      collectedTime: hhmmNow(),
      collectedBy: user?.displayName ?? settings.deviceName,
    });
    toast.success(`Sample collected — ${o.tests}`);
  };

  const setStatusOf = (o: LabOrder, s: LabOrderStatus) => {
    upsert<LabOrder>("labOrders", { id: o.id, status: s });
    toast.success(`Order → ${s}`);
  };

  const del = (o: LabOrder) => {
    if (confirmDelete("this lab order")) {
      remove("labOrders", o.id);
      toast.success("Order deleted");
    }
  };

  const exportCsv = () => {
    downloadCsv("lab-orders.csv", [
      [
        "Date",
        "Patient",
        "Tests",
        "Priority",
        "Status",
        "Ordered by",
        "Sample collected",
        "Collected by",
      ],
      ...filtered.map((o) => [
        o.date,
        state.patients[o.patientId]?.name ?? "",
        o.tests,
        o.priority,
        o.status,
        o.orderedBy,
        o.collectedDate ? `${o.collectedDate} ${o.collectedTime ?? ""}`.trim() : "",
        o.collectedBy ?? "",
      ]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Lab Orders"
        subtitle={`${stats.awaitingSample} awaiting sample · ${stats.awaitingResult} awaiting result`}
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
          {LAB_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          className="max-w-xs"
          placeholder="Search tests / doctor / notes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {stats.urgent > 0 ? <Badge tone="red">{stats.urgent} urgent awaiting sample</Badge> : null}
      </div>

      <DataTable
        columns={[
          "Date",
          "Patient",
          "Tests",
          "Priority",
          "Status",
          "Ordered by",
          "Sample",
          "Actions",
          "",
        ]}
        rowCount={filtered.length}
        empty="No lab orders yet — order one from this page, the Doctor workspace or a patient file."
      >
        {filtered.map((o) => {
          const action = nextAction(o.status);
          return (
            <tr key={o.id}>
              <Td className="whitespace-nowrap">{fmtDate(o.date)}</Td>
              <Td>
                <span className="font-medium">{state.patients[o.patientId]?.name ?? "—"}</span>
                <div className="text-xs text-muted-foreground">
                  {state.patients[o.patientId]?.mrn ?? ""}
                </div>
              </Td>
              <Td className="max-w-56">{o.tests}</Td>
              <Td>
                {o.priority === "Urgent" ? (
                  <Badge tone="red">Urgent</Badge>
                ) : (
                  <Badge tone="neutral">Routine</Badge>
                )}
              </Td>
              <Td>
                <Select
                  className="w-44 py-1 text-xs"
                  value={o.status}
                  onChange={(e) => setStatusOf(o, e.target.value as LabOrderStatus)}
                >
                  {LAB_ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td>{o.orderedBy || "—"}</Td>
              <Td className="text-xs">
                {o.collectedDate ? (
                  <>
                    {fmtDate(o.collectedDate)} {o.collectedTime}
                    <div className="text-muted-foreground">{o.collectedBy}</div>
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {action === "collect" ? (
                  <Button
                    variant="outline"
                    className="mr-1 px-2 py-1 text-xs"
                    onClick={() => collectSample(o)}
                  >
                    <TestTube2 className="h-3.5 w-3.5" /> Collect
                  </Button>
                ) : null}
                {action === "result" ? (
                  <Button
                    variant="outline"
                    className="mr-1 px-2 py-1 text-xs"
                    onClick={() => setResultFor(o)}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Result
                  </Button>
                ) : null}
                {o.status === "Result ready" && o.labResultId && state.labs[o.labResultId] ? (
                  <Badge tone="green">
                    {state.labs[o.labResultId]!.flag === "critical"
                      ? "⚠ critical"
                      : state.labs[o.labResultId]!.flag}
                  </Badge>
                ) : o.status === "Result ready" ? (
                  <Badge tone="green">Ready</Badge>
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
        title={form.id ? "Edit lab order" : "New lab order"}
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
          <Field label="Tests" required className="sm:col-span-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {COMMON_LAB_TESTS.map((t) => (
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
              placeholder="Selected chips + any extra tests, comma separated"
              value={form.tests ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, tests: e.target.value }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={form.priority ?? "Routine"}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: e.target.value as LabOrder["priority"] }))
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
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              placeholder="Clinical notes for the lab…"
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

      {/* result modal */}
      <ResultModal order={resultFor} onClose={() => setResultFor(null)} />

      {/* printable requisition slip */}
      <PrintOverlay
        open={Boolean(printOrder)}
        title="Laboratory Requisition"
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
              <strong>Tests requested:</strong> {printOrder.tests}
            </p>
            {printOrder.notes ? (
              <p className="mt-2">
                <strong>Notes:</strong> {printOrder.notes}
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
                Sample collected by / time
              </span>
            </div>
          </div>
        ) : null}
      </PrintOverlay>
    </div>
  );
}

/* --------------------------------------------------------- result modal */

const blankResult = () => ({
  testName: "",
  result: "",
  unit: "",
  normalRange: "",
  flag: "normal",
  technician: "",
});

function ResultModal({ order, onClose }: { order: LabOrder | null; onClose: () => void }) {
  const { state, upsert } = useHms();
  const { user } = useSession();
  const [form, setForm] = useState(blankResult);

  /* Re-seed the form whenever a different order is opened. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (order && order.id !== seededFor) {
    setSeededFor(order.id);
    setForm({
      ...blankResult(),
      testName: order.tests.split(",")[0]?.trim() ?? "",
      technician: user?.displayName ?? "",
    });
  }
  if (!order) return null;

  const save = () => {
    if (!form.testName.trim()) {
      toast.error("Test name is required");
      return;
    }
    if (!form.result.trim()) {
      toast.error("Enter the result value");
      return;
    }
    const labId = upsert<Lab>("labs", {
      patientId: order.patientId,
      visitId: order.visitId || "",
      date: todayISO(),
      testName: form.testName.trim(),
      result: form.result.trim(),
      unit: form.unit.trim(),
      normalRange: form.normalRange.trim(),
      flag: form.flag,
      technician: form.technician.trim(),
    } as Lab);
    upsert<LabOrder>("labOrders", { id: order.id, status: "Result ready", labResultId: labId });
    toast.success("Result saved — order marked Result ready");
    onClose();
  };

  return (
    <Modal open title={`Result — ${order.tests}`} onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        Patient:{" "}
        <strong className="text-foreground">{state.patients[order.patientId]?.name ?? "—"}</strong>
        {order.tests.includes(",") ? " — one test per entry; repeat for each test." : ""}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Test" required>
          <Input
            value={form.testName}
            onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))}
          />
        </Field>
        <Field label="Result" required>
          <Input
            value={form.result}
            onChange={(e) => setForm((f) => ({ ...f, result: e.target.value }))}
          />
        </Field>
        <Field label="Unit">
          <Input
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
        </Field>
        <Field label="Reference range">
          <Input
            value={form.normalRange}
            onChange={(e) => setForm((f) => ({ ...f, normalRange: e.target.value }))}
          />
        </Field>
        <Field label="Flag">
          <Select
            value={form.flag}
            onChange={(e) => setForm((f) => ({ ...f, flag: e.target.value }))}
          >
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="low">low</option>
            <option value="critical">critical</option>
          </Select>
        </Field>
        <Field label="Technician">
          <Input
            value={form.technician}
            onChange={(e) => setForm((f) => ({ ...f, technician: e.target.value }))}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save result</Button>
      </div>
    </Modal>
  );
}
