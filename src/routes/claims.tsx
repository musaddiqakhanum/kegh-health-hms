import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  Download,
  FileCheck2,
  IndianRupee,
  Pencil,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { fmtDate, fmtDateTime, money, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import {
  activePayers,
  claimAgeDays,
  claimList,
  claimPending,
  claimQueueStats,
  claimTone,
  claimStats,
  claimsForPayer,
  defaultDocs,
  docsReady,
  isOpenClaim,
  isOverdue,
  nextClaimStep,
  nextClaimNo,
  normalizeDocs,
  payerList,
  searchClaims,
  searchPayers,
  settledStatus,
  settlementDelta,
  submittedAt,
} from "@/lib/hms/claims";
import {
  BILL_PAYMENT_MODES,
  CLAIM_DOCUMENTS,
  CLAIM_STATUSES,
  PAYER_TYPES,
  type Admission,
  type Bill,
  type Claim,
  type ClaimDoc,
  type ClaimStatus,
  type Payer,
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

export const Route = createFileRoute("/claims")({
  head: () => ({
    meta: [
      { title: "Insurance Claims — KEGH HMS" },
      {
        name: "description",
        content:
          "Insurance and PM-JAY claims desk — pre-auth, claim submission, settlement tracking and payer master.",
      },
      { property: "og:title", content: "Insurance Claims — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Insurance and PM-JAY claims desk — pre-auth, claim submission, settlement tracking and payer master.",
      },
    ],
  }),
  component: ClaimsPage,
});

/* ----------------------------------------------------------------- helpers */

/** Co-pay vs payer money decides which bill payment mode a settlement posts under. */
function settlementMode(payer: Payer | undefined): string {
  return payer?.type === "Government scheme" ? "Scheme (PM-JAY)" : "Insurance / TPA";
}

type ClaimForm = {
  id?: string;
  claimNo: number;
  patientId: string;
  visitId: string;
  admissionId: string;
  billId: string;
  payerId: string;
  scheme: string;
  policyNo: string;
  date: string;
  treatment: string;
  admissionDate: string;
  dischargeDate: string;
  packageCode: string;
  claimedAmount: number;
  approvedAmount: number;
  patientShare: number;
  reference: string;
  docs: ClaimDoc[];
  notes: string;
  preparedBy: string;
};

const blankClaim = (claimNo: number, preparedBy: string): ClaimForm => ({
  claimNo,
  patientId: "",
  visitId: "",
  admissionId: "",
  billId: "",
  payerId: "",
  scheme: "",
  policyNo: "",
  date: todayISO(),
  treatment: "",
  admissionDate: "",
  dischargeDate: "",
  packageCode: "",
  claimedAmount: 0,
  approvedAmount: 0,
  patientShare: 0,
  reference: "",
  docs: defaultDocs(),
  notes: "",
  preparedBy,
});

function claimToForm(c: Claim): ClaimForm {
  return {
    id: c.id,
    claimNo: c.claimNo,
    patientId: c.patientId,
    visitId: c.visitId || "",
    admissionId: c.admissionId || "",
    billId: c.billId || "",
    payerId: c.payerId || "",
    scheme: c.scheme || "",
    policyNo: c.policyNo || "",
    date: c.date,
    treatment: c.treatment || "",
    admissionDate: c.admissionDate || "",
    dischargeDate: c.dischargeDate || "",
    packageCode: c.packageCode || "",
    claimedAmount: Number(c.claimedAmount || 0),
    approvedAmount: Number(c.approvedAmount || 0),
    patientShare: Number(c.patientShare || 0),
    reference: c.reference || "",
    docs: normalizeDocs(c.docs),
    notes: c.notes || "",
    preparedBy: c.preparedBy || "",
  };
}

/* --------------------------------------------------------------------- page */

type Tab = "register" | "payers";

function ClaimsPage() {
  const { state, settings, upsert, remove } = useHms();
  const { user } = useSession();
  const who = user?.displayName ?? settings.deviceName;

  const [tab, setTab] = useState<Tab>("register");
  const [status, setStatus] = useState<"" | ClaimStatus>("");
  const [payerFilter, setPayerFilter] = useState("");
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ClaimForm>(() => blankClaim(1, who));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settleFor, setSettleFor] = useState<Claim | null>(null);
  const [printClaim, setPrintClaim] = useState<Claim | null>(null);

  const stats = useMemo(() => claimQueueStats(state), [state]);
  const all = useMemo(() => claimList(state), [state]);
  const payers = useMemo(() => activePayers(state), [state]);

  const filtered = useMemo(() => {
    let rows = all;
    if (status) rows = rows.filter((c) => c.status === status);
    if (payerFilter) rows = rows.filter((c) => c.payerId === payerFilter);
    if (openOnly) rows = rows.filter(isOpenClaim);
    return searchClaims(
      rows,
      q,
      (id) => `${state.patients[id]?.name ?? ""} ${state.patients[id]?.mrn ?? ""}`,
    );
  }, [all, status, payerFilter, openOnly, q, state.patients]);

  const filteredStats = useMemo(() => claimStats(filtered), [filtered]);
  const detail = detailId ? state.claims[detailId] : undefined;

  const openNew = () => {
    setForm(blankClaim(nextClaimNo(state), who));
    setFormOpen(true);
  };

  const openEdit = (c: Claim) => {
    setForm(claimToForm(c));
    setFormOpen(true);
  };

  const saveClaim = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.payerId) {
      toast.error("Pick the payer / scheme");
      return;
    }
    if (!form.treatment.trim()) {
      toast.error("Enter the diagnosis or procedure being claimed");
      return;
    }
    const record: Claim = {
      id: form.id ?? crypto.randomUUID(),
      claimNo: form.claimNo,
      patientId: form.patientId,
      visitId: form.visitId,
      admissionId: form.admissionId,
      billId: form.billId,
      payerId: form.payerId,
      payerName: state.payers[form.payerId]?.name ?? "",
      scheme: form.scheme,
      policyNo: form.policyNo,
      date: form.date,
      treatment: form.treatment.trim(),
      admissionDate: form.admissionDate,
      dischargeDate: form.dischargeDate,
      packageCode: form.packageCode,
      claimedAmount: Number(form.claimedAmount || 0),
      approvedAmount: Number(form.approvedAmount || 0),
      settledAmount: form.id ? Number(state.claims[form.id]?.settledAmount || 0) : 0,
      patientShare: Number(form.patientShare || 0),
      status: form.id ? (state.claims[form.id]?.status ?? "Preparing") : "Preparing",
      reference: form.reference,
      docs: normalizeDocs(form.docs),
      events: form.id
        ? (state.claims[form.id]?.events ?? [])
        : [{ at: Date.now(), status: "Preparing", by: who, note: "Claim file opened" }],
      notes: form.notes,
      preparedBy: form.preparedBy,
      settledOn: form.id ? (state.claims[form.id]?.settledOn ?? "") : "",
      settlementRef: form.id ? (state.claims[form.id]?.settlementRef ?? "") : "",
      settlementPosted: form.id ? Number(state.claims[form.id]?.settlementPosted || 0) : 0,
      createdAt: form.id ? (state.claims[form.id]?.createdAt ?? Date.now()) : Date.now(),
    };
    upsert<Claim>("claims", record);
    toast.success(form.id ? "Claim updated" : `Claim CLM-${record.claimNo} opened`);
    setFormOpen(false);
  };

  /** Move a claim along the workflow, stamping who did it and when. */
  const moveStatus = (claim: Claim, to: ClaimStatus, note = "") => {
    const events = [...(claim.events ?? []), { at: Date.now(), status: to, by: who, note }].slice(
      -60,
    );
    upsert<Claim>("claims", { id: claim.id, status: to, events });
    toast.success(`CLM-${claim.claimNo} → ${to}`);
  };

  const runStep = (claim: Claim) => {
    const step = nextClaimStep(claim.status);
    if (!step) return;
    if (step.kind === "settle") {
      setSettleFor(claim);
      return;
    }
    moveStatus(claim, step.to);
  };

  const del = (c: Claim) => {
    if (confirmDelete(`claim CLM-${c.claimNo}`)) {
      remove("claims", c.id);
      toast.success("Claim deleted");
    }
  };

  /** Post whatever of the settlement has not reached the patient's bill yet. */
  const postToBill = (claim: Claim) => {
    const bill = claim.billId ? state.bills[claim.billId] : undefined;
    if (!bill) {
      toast.error("This claim is not linked to a bill — link one from Edit");
      return;
    }
    const delta = Number(claim.settledAmount || 0) - Number(claim.settlementPosted || 0);
    if (delta <= 0) {
      toast.info("The settlement is already posted to the bill");
      return;
    }
    const payer = state.payers[claim.payerId];
    const total = Number(bill.totalAmount || 0);
    const paid = Math.min(Number(bill.paid || 0) + delta, total);
    upsert<Bill>("bills", {
      id: bill.id,
      paid,
      due: Math.max(0, total - paid),
      paymentMode: settlementMode(payer),
      payerId: claim.payerId,
      payerName: claim.payerName,
    });
    upsert<Claim>("claims", {
      id: claim.id,
      settlementPosted: Number(claim.settlementPosted || 0) + delta,
    });
    toast.success(`${money(delta)} posted to the patient's bill`);
  };

  const exportCsv = () => {
    downloadCsv("insurance-claims.csv", [
      [
        "Claim no",
        "Date",
        "Patient",
        "MRN",
        "Payer",
        "Scheme",
        "Policy / card",
        "Treatment",
        "Admission",
        "Discharge",
        "Claimed",
        "Approved",
        "Settled",
        "Patient share",
        "Pending",
        "Status",
        "Insurer reference",
        "Docs ready",
        "Age (days)",
        "Settled on",
        "Settlement reference",
        "Notes",
      ],
      ...filtered.map((c) => [
        `CLM-${c.claimNo}`,
        c.date,
        state.patients[c.patientId]?.name ?? "",
        state.patients[c.patientId]?.mrn ?? "",
        c.payerName,
        c.scheme,
        c.policyNo,
        c.treatment,
        c.admissionDate,
        c.dischargeDate,
        c.claimedAmount,
        c.approvedAmount,
        c.settledAmount,
        c.patientShare,
        claimPending(c),
        c.status,
        c.reference,
        `${docsReady(c)}/${(c.docs ?? []).length}`,
        claimAgeDays(c),
        c.settledOn,
        c.settlementRef,
        c.notes.replace(/\s+/g, " "),
      ]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Insurance Claims"
        subtitle={
          stats.total === 0
            ? "Raise claims against insurers and schemes, and chase what is due"
            : `${stats.open} open · ${stats.awaitingSettlement} with the payer · ${money(stats.pendingAmount)} pending`
        }
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> New claim
            </Button>
          </>
        }
      />

      <div className="mb-4 inline-flex flex-wrap rounded-lg bg-muted p-1">
        {(
          [
            ["register", `Claim register (${stats.open} open)`],
            ["payers", `Payers & schemes (${payerList(state).length})`],
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
          </button>
        ))}
      </div>

      {tab === "register" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Awaiting pre-auth
              </p>
              <p className="mt-1.5 text-2xl font-semibold">{stats.preAuthPending}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending with payer
              </p>
              <p className="mt-1.5 text-2xl font-semibold">{money(stats.pendingAmount)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Settled this month
              </p>
              <p className="mt-1.5 text-2xl font-semibold">{money(stats.settledThisMonthAmount)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Overdue follow-ups
              </p>
              <p
                className={cn(
                  "mt-1.5 text-2xl font-semibold",
                  stats.overdue > 0 && "text-destructive",
                )}
              >
                {stats.overdue}
              </p>
            </Card>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select
              className="w-56"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All statuses ({all.length})</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select
              className="w-64"
              value={payerFilter}
              onChange={(e) => setPayerFilter(e.target.value)}
            >
              <option value="">All payers</option>
              {payerList(state).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active === false ? " (inactive)" : ""}
                </option>
              ))}
            </Select>
            <Input
              className="max-w-xs"
              placeholder="Search patient, payer, reference…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button
              variant={openOnly ? "primary" : "outline"}
              onClick={() => setOpenOnly((v) => !v)}
            >
              Open only
            </Button>
            {stats.overdue > 0 ? (
              <Badge tone="red">{stats.overdue} past the payer's settlement window</Badge>
            ) : null}
          </div>

          <p className="mb-2 text-sm text-muted-foreground">
            Showing <strong className="text-foreground">{filtered.length}</strong> claim
            {filtered.length === 1 ? "" : "s"} · claimed {money(filteredStats.claimed)} · settled{" "}
            {money(filteredStats.settled)} · pending {money(filteredStats.pending)} ·{" "}
            {filteredStats.settlementRate}% of claimed money received
          </p>

          <DataTable
            columns={[
              "Claim",
              "Date",
              "Patient",
              "Payer / scheme",
              "Treatment",
              "Claimed",
              "Approved",
              "Settled",
              "Status",
              "Age",
              "Actions",
              "",
            ]}
            rowCount={filtered.length}
            empty="No claims yet — raise one from here or from a patient's bill."
          >
            {filtered.map((c) => {
              const payer = state.payers[c.payerId];
              const step = nextClaimStep(c.status);
              const overdue = isOverdue(c, payer);
              return (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap font-medium">
                    CLM-{c.claimNo}
                    {c.billId ? (
                      <div className="text-xs font-normal text-muted-foreground">billed</div>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDate(c.date)}</Td>
                  <Td>
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: c.patientId }}
                      className="font-medium text-accent underline"
                    >
                      {state.patients[c.patientId]?.name ?? "—"}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {state.patients[c.patientId]?.mrn ?? ""}
                    </div>
                  </Td>
                  <Td className="max-w-52">
                    {c.payerName}
                    <div className="text-xs text-muted-foreground">{c.scheme || "—"}</div>
                  </Td>
                  <Td className="max-w-48 text-xs">{c.treatment}</Td>
                  <Td className="whitespace-nowrap">{money(c.claimedAmount)}</Td>
                  <Td className="whitespace-nowrap">{money(c.approvedAmount)}</Td>
                  <Td className="whitespace-nowrap">{money(c.settledAmount)}</Td>
                  <Td>
                    <Badge tone={claimTone(c.status)}>{c.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {claimAgeDays(c)}d
                    {overdue ? (
                      <div>
                        <Badge tone="red">overdue</Badge>
                      </div>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {step ? (
                      <Button
                        variant="outline"
                        className="mr-1 px-2 py-1 text-xs"
                        onClick={() => runStep(c)}
                      >
                        {step.kind === "settle" ? (
                          <IndianRupee className="h-3.5 w-3.5" />
                        ) : (
                          <BadgeCheck className="h-3.5 w-3.5" />
                        )}
                        {step.label}
                      </Button>
                    ) : null}
                    {c.status === "Pre-auth sent" ? (
                      <button
                        title="Pre-auth rejected"
                        className="mr-1 align-middle text-muted-foreground hover:text-destructive"
                        onClick={() => moveStatus(c, "Pre-auth rejected")}
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    ) : null}
                    {c.status === "Claim submitted" ? (
                      <button
                        title="Raise a query"
                        className="mr-1 align-middle text-muted-foreground hover:text-foreground"
                        onClick={() => moveStatus(c, "Query raised")}
                      >
                        <FileCheck2 className="h-4 w-4" />
                      </button>
                    ) : null}
                    {isOpenClaim(c) ? (
                      <button
                        title="Reject claim"
                        className="align-middle text-muted-foreground hover:text-destructive"
                        onClick={() => moveStatus(c, "Rejected")}
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <button
                      title="Open claim file"
                      className="mr-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setDetailId(c.id)}
                    >
                      <ShieldCheck className="h-4 w-4" />
                    </button>
                    <button
                      title="Print claim sheet"
                      className="mr-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setPrintClaim(c)}
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      title="Edit claim"
                      className="mr-2 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      title="Delete claim"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => del(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </>
      ) : (
        <PayersTab />
      )}

      <ClaimFormModal
        open={formOpen}
        form={form}
        setForm={setForm}
        payers={payers}
        onClose={() => setFormOpen(false)}
        onSave={saveClaim}
      />

      <ClaimDetailModal
        claim={detail}
        onClose={() => setDetailId(null)}
        onEdit={(c) => {
          setDetailId(null);
          openEdit(c);
        }}
        onSettle={(c) => setSettleFor(c)}
        onPost={postToBill}
        onMove={moveStatus}
        onPrint={(c) => setPrintClaim(c)}
      />

      <SettlementModal
        claim={settleFor}
        onClose={() => setSettleFor(null)}
        onSaved={() => setSettleFor(null)}
      />

      <ClaimPrint claim={printClaim} onClose={() => setPrintClaim(null)} />
    </div>
  );
}

/* ------------------------------------------------------------- claim form */

function ClaimFormModal({
  open,
  form,
  setForm,
  payers,
  onClose,
  onSave,
}: {
  open: boolean;
  form: ClaimForm;
  setForm: React.Dispatch<React.SetStateAction<ClaimForm>>;
  payers: Payer[];
  onClose: () => void;
  onSave: () => void;
}) {
  const { state } = useHms();
  const set = <K extends keyof ClaimForm>(key: K, value: ClaimForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const patientBills = useMemo(
    () =>
      Object.values(state.bills)
        .filter((b) => b.patientId === form.patientId)
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [state.bills, form.patientId],
  );
  const patientAdmissions = useMemo(
    () =>
      Object.values(state.admissions ?? {})
        .filter((a) => a.patientId === form.patientId)
        .sort((a, b) => (b.admitDate || "").localeCompare(a.admitDate || "")),
    [state.admissions, form.patientId],
  );

  /** Picking a patient pulls their scheme, card number and last admission in. */
  const pickPatient = (id: string) => {
    const p = state.patients[id];
    setForm((f) => ({
      ...f,
      patientId: id,
      visitId: "",
      admissionId: "",
      billId: "",
      scheme: f.scheme || p?.pmjayScheme || "",
      policyNo: f.policyNo || p?.pmjayCardId || "",
    }));
  };

  const pickBill = (id: string) => {
    const bill = state.bills[id];
    setForm((f) => ({
      ...f,
      billId: id,
      claimedAmount: bill ? Number(bill.totalAmount || 0) : f.claimedAmount,
      // A bill already addressed to a payer decides the payer for the claim.
      payerId: f.payerId || bill?.payerId || "",
    }));
  };

  const pickAdmission = (id: string) => {
    const adm: Admission | undefined = state.admissions[id];
    setForm((f) => ({
      ...f,
      admissionId: id,
      admissionDate: adm?.admitDate ?? f.admissionDate,
      dischargeDate: adm?.dischargeDate ?? f.dischargeDate,
      treatment: f.treatment || adm?.reason || "",
      visitId: f.visitId || adm?.visitId || "",
    }));
  };

  const toggleDoc = (name: string) =>
    setForm((f) => ({
      ...f,
      docs: normalizeDocs(f.docs).map((d) => (d.name === name ? { ...d, ready: !d.ready } : d)),
    }));

  const ready = docsReady({ docs: form.docs });

  return (
    <Modal
      open={open}
      title={form.id ? `Edit claim CLM-${form.claimNo}` : `New claim CLM-${form.claimNo}`}
      onClose={onClose}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Patient" required className="sm:col-span-2">
          <PatientPicker value={form.patientId} onChange={pickPatient} />
        </Field>
        <Field label="Linked visit">
          <VisitPicker
            patientId={form.patientId}
            value={form.visitId}
            onChange={(id) => set("visitId", id)}
          />
        </Field>
        <Field label="Linked IPD stay">
          <Select value={form.admissionId} onChange={(e) => pickAdmission(e.target.value)}>
            <option value="">No admission</option>
            {patientAdmissions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.admitDate} → {a.dischargeDate || "still admitted"} · {a.reason || "IPD"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Patient bill">
          <Select value={form.billId} onChange={(e) => pickBill(e.target.value)}>
            <option value="">No linked bill</option>
            {patientBills.map((b) => (
              <option key={b.id} value={b.id}>
                {fmtDate(b.date)} · {money(b.totalAmount)} · due {money(b.due)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Claim date" required>
          <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Payer / scheme" required>
          <Select
            value={form.payerId}
            onChange={(e) => {
              const payer = state.payers[e.target.value];
              setForm((f) => ({
                ...f,
                payerId: e.target.value,
                scheme: f.scheme || payer?.name || "",
              }));
            }}
          >
            <option value="">Select payer…</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Scheme / plan">
          <Input
            placeholder="PM-JAY (Ayushman Bharat)"
            value={form.scheme}
            onChange={(e) => set("scheme", e.target.value)}
          />
        </Field>
        <Field label="Policy / Ayushman card no.">
          <Input
            value={form.policyNo}
            onChange={(e) => set("policyNo", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Insurer / TPA reference">
          <Input
            placeholder="Pre-auth or claim number from the payer"
            value={form.reference}
            onChange={(e) => set("reference", e.target.value)}
          />
        </Field>
        <Field label="Package / procedure code">
          <Input value={form.packageCode} onChange={(e) => set("packageCode", e.target.value)} />
        </Field>
        <Field label="Diagnosis / procedure" required className="sm:col-span-2">
          <Input
            placeholder="Acute appendicitis — laparoscopic appendectomy"
            value={form.treatment}
            onChange={(e) => set("treatment", e.target.value)}
          />
        </Field>
        <Field label="Admission date">
          <Input
            type="date"
            value={form.admissionDate}
            onChange={(e) => set("admissionDate", e.target.value)}
          />
        </Field>
        <Field label="Discharge date">
          <Input
            type="date"
            value={form.dischargeDate}
            onChange={(e) => set("dischargeDate", e.target.value)}
          />
        </Field>
        <Field label="Claimed amount (₹)" required>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.claimedAmount}
            onChange={(e) => set("claimedAmount", Number(e.target.value))}
          />
        </Field>
        <Field label="Approved amount (₹)">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.approvedAmount}
            onChange={(e) => set("approvedAmount", Number(e.target.value))}
          />
        </Field>
        <Field label="Patient share / co-pay (₹)">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.patientShare}
            onChange={(e) => set("patientShare", Number(e.target.value))}
          />
        </Field>
        <Field label="Prepared by">
          <Input value={form.preparedBy} onChange={(e) => set("preparedBy", e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">
          Document checklist{" "}
          <span className="text-muted-foreground">
            ({ready}/{CLAIM_DOCUMENTS.length} ready)
          </span>
        </p>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {normalizeDocs(form.docs).map((d) => (
            <label key={d.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.ready}
                onChange={() => toggleDoc(d.name)}
                className="h-4 w-4"
              />
              {d.name}
            </label>
          ))}
        </div>
      </div>

      <Field label="Notes" className="mt-4">
        <Textarea
          placeholder="Deductions, queries from the payer, papers still to collect…"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onSave}>Save claim</Button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- claim detail */

function ClaimDetailModal({
  claim,
  onClose,
  onEdit,
  onSettle,
  onPost,
  onMove,
  onPrint,
}: {
  claim: Claim | undefined;
  onClose: () => void;
  onEdit: (c: Claim) => void;
  onSettle: (c: Claim) => void;
  onPost: (c: Claim) => void;
  onMove: (c: Claim, to: ClaimStatus, note?: string) => void;
  onPrint: (c: Claim) => void;
}) {
  const { state, upsert } = useHms();
  if (!claim) return null;
  const patient = state.patients[claim.patientId];
  const payer = state.payers[claim.payerId];
  const bill = claim.billId ? state.bills[claim.billId] : undefined;
  const step = nextClaimStep(claim.status);
  const canPost =
    isOpenClaim(claim) && Number(claim.settledAmount || 0) > Number(claim.settlementPosted || 0);

  const toggleDoc = (name: string) =>
    upsert<Claim>("claims", {
      id: claim.id,
      docs: normalizeDocs(claim.docs).map((d) => (d.name === name ? { ...d, ready: !d.ready } : d)),
    });

  return (
    <Modal
      open
      title={`CLM-${claim.claimNo} — ${claim.payerName || "claim"}`}
      onClose={onClose}
      wide
    >
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Patient:</span>{" "}
          <Link
            to="/patients/$patientId"
            params={{ patientId: claim.patientId }}
            className="text-accent underline"
          >
            {patient?.name ?? "—"}
          </Link>{" "}
          {patient?.mrn ? <span className="text-muted-foreground">· {patient.mrn}</span> : null}
        </p>
        <p>
          <span className="text-muted-foreground">Payer:</span> {claim.payerName || "—"}
          {payer ? <span className="text-muted-foreground"> · {payer.type}</span> : null}
        </p>
        <p>
          <span className="text-muted-foreground">Scheme:</span> {claim.scheme || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Policy / card:</span> {claim.policyNo || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Opened:</span> {fmtDate(claim.date)}
        </p>
        <p>
          <span className="text-muted-foreground">Reference:</span> {claim.reference || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Admission:</span>{" "}
          {claim.admissionDate ? fmtDate(claim.admissionDate) : "—"}
          {claim.dischargeDate ? ` → ${fmtDate(claim.dischargeDate)}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Package:</span> {claim.packageCode || "—"}
        </p>
        <p className="sm:col-span-2">
          <span className="text-muted-foreground">Treatment:</span> {claim.treatment || "—"}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(
          [
            ["Claimed", money(claim.claimedAmount)],
            ["Approved", money(claim.approvedAmount)],
            ["Settled", money(claim.settledAmount)],
            ["Patient share", money(claim.patientShare)],
            ["Pending", money(claimPending(claim))],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={claimTone(claim.status)}>{claim.status}</Badge>
        <span className="text-xs text-muted-foreground">
          {submittedAt(claim)
            ? `submitted ${fmtDateTime(submittedAt(claim))}`
            : "not submitted yet"}{" "}
          · {claimAgeDays(claim)}d in the pipeline
        </span>
        {step ? (
          <Button
            className="ml-auto px-2.5 py-1.5 text-xs"
            onClick={() => (step.kind === "settle" ? onSettle(claim) : onMove(claim, step.to))}
          >
            {step.label}
          </Button>
        ) : null}
        {canPost ? (
          <Button variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => onPost(claim)}>
            <IndianRupee className="h-3.5 w-3.5" /> Post to bill
          </Button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          className="w-56 py-1.5 text-xs"
          value={claim.status}
          onChange={(e) => onMove(claim, e.target.value as ClaimStatus, "Set from the claim file")}
        >
          {CLAIM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => onSettle(claim)}>
          Record settlement
        </Button>
        <Button variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => onEdit(claim)}>
          <Pencil className="h-3.5 w-3.5" /> Edit claim
        </Button>
        <Button variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => onPrint(claim)}>
          <Printer className="h-3.5 w-3.5" /> Print sheet
        </Button>
      </div>

      {bill ? (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs">
          Linked bill {fmtDate(bill.date)} — total {money(bill.totalAmount)}, paid{" "}
          {money(bill.paid)}, due <strong>{money(bill.due)}</strong>
          {Number(claim.settlementPosted || 0) > 0
            ? ` · ${money(claim.settlementPosted)} of this claim already posted`
            : ""}
        </p>
      ) : null}

      {claim.settledOn || claim.settlementRef ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Settled {claim.settledOn ? fmtDate(claim.settledOn) : "—"}
          {claim.settlementRef ? ` · ref ${claim.settlementRef}` : ""}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">
          Documents{" "}
          <span className="text-muted-foreground">
            ({docsReady(claim)}/{(claim.docs ?? []).length} ready)
          </span>
        </p>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {normalizeDocs(claim.docs).map((d) => (
            <label key={d.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.ready}
                onChange={() => toggleDoc(d.name)}
                className="h-4 w-4"
              />
              {d.name}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">History</p>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md bg-muted px-3 py-2 text-xs">
          {[...(claim.events ?? [])].reverse().map((e, i) => (
            <p key={`${e.at}-${i}`} className="flex flex-wrap gap-2">
              <span className="text-muted-foreground">{fmtDateTime(e.at)}</span>
              <strong>{e.status}</strong>
              <span>{e.note}</span>
              <span className="text-muted-foreground">— {e.by}</span>
            </p>
          ))}
          {(claim.events ?? []).length === 0 ? (
            <p className="text-muted-foreground">No steps stamped yet.</p>
          ) : null}
        </div>
      </div>

      {claim.notes ? (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Notes:</span> {claim.notes}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- claim settlement */

type SettleForm = {
  approvedAmount: number;
  settledAmount: number;
  patientShare: number;
  settledOn: string;
  settlementRef: string;
  note: string;
};

function SettlementModal({
  claim,
  onClose,
  onSaved,
}: {
  claim: Claim | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { state, settings, upsert } = useHms();
  const { user } = useSession();
  const who = user?.displayName ?? settings.deviceName;
  const [form, setForm] = useState<SettleForm>(() => ({
    approvedAmount: 0,
    settledAmount: 0,
    patientShare: 0,
    settledOn: todayISO(),
    settlementRef: "",
    note: "",
  }));
  /* Re-seed the form once per claim opened — the settle button is everywhere. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (claim && claim.id !== seededFor) {
    setSeededFor(claim.id);
    setForm({
      approvedAmount: Number(claim.approvedAmount || 0) || Number(claim.claimedAmount || 0),
      settledAmount: Number(claim.settledAmount || 0) || Number(claim.approvedAmount || 0),
      patientShare: Number(claim.patientShare || 0),
      settledOn: claim.settledOn || todayISO(),
      settlementRef: claim.settlementRef || "",
      note: "",
    });
  }
  if (!claim) return null;

  const payer = state.payers[claim.payerId];
  const delta = settlementDelta(claim, form.settledAmount);
  const bill = claim.billId ? state.bills[claim.billId] : undefined;

  const save = () => {
    if (form.settledAmount <= 0) {
      toast.error("Enter the amount actually received");
      return;
    }
    const status = settledStatus(form.settledAmount, form.approvedAmount);
    const events = [
      ...(claim.events ?? []),
      {
        at: Date.now(),
        status,
        by: who,
        note: `${money(form.settledAmount)} received${form.settlementRef ? ` · ref ${form.settlementRef}` : ""}${
          delta !== 0 && bill ? ` · ${money(delta)} posted to the bill` : ""
        }`,
      },
    ].slice(-60);

    /* Post only the difference to the bill, so re-saving a corrected
       settlement can never pay the same bill twice. */
    if (bill && delta > 0) {
      const total = Number(bill.totalAmount || 0);
      const paid = Math.min(Number(bill.paid || 0) + delta, total);
      upsert<Bill>("bills", {
        id: bill.id,
        paid,
        due: Math.max(0, total - paid),
        paymentMode: settlementMode(payer),
        payerId: claim.payerId,
        payerName: claim.payerName,
      });
    }

    upsert<Claim>("claims", {
      id: claim.id,
      approvedAmount: Number(form.approvedAmount || 0),
      settledAmount: Number(form.settledAmount || 0),
      patientShare: Number(form.patientShare || 0),
      settledOn: form.settledOn,
      settlementRef: form.settlementRef,
      status,
      settlementPosted: Number(claim.settlementPosted || 0) + Math.max(0, delta),
      events,
    });
    toast.success(
      status === "Settled"
        ? `Claim settled — ${money(form.settledAmount)} received`
        : `Part settlement recorded — ${money(form.settledAmount)} received`,
    );
    onSaved();
  };

  return (
    <Modal open title={`Settlement — CLM-${claim.claimNo}`} onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        Claimed <strong className="text-foreground">{money(claim.claimedAmount)}</strong> · received
        so far <strong className="text-foreground">{money(claim.settledAmount)}</strong>
        {bill ? ` · bill due ${money(bill.due)}` : " · no linked bill"}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Approved amount (₹)">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.approvedAmount}
            onChange={(e) => setForm((f) => ({ ...f, approvedAmount: Number(e.target.value) }))}
          />
        </Field>
        <Field label="Amount received (₹)" required>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.settledAmount}
            onChange={(e) => setForm((f) => ({ ...f, settledAmount: Number(e.target.value) }))}
          />
        </Field>
        <Field label="Patient share / co-pay (₹)">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.patientShare}
            onChange={(e) => setForm((f) => ({ ...f, patientShare: Number(e.target.value) }))}
          />
        </Field>
        <Field label="Received on">
          <Input
            type="date"
            value={form.settledOn}
            onChange={(e) => setForm((f) => ({ ...f, settledOn: e.target.value }))}
          />
        </Field>
        <Field label="UTR / cheque / settlement ref" className="sm:col-span-2">
          <Input
            value={form.settlementRef}
            onChange={(e) => setForm((f) => ({ ...f, settlementRef: e.target.value }))}
          />
        </Field>
        <p className="rounded-md bg-muted px-3 py-2 text-xs sm:col-span-2">
          {delta > 0
            ? `${money(delta)} will be posted to the patient's bill as ${settlementMode(payer)} payment.`
            : delta < 0
              ? `This reduces the earlier posting by ${money(Math.abs(delta))} — the bill keeps the corrected figure.`
              : "This settlement is already reflected on the bill."}
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save settlement</Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- printing */

function ClaimPrint({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  const { state } = useHms();
  if (!claim) return null;
  const patient = state.patients[claim.patientId];
  const payer = state.payers[claim.payerId];
  return (
    <PrintOverlay open title={`Insurance Claim CLM-${claim.claimNo}`} onClose={onClose}>
      <table className="mb-3">
        <tbody>
          <tr>
            <td style={{ width: "35%" }}>
              <strong>Patient:</strong> {patient?.name ?? "—"}
            </td>
            <td>
              <strong>MRN:</strong> {patient?.mrn ?? "—"}
            </td>
            <td>
              <strong>Phone:</strong> {patient?.phone || "—"}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Payer:</strong> {claim.payerName || "—"}
            </td>
            <td>
              <strong>Scheme:</strong> {claim.scheme || "—"}
            </td>
            <td>
              <strong>Policy / card:</strong> {claim.policyNo || "—"}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Claim date:</strong> {fmtDate(claim.date)}
            </td>
            <td>
              <strong>Admission:</strong> {claim.admissionDate ? fmtDate(claim.admissionDate) : "—"}
            </td>
            <td>
              <strong>Discharge:</strong> {claim.dischargeDate ? fmtDate(claim.dischargeDate) : "—"}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Status:</strong> {claim.status}
            </td>
            <td>
              <strong>Payer reference:</strong> {claim.reference || "—"}
            </td>
            <td>
              <strong>Package:</strong> {claim.packageCode || "—"}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mb-3">
        <strong>Diagnosis / procedure:</strong> {claim.treatment || "—"}
      </p>

      <table className="mb-3">
        <thead>
          <tr>
            <th>Claimed (₹)</th>
            <th>Approved (₹)</th>
            <th>Received (₹)</th>
            <th>Patient share (₹)</th>
            <th>Pending (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{money(claim.claimedAmount)}</td>
            <td>{money(claim.approvedAmount)}</td>
            <td>{money(claim.settledAmount)}</td>
            <td>{money(claim.patientShare)}</td>
            <td>{money(claimPending(claim))}</td>
          </tr>
        </tbody>
      </table>

      <p className="mb-1">
        <strong>Documents enclosed:</strong>
      </p>
      <ul className="mb-3 list-inside list-disc">
        {(claim.docs ?? []).map((d) => (
          <li key={d.name}>
            {d.ready ? "☑" : "☐"} {d.name}
          </li>
        ))}
      </ul>

      {(claim.events ?? []).length ? (
        <>
          <p className="mb-1">
            <strong>History:</strong>
          </p>
          <table className="mb-3">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Note</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {(claim.events ?? []).map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td>{fmtDateTime(e.at)}</td>
                  <td>{e.status}</td>
                  <td>{e.note}</td>
                  <td>{e.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {claim.notes ? (
        <p className="mb-3">
          <strong>Notes:</strong> {claim.notes}
        </p>
      ) : null}

      <p className="mb-3 text-xs">
        {payer?.contact ? `Payer claim desk: ${payer.contact}` : ""}
        {payer?.settlementDays ? ` · usual settlement window ${payer.settlementDays} days` : ""}
      </p>

      <div className="mt-8 flex justify-between text-sm">
        <span>
          ______________________
          <br />
          Prepared by {claim.preparedBy || ""}
        </span>
        <span>
          ______________________
          <br />
          Verified by (Billing / Admin)
        </span>
      </div>
    </PrintOverlay>
  );
}

/* ----------------------------------------------------------- payer master */

type PayerForm = {
  id?: string;
  name: string;
  type: string;
  code: string;
  contact: string;
  settlementDays: number;
  active: boolean;
  notes: string;
};

const blankPayer = (): PayerForm => ({
  name: "",
  type: "Private insurer",
  code: "",
  contact: "",
  settlementDays: 30,
  active: true,
  notes: "",
});

function PayersTab() {
  const { state, upsert, remove } = useHms();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PayerForm>(blankPayer);

  const rows = useMemo(() => {
    let list = payerList(state);
    if (type) list = list.filter((p) => p.type === type);
    return searchPayers(list, q);
  }, [state, q, type]);

  const openNew = () => {
    setForm(blankPayer());
    setOpen(true);
  };

  const openEdit = (p: Payer) => {
    setForm({
      id: p.id,
      name: p.name,
      type: p.type,
      code: p.code,
      contact: p.contact,
      settlementDays: Number(p.settlementDays || 0),
      active: p.active !== false,
      notes: p.notes,
    });
    setOpen(true);
  };

  const save = () => {
    if (!form.name.trim()) {
      toast.error("Payer name is required");
      return;
    }
    upsert<Payer>("payers", {
      id: form.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      type: form.type,
      code: form.code.trim().toUpperCase(),
      contact: form.contact,
      settlementDays: Number(form.settlementDays || 0),
      active: form.active,
      notes: form.notes,
    } as Payer);
    toast.success(form.id ? "Payer updated" : "Payer added");
    setOpen(false);
  };

  const del = (p: Payer) => {
    const used = claimsForPayer(state, p.id).length;
    if (used > 0) {
      toast.error(
        `${used} claim${used === 1 ? "" : "s"} reference ${p.name} — mark it inactive instead of deleting`,
      );
      return;
    }
    if (confirmDelete(`payer ${p.name}`)) {
      remove("payers", p.id);
      toast.success("Payer removed");
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search payer, code or type"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-52" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {PAYER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Add payer
        </Button>
        <span className="text-sm text-muted-foreground">
          {rows.length} payer{rows.length === 1 ? "" : "s"} — the built-in Indian scheme and insurer
          list loads itself on first run; edit or deactivate anything you do not use.
        </span>
      </div>

      <DataTable
        columns={[
          "Payer",
          "Type",
          "Code",
          "Claim desk",
          "Settlement window",
          "Claims",
          "Status",
          "",
        ]}
        rowCount={rows.length}
        empty="No payers on file yet."
      >
        {rows.map((p) => {
          const used = claimsForPayer(state, p.id).length;
          return (
            <tr key={p.id}>
              <Td className="font-medium">
                {p.name}
                {p.notes ? <div className="text-xs text-muted-foreground">{p.notes}</div> : null}
              </Td>
              <Td>{p.type}</Td>
              <Td>{p.code || "—"}</Td>
              <Td className="text-xs">{p.contact || "—"}</Td>
              <Td>{Number(p.settlementDays || 0) > 0 ? `${p.settlementDays} days` : "—"}</Td>
              <Td>{used}</Td>
              <Td>
                <Badge tone={p.active === false ? "neutral" : "green"}>
                  {p.active === false ? "Inactive" : "Active"}
                </Badge>
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  title="Edit payer"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(p)}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  title="Delete payer"
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
        title={form.id ? "Edit payer" : "Add payer"}
        onClose={() => setOpen(false)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payer name" required className="sm:col-span-2">
            <Input
              placeholder="Star Health & Allied Insurance"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {PAYER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Short code">
            <Input
              placeholder="STAR"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Claim desk phone / portal">
            <Input
              value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
            />
          </Field>
          <Field label="Settlement window (days)">
            <Input
              type="number"
              min={0}
              value={form.settlementDays}
              onChange={(e) => setForm((f) => ({ ...f, settlementDays: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              placeholder="Pre-auth portal, documents they insist on, panel rates…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="h-4 w-4"
            />
            Active — offered on new claims
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save payer</Button>
        </div>
      </Modal>

      <p className="mt-3 text-xs text-muted-foreground">
        Bill payment modes include {BILL_PAYMENT_MODES.join(", ")} — settlements post to the
        patient's bill under the right one automatically.
      </p>
    </div>
  );
}
