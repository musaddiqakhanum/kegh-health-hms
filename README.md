# KEGH Health Companion

Build a full Hospital Management Information System (HMS) called "KEGH HMS" as a React + Vite + Tailwind CSS single-page application with a sidebar layout, offline-first storage (localStorage/IndexedDB), and Google Drive sync.

Core data model
Each entity has a unique id (crypto.randomUUID). Store all data in a single state object in IndexedDB (store name: "kegh-hms", key: "state"). The state shape:

text

{
  patients: { [id]: { id, name, mrn, dob, gender, phone, address, fatherName, bloodGroup, allergies, createdAt } },
  visits:   { [id]: { id, patientId, date, type:"OPD"|"IPD"|"Emergency", doctor, department, diagnosis, notes, admissionDate, dischargeDate, createdAt } },
  labs:     { [id]: { id, patientId, visitId, date, testName, result, unit, normalRange, flag:"normal"|"high"|"low"|"critical", technician, createdAt } },
  rads:     { [id]: { id, patientId, visitId, date, studyType, findings, impression, radiologist, createdAt } },
  pharms:   { [id]: { id, patientId, visitId, date, medication, dosage, frequency, duration, qty, rate, createdAt } },
  bills:    { [id]: { id, patientId, visitId, date, items:[{description,qty,rate,amount}], totalAmount, paid, due, paymentMode, createdAt } }
}
MRN (Medical Record Number) format
Auto-generate as KEGH/YY/NNNN where YY is the last 2 digits of the current year and NNNN is a zero-padded sequential number (0001, 0002, etc.), continuing from the highest existing MRN for that year.

Navigation sidebar (left, collapsible on mobile ≤820px)
Use these nav items with icons:

Dashboard (layout-dashboard icon)
Patients (users icon)
Visits (OPD/IPD) (stethoscope icon)
Laboratory (flask-conical icon)
Radiology (scan icon)
Pharmacy (pill icon)
Billing (indian-rupee icon)
Reports (bar-chart-3 icon)
Google Drive Sync (cloud icon)
Settings (settings icon)
Brand: "KEGH" logo in the sidebar header with "Health Records" subtitle.

Pages and features
Dashboard: Hero card with hospital name/address/phone. Stats grid: Patients registered, Visits today, Laboratory today, Radiology today, Pharmacy today, Today's collection (₹), Admitted/IPD count, All-time collection. Recent visits table (last 6). "Get set up" checklist (hospital details, role, Drive connected, encryption).

Patients: Searchable table (name, MRN, phone, age, gender). Add/edit form: name, DOB, gender (M/F/Other), phone, address, father name, blood group, allergies. Click patient → Patient 360° view showing all their visits with nested lab/rad/pharm/bill records, totals, and action buttons to add child records or print/export.

Visits: Table of all visits (date, patient name, type, doctor, diagnosis). Add/edit: select patient (searchable dropdown), date, type (OPD/IPD/Emergency), doctor, department, diagnosis, notes. IPD gets admission/discharge dates.

Laboratory: Table (date, patient, test, result, flag). Add/edit: patient, visit (linked), date, test name, result, unit, normal range, flag (auto-compare or manual: normal/high/low/critical), technician.

Radiology: Table (date, patient, study type, impression). Add/edit: patient, visit, date, study type, findings (textarea), impression, radiologist.

Pharmacy: Table (date, patient, medication, qty, amount). Add/edit: patient, visit, date, medication name, dosage, frequency, duration, quantity, rate per unit. Auto-calculate amount = qty × rate.

Billing: Table (date, patient, total, paid, due). Add/edit: patient, visit, date, line items (description + qty + rate = auto amount), total (sum of items), paid amount, due (auto = total - paid), payment mode (Cash/UPI/Card/Insurance).

Reports:

Section-wise report: select section (Lab/Billing/Pharmacy/Radiology) + date range (Today/7 days/30 days/This month/All time) → generates a summary table with counts, totals, and breakdowns.
Patient-wise report: select patient → shows complete record across all sections.
Both reports support: Print (opens a print-optimized overlay with hospital letterhead: name, address, phone, registration number, date), CSV download.
Day-end report: button on dashboard, shows today's summary across all sections.
Google Drive Sync:

A setup section explaining how to get a Google Cloud Client ID (link to console.cloud.google.com).
Input field for Client ID, folder name (default "KEGH-HMS Health Records").
"Connect Google Drive" button → opens Google OAuth popup (scope: drive.file only).
Once connected: shows last sync time, file count, sync status.
"Sync Now" button.
Auto-sync every 10 minutes when connected.
Each device writes its own .keg file (gzip-compressed JSON). All devices merge all .keg files on sync.
Optional AES-256-GCM encryption with a user-chosen passphrase.
Sync algorithm: download all .keg files → decompress → merge operation logs (newest timestamp wins per record) → upload own device's merged state.
Settings:

Hospital profile: name, address, phone, registration number (printed on reports).
Device name (e.g. "Reception PC", "Lab Tablet").
Role selector: Admin, Reception, Doctor, Lab, Pharmacy, Billing. Each role shows/hides relevant nav items.
PIN lock: set a 4-digit PIN. On next app open, PIN is required. "Forgot PIN" clears it (local only).
Auto-sync toggle and interval (minutes).
Export/Import .keg file manually (download current data / upload and merge).
Encryption toggle and passphrase.
Role-based nav visibility
Admin: all pages
Reception: Dashboard, Patients, Visits, Billing, Reports
Doctor: Dashboard, Patients, Visits, Labs, Rads, Pharmacy
Lab: Dashboard, Patients, Labs, Reports
Pharmacy: Dashboard, Patients, Pharms, Reports
Billing: Dashboard, Patients, Billing, Reports
Visual design
Color scheme: deep teal primary (#0b3a44), accent teal (#0b6b5f), light background (#f0f7f5), white cards.
Sidebar: dark teal gradient, white text, 236px wide, collapses to off-canvas drawer on mobile.
Cards with subtle shadows, rounded corners (8px).
Tables with sticky headers, alternating row shading.
Status badges: green (normal/paid), amber (high/partial), red (critical/due).
Toast notifications (bottom-right, auto-dismiss).
Modal dialogs for forms.
Print styles: @media print hides everything except the report overlay, white background, hospital letterhead at top, @page margins 14mm 12mm.
PWA
manifest.json with name "KEGH HMS", short_name "KEGH HMS", display standalone, theme_color #0b3a44.
Service worker caching the app shell for offline use.
Icons: teal medical cross on white background (192x192 and 512x512).
Technical requirements
React functional components with hooks
React Router for hash-based routing (#/dash, #/patients, #/patients/p/:id, etc.)
Tailwind CSS for styling
IndexedDB via idb-keyval or raw IndexedDB API for persistence
Google Drive REST API v3 (drive.file scope) for sync
JSZip or pako for gzip compression
Web Crypto API for AES-256-GCM encryption
No backend server — everything runs in the browser
Must work on Chrome/Edge (Windows) and Chrome (Android)
Important behaviors
Global search bar in the top bar: searches patient name, MRN, phone → navigates to patients list filtered.
"/" keyboard shortcut focuses search.
Escape closes modals and print overlay.
Online/offline indicator in sidebar footer.
All monetary values displayed as ₹ with 2 decimal places.
Dates formatted as DD-MMM-YYYY.
All forms validate required fields before saving.
Delete actions require confirmation.
The app should load instantly (show a "KEGH" splash while JS bundles load).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://kegh-health-hms.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e3573298-8936-4293-9adf-24f3c90c6900).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
