import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCheck,
  Mic,
  NotebookPen,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import { HANDOVER_CATEGORIES, type HandoverNote } from "@/lib/hms/types";
import { handoverStats, searchNotes, sortNotes } from "@/lib/hms/handover";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "@/components/hms/ui";
import { PatientPicker, confirmDelete } from "@/components/hms/pickers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/handover")({
  head: () => ({
    meta: [
      { title: "Shift Handover — KEGH HMS" },
      {
        name: "description",
        content:
          "Shift handover notes — write, snap a photo or record a voice note so the next shift knows what to do.",
      },
      { property: "og:title", content: "Shift Handover — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Shift handover notes — write, snap a photo or record a voice note so the next shift knows what to do.",
      },
    ],
  }),
  component: HandoverPage,
});

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* Downscale a picked/snapped photo to a sync-friendly JPEG data URI. */
async function fileToPhotoData(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable image"));
      i.src = url;
    });
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------- recorder */

function AudioCapture({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (data: string | undefined, mime: string | undefined) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("This browser can't record audio — type the note instead");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const fr = new FileReader();
        fr.onload = () => onChange(String(fr.result), blob.type);
        fr.readAsDataURL(blob);
      };
      mr.start();
      recRef.current = mr;
      setSecs(0);
      timerRef.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied — type the note instead");
    }
  };

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    recRef.current?.stop();
    setRecording(false);
  };

  const mm = String(Math.floor(secs / 60)).padStart(1, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-2">
          <audio controls src={value} className="h-9 w-full" />
          <button
            type="button"
            title="Remove recording"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => {
              onChange(undefined, undefined);
              setSecs(0);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : recording ? (
        <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
          <span className="text-sm font-medium text-red-800">
            Recording… {mm}:{ss}
          </span>
          <Button variant="outline" className="ml-auto px-2 py-1 text-xs" onClick={stop}>
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={start}>
          <Mic className="h-4 w-4" /> Record voice note
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

const blank = (author: string, role: string): Partial<HandoverNote> => ({
  date: todayISO(),
  time: hhmmNow(),
  author,
  role,
  category: "Handover",
  patientId: "",
  text: "",
  resolved: false,
});

function categoryTone(c: string): "green" | "amber" | "red" | "neutral" {
  const s = (c || "").toLowerCase();
  if (s === "urgent") return "red";
  if (s.includes("follow") || s.includes("lab")) return "amber";
  if (s === "handover") return "neutral";
  return "neutral";
}

function HandoverPage() {
  const { state, settings, upsert, remove } = useHms();
  const { user } = useSession();
  const [show, setShow] = useState<"open" | "done" | "all">("open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<HandoverNote>>(() =>
    blank(user?.displayName ?? settings.deviceName, user?.role ?? settings.role),
  );
  const [photoBusy, setPhotoBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => handoverStats(state), [state]);
  const rows = useMemo(() => {
    const all = sortNotes(Object.values(state.handoverNotes ?? {}));
    const shown =
      show === "open"
        ? all.filter((n) => !n.resolved)
        : show === "done"
          ? all.filter((n) => n.resolved)
          : all;
    return searchNotes(shown, q, (id) => state.patients[id]?.name ?? "");
  }, [state, show, q]);

  const openNew = () => {
    setForm(blank(user?.displayName ?? settings.deviceName, user?.role ?? settings.role));
    setOpen(true);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const data = await fileToPhotoData(file);
      setForm((f) => ({ ...f, photoData: data }));
      toast.success("Photo attached (downscaled for sync)");
    } catch {
      toast.error("Could not read that image");
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = () => {
    if (!form.text?.trim() && !form.photoData && !form.audioData) {
      toast.error("Write something, or attach a photo / recording");
      return;
    }
    upsert<HandoverNote>("handoverNotes", {
      ...form,
      patientId: form.patientId || undefined,
      resolved: false,
    } as HandoverNote);
    toast.success("Handover note saved — next shift will see it");
    setOpen(false);
  };

  const markDone = (n: HandoverNote) => {
    upsert<HandoverNote>("handoverNotes", {
      id: n.id,
      resolved: true,
      resolvedBy: user?.displayName ?? settings.deviceName,
      resolvedAt: Date.now(),
    });
    toast.success("Marked as handled");
  };

  const reopen = (n: HandoverNote) => {
    upsert<HandoverNote>("handoverNotes", {
      id: n.id,
      resolved: false,
      resolvedBy: undefined,
      resolvedAt: undefined,
    });
    toast.success("Moved back to open notes");
  };

  const del = (n: HandoverNote) => {
    if (confirmDelete("this handover note")) {
      remove("handoverNotes", n.id);
      toast.success("Note deleted");
    }
  };

  const exportCsv = () => {
    downloadCsv("shift-handover.csv", [
      ["Date", "Time", "Author", "Role", "Category", "Patient", "Note", "Status", "Handled by"],
      ...rows.map((n) => [
        n.date,
        n.time,
        n.author,
        n.role,
        n.category,
        n.patientId ? (state.patients[n.patientId]?.name ?? "") : "",
        n.text,
        n.resolved ? "Done" : "Open",
        n.resolvedBy ?? "",
      ]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Shift Handover"
        subtitle={
          stats.open > 0
            ? `${stats.open} open note${stats.open === 1 ? "" : "s"} for the oncoming shift${stats.urgent ? ` · ${stats.urgent} urgent` : ""}`
            : "Nothing pending for the next shift"
        }
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <NotebookPen className="h-4 w-4 rotate-0" /> CSV
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> New note
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          className="w-44"
          value={show}
          onChange={(e) => setShow(e.target.value as typeof show)}
        >
          <option value="open">Open notes</option>
          <option value="done">Handled</option>
          <option value="all">All notes</option>
        </Select>
        <Input
          className="max-w-xs"
          placeholder="Search text, author, patient…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="py-3 text-sm text-muted-foreground">
            {show === "open"
              ? "Queue clear — no pending handover notes. When the shift changes, leave one with text, a photo or a voice note."
              : "No notes in this view."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((n) => (
            <Card key={n.id} className={cn("flex flex-col gap-2", n.resolved && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={categoryTone(n.category)}>{n.category || "Handover"}</Badge>
                {n.resolved ? <Badge tone="green">Handled</Badge> : null}
                {n.photoData ? <Badge tone="neutral">📷 photo</Badge> : null}
                {n.audioData ? <Badge tone="neutral">🎙 voice</Badge> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtDate(n.date)} {n.time}
                </span>
              </div>

              {n.text ? (
                <p className="whitespace-pre-wrap text-sm text-foreground">{n.text}</p>
              ) : null}

              {n.patientId ? (
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: n.patientId }}
                  className="text-sm font-medium text-accent underline"
                >
                  Patient: {state.patients[n.patientId]?.name ?? "—"} ·{" "}
                  {state.patients[n.patientId]?.mrn ?? ""}
                </Link>
              ) : null}

              {n.photoData ? (
                <button type="button" onClick={() => setLightbox(n.photoData ?? null)}>
                  <img
                    src={n.photoData}
                    alt="Handover attachment"
                    className="max-h-48 rounded-md ring-1 ring-border/60"
                  />
                </button>
              ) : null}

              {n.audioData ? <audio controls src={n.audioData} className="h-9 w-full" /> : null}

              <div className="mt-1 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <span>
                  {n.author || "—"}
                  {n.role ? ` · ${n.role}` : ""}
                  {n.resolved
                    ? ` → handled by ${n.resolvedBy ?? "—"} · ${fmtDateTime(n.resolvedAt)}`
                    : ""}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {n.resolved ? (
                    <button
                      className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => reopen(n)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reopen
                    </button>
                  ) : (
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-xs"
                      onClick={() => markDone(n)}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Mark handled
                    </Button>
                  )}
                  <button
                    title="Delete note"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    onClick={() => del(n)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* new note modal */}
      <Modal open={open} title="New handover note" onClose={() => setOpen(false)} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Written by" required>
            <Input
              value={form.author ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
            />
          </Field>
          <Field label="Role">
            <Input
              placeholder="Duty nurse, Doctor, Reception…"
              value={form.role ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
          </Field>
          <Field label="Category" className="sm:col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {HANDOVER_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, category: c }))}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
                    form.category === c
                      ? "bg-accent text-accent-foreground ring-accent"
                      : "bg-background text-foreground ring-border hover:bg-muted",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>
          <Field label="For patient (optional)" className="sm:col-span-2">
            <PatientPicker
              value={form.patientId ?? ""}
              onChange={(id) => setForm((f) => ({ ...f, patientId: id }))}
            />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Textarea
              placeholder={
                "e.g. Bed GW-3 fever came down to 99°F at 6 pm, next dose 9 pm. Ramesh's attender will bring reports tomorrow morning. Billing to follow up on ₹4,200 due."
              }
              value={form.text ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            />
          </Field>
          <Field label="Photo (snapshot / whiteboard)" className="sm:col-span-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {form.photoData ? (
              <div className="flex items-start gap-2">
                <img
                  src={form.photoData}
                  alt="Attachment preview"
                  className="max-h-40 rounded-md ring-1 ring-border/60"
                />
                <button
                  type="button"
                  title="Remove photo"
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={() => setForm((f) => ({ ...f, photoData: undefined }))}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="h-4 w-4" /> {photoBusy ? "Processing…" : "Take / attach photo"}
              </Button>
            )}
          </Field>
          <Field label="Voice note (keep it under ~2 minutes)" className="sm:col-span-2">
            <AudioCapture
              value={form.audioData}
              onChange={(data, mime) =>
                setForm((f) => ({ ...f, audioData: data, audioMime: mime }))
              }
            />
          </Field>
        </div>
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Notes, photos and recordings are stored in the record itself, so they sync to every device
          with the normal Google Drive sync cycle.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>
            <NotebookPen className="h-4 w-4" /> Leave note for next shift
          </Button>
        </div>
      </Modal>

      {/* photo lightbox */}
      <Modal open={Boolean(lightbox)} title="Attached photo" onClose={() => setLightbox(null)} wide>
        {lightbox ? (
          <img src={lightbox} alt="Handover attachment" className="w-full rounded-md" />
        ) : null}
      </Modal>
    </div>
  );
}
