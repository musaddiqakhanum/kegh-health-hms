import { useEffect } from "react";
import { Printer, X } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { fmtDate } from "@/lib/hms/format";
import { Button } from "./ui";
import keghLogo from "@/assets/kegh-logo.png.asset.json";

export function PrintOverlay({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { settings } = useHms();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div
        id="print-overlay"
        className="mx-auto max-w-4xl rounded-lg bg-white p-8 text-slate-900 shadow-xl"
      >
        <div className="no-print mb-4 flex justify-end gap-2">
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4" /> Close
          </Button>
        </div>

        <header className="mb-5 flex items-center gap-4 border-b-2 border-slate-800 pb-3">
          <img
            src={keghLogo.url}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 object-contain"
          />
          <div className="flex-1 text-center">
            <h1 className="text-xl font-bold uppercase tracking-wide">
              {settings.hospitalName || "KEGH LLP"}
            </h1>
            {settings.hospitalAddress ? (
              <p className="text-sm">{settings.hospitalAddress}</p>
            ) : null}
            <p className="text-sm">
              {settings.hospitalPhone ? `Phone: ${settings.hospitalPhone}` : ""}
              {settings.registrationNumber ? ` · Reg. No: ${settings.registrationNumber}` : ""}
            </p>
          </div>
        </header>

        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <span className="text-sm">Date: {fmtDate(Date.now())}</span>
        </div>

        <div className="print-body text-sm [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
          {children}
        </div>
      </div>
    </div>
  );
}
