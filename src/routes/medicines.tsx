import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useHms } from "@/lib/hms/store";
import { PageHeader } from "@/components/hms/ui";
import { CatalogueBrowser } from "@/components/hms/catalogue-browser";
import { MED_CATEGORIES } from "@/lib/hms/types";

export const Route = createFileRoute("/medicines")({
  component: MedicinesPage,
});

function MedicinesPage() {
  const { state } = useHms();
  const { items, forms } = useMemo(() => {
    const rows = Object.values(state.medCatalog ?? {});
    const distinctForms = new Set(
      rows.map((r) => r.form).filter((f) => f && MED_CATEGORIES.includes(f)),
    );
    return { items: rows.length, forms: distinctForms.size };
  }, [state.medCatalog]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Medicine Library"
        subtitle={`${items} Indian-market medicines · ${forms} dosage forms · browse, search, or jump by letter. The same list feeds prescriptions and pharmacy stock.`}
      />
      <div className="min-h-0 flex-1">
        <CatalogueBrowser className="h-full" />
      </div>
    </div>
  );
}
