# Real-time sync — design (draft)

Status: **phases 2–4 implemented, not yet proven in a browser.** Decisions 1–4 are settled (see below). Phase 4 (staff sign-in and change policy in the room) is in this branch. Real-time sync stays off until a room address is set in Settings, and a staff member signs in to the room. Checks so far: smoke suites (165 real-time checks), the room check against a local room (47 checks, plus the restart check), the Worker typecheck, and the app build. The two-device end-to-end run from phase 2 has not been repeated since the phase 4 protocol change. A browser run of the app with two devices has not been done.

## Goal

Every device in the hospital sees a change within about a second while online, keeps working offline, and catches up automatically on reconnect. Google Drive sync stays available until the new path is proven.

## Current state (what we build on)

- State is one object (`HmsState`) with 30 record collections (`COLLECTIONS` in `src/lib/hms/types.ts`).
- Every write stamps a per-record change time in `ops` (`"<collection>:<id>"` → ms timestamp). Deletes write a tombstone in `deleted`.
- `mergeStates` (`src/lib/hms/merge.ts`) already merges two states record by record: newest write wins, and tombstones are respected.
- Sync today is whole-file: each device uploads `kegh-<device>.keg` to Google Drive and merges the others' files. Nothing is pushed.

The model is already per-record and timestamped, so the server can speak the same language. The change needed is transport and a server-side source of truth.

## Proposed architecture

```
 device (IndexedDB, offline-first)  ⇄  WebSocket  ⇄  hospital room (Durable Object)
                                                      ├─ SQLite: records + change log
                                                      └─ broadcasts accepted changes
```

- **One room per hospital**, implemented as a Cloudflare Durable Object. It owns the authoritative copy and serialises writes.
- **Change log, not snapshots.** A device sends individual record changes `{collection, id, value | tombstone, ts, deviceId, seq}`. The server appends them to its log and assigns a monotonic sequence number.
- **Catch-up:** on connect, a device sends its last-seen sequence number. The server replays everything after it, then streams live changes.
- **Outbox on the device:** local writes are queued in IndexedDB and retried until acknowledged. Duplicates are harmless because each change has a `(deviceId, seq)` pair and writes are idempotent.
- **Conflicts:** same-record edits from two devices are merged by timestamp as today. A conflict is **flagged** for review rather than silently overwritten (see decision 3).

## Decisions

Settled by the team:

1. **Where patient data lives:** Cloudflare, any region. *A data-protection review is still required before real patient data is stored.*
2. **Hosting:** Cloudflare Durable Objects, one room per hospital.
3. **Conflict policy:** warn and keep. The newer version wins (ties broken by device id), and the other is kept in the conflicts list for review.
4. **Google Drive:** kept as an optional backup.

Still open (default applies until changed):

5. **Users and passwords.** The `users` collection holds PBKDF2 hashes. *Default: sync hashes so staff can log in on any device, with the server verifying logins.*

## Data that needs special handling

- **`auditLogs`:** high volume. Stream it, but do not merge or rewrite entries. Append-only on the server.
- **`users`:** hashes only, never plain passwords. Changes must be authorised by an Admin on the server.
- **`settings`:** device-local values (PIN, auto-lock, device name) stay local. Hospital-wide values (profile, rates, doctors) sync.
- **Drive `.keg` files:** not used as a source of truth once the server is live.

## Phased plan

1. **Sync core (done):** `src/lib/hms/sync-core.ts` holds the sequenced room log, idempotent submit, conflict flagging, the device outbox, and per-record convergence. `scripts/smoke-realtime.mjs` covers these, including a seeded random run with duplicates and out-of-order delivery. A deliberate break of the per-record ordering rule is caught by the suite.
1b. **Server skeleton (in progress):** Durable Object room wrapping `RoomLog`, WebSocket endpoint, and wire-protocol checks. The room is a separate Worker in `sync-worker/`, not part of the Nitro app build. Nitro's `cloudflare-durable` preset only generates a generic `$DurableObject` class, and changing presets would alter the managed build. The app will connect to the room by full URL in phase 2. Local checks: `sync-worker/test/room-check.mjs` (live `wrangler dev`, including restart persistence).
2. **Device transport (implemented):**
   - `src/lib/hms/realtime.ts` (`RealtimeClient`): connects with the device cursor, applies catch-up, sends the outbox in order (at most 100 unacknowledged), resends everything unacknowledged after any reconnect (the room dedupes by `devSeq`), reconnects with backoff, and runs a 20 s heartbeat that drops a silent socket. It also discards a change that fails validation, rather than retrying it forever.
   - `src/lib/hms/realtime-state.ts`: pure rules. Local edits become per-record changes (journal). Room updates apply without echoing back. On connect, the device sends what the room lacks or has differently (`importLocal`, no base version, so the room flags a clash and keeps the newer version).
   - Store: local `upsert`/`remove` are journaled. Bulk changes (backup restore, Drive merge) are not journaled one record at a time. They are reconciled with the room instead. A restore therefore never deletes room data.
   - Sidebar footer: Live sync / Syncing n / Offline · n waiting. Settings: room address (off when empty).
   - A room whose history is shorter than the device's cursor is treated as reset. The device starts over from zero.
   - Known limits: the room token is kept in browser settings (not in backups or Drive files). Two tabs on one device are not coordinated. A reset is detected only by a shorter history, not by a room identity check.
3. **Conflict flagging (implemented):** the room sends the losing version with each conflict (`Update.other`), so every device learns about it on catch-up or live. Each device lists conflicts at `/conflicts` (linked from the sidebar when any are open). The reviewer sees only the fields that differ, and chooses **Use other (older) version** (applied as a new edit, so it wins everywhere) or **Keep current**. Review state is per device.
4. **Auth (implemented):**
   - **Sign-in in the room.** A device signs in with a staff username and password. The room checks them against its own `users` records (hashes are synced; decision 5). A session token is returned: HMAC-SHA-256, signed with the room's `SESSION_SECRET`, valid for 12 hours. Changes to the account are checked live on every message: a deactivated account or a force sign-out (`sessionsKickedAt`) ends the session and closes the socket.
   - **Nothing without a session.** Catch-up, submit and live updates need a signed-in socket. Updates are sent only to signed-in sockets. The room token alone gets nothing.
   - **Policy on every change** (`src/lib/hms/sync-auth.ts`, `authorizeChange`): `users`, `staff`, `payrolls` and `expenses` are Admin-only, matching the Admin-only pages in `nav.ts`. `auditLogs` is append-only: entries can be added, never changed or deleted. Everything else can be written by any signed-in staff member.
   - **Refusal:** a refused change is not logged and takes no sequence number. The device drops the edit and takes the room's version of the record. The user sees a message saying why.
   - **First admin:** while the room has no active Admin, a `login` may carry the device's local Admin record. The room verifies the password against it and writes the record once. The device sends it on a retry only, after an ordinary sign-in is refused, so routine sign-ins never send the hash.
   - **Device side:** the session token is kept in `sessionStorage` (per browser tab, per room). Signing in to the app also signs in to the room with the same password. The sidebar shows "Sign in to sync" until a staff member signs in. Settings has a sign-in form and a sign-out button.
5. **Migration:** one-time import of existing Drive `.keg` data.
6. **Shadow run:** real-time and Drive sync both on, comparing results, before switching off Drive.
7. **Cutover** and removal of whole-file sync, if decision 4 says so.

## Phase 4 limits (read before real patient data)

- **Role rules are per collection, not per field or per action.** A Reception account can still change any patient field the app lets it change. The app's own page checks still apply on the device, but the room does not enforce them. Finer rules are a later change.
- **Password hashes reach every signed-in device.** `users` is synced so that staff can sign in anywhere, which means every device holds the PBKDF2 hashes. This was already true of the local app data and Drive backups. Hashes are no secret from a device that is signed in.
- **No login rate limit in the room.** The device locks out after five failed attempts (per device). The room itself does not limit guesses, so the room token is the only gate in front of a password guess.
- **The first-admin window.** Until a room has an active Admin, anyone with the room token can create the first Admin account. Create the room, then sign in on a trusted device straight away.
- **Session token in `sessionStorage`.** A token survives a reload in the same tab, not a closed tab. After a browser restart the device signs in to the room again.
- **Sign-in needs the Admin device's records.** A device with no local Admin account cannot make the room's first admin. The app needs at least one Admin account before real-time sync is turned on.
- **Not yet tested in a browser.** The two-device run and the sign-in form have only been checked by the smoke suite, the room check and the app build.

## Testing

- Unit tests for merge and conflict rules (extend `scripts/smoke-*.mjs`).
- Multi-device simulation: several headless browser profiles plus a local room, checking convergence after random offline periods.
- Load check: one room with dozens of concurrent devices, including reconnect storms.

## Known limits to verify before committing

- Patient data goes to the room once a room address is set. Do not set one for real patients before the data-protection review.

- Durable Object storage and message limits on the account's plan.
- Behaviour of the existing Worker build with Durable Object bindings (`wrangler` config changes).
- Whether the Lovable-managed `vite.config.ts` and build pipeline can carry a second Worker.
