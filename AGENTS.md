# Satisfactory Planner — agent guide

Read this file before changing the project. For interface work also read `public/AGENTS.md`. `README.md` describes installation and user features. These instructions describe the current implementation, not a requirement to keep its visual design. Follow the user's current request where it changes the scope.

## Product and priorities

This is a Satisfactory production planner and progress notebook, not a game-save parser. Users create named saves, configure game settings and goals, and track chronological construction steps per profile. There are two supported editions:

- Docker/Node: server persistence, optional accounts, multiple users and devices.
- GitHub Pages: static assets, browser-side calculator, IndexedDB persistence, no server or login.

Both editions must continue working. A design redesign is welcome; it must preserve existing saves and behavior. Do not replace the functional application with a demo, hardcoded dashboard, or mock data.

## Repository map

| Location | Responsibility |
| --- | --- |
| `public/app.js` | Shared vanilla-JS UI, hash routes, forms, event handlers, API dispatch |
| `public/style.css`, `public/index.html`, `public/favicon.svg` | Presentation and shell |
| `public/preferences.js` | Wizard options, resource presets, help text |
| `public/progression.js`, `public/progression.json` | Chronological guidance and unlock/milestone metadata |
| `public/plan.json` | Preserved original handbook; real plan content, not a disposable fixture |
| `public/state.js` | Shared blank progress, validation and mutations |
| `public/transfer.js` | Portable full-save format and validation |
| `public/browser-api.js`, `public/browser-store.js` | Browser API adapter, worker orchestration, IndexedDB transactions |
| `planner.mjs`, `optimizer.mjs`, `recipes.json` | Production calculation, HiGHS solver, recipe data |
| `vendor/`, `THIRD_PARTY.md` | Bundled solver and attribution; retain licenses |
| `server.mjs`, `workspace.mjs` | HTTP/authentication boundary, scoped saves, durable server persistence |
| `docker-start.mjs`, `Dockerfile`, `compose*.yaml` | Container startup and Synology ownership support |
| `build-browser.mjs` | Allowlisted static build; adapts calculator for browser execution |
| `tests/`, `browser-check.mjs` | Server, calculator, interface and real-browser checks |
| `.github/workflows/docker.yml` | Tests, Docker publishing, public-site publishing |

`dist/` is generated. Change source files, then rebuild. `data/` is live local user data, not test data. Do not read credentials, print its contents, delete it, overwrite it, or include it in commits/build artifacts. Use temporary data directories for tests. Keep `.env` and account/session secrets private.

## Data compatibility is essential

**Mandatory release rule: an update must never lose, reset, orphan or incorrectly reassign a user's progress.** This applies to major redesigns, rewritten components, changed task identifiers, schema changes and both persistence editions. Existing users must be able to migrate to the new version without recreating saves or manually re-entering progress. A release is not ready until its migration path is implemented and verified.

- Support upgrades from every previously released data format, directly or through a tested migration chain. Do not assume users installed every intermediate release. Version persisted data explicitly when its structure changes.
- Migrate profiles, calculation snapshots/handbooks, checks, notes, delivery counts, custom tasks and active selections together. Preserve server ownership and browser-local isolation.
- For renamed, split, merged or removed steps, define explicit identifier mappings. Preserve original completion records when no unambiguous mapping exists and expose them for review; do not silently discard them or mark unrelated new work complete. Keep the original saved plan accessible when a replacement changes its meaning.
- Perform migrations atomically and make retries safe. Retain a recoverable copy of the pre-migration data before modifying it. Failed migrations must leave that data intact and present recovery guidance, never silently initialize an empty save. Automatic updates must not depend on the user having remembered to export a backup.
- Apply equivalent safeguards to IndexedDB and server files. Keep older full-save exports importable through the same version-aware migration path. Never downgrade or overwrite an unknown newer format; explain that a compatible app version is needed.
- Add anonymized fixtures for released formats and test direct/skipped-version upgrades, repeat attempts, partial-failure recovery and old exports. Verify exact progress and ownership preservation, not just that the new application opens. Migration tests are required whenever compatibility is affected.

- Ownership hierarchy: server user → named save → profile. Each profile owns its checks, notes, deliveries, selected phase and custom tasks.
- Calculated profiles retain calculation snapshots. Do not silently recalculate existing profiles during startup, navigation, import, or an application update.
- Original profiles use the preserved handbook, including an imported profile's own `handbook` when present. Do not replace that with the current default template.
- Keep IDs stable: save/profile IDs, recipe/factory IDs, checklist keys and storage addresses link existing progress to content. Display labels can change without changing these identifiers.
- Server writes are serialized and atomic. Preserve ownership checks, explicit save/profile scope, request-origin protections and optional authentication. A corrupt file must not silently become an empty workspace.
- Browser storage uses IndexedDB database `satisfactory-planner-browser-v1`, store `workspace`, record `main`. Preserve its name and transaction guarantees. Renaming the database makes existing saves disappear from the UI.
- Full transfers use `satisfactory-planner-saves`, version 1. They include plans/handbooks and progress, exclude credentials/accounts/sessions, and import as new copies with remapped IDs. Progress-only backups are a separate format. Profile shares (`/api/export-saves?save=…&profile=…&share=1`) are the same format scoped to one profile with progress stripped via `shareState`, so both editions import them through the normal path.
- Progress states are content-versioned: 1 base, 2 adds storage layout edits, 3 adds build-plan edits (`taskEdits`) and factory groups (`factoryGroups`). `validateState` picks the lowest version the content needs, so untouched states stay importable by older releases, and refuses higher versions with an update message instead of dropping data. Any new state feature must follow this pattern.
- Any schema change needs a tested, non-destructive migration. Export/import must work between both editions. Test malformed imports and verify existing data remains unchanged.
- Local server data currently uses `workspace.json`; `progress.json` is a retained legacy migration source. Never run old and new servers against the same live directory simultaneously.

## Planning rules to preserve

Keep presentation separate from calculation. Do not change recipe rates, power budgets, goals or resource assumptions to make cards look cleaner.

- Guidance must respect phase and milestone availability: early construction materials and biomass before later fuels, hard drives for alternates, relevant MAM unlocks, then later power and drone fuel upgrades.
- Whole-machine production is an option with recalculated upstream inputs and surplus. Do not merely round displayed machine counts and claim the material balance still holds.
- Storage selections protect the selected outputs. Unpackaged fluids and radioactive items do not belong in the general storage contract. Gathered items may have storage positions without being continuously produced.
- Existing power means spare capacity, not total installed generation. Existing fuel consumption must already be deducted from resource budgets. Preserve the configurable utility allowance and phase-appropriate power/drone preferences.
- Distinguish known node presets from seed-dependent estimates. Do not invent resource totals. Verify gameplay changes against authoritative current references when changing game data.
- Preserve warnings and infeasible-plan explanations; never present an infeasible result as a completed production plan.

The owner's original handbook starts in Phase 3, with all Tier 6 unlocks, pure nodes/ingot recipes, 50× elevator requirements and half power consumption. Iron expands across phases rather than being fully built in Phase 3. Its storage layout includes an already-built ground floor and a workshop. These are original-profile facts, not defaults for every new user. Use the stored handbook as the source of exact targets rather than reconstructing numbers from this summary.

## Development and verification

Run commands from this repository root. Node 24 is used in CI; the package supports Node >=22. The application has no frontend framework or bundler requirement.

```sh
node server.mjs
npm run check
npm test
node build-browser.mjs
```

The server defaults to port 8080. Set `HOST=127.0.0.1` for a local-only preview and `DATA_DIR` to an isolated temporary folder for experiments. Environment-variable syntax differs by shell. Check whether an existing server is running before starting another; never terminate unrelated processes.

For real-browser verification, CI installs Playwright separately:

```sh
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install --with-deps chromium
node build-browser.mjs
node browser-check.mjs
```

`PLANNER_PLAYWRIGHT` can point to an already installed Playwright entry file. `PLANNER_BROWSER_CHANNEL=msedge` can use installed Edge. Browser checks serve the build under `/satisfactory-planner/`, run the actual WASM calculator, and test persistence, isolated profiles, concurrent tabs and Docker transfers in temporary storage.

Use tests appropriate to the change. UI redesigns require real-browser inspection in addition to tests; see `public/AGENTS.md`. The VM-based interface tests currently reference UI functions/selectors. If restructuring them, update the tests to cover equivalent behavior rather than deleting coverage. Documentation-only changes need link/path and diff review, not the whole Docker test suite.

## Publishing

- Private source: `reinder83/satisfactory-planner`.
- Public generated site repository: `reinder83/reinder83.github.io`.
- Public URL: `https://reinder83.github.io/satisfactory-planner/`.
- Docker image: `ghcr.io/reinder83/satisfactory-planner:latest` (AMD64 and ARM64).

Pushes to source `main` run checks and publish both editions. Pull requests run checks without deployment. The source workflow uses the repository-scoped `PAGES_DEPLOY_KEY` secret to push only built website files to the public repository; its own Pages workflow deploys them. Do not replace this with a broad personal token or make the private source public. No live data, private handbook targets, account records or workspace files belong in the public build.

Frontend assets added during a redesign need entries in `build-browser.mjs` and must be available in Docker too. Preserve subpath-safe URLs and worker/WASM loading. Do not add a backend dependency to the public edition. Preserve PUID/PGID/TZ, privilege dropping and data-volume compatibility in Docker.

Work in the source repository; direct edits to generated public-site files will be overwritten. Pushing `main` is a live release, so check the user's requested publishing scope. Report what changed, verification performed and any remaining limitation. Update these guides when architecture or commands change.
