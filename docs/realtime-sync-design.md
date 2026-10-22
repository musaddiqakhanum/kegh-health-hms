# Real-time sync — design (draft)

Status: **draft, decisions pending**. No server code exists yet.

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

## Decisions needed

1. **Where patient data lives.** Hosting patient records on Cloudflare means a data-protection review and a choice of region. *Default if no answer: stop and ask before any patient data leaves devices.*
2. **Hosting.** Durable Objects on the existing Cloudflare account (fits the Worker deploy target; limits and pricing still to be checked), or a managed Postgres with a realtime layer. *Default: Durable Objects.*
3. **Conflict policy.** (a) newest wins, log the other silently; (b) newest wins, show a warning and keep the other version for review. *Default: (b) for clinical collections, (a) for settings and counters.*
4. **Google Drive.** Keep as an optional backup, or remove once real-time is live. *Default: keep as backup until the server has run in production for a while.*
5. **Users and passwords.** The `users` collection holds PBKDF2 hashes. Options: sync hashes to the server (accounts work on any device), or keep accounts local and only sync clinical data. *Default: sync hashes, since staff need to log in on any device, and the server verifies logins.*

## Data that needs special handling

- **`auditLogs`:** high volume. Stream it, but do not merge or rewrite entries. Append-only on the server.
- **`users`:** hashes only, never plain passwords. Changes must be authorised by an Admin on the server.
- **`settings`:** device-local values (PIN, auto-lock, device name) stay local. Hospital-wide values (profile, rates, doctors) sync.
- **Drive `.keg` files:** not used as a source of truth once the server is live.

## Phased plan

1. **Server skeleton:** Durable Object room, WebSocket endpoint, change log with sequence numbers, and a test harness that simulates devices.
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
