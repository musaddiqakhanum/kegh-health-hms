import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { changedFields, splitKey } from "@/lib/hms/realtime-state";
import { fmtDateTime } from "@/lib/hms/format";
import type { ReviewItem } from "@/lib/hms/sync-core";
import { Badge, Button, Card, PageHeader } from "@/components/hms/ui";

export const Route = createFileRoute("/conflicts")({
  head: () => ({
    meta: [
      { title: "Conflicts to review — KEGH HMS" },
      {
        name: "description",
        content: "Records that two devices changed at the same time. Review the older version.",
      },
      { property: "og:title", content: "Conflicts to review — KEGH HMS" },
      {
        property: "og:description",
        content: "Records that two devices changed at the same time. Review the older version.",
      },
    ],
  }),
  component: ConflictsPage,
});

/** Short label for a record: its name or title when it has one, otherwise its id. */
function recordLabel(key: string, value: unknown): string {
  const parts = splitKey(key);
  const kind = parts?.collection ?? key.split(":")[0] ?? "record";
  const id = parts?.id ?? key;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const field of ["name", "displayName", "title", "procedure", "item"]) {
      const text = v[field];
      if (typeof text === "string" && text.trim()) return `${kind} · ${text.trim()}`;
    }
  }
  return `${kind} · ${id.slice(0, 8)}`;
}

/** Compact display of one field value. */
function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 160)}…` : json;
}

function ConflictCard({
  item,
  onResolve,
}: {
  item: ReviewItem;
  onResolve: (seq: number, choice: "older" | "current") => void;
}) {
  const { kept, other } = item;
  const deleted = (v: unknown) => v === null;
  const diffs = changedFields(kept.value, other.value);
  const label = recordLabel(item.key, kept.value ?? other.value);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{label}</h2>
        <Badge tone={item.reviewed ? "green" : "amber"}>
          {item.reviewed ? "Reviewed" : "Needs review"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Two devices changed this record at the same time. The newer version is shown as current.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">Current (newer)</p>
          <p className="text-xs text-muted-foreground">
            {fmtDateTime(kept.ts)} · device {kept.deviceId}
          </p>
          <p className="mt-1 text-xs">{deleted(kept.value) ? "Record was deleted" : "Saved"}</p>
        </div>
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">Other (older)</p>
          <p className="text-xs text-muted-foreground">
            {fmtDateTime(other.ts)} · device {other.deviceId}
          </p>
          <p className="mt-1 text-xs">{deleted(other.value) ? "Record was deleted" : "Saved"}</p>
        </div>
      </div>
      {diffs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Field</th>
                <th className="py-1 pr-3 font-medium">Current</th>
                <th className="py-1 font-medium">Other</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.field} className="border-t">
                  <td className="py-1 pr-3 font-mono text-xs">{d.field}</td>
                  <td className="py-1 pr-3 break-all">{show(d.a)}</td>
                  <td className="py-1 break-all">{show(d.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">The two versions have the same fields.</p>
      )}
      {!item.reviewed && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onResolve(item.seq, "current")}>
            Keep current
          </Button>
          <Button onClick={() => onResolve(item.seq, "older")}>Use other (older) version</Button>
        </div>
      )}
    </Card>
  );
}

function ConflictsPage() {
  const { conflicts, resolveConflict, realtime } = useHms();
  const open = conflicts.filter((c) => !c.reviewed);
  const done = conflicts.filter((c) => c.reviewed);

  const resolve = (seq: number, choice: "older" | "current") => {
    resolveConflict(seq, choice);
    toast.success(choice === "older" ? "Older version applied and synced" : "Current version kept");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conflicts to review"
        subtitle="When two devices change the same record, the newer change is kept and the other version is listed here."
      />
      {!realtime.configured && (
        <p className="text-sm text-muted-foreground">
          Real-time sync is off. Conflicts appear here once a room address is set in Settings.
        </p>
      )}
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conflicts to review.</p>
      ) : (
        <div className="space-y-4">
          {open.map((item) => (
            <ConflictCard key={item.seq} item={item} onResolve={resolve} />
          ))}
        </div>
      )}
      {done.length > 0 && (
        <p className="text-xs text-muted-foreground">{done.length} reviewed on this device.</p>
      )}
    </div>
  );
}
