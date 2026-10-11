<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Setup

- Install dependencies with `npm install` (or `bun install`), **NOT** `npm ci`. Dependencies are pinned by `bun.lock` and there is no `package-lock.json`, so `npm ci` fails outright. Never commit a machine-generated `package-lock.json`.
- Start the dev server with `npm run dev -- --host 0.0.0.0 --port 8080`. Always bind to `0.0.0.0` (not `127.0.0.1`) so proxied preview hosts work, and ensure browser-facing code uses relative URLs only (never `localhost` or `127.0.0.1`).

## Gates to run before committing

1. Run every smoke suite in `scripts/smoke-*.mjs` (all 10 suites must pass):
   ```bash
   for f in scripts/smoke-*.mjs; do node "$f"; done
   ```
2. Type-check: `npx tsc --noEmit`.
3. Lint and auto-fix only the files you changed (`npx eslint --fix <changed-files>`), then re-run `npx tsc --noEmit`.
4. Production build: `npm run build`.
5. Start the server and `curl` the routes you touched to verify they render cleanly (note: `/patients` legitimately returns `307` redirecting to `/patients?q=`).
- When adding or renaming file-based routes under `src/routes/`, regenerate and commit the updated `src/routeTree.gen.ts`.
- In `scripts/smoke-*.mjs` fixtures, use realistic day-based ms epochs (`n*86400000 + h*3600000`) so date-math and turnaround helpers behave realistically.

## Domain rules

- **Medicine catalogue seed (`INDIAN_DRUGS`)**: Editing `INDIAN_DRUGS` in `src/lib/hms/indian-drugs.ts` requires bumping `DRUG_SEED_VERSION` in `src/lib/hms/medcatalog.ts`. Otherwise, already-seeded devices keep their existing `kegh-hms-drug-seed-version` `localStorage` flag and never receive the top-up. Seeding only merges missing deterministic `seed-med-<slug>` rows and never overwrites device-added catalogue entries.
- **Attendance module**: The staff attendance module is deliberately absent (the hospital tracks attendance in an external app) — do not reintroduce it.
- **Current patient & workspace terminology**: The active/current patient selection is device-local (`kegh-hms-current-patient` in `localStorage`). In UI copy and navigation, "My workspace" refers to the signed-in staff member's role home (Reception, Doctor, Lab, Pharmacy, Billing), not the Admin dashboard.
