# Phase 4b draft: field rules and device sign-in

Status: **draft for review. Nothing here is built.** Two items from the readiness list:

- Item 3: per-field role rules in the room (you chose this approach).
- Item 4: password hashes stay in the room; devices sign in offline with a PIN (you chose this approach).

Please review sections 1 and 2 before any code is written. The field matrix in section 1 is a proposal, built from the page access in `src/components/hms/nav.ts` and the record shapes in `src/lib/hms/types.ts`.

## 1. Per-field role rules (item 3)

### Today

The room (`authorizeChange` in `src/lib/hms/sync-auth.ts`) only restricts four collections to Admin (`users`, `staff`, `payrolls`, `expenses`) and makes `auditLogs` append-only. Any other signed-in role can change any field of any other record.

### Proposed rule

A change is accepted only if the signed-in role may write **every field that differs** from the room's current version. Field differences are computed the same way as `changedFields` (ignoring `id` and `createdAt`). A create (no current version) must be allowed for every field it sets. Anything refused is never logged, and the device receives the room's version, as now.

Admin may write every field. Admin-only collections stay Admin-only.

### Proposed matrix (for review)

Roles: Reception, Nursing, Doctor, Lab, Pharmacy, Billing. Admin may write everything.

| Collection | Field group | Proposed roles |
| --- | --- | --- |
| patients | name, dob, gender, phone, address, fatherName | Reception, Doctor, Nursing |
| patients | bloodGroup, allergies | Doctor, Nursing |
| patients | doctor (assigned) | Reception, Doctor |
| patients | abha*, pmjay* (IDs and verification) | Reception, Billing |
| visits | date, type, doctor, department, admissionDate, dischargeDate | Reception, Doctor |
| visits | diagnosis, notes, procedures, followUp | Doctor |
| admissions | bedId, admitDate, admitTime, status | Reception, Nursing |
| admissions | reason, doctor, expectedDischarge, discharge block | Doctor |
| beds | ward, room, label, active, notes | Reception, Nursing |
| beds | rate | Admin |
| appointments | date, time, doctor, department, type, notes, tokenNo, tokenTime | Reception |
| appointments | status | Reception, Doctor |
| doctorSchedules | all | Reception |
| labOrders | tests, priority, orderedBy, notes | Doctor |
| labOrders | status, collectedDate, collectedTime, collectedBy | Lab, Nursing |
| labOrders | labResultId | Lab |
| labs (results) | all | Lab |
| rads, imagingOrders | as labOrders / labs above | Doctor (order), Lab (result) |
| prescriptions | doctor, diagnosis, items, notes, signOff | Doctor |
| prescriptions | itemDispensed, dispenseStatus, dispensedBy, dispensedAt | Pharmacy |
| pharms, meds, batches, grns, medCatalog | all | Pharmacy |
| bills | items, discount, tax, totalAmount | Billing |
| bills | paid, due, paymentMode | Billing, Reception |
| bills | labChargeBillId, bedChargeBillId (posting guards) | Billing, Lab, Reception |
| payers, claims | all | Billing |
| surgeries | schedule fields | Reception, Doctor |
| surgeries | status, team notes | Doctor, Nursing |
| serviceRates | all | Admin |
| vitals, nursingNotes | all | Nursing |
| handoverNotes | all (author fixed at create) | Nursing, Doctor, Reception |
| users, staff, payrolls, expenses | all | Admin (unchanged) |
| auditLogs | append only | all signed-in roles (unchanged) |

**Open questions for you:**
- Is Reception allowed to take payments (`paid`, `paymentMode`)?
- Should Doctor be able to change `patients.allergies`? (Proposed: yes.)
- Should Nursing be able to change visit diagnosis? (Proposed: no.)
- Should `serviceRates` be Admin-only? (Proposed: yes.)

### Effect on the app

The app's own page checks stay. The room becomes the enforcer, so a refused change shows the same message the device already shows for a denied change.

### Tests needed

- room-check: each role's allowed and refused field changes, including a mixed change where one field is refused (the whole change is refused).
- Mutation: remove one field rule and confirm the check fails.

## 2. Device sign-in with PIN (item 4)

### Today

- `users` records, including `passwordHash` and `salt`, are synced to every signed-in device.
- Local sign-in checks those hashes on the device, so a device can sign staff in without the room.
- The same hashes are in Drive `.keg` backups.

### Proposed

1. **Room only holds hashes.** The room strips `passwordHash` and `salt` from every `users` record it sends to devices (in `catchup` and `update`). A device's copy of `users` has no password material.
2. **Room sign-in is unchanged.** Staff still sign in with username and password. The room verifies it, as now.
3. **Offline sign-in with a device PIN.** After a successful room sign-in, the device stores, in its local settings:
   - a salted hash of the staff member's PIN (set at that sign-in, using PBKDF2, the same scheme as now);
   - the user's id, username, role and display name (no password material);
   - a count of failed PIN attempts.
   Offline, staff unlock with the PIN. Five failed PIN attempts clear the stored offline session, and the device needs the room again.
4. **Backups.** `.keg` exports and Drive files leave out `passwordHash` and `salt`. Restoring a backup on a device gives a user list with no offline sign-in until the next room sign-in.

### Risks to accept or change

- **A 4-digit PIN is a weak offline secret.** Someone who copies the device's storage can try all 10,000 PINs offline. The PIN hash must be slow (PBKDF2 at least as strong as today), and the offline session must expire after a fixed time (proposed: 12 hours, matching room sessions). Recommend a PIN of at least 6 digits for devices that hold patient data. **Decision needed.**
- **Changing a password** needs the room. An offline device cannot change a password.
- **Deactivated accounts** keep their offline PIN until the device next connects. This is a window, not a bypass: the room refuses every change from that account once it reconnects.

### Tests needed

- room-check: `users` records sent to devices have no `passwordHash` or `salt`.
- smoke: offline PIN unlock works after a room sign-in, fails after five wrong PINs, and expires.
- Browser check: sign in while the room is up, go offline, unlock with the PIN.

## 3. Decisions needed before building

1. Confirm or change the field matrix in section 1 (and the four open questions).
2. Offline PIN length: 4 digits (the app's current PIN) or 6 or more.
3. Offline session length: 12 hours (proposed) or shorter.
4. Confirm that backups and Drive files will leave out password hashes, which means a restored backup has no offline sign-in until the next room sign-in.

## 4. Item 3 build status

Built as section 1 describes, with these additions and deviations from the approved matrix:

- `mrn` on patients: Reception.
- `status` on labOrders and imagingOrders: Doctor, Lab, Nursing.
- `status` on surgeries: Reception, Doctor, Nursing.
- Visit `patientId`: Reception, Doctor, Nursing.
- Handover `resolved`, `resolvedBy`, `resolvedAt`: all roles (so anyone can mark a handover done).
- `beds.rate` and `serviceRates`: Admin only, stated explicitly.
- Handover `author` is create-only, so a handover note cannot be re-attributed, and non-Admin roles cannot delete one.

Risks to test in the browser:

- Admissions `reason` and `doctor` are Doctor-only in the draft. If Reception admits patients with those fields, the admission is refused.
- Bill `items` are Billing-only. Check whether Reception creates bills.

Coverage: `scripts/smoke-realtime.mjs` fails if any field of any synced record type (other than `auditLogs`) has no entry in `FIELD_RULES`.
