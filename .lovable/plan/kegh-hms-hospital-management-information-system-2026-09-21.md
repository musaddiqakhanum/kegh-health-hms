# KEGH HMS — Hospital Management Information System

An offline-first hospital records app: patients, visits, lab, radiology, pharmacy, billing, reports, and Google Drive sync. Everything runs in the browser; no server database.

## Two adjustments to your brief

1. **Routing**: this project runs on TanStack Router (file-based paths like `/patients/:id`) instead of React Router hash routes. Same pages, same navigation, cleaner URLs — no functional difference for users.
2. **Google Drive**: I'll build it exactly as described — you paste your own Google Cloud Client ID in the Sync page and sign in via a popup with `drive.file` access only. (Lovable also offers a one-click Drive connection, but that connects *your* account for everyone, so the per-device sign-in you described is the right fit.)

## Data and storage

Single state object in IndexedDB (store `kegh-hms`, key `state`) holding `patients`, `visits`, `labs`, `rads`, `pharms`, `bills`, each keyed by `crypto.randomUUID()`. Every write also stamps an operation log entry (record id + timestamp) used for sync merging.

MRN auto-generated as `KEGH/YY/NNNN`, continuing from the highest number seen for the current year.

All reads/writes go through one app-wide store hook so every page stays in sync instantly and saves are debounced to IndexedDB.

## Pages

- **Dashboard** — hospital hero card, 8 stat tiles (patients, today's visits/lab/radiology/pharmacy, today's collection, admitted IPD, all-time collection), last 6 visits, setup checklist, Day-end report button.
- **Patients** — searchable table; add/edit form; click-through to **Patient 360°** showing every visit with nested lab/radiology/pharmacy/bill records, totals, quick-add buttons, print/export.
- **Visits** — OPD/IPD/Emergency with searchable patient picker; IPD shows admission/discharge dates.
- **Laboratory** — result entry with unit, normal range, and flag (auto-derived from range when numeric, manually overridable).
- **Radiology** — study type, findings, impression, radiologist.
- **Pharmacy** — medication, dosage, frequency, duration; amount auto-calculates as qty × rate.
- **Billing** — line items with auto amounts, total, paid, auto due, payment mode.
- **Reports** — section-wise (Lab/Billing/Pharmacy/Radiology × Today/7d/30d/This month/All time) and patient-wise; both print with hospital letterhead and export CSV.
- **Google Drive Sync** — setup guide, Client ID + folder name, connect, last sync time, file count, status, Sync Now, auto-sync every 10 minutes.
- **Settings** — hospital profile, device name, role, 4-digit PIN lock (with Forgot PIN reset), auto-sync toggle/interval, manual `.keg` export/import, encryption toggle and passphrase.

Role-based nav visibility exactly as specified (Admin, Reception, Doctor, Lab, Pharmacy, Billing).

## Sync behaviour

Each device writes its own `.keg` file: JSON → gzip (pako) → optional AES-256-GCM (Web Crypto, passphrase-derived key). Sync downloads every `.keg` in the Drive folder, decompresses, merges by newest-timestamp-wins per record, then uploads this device's merged state. Works offline; syncs when back online.

## Look and feel

Deep teal `#0b3a44` primary, `#0b6b5f` accent, `#f0f7f5` background, white cards, 8px radius, subtle shadows. 236px dark-teal gradient sidebar with KEGH brand and "Health Records", collapsing to a drawer at ≤820px. Sticky-header tables with zebra rows, green/amber/red status badges, bottom-right toasts, modal forms, print-only overlay with letterhead and 14mm/12mm page margins. All money as ₹ with 2 decimals; dates as DD-MMM-YYYY.

Top bar has global search across name/MRN/phone; `/` focuses it, `Escape` closes modals and print overlay. Sidebar footer shows online/offline state. Splash screen with the KEGH mark while the app boots.

## PWA

Manifest (`KEGH HMS`, standalone, theme `#0b3a44`), teal medical-cross icons at 192 and 512, and a service worker caching the app shell for offline use. Offline mode works in the published app, not in the editor preview.

## Build order

1. Storage layer, state model, MRN generator, shared UI kit (cards, tables, modal, toast, badges), sidebar + top bar shell.
2. Patients, Patient 360°, Visits.
3. Laboratory, Radiology, Pharmacy, Billing.
4. Dashboard stats, Reports, print and CSV export.
5. Settings (profile, role, PIN, import/export, encryption).
6. Google Drive sync, compression, encryption, auto-sync.
7. PWA manifest, icons, service worker, splash.

## Technical notes

- Client-only app: IndexedDB, Web Crypto, and Drive calls all run after hydration; pages render safely during server rendering.
- Dependencies to add: `idb-keyval`, `pako`, `lucide-react` icons, `vite-plugin-pwa` for the service worker.
- Drive integration uses Google Identity Services token popup + Drive REST v3 with `drive.file` scope; Client ID stored locally on the device.
- Encryption: AES-256-GCM with PBKDF2-derived key from the passphrase; the passphrase is never stored or synced.
