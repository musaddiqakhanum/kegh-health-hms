import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { searchPatients } from "@/lib/hms/selectors";
import { ageFromDob, fmtDate, fmtDateTime } from "@/lib/hms/format";
import { nextMrn } from "@/lib/hms/mrn";
import { PMJAY_SCHEMES, PMJAY_STATUSES, type Patient } from "@/lib/hms/types";
import { digitsOnly, formatAbhaNumber, normalizePmjayCardId } from "@/lib/abdm/healthId";
import {
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
import { confirmDelete } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";
import { AbhaVerify } from "@/components/hms/AbhaVerify";

export const Route = createFileRoute("/patients/")({
  validateSearch: (search: Record<string, unknown>) => ({ q: (search["q"] as string) || "" }),
  head: () => ({
    meta: [
      { title: "Patients — KEGH HMS" },
      {
        name: "description",
        content: "Register and search hospital patients by name, MRN, phone, ABHA or PM-JAY card.",
      },
      { property: "og:title", content: "Patients — KEGH HMS" },
      {
        property: "og:description",
        content: "Register and search hospital patients by name, MRN, phone, ABHA or PM-JAY card.",
      },
    ],
  }),
  component: PatientsPage,
});

const blank = (): Partial<Patient> => ({
  name: "",
  dob: "",
  gender: "M",
  phone: "",
  address: "",
  fatherName: "",
  bloodGroup: "",
  allergies: "",
  doctor: "",
  abhaNumber: "",
  abhaAddress: "",
  pmjayCardId: "",
  pmjayFamilyId: "",
  pmjayScheme: "",
  pmjayStatus: "Not enrolled",
});

function PatientsPage() {
  const { q } = Route.useSearch();
  const { state, upsert, remove } = useHms();
  const [query, setQuery] = useState(q);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Patient>>(blank);
  const [showVerify, setShowVerify] = useState(false);

  const rows = useMemo(
    () =>
      searchPatients(Object.values(state.patients), query).sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""),
      ),
    [state.patients, query],
  );

  const set = (k: keyof Patient, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const patch = (p: Partial<Patient>) => setForm((f) => ({ ...f, ...p }));

  const save = () => {
    if (!form.name?.trim()) {
      toast.error("Patient name is required");
      return;
    }
    if (!form.dob) {
      toast.error("Date of birth is required");
      return;
    }
    const abha = digitsOnly(form.abhaNumber ?? "");
    if (abha && abha.length !== 14) {
      toast.error("ABHA number must have 14 digits");
      return;
    }
    upsert<Patient>("patients", {
      ...form,
      abhaNumber: abha,
      pmjayCardId: normalizePmjayCardId(form.pmjayCardId ?? ""),
      pmjayStatus: form.pmjayStatus || "Not enrolled",
      mrn: form.mrn || nextMrn(state),
    } as Patient);
    toast.success(form.id ? "Patient updated" : "Patient registered");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={`${rows.length} record${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setShowVerify(false);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New patient
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <Input
          placeholder="Search by name, MRN, phone, ABHA or PM-JAY card"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Card>

      <DataTable
        columns={["Name", "MRN", "Phone", "Age", "Gender", "Doctor", "Registered", ""]}
        rowCount={rows.length}
      >
        {rows.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link
                to="/patients/$patientId"
                params={{ patientId: p.id }}
                className="font-medium text-accent underline"
              >
                {p.name}
              </Link>
              {p.abhaVerified ? (
                <ShieldCheck
                  className="ml-1.5 inline h-4 w-4 text-emerald-600"
                  aria-label="ABHA verified"
                />
              ) : p.abhaNumber ? (
                <ShieldAlert
                  className="ml-1.5 inline h-4 w-4 text-amber-600"
                  aria-label="ABHA not verified"
                />
              ) : null}
              {p.pmjayVerified ? (
                <span
                  className="ml-1.5 align-middle text-[10px] font-bold uppercase text-emerald-700"
                  title="PM-JAY card verified"
                >
                  PMJ
                </span>
              ) : null}
            </Td>
            <Td>{p.mrn}</Td>
            <Td>{p.phone || "—"}</Td>
            <Td>{ageFromDob(p.dob)}</Td>
            <Td>{p.gender}</Td>
            <Td>{p.doctor || "—"}</Td>
            <Td>{fmtDate(p.createdAt)}</Td>
            <Td className="whitespace-nowrap">
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(p);
                  setShowVerify(false);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirmDelete(`patient ${p.name}`)) {
                    remove("patients", p.id);
                    toast.success("Patient deleted");
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal
        open={open}
        title={form.id ? "Edit patient" : "Register patient"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Date of birth" required>
            <Input
              type="date"
              value={form.dob ?? ""}
              onChange={(e) => set("dob", e.target.value)}
            />
          </Field>
          <Field label="Gender">
            <Select value={form.gender ?? "M"} onChange={(e) => set("gender", e.target.value)}>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Assigned doctor" className="sm:col-span-2">
            <DoctorSelect value={form.doctor ?? ""} onChange={(d) => set("doctor", d)} />
          </Field>
          <Field label="Father / guardian name">
            <Input
              value={form.fatherName ?? ""}
              onChange={(e) => set("fatherName", e.target.value)}
            />
          </Field>
          <Field label="Blood group">
            <Select
              value={form.bloodGroup ?? ""}
              onChange={(e) => set("bloodGroup", e.target.value)}
            >
              <option value="">Unknown</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Allergies" className="sm:col-span-2">
            <Textarea
              value={form.allergies ?? ""}
              onChange={(e) => set("allergies", e.target.value)}
            />
          </Field>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
            ABHA (Ayushman Bharat Digital Mission)
          </p>
          <Field label="ABHA number" className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <Input
                value={form.abhaNumber ? formatAbhaNumber(form.abhaNumber) : ""}
                inputMode="numeric"
                placeholder="14-3245-6789-0123"
                onChange={(e) => set("abhaNumber", digitsOnly(e.target.value).slice(0, 14))}
              />
              {form.abhaVerified ? (
                <span className="whitespace-nowrap text-xs font-semibold text-emerald-700">
                  Verified {fmtDateTime(form.abhaVerifiedAt)}
                </span>
              ) : null}
            </div>
          </Field>
          <Field label="ABHA address" className="sm:col-span-2">
            <Input
              value={form.abhaAddress ?? ""}
              placeholder="name@sbx"
              onChange={(e) => set("abhaAddress", e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            {showVerify ? (
              <AbhaVerify
                abhaNumber={form.abhaNumber || undefined}
                abhaAddress={form.abhaAddress || undefined}
                abhaVerified={form.abhaVerified}
                abhaVerifiedAt={form.abhaVerifiedAt}
                onApply={(p) => {
                  const { demo: _demo, ...rest } = p;
                  patch(rest as Partial<Patient>);
                  if (p.demo) {
                    toast.info("Demo data prefilled — the ABHA number is not marked verified.");
                  } else {
                    toast.success("Verified ABHA profile applied to the patient");
                  }
                  setShowVerify(false);
                }}
              />
            ) : (
              <Button type="button" variant="outline" onClick={() => setShowVerify(true)}>
                <ShieldCheck className="h-4 w-4" /> Verify ABHA with OTP
              </Button>
            )}
          </div>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
            Ayushman card (PM-JAY)
          </p>
          <Field label="Card / beneficiary ID">
            <Input
              value={form.pmjayCardId ?? ""}
              placeholder="e.g. 10234567891122334"
              onChange={(e) => set("pmjayCardId", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Family / ration card ID">
            <Input
              value={form.pmjayFamilyId ?? ""}
              onChange={(e) => set("pmjayFamilyId", e.target.value)}
            />
          </Field>
          <Field label="Scheme">
            <Input
              list="pmjay-schemes"
              value={form.pmjayScheme ?? ""}
              placeholder="PM-JAY (Ayushman Bharat)"
              onChange={(e) => set("pmjayScheme", e.target.value)}
            />
            <datalist id="pmjay-schemes">
              {PMJAY_SCHEMES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Enrollment status">
            <Select
              value={form.pmjayStatus ?? "Not enrolled"}
              onChange={(e) => set("pmjayStatus", e.target.value)}
            >
              {PMJAY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Checked on NHA / state portal" className="sm:col-span-2">
            <div className="flex items-center gap-3">
              <Select
                value={form.pmjayVerified ? "on" : "off"}
                onChange={(e) =>
                  patch(
                    e.target.value === "on"
                      ? { pmjayVerified: true, pmjayVerifiedAt: Date.now() }
                      : { pmjayVerified: false },
                  )
                }
              >
                <option value="off">No</option>
                <option value="on">Yes — card verified</option>
              </Select>
              {form.pmjayVerified && form.pmjayVerifiedAt ? (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  Checked {fmtDateTime(form.pmjayVerifiedAt)}
                </span>
              ) : null}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save patient</Button>
        </div>
      </Modal>
    </div>
  );
}
