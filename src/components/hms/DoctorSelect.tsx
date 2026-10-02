import { useState } from "react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { Button, Input, Select } from "./ui";

export function DoctorSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const { settings, updateSettings, state } = useHms();
  const doctors = Array.from(
    new Set([
      ...(settings.doctors ?? []),
      ...Object.values(state.visits)
        .map((v) => v.doctor)
        .filter(Boolean),
      ...Object.values(state.patients)
        .map((p) => p.doctor)
        .filter(Boolean),
    ]),
  ).sort((a, b) => a.localeCompare(b));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const add = () => {
    const clean = name.trim();
    if (!clean) {
      toast.error("Enter the doctor's name");
      return;
    }
    if (!doctors.some((d) => d.toLowerCase() === clean.toLowerCase())) {
      updateSettings({ doctors: [...doctors, clean].sort((a, b) => a.localeCompare(b)) });
    }
    onChange(clean);
    setName("");
    setAdding(false);
    toast.success(`${clean} added`);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select doctor…</option>
          {value && !doctors.includes(value) ? <option value={value}>{value}</option> : null}
          {doctors.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "Add doctor"}
        </Button>
      </div>
      {adding ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="Dr. Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" onClick={add}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
