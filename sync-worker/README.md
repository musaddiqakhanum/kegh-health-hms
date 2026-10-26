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

Sign-in errors (`error` frames with a `code`): `invalid-login` (wrong username or password, or an inactive account; the same answer for each), `too-many-attempts` (the username is locked; the message says how many minutes to wait), `sign-in-required`, `not-configured`.

**Sign-in throttle.** The room counts sign-in attempts per username (case and spacing ignored), including unknown names so the lock does not reveal which accounts exist. The sixth attempt in a 15-minute window locks that name for 15 minutes, and the right password is refused during the lock. A successful sign-in clears the count. The count is saved in the room's storage, so a lock survives a restart. The limits are the constants `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MS` and `LOGIN_LOCK_MS` in `src/room.ts`. Separately, the app's own sign-in on each device locks that device for 60 seconds after five failures (`src/lib/hms/session.tsx`). Trade-off: anyone holding the room token can lock a staff name for 15 minutes by guessing, so keep the room token secret.

Retries are safe. A device resends the same `(deviceId, devSeq)` and gets `duplicate` without a second write.

Conflicts follow the design: the newer change wins, and the other version is kept and flagged for review.

## Run locally

```sh
cd sync-worker
cp .dev.vars.example .dev.vars        # then set ROOM_TOKEN and SESSION_SECRET to local values
npx wrangler dev --config wrangler.jsonc --ip 0.0.0.0 --port 8787 --persist-to /tmp/sync-state
```

`--persist-to` keeps room history between restarts. Without it, a restart starts empty.

Tested with wrangler 4.152.0. `.dev.vars` and `.wrangler/` are gitignored.

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

## Deploy

Do not deploy with real patient data until the data-protection review in the design doc is done.

**Warning:** `test/room-check.mjs` creates staff accounts in the room (`check-admin`, `check-reception`, and others) and uses first-admin setup. Run it only against a scratch room. Never run it against the hospital's room.

1. **Choose the room.** One room per hospital. The room id is lowercase letters, digits and hyphens, up to 64 characters.
2. **Log in to Cloudflare** from `sync-worker/` with `npx wrangler login`, or set a deploy token in the environment. Never paste tokens into chat or into files in Git.
3. **Set the two secrets** (different values, never the same):
   - `npx wrangler secret put ROOM_TOKEN` — the device gate. Use a long random value (for example `openssl rand -base64 32`).
   - `npx wrangler secret put SESSION_SECRET` — signs staff sessions. Use a long random value (for example `openssl rand -base64 48`).
   - Changing `SESSION_SECRET` signs everyone out. Changing `ROOM_TOKEN` means updating the room address on every device.
4. **Deploy:** `npx wrangler deploy --config wrangler.jsonc`. The first deploy creates the `HospitalRoom` Durable Object class (migration `v1`).
5. **Check the room:** `https://<worker-host>/health` must return `ok`. An unauthorised WebSocket request must return 401.
6. **Create the first admin** on a trusted device, right after deploy, and before any other device signs in. The first Admin account on that device sends its record through the setup path (see "First admin" below).
7. **Enter the room address** on each device in Settings: `wss://<worker-host>/rooms/<room>/ws?token=<ROOM_TOKEN>`.
8. **Watch the logs** during the first sign-ins with `npx wrangler tail` (from `sync-worker/`).

**First admin:** the first device to sign in with an Admin account while the room has no active Admin sends that account's record. The room writes it once, and the window closes as soon as one active Admin exists. Do this on a trusted device.

**Known limits** (also in the design doc): role rules are per collection, not per field; password hashes reach every signed-in device; the sign-in throttle can be used to lock a staff name for 15 minutes; and failed-attempt records are kept until that name is tried again, so a flood of random names grows the room's storage slowly.
