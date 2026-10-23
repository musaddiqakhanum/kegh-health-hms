# Sync worker (real-time room)

This is the server side of real-time sync for KEGH HMS (design: `docs/realtime-sync-design.md`, phase 1b).

It is a separate Cloudflare Worker, not part of the Nitro app build. The app Worker is built by Lovable-managed tooling, and its Nitro `cloudflare-durable` preset only generates a generic `$DurableObject` class. This Worker has one Durable Object class, `HospitalRoom`, with one room per hospital.

**Status:** not deployed. Local checks pass. Real patient data must not go to this Worker until the data-protection review is done (design doc, "Known limits").

## Layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Entry point. `/health`, and `/rooms/<id>/ws` (token check, then forwards to the room). |
| `src/room.ts` | `HospitalRoom` Durable Object. Holds one `RoomLog`, persists every accepted change before acknowledging it, and broadcasts updates over WebSocket hibernation. |
| `wrangler.jsonc` | Worker config. SQLite-backed Durable Object class `HospitalRoom` (migration `v1`). |
| `test/room-check.mjs` | End-to-end checker against a running room. |
| `.dev.vars.example` | Template for the local room token and the session secret. |

The room logic itself lives in `src/lib/hms/sync-core.ts` (`RoomLog`) and the wire format in `src/lib/hms/sync-protocol.ts`. Both are shared with the app and are covered by `scripts/smoke-realtime.mjs`.

## Wire protocol

Connect to `/rooms/<roomId>/ws?token=<ROOM_TOKEN>` with a WebSocket. Room IDs are lowercase letters, digits and hyphens, up to 64 characters. Frames are JSON text, at most 256 KB.

Client → server:

- `{"type":"hello","deviceId":"…","cursor":N}`: asks for every update after sequence `N`. The server replies with `catchup`.
- `{"type":"submit","change":{deviceId, devSeq, key, ts, baseTs, value}}`: `key` is `<collection>:<id>` with a known collection. `value: null` is a delete. The server replies with `ack`, and sends `update` to everyone when the change is accepted.
- `{"type":"ping"}`: the server replies with `pong`.

Server → client: `catchup`, `ack` (includes `result`: `accepted`, `duplicate` or `conflict`), `update`, `pong`, `error`.

Retries are safe. A device resends the same `(deviceId, devSeq)` and gets `duplicate` without a second write.

Conflicts follow the design: the newer change wins, and the other version is kept and flagged for review.

## Run locally

```sh
cd sync-worker
cp .dev.vars.example .dev.vars        # then set ROOM_TOKEN and SESSION_SECRET to local values
npx wrangler dev --config wrangler.jsonc --ip 0.0.0.0 --port 8787 --persist-to /tmp/sync-state
```

`--persist-to` keeps room history between restarts. Without it, a restart starts empty.

Tested with wrangler 4.151.3. `.dev.vars` and `.wrangler/` are gitignored.

## Check it

Start the room (above), then:

```sh
# 1. Run the checks and save the room's history
SYNC_URL=http://localhost:8787 ROOM_TOKEN=<token> SYNC_ROOM=check-1 SYNC_SAVE=/tmp/room-check-1.json \
  node test/room-check.mjs

# 2. Stop the room, start it again with the same --persist-to, then compare
SYNC_URL=http://localhost:8787 ROOM_TOKEN=<token> SYNC_ROOM=check-1 SYNC_VERIFY=/tmp/room-check-1.json \
  node test/room-check.mjs
```

The first run covers auth and routing, two devices, live updates, idempotent retry, conflicts with newer-wins, rejected bad collections and malformed JSON, and late-device catch-up. The second run checks that sequence numbers and values are unchanged after a restart.

## Before deploying

- **Secret:** `npx wrangler secret put ROOM_TOKEN`. Do not put the real value in `wrangler.jsonc`.
- **Device gate:** `ROOM_TOKEN` is a shared secret for the device connection. It is not a login.
- **Staff sign-in (phase 4):** `npx wrangler secret put SESSION_SECRET`. Staff sign in over the socket with their room username and password. Sessions last 12 hours and are checked against the live account on every message. Set this before any device signs in.
- **First admin:** the first device to sign in with an Admin account while the room has no active Admin sends that account's record. The room writes it once. Do this on a trusted device, right after the room is created.
- **Data protection:** patient data may only go here after the review in the design doc.
- **Deploy:** `npx wrangler deploy`. The app will connect by full URL (phase 2).
