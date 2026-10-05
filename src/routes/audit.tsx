import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { fmtDateTime } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import { COLLECTIONS, type AuditAction, type AuditLog, type Collection } from "@/lib/hms/types";
import { Badge, Button, DataTable, Input, PageHeader, Select, Td } from "@/components/hms/ui";
import { AdminOnly } from "@/components/hms/gate";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — KEGH HMS" },
      {
        name: "description",
        content:
          "Read-only audit trail: who created, edited or deleted which record, on which device.",
      },
      { property: "og:title", content: "Audit Trail — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Read-only audit trail: who created, edited or deleted which record, on which device.",
      },
    ],
  }),
  component: AuditPage,
});

const ACTION_TONE: Record<AuditAction, "green" | "amber" | "red" | "neutral"> = {
  create: "green",
  update: "amber",
  delete: "red",
  login: "neutral",
  logout: "neutral",
};

/** Human label for a logged record when it still exists (name, GRN number…). */
function recordLabel(state: ReturnType<typeof useHms>["state"], a: AuditLog): string {
  const byId = <T,>(recs: Record<string, T>) => recs[a.recordId];
  switch (a.collection as Collection) {
    case "patients": {
      const p = byId(state.patients);
      return p ? `${p.name} · ${p.mrn}` : "";
    }
    case "meds":
      return byId(state.meds)?.name ?? "";
    case "batches": {
      const b = byId(state.batches);
      return b ? `${state.meds[b.medicineId]?.name ?? "Batch"} · ${b.batchNo}` : "";
    }
    case "grns":
      return byId(state.grns) ? `GRN-${byId(state.grns)!.grnNo}` : "";
    case "staff":
      return byId(state.staff)?.name ?? "";
    case "users":
      return byId(state.users)?.username ?? "";
    case "prescriptions": {
      const rx = byId(state.prescriptions);
      return rx ? `Rx · ${state.patients[rx.patientId]?.name ?? ""}` : "";
    }
    case "labOrders": {
      const lo = byId(state.labOrders);
      return lo
        ? `${state.patients[lo.patientId]?.name ?? "—"} · ${lo.tests.split(",")[0]?.trim() ?? ""}`
        : "";
    }
    case "imagingOrders": {
      const io = byId(state.imagingOrders);
      return io
        ? `${state.patients[io.patientId]?.name ?? "—"} · ${io.study.split(",")[0]?.trim() ?? ""}`
        : "";
    }
    case "admissions": {
      const adm = byId(state.admissions);
      return adm ? `${state.patients[adm.patientId]?.name ?? "—"} · ${adm.status}` : "";
    }
    case "beds":
      return byId(state.beds)?.label ?? "";
    case "handoverNotes": {
      const n = byId(state.handoverNotes);
      return n ? `${n.author || "—"} · ${(n.text || n.category || "").slice(0, 40)}` : "";
    }
    case "pharms": {
      const ph = byId(state.pharms);
      return ph ? `${ph.medication} · ${state.patients[ph.patientId]?.name ?? ""}` : "";
    }
    case "bills": {
      const bill = byId(state.bills);
      return bill ? `Bill · ${state.patients[bill.patientId]?.name ?? ""}` : "";
    }
    case "appointments": {
      const ap = byId(state.appointments);
      return ap ? `${ap.date} ${ap.time} · ${state.patients[ap.patientId]?.name ?? ""}` : "";
    }
    default:
      return "";
  }
}

function AuditPage() {
  const { state } = useHms();
  const [q, setQ] = useState("");
  const [action, setAction] = useState<"" | AuditAction>("");
  const [collection, setCollection] = useState<"" | Collection>("");
  const [limit, setLimit] = useState(200);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return Object.values(state.auditLogs ?? {})
      .filter((a) => {
        if (action && a.action !== action) return false;
        if (collection && a.collection !== collection) return false;
        if (!s) return true;
        const label = recordLabel(state, a).toLowerCase();
        return (
          a.recordId.toLowerCase().includes(s) ||
          (a.deviceName || "").toLowerCase().includes(s) ||
          (a.role || "").toLowerCase().includes(s) ||
          label.includes(s)
        );
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [state, q, action, collection]);

  const shown = rows.slice(0, limit);
  const crudCount = rows.filter((a) => ["create", "update", "delete"].includes(a.action)).length;

  const exportCsv = () => {
    downloadCsv("audit-trail.csv", [
      ["Time", "Action", "Collection", "Record", "Record label", "Role", "Device"],
      ...rows.map((a) => [
        fmtDateTime(a.timestamp),
        a.action,
        a.collection,
        a.recordId,
        recordLabel(state, a),
        a.role,
        a.deviceName,
      ]),
    ]);
  };

  return (
    <AdminOnly
      page="Audit Trail"
      subtitle="Who created, edited or deleted which record — read-only"
      hint="Every save, delete, login and logout is logged automatically with the device and role."
    >
      <div className="space-y-4">
        <PageHeader
          title="Audit Trail"
          subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"} · ${crudCount} data changes · read-only`}
          actions={
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder="Search record, patient, device or role"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            className="w-44"
            value={action}
            onChange={(e) => setAction(e.target.value as typeof action)}
          >
            <option value="">All actions</option>
            <option value="create">create</option>
            <option value="update">update</option>
            <option value="delete">delete</option>
            <option value="login">login</option>
            <option value="logout">logout</option>
          </Select>
          <Select
            className="w-52"
            value={collection}
            onChange={(e) => setCollection(e.target.value as typeof collection)}
          >
            <option value="">All collections</option>
            {COLLECTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <DataTable
          columns={["Time", "Action", "Collection", "Record", "Role", "Device"]}
          rowCount={shown.length}
          empty="Nothing logged yet — entries appear here as staff work."
        >
          {shown.map((a) => {
            const label = recordLabel(state, a);
            return (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(a.timestamp)}</Td>
                <Td>
                  <Badge tone={ACTION_TONE[a.action] ?? "neutral"}>{a.action}</Badge>
                </Td>
                <Td>{a.collection}</Td>
                <Td>
                  {label ? <div>{label}</div> : null}
                  <div className="font-mono text-xs text-muted-foreground" title={a.recordId}>
                    {a.recordId.slice(0, 8)}…
                  </div>
                </Td>
                <Td>{a.role || "—"}</Td>
                <Td>{a.deviceName || "—"}</Td>
              </tr>
            );
          })}
        </DataTable>

        {rows.length > shown.length ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {shown.length} of {rows.length}.
            </p>
            <Button variant="outline" onClick={() => setLimit((l) => l + 500)}>
              <ScrollText className="h-4 w-4" /> Show 500 more
            </Button>
          </div>
        ) : null}
      </div>
    </AdminOnly>
  );
}
