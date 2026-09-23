import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Banknote, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { hasLeft, searchStaff, sortStaffByName, staffDepartments } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import { periodLabel, currentPeriod } from "@/lib/hms/payroll";
import { DEPARTMENTS, STAFF_ROLES, type Staff } from "@/lib/hms/types";
import { downloadCsv } from "@/lib/hms/csv";
import {
  Badge,
  Button,
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
import { AdminOnly } from "@/components/hms/gate";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [
      { title: "Staff Records — KEGH HMS" },
      {
        name: "description",
        content:
          "Register hospital staff with role, department, phone, salary and join / leave dates.",
      },
      { property: "og:title", content: "Staff Records — KEGH HMS" },
      {
        property: "og:description",
        content: "Staff master for the monthly payroll run — roles, departments and salaries.",
      },
    ],
  }),
  component: StaffPage,
});

const blank = (): Partial<Staff> => ({
  name: "",
  role: "",
  department: "",
  phone: "",
  monthlySalary: 0,
  joinDate: todayISO(),
  leaveDate: "",
  notes: "",
});

type StatusFilter = "all" | "active" | "left";

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function StaffPage() {
  const { state, upsert, remove } = useHms();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Staff>>(blank);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const all = useMemo(() => sortStaffByName(Object.values(state.staff ?? {})), [state.staff]);
  const departments = useMemo(() => staffDepartments(all), [all]);
  const today = todayISO();

  const rows = useMemo(() => {
    let list = searchStaff(all, q);
    // Ignore a stale department filter (e.g. the last person in it was deleted).
    if (dept !== "all" && all.some((s) => s.department === dept)) {
      list = list.filter((s) => s.department === dept);
    }
    if (status === "active") list = list.filter((s) => !hasLeft(s) && (s.joinDate || "") <= today);
    if (status === "left") list = list.filter((s) => hasLeft(s));
    return list;
  }, [all, q, dept, status, today]);

  const onRoll = all.filter((s) => !hasLeft(s));
  const salaryBill = onRoll.reduce((sum, s) => sum + Number(s.monthlySalary || 0), 0);
  const joiningSoon = onRoll.filter((s) => (s.joinDate || "") > today).length;

  const save = () => {
    const name = (form.name ?? "").trim();
    if (!name) {
      toast.error("Staff name is required");
      return;
    }
    if (!form.joinDate) {
      toast.error("Joining date is required");
      return;
    }
    if (form.leaveDate && form.leaveDate < form.joinDate) {
      toast.error("Leave date cannot be before the joining date");
      return;
    }
    const salary = Number(form.monthlySalary || 0);
    if (salary < 0 || Number.isNaN(salary)) {
      toast.error("Monthly salary must be zero or more");
      return;
    }
    const dupe = all.some(
      (s) =>
        s.id !== form.id && s.name.toLowerCase() === name.toLowerCase() && s.role === form.role,
    );
    if (dupe) {
      toast.error(`${name} is already registered with the same role`);
      return;
    }
    upsert<Staff>("staff", {
      ...form,
      name,
      role: (form.role ?? "").trim(),
      department: (form.department ?? "").trim(),
      phone: (form.phone ?? "").trim(),
      monthlySalary: salary,
      leaveDate: (form.leaveDate ?? "").trim(),
      notes: (form.notes ?? "").trim(),
    } as Staff);
    toast.success(form.id ? "Staff record updated" : `${name} added to the staff list`);
    setOpen(false);
  };

  const exportCsv = () => {
    downloadCsv("kegh-staff.csv", [
      [
        "Name",
        "Role",
        "Department",
        "Phone",
        "Monthly salary",
        "Joined",
        "Left",
        "Status",
        "Notes",
      ],
      ...rows.map((s) => [
        s.name,
        s.role || "—",
        s.department || "—",
        s.phone || "—",
        Number(s.monthlySalary || 0),
        s.joinDate,
        s.leaveDate || "",
        hasLeft(s) ? "Left" : "Active",
        s.notes || "",
      ]),
    ]);
    toast.success("Staff list exported");
  };

  const markLeft = (s: Staff) => {
    upsert<Staff>("staff", { ...s, leaveDate: todayISO() });
    toast.success(`${s.name} marked as left today`);
  };

  return (
    <AdminOnly
      page="Staff Records"
      hint="Salary details stay on the Admin portal. Monthly totals still appear under Reports."
    >
      <div>
        <PageHeader
          title="Staff Records"
          subtitle={`${onRoll.length} on roll · ${all.length - onRoll.length} left · ${money(salaryBill)} per month`}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" onClick={() => navigate({ to: "/payroll" })}>
                <Banknote className="h-4 w-4" /> Payroll · {periodLabel(currentPeriod())}
              </Button>
              <Button
                onClick={() => {
                  setForm(blank());
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Register staff
              </Button>
            </>
          }
        />

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="On roll" value={onRoll.length} />
          <Tile label="Left" value={all.length - onRoll.length} />
          <Tile label="Monthly salary bill" value={money(salaryBill)} />
          <Tile label="Departments" value={departments.length} />
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Search">
            <Input
              placeholder="Name, role, department or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <Field label="Department">
            <Select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">Everyone</option>
              <option value="active">On roll</option>
              <option value="left">Left</option>
            </Select>
          </Field>
        </div>

        <DataTable
          columns={[
            "Name",
            "Role",
            "Department",
            "Phone",
            "Salary / month",
            "Joined",
            "Status",
            "",
          ]}
          rowCount={rows.length}
          empty="No staff match these filters. Use “Register staff” to add the first one."
        >
          {rows.map((s) => {
            const left = hasLeft(s);
            const joining = !left && (s.joinDate || "") > today;
            return (
              <tr key={s.id}>
                <Td className="font-medium">
                  {s.name}
                  {s.notes ? (
                    <span className="block text-xs text-muted-foreground">{s.notes}</span>
                  ) : null}
                </Td>
                <Td>{s.role || "—"}</Td>
                <Td>{s.department || "—"}</Td>
                <Td>{s.phone || "—"}</Td>
                <Td className="font-medium">{money(s.monthlySalary)}</Td>
                <Td>{fmtDate(s.joinDate)}</Td>
                <Td>
                  {left ? (
                    <Badge tone="red">Left {fmtDate(s.leaveDate)}</Badge>
                  ) : joining ? (
                    <Badge tone="amber">Joins {fmtDate(s.joinDate)}</Badge>
                  ) : (
                    <Badge tone="green">Active</Badge>
                  )}
                </Td>
                <Td className="whitespace-nowrap">
                  <button
                    className="mr-2 text-muted-foreground hover:text-foreground"
                    title="Edit"
                    onClick={() => {
                      setForm(s);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!left ? (
                    <button
                      className="mr-2 text-xs text-muted-foreground underline hover:text-foreground"
                      title="Set today as the last working day"
                      onClick={() => markLeft(s)}
                    >
                      Mark left
                    </button>
                  ) : null}
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    title="Delete"
                    onClick={() => {
                      if (confirmDelete(`${s.name}'s staff record`)) {
                        remove("staff", s.id);
                        toast.success("Staff record deleted");
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Td>
              </tr>
            );
          })}
        </DataTable>

        {joiningSoon > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {joiningSoon} staff member{joiningSoon === 1 ? "" : "s"} join after today — the payroll
            run pro-rates their first month automatically.
          </p>
        ) : null}

        <Modal
          open={open}
          title={form.id ? `Edit ${form.name ?? "staff"}` : "Register staff"}
          onClose={() => setOpen(false)}
          wide
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input
                autoFocus
                placeholder="e.g. Asha Kumbhar"
                value={form.name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <Input
                placeholder="98xxxxxxxx"
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="Role / designation">
              <Input
                list="kegh-staff-roles"
                placeholder="Staff Nurse"
                value={form.role ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              />
              <datalist id="kegh-staff-roles">
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Department">
              <Input
                list="kegh-departments"
                placeholder="Nursing"
                value={form.department ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              />
              <datalist id="kegh-departments">
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="Monthly salary (₹)" required>
              <Input
                type="number"
                min={0}
                step="100"
                value={form.monthlySalary ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, monthlySalary: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Date of joining" required>
              <Input
                type="date"
                value={form.joinDate ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, joinDate: e.target.value }))}
              />
            </Field>
            <Field label="Leave date" className="sm:col-span-2">
              <Input
                type="date"
                value={form.leaveDate ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, leaveDate: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Leave empty while the person is on roll. Set it to stop them appearing in future
                payroll runs; the month they leave is pro-rated to this date.
              </span>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                placeholder="Qualification, shift, bank account, advance policy…"
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
            <div className="rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
              Gross monthly pay: <strong>{money(form.monthlySalary)}</strong>
              {form.leaveDate && form.leaveDate < todayISO() ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  (left on {fmtDate(form.leaveDate)})
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{form.id ? "Save changes" : "Register staff"}</Button>
          </div>
        </Modal>
      </div>
    </AdminOnly>
  );
}
