import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { searchPatients } from "@/lib/hms/selectors";
import { ageFromDob, fmtDate } from "@/lib/hms/format";
import { nextMrn } from "@/lib/hms/mrn";
import type { Patient } from "@/lib/hms/types";
import { Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, Td, Textarea } from "@/components/hms/ui";
import { confirmDelete } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";

export const Route = createFileRoute("/patients/")({
  validateSearch: (search: Record<string, unknown>) => ({ q: (search['q'] as string) || "" }),
  head: () => ({
    meta: [
      { title: "Patients — KEGH HMS" },
      { name: "description", content: "Register and search hospital patients by name, MRN or phone." },
      { property: "og:title", content: "Patients — KEGH HMS" },
      { property: "og:description", content: "Register and search hospital patients by name, MRN or phone." },
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
});

function PatientsPage() {
  const { q } = Route.useSearch();
  const { state, upsert, remove } = useHms();
  const [query, setQuery] = useState(q);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Patient>>(blank);

  const rows = useMemo(
    () =>
      searchPatients(Object.values(state.patients), query).sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""),
      ),
    [state.patients, query],
  );

  const set = (k: keyof Patient, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name?.trim()) { toast.error("Patient name is required"); return; }
    if (!form.dob) { toast.error("Date of birth is required"); return; }
    upsert<Patient>("patients", { ...form, mrn: form.mrn || nextMrn(state) } as Patient);
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
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New patient
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <Input
          placeholder="Search by name, MRN or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Card>

      <DataTable columns={["Name", "MRN", "Phone", "Age", "Gender", "Doctor", "Registered", ""]} rowCount={rows.length}>
        {rows.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link to="/patients/$patientId" params={{ patientId: p.id }} className="font-medium text-accent underline">
                {p.name}
              </Link>
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

      <Modal open={open} title={form.id ? "Edit patient" : "Register patient"} onClose={() => setOpen(false)} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Date of birth" required>
            <Input type="date" value={form.dob ?? ""} onChange={(e) => set("dob", e.target.value)} />
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
            <Input value={form.fatherName ?? ""} onChange={(e) => set("fatherName", e.target.value)} />
          </Field>
          <Field label="Blood group">
            <Select value={form.bloodGroup ?? ""} onChange={(e) => set("bloodGroup", e.target.value)}>
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
            <Textarea value={form.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} />
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
