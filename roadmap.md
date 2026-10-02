# KEGH HMS roadmap

- [x] Core storage, state model, MRN, UI kit, sidebar shell
- [x] Patients, Patient 360, Visits
- [x] Laboratory, Radiology, Pharmacy, Billing
- [x] Dashboard, Reports, print + CSV
- [x] Settings, Google Drive sync, encryption
- [x] Fix remaining TypeScript build errors
- [x] Use uploaded logo in sidebar, splash, print letterhead and favicon
- [x] Default company name "KEGH LLP"
- [x] PWA manifest icons + offline service worker
- [x] Staff records — role, department, phone, salary, join / leave dates
- [x] Monthly payroll run — pro-rated gross, advances, deductions, net pay, payslips
- [x] Expenses page (Admin) with salary posted from each payroll run
- [x] Reports: monthly expense totals incl. salaries, category breakdown
- [x] Sync every collection (staff, payroll, expenses, appointments…) between devices
- [x] Team sync — several staff Google accounts writing one shared Drive folder
- [x] Appointments restored — day / upcoming / all views, filters, CSV, token check-in
- [x] Weekly doctor availability roster with on-duty hints in the booking form
- [x] OPD token queue — now serving, walk-in check-in, token slips, counter board
- [x] Prescriptions restored — medicine rows, allergy warning, letterhead print, CSV
- [x] Reports: appointments & prescriptions sections with range, print and CSV
- [x] Reports: OPD activity & prescribing card with doctor-wise table
- [x] Dashboard & Patient 360: appointment and prescription tiles, lists and print
- [x] Live ABHA (ABDM) OTP verification + Ayushman (PM-JAY) card fields on patients
- [x] Staff login — offline accounts (PBKDF2 hashes), login gate, lockout, login / logout audit entries
- [x] Per-person role workspaces — Reception, Doctor, Lab, Pharmacy, Billing; Admin keeps the dashboard
- [x] Pharmacy inventory — batches, expiry, GRN, reorder levels, low-stock alerts
      (catalog + FEFO dispensing, batch write-offs, supplier invoices, stock valuation)
- [x] Audit trail viewer (Admin, read-only) plus CRUD audit writer
      (every upsert/delete stamps action, collection, record, role and device)
- [x] Lab order queue — order → sample collected → result, urgent flag,
      requisition slip print, Lab workspace queue (was the honest stand-in)
- [x] Prescription fulfilment — counter queue (Pending / Partial / Dispensed),
      per-item ticks, one-click dispense that writes entries and draws stock
      FEFO; Pharmacy workspace counter queue (last stand-in removed)
- [x] IPD admissions & beds — wards/bed master with batch add, bed board with
      live occupancy, admit → discharge flow, letterhead discharge summaries
- [x] Shift handover — written notes, photo snapshots and voice recordings
      from any duty role; open/handled tracking; attachments sync with Drive
