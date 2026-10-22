# Real-time sync — design (draft)

Status: **phase 1 in progress.** Decisions 1–4 are settled (see below). The sync core and its tests exist; the Durable Object wrapper and transport do not yet.

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
1b. **Server skeleton:** Durable Object room wrapping `RoomLog`, WebSocket endpoint, and deployment checks on the Nitro Cloudflare build.
2. **Device transport:** outbox, reconnect with catch-up, and status in the sidebar footer (online / syncing / offline).
3. **Conflict flagging:** a review list in the app for flagged records.
4. **Auth:** server-side staff verification and role checks on every change.
5. **Migration:** one-time import of existing Drive `.keg` data.
6. **Shadow run:** real-time and Drive sync both on, comparing results, before switching off Drive.
7. **Cutover** and removal of whole-file sync, if decision 4 says so.

## Testing

- Unit tests for merge and conflict rules (extend `scripts/smoke-*.mjs`).
- Multi-device simulation: several headless browser profiles plus a local room, checking convergence after random offline periods.
- Load check: one room with dozens of concurrent devices, including reconnect storms.

## Known limits to verify before committing

- Durable Object storage and message limits on the account's plan.
- Behaviour of the existing Worker build with Durable Object bindings (`wrangler` config changes).
- Whether the Lovable-managed `vite.config.ts` and build pipeline can carry a second Worker.
