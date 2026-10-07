import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { catalogList, composeMedText } from "@/lib/hms/medcatalog";
import { MED_CATEGORIES, type MedCatalogItem } from "@/lib/hms/types";
import { MedFormArt } from "@/components/hms/med-art";
import { Button, Input, Modal } from "@/components/hms/ui";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- helpers */

interface NameGroup {
  name: string;
  first: string; // uppercase first letter
  variants: MedCatalogItem[];
}

function groupCatalogue(items: MedCatalogItem[]): NameGroup[] {
  const byName = new Map<string, MedCatalogItem[]>();
  for (const item of items) {
    const k = (item.name || "").trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(item);
  }
  return [...byName.values()]
    .map((variants) => {
      const sorted = [...variants].sort(
        (a, b) =>
          (a.form || "").localeCompare(b.form || "") ||
          (a.strength || "").localeCompare(b.strength || ""),
      );
      const name = (sorted[0]?.name ?? "?").trim();
      return { name, first: (name[0] || "#").toUpperCase(), variants: sorted };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------------- browser */

export function CatalogueBrowser({
  onPick,
  pickLabel = "Use",
  className,
}: {
  /** If provided, clicking a variant picks it; otherwise browse-only. */
  onPick?: (item: MedCatalogItem) => void;
  pickLabel?: string;
  className?: string;
}) {
  const { state } = useHms();
  const [query, setQuery] = useState("");
  const [formFilter, setFormFilter] = useState("");

  const all = useMemo(() => catalogList(state), [state.medCatalog]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = formFilter
      ? all.filter((i) => (i.form || "").toLowerCase() === formFilter.toLowerCase())
      : all;
    if (q.length >= 2) rows = rows.filter((i) => i.name.toLowerCase().includes(q));
    else if (q.length === 1) rows = rows.filter((i) => i.name.toLowerCase().startsWith(q));
    return rows;
  }, [all, query, formFilter]);

  const groups = useMemo(() => groupCatalogue(searched), [searched]);

  const formCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of searched) counts.set(i.form, (counts.get(i.form) ?? 0) + 1);
    return MED_CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0).map(
      (c) => [c, counts.get(c)!] as const,
    );
  }, [searched]);

  const letters = useMemo(() => {
    const present = new Set(groups.map((g) => g.first));
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => ({ l, on: present.has(l) }));
  }, [groups]);

  const letterAnchors = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) if (!map.has(g.first)) map.set(g.first, `cat-letter-${g.first}`);
    return map;
  }, [groups]);

  const searching = query.trim().length > 0;
  let lastLetter = "";

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={`Search ${all.length} medicines…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* A–Z navigation strip */}
      <div className="mt-2 flex flex-wrap gap-0.5">
        {letters.map(({ l, on }) => (
          <a
            key={l}
            href={on && !searching ? `#${letterAnchors.get(l) ?? ""}` : undefined}
            onClick={(e) => {
              if (!on || searching) e.preventDefault();
            }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-xs font-semibold transition-colors",
              on && !searching
                ? "cursor-pointer text-accent hover:bg-accent/15"
                : "cursor-default text-muted-foreground/35",
            )}
          >
            {l}
          </a>
        ))}
      </div>

      {/* form filter chips */}
      {formCounts.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFormFilter("")}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition-colors",
              !formFilter
                ? "bg-foreground text-background ring-foreground"
                : "bg-muted text-muted-foreground ring-border hover:bg-secondary",
            )}
          >
            All
          </button>
          {formCounts.map(([c, n]) => (
            <button
              key={c}
              type="button"
              onClick={() => setFormFilter(c)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition-colors",
                formFilter === c
                  ? "bg-foreground text-background ring-foreground"
                  : "bg-muted text-muted-foreground ring-border hover:bg-secondary",
              )}
            >
              {c} ({n})
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {groups.map((g) => {
          const letterAnchor = searching || g.first === lastLetter ? null : `cat-letter-${g.first}`;
          if (!searching) lastLetter = g.first;
          return (
            <div
              key={g.name}
              id={letterAnchor ?? undefined}
              className="rounded-lg border border-border bg-card p-2.5"
            >
              <div className="flex items-start gap-2.5">
                <MedFormArt name={g.name} form={g.variants[0]?.form ?? ""} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="text-sm font-semibold text-foreground">{g.name}</p>
                    {g.variants.length > 1 ? (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {g.variants.length} options
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.variants.map((v) =>
                      onPick ? (
                        <button
                          key={v.id}
                          type="button"
                          title={`${pickLabel}: ${composeMedText(v)}`}
                          onClick={() => onPick(v)}
                          className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/30 transition-colors hover:bg-accent/20"
                        >
                          {v.form}
                          {v.strength ? ` · ${v.strength}` : ""}
                        </button>
                      ) : (
                        <span
                          key={v.id}
                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border"
                        >
                          {v.form}
                          {v.strength ? ` · ${v.strength}` : ""}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No medicine matches — import it from Pharmacy → Import catalogue.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- modal */

export function MedicinePickerModal({
  open,
  onClose,
  onPick,
  title = "Medicine library — pick one",
  pickLabel = "Use",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: MedCatalogItem) => void;
  title?: string;
  pickLabel?: string;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} wide>
      <div className="flex h-[32rem] flex-col">
        <CatalogueBrowser
          className="min-h-0 flex-1"
          pickLabel={pickLabel}
          onPick={(item) => {
            onPick(item);
            onClose();
          }}
        />
        <div className="mt-3 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
