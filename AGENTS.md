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
| `public/app.js`, `public/app/` | Shared vanilla-JS UI as ES modules: `app.js` is the entry point; `app/session.js` holds the open save/profile and UI state (other modules change it through its setters), `app/api.js` requests and the save queue, `app/shell.js` the frame and view router, `app/views/` one module per page, `app/wizard/` the profile wizard, `app/events/` the delegated event handlers |
| `public/style.css`, `public/index.html`, `public/favicon.svg` | Presentation and shell |
| `public/preferences.js` | Wizard options, resource presets, help text |
| `public/ada.js` | ADA’s remarks: facts in, ordered plain-text lines out |
| `public/progression.js`, `public/progression.json` | Chronological guidance and unlock/milestone metadata |
| `public/plan.json` | Preserved original handbook; real plan content, not a disposable fixture |
| `public/state.js` | Shared blank progress, validation and mutations |
| `public/transfer.js` | Portable full-save format and validation |
| `public/browser-api.js`, `public/browser-store.js` | Browser API adapter, worker orchestration, IndexedDB transactions |
| `planner.mjs`, `optimizer.mjs`, `recipes.json` | Production calculation, HiGHS solver, recipe data |
| `vendor/`, `THIRD_PARTY.md` | Bundled solver and attribution; retain licenses |
| `server.mjs`, `workspace.mjs` | HTTP/authentication boundary, scoped saves, durable server persistence |
| `docker-start.mjs`, `Dockerfile`, `compose*.yaml` | Container startup and Synology ownership support |
| `build.mjs` | Release build: minified Docker frontend (`dist/web`) and allowlisted Pages edition (`dist/satisfactory-planner`); adapts the calculator for browser execution |
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
- A new profile added to an existing save may start from a chosen sibling profile's records (`newProfileState` in `public/state.js`, used by both editions). It copies, never moves: the source profile is untouched. World-shaped records (unlocks, the storage room, commissioning steps, deliveries, notes) copy as they are; plan-shaped `calc-` checks copy only where the new plan needs no more machines and no more input, and are carried unticked for review otherwise, matching `/api/round-up`. Creating a profile without `carryFrom` must keep producing the blank state earlier releases produced.
- Calculated profiles retain calculation snapshots. Do not silently recalculate existing profiles during startup, navigation, import, or an application update.
- Original profiles use the preserved handbook, including an imported profile's own `handbook` when present. Do not replace that with the current default template.
- Keep IDs stable: save/profile IDs, recipe/factory IDs, checklist keys and storage addresses link existing progress to content. Display labels can change without changing these identifiers.
- Server writes are serialized and atomic. Preserve ownership checks, explicit save/profile scope, request-origin protections and optional authentication. A corrupt file must not silently become an empty workspace.
- Browser storage uses IndexedDB database `satisfactory-planner-browser-v1`, store `workspace`, record `main`. Preserve its name and transaction guarantees. Renaming the database makes existing saves disappear from the UI.
- Full transfers use `satisfactory-planner-saves`, version 1. They include plans/handbooks and progress, exclude credentials/accounts/sessions, and import as new copies with remapped IDs. Progress-only backups are a separate format. Profile shares (`/api/export-saves?save=…&profile=…&share=1`) are the same format scoped to one profile with progress stripped via `shareState`, so both editions import them through the normal path.
- Progress states are content-versioned: 1 base, 2 adds storage layout edits, 3 adds build-plan edits (`taskEdits`) and factory groups (`factoryGroups`), 4 adds container positions past a bay's printed eight (`A09` and upwards). `validateState` picks the lowest version the content needs, so untouched states stay importable by older releases, and refuses higher versions with an update message instead of dropping data. Any new state feature must follow this pattern.
- Any schema change needs a tested, non-destructive migration. Export/import must work between both editions. Test malformed imports and verify existing data remains unchanged.
- Local server data currently uses `workspace.json`; `progress.json` is a retained legacy migration source. Never run old and new servers against the same live directory simultaneously.

## Planning rules to preserve

Keep presentation separate from calculation. Do not change recipe rates, power budgets, goals or resource assumptions to make cards look cleaner.

- A profile is built for the phase it records in its settings. Do not offer or generate steps for earlier phases: the user has already passed them, and each phase plan is a self-contained steady state that reads nothing from an earlier phase’s layout.
- Where a phase stops using a line an earlier phase built, say so as a step: its budgets no longer include it, and a replacement is usually a different machine rather than an upgrade in place. Retire each line once, in the phase straight after the last one that needed it, and never one the plan picks up again later.
- Guidance must respect phase and milestone availability: early construction materials and biomass before later fuels, hard drives for alternates, relevant MAM unlocks, then later power and drone fuel upgrades.
- Whole-machine production is an option with recalculated upstream inputs and surplus. Do not merely round displayed machine counts and claim the material balance still holds.
- `phaseTime: 'final'` applies the target time to Phase 5 and re-solves phases 1–4 for maximum output under per-recipe caps (`caps` in `run`): each recipe is limited to the machines some phase from that one onward already builds, and a recipe no such phase uses is capped at zero. A phase is replaced only when it finishes strictly sooner, and it records `aheadOf` so the interface can show what it used to take. The default `'every'` must keep producing the per-phase plan earlier releases produced. Do not let this add capacity a later phase drops — that is the whole point of the caps, and it is tested.
- Storage selections protect the selected outputs. Unpackaged fluids and radioactive items do not belong in the general storage contract. Gathered items may have storage positions without being continuously produced.
- The protected rate is per item, not global: `storageRateFor` in `public/preferences.js` resolves a per-item override, then Space Elevator parts at 0 (`elevatorParts`, kept in step with the planner's `DELIVERIES` by a test — their deliveries and the later project parts consuming them are already planned, so a buffer on top is production nobody draws from), then the construction-material rate (`buildRate`), then the general rate (`storageRate`). An absent `buildRate` must keep meaning "the general rate", so profiles saved before it existed calculate identically. A rate of 0 keeps the item's container and storage address while reserving no production — keep such items in `stage.storage` so the storage map still shows them, and out of rate listings.
- Production you already run (`existingSupply`) is a per-item rate the plan credits: a capped, almost-free source of that item, modelled exactly like a raw-resource source. The plan then builds only the remainder and never the chain behind it. It is deliberately a rate rather than a match against the plan's own rows, because an existing factory rarely uses the recipe or machine count a fresh solve picks. Its ore and power are assumed to be outside the entered budgets, the same assumption "spare existing power" already makes. An empty map must keep producing the plan earlier releases produced, and it is tested. Crediting a line narrows the recipe network the exact solve chooses, which leaves less room to round up to whole machines: widen the network with the recipes the phase would have used without the credit, and if it still will not round, drop the credit and set `supplyDropped`. Telling the planner what you already built must never cost you a plan — the same rule production amplification follows.
- Existing power means spare capacity, not total installed generation. Existing fuel consumption must already be deducted from resource budgets. Preserve the configurable utility allowance and phase-appropriate power/drone preferences.
- Alien Power Augmenters are Phase 5 only. Each adds 500 MW to the grid's base production and a multiplier of `0.1 x unfueled + 0.3 x fueled` over that base, which includes existing installed generation — so `installedPowerGW` is the total, of which `availablePowerGW` (spare) is a part. Defaulting `installedPowerGW` to the spare figure understates the boost deliberately; `augmenters: 0` must keep producing the plan earlier releases produced, and it is tested.
- A fueled augmenter's 5 Alien Power Matrix/min is derived from the augmenter count, never entered as a rate, so the fuel line cannot disagree with the augmenters it feeds. Whether fueling pays is answered by re-solving Phase 5 unfueled and comparing buildings (or hours, for maximum output), not by a rule of thumb.
- An item with no sink value has nowhere to overflow, so it is balanced exactly like fluids and waste, is excluded from whole-machine rounding, and never appears as surplus bound for the sink. Power Shards are the current case: a rounded-up Synthetic Power Shard line stalls in game.
- Somersloops parked in hand-fed constructors (slugs, remains, biomass) reserve a somersloop and add a checklist step only. Their inputs are gathered, never belted, so they stay out of the continuous production balance — the same rule that keeps starter and biomass lines out of it.
- Production amplification is opt-in and defaults to 0, because collecting every somersloop is a hunt a plan may not want. An amplified line is a separate `amp:`-prefixed row: same inputs, double output, four times the power, always whole machines. Twins are offered only for the largest lines of the unamplified solve (`AMPLIFY_CANDIDATES`, tuned against the heaviest plans in the test set) because each one is another integer variable in a fit that must finish inside the solver's time limit. Amplification can never make a plan infeasible — the solver may always place none — so a failed fit is a time-out: fall back to the unamplified plan, set `amplificationDropped` and say so. Never let it cost the user a plan that fits.
- Distinguish known node presets from seed-dependent estimates. Do not invent resource totals. Verify gameplay changes against authoritative current references when changing game data.
- Random node randomization is a shuffle, not a regeneration: node locations never move, each location keeps its own purity rating, and only the ore assigned to it changes. Each resource therefore keeps exactly its default node count while its split across impure/normal/pure is drawn from the map's fixed pool of purity slots. So under Random the counts stay knowable for the uniform purities, where the split does not matter, and only the split is lost for the ones that keep the map's own (Default, Mostly Pure, Mostly Impure) — do not estimate that split, it is seed-dependent and observed to be biased per resource. The resource-rich distributions do change per-resource counts, by seed-dependent amounts, and have no authoritative table — community counts of those vary seed to seed, so treat any published table for them as one seed's reading.
- Resource wells are the exception to the shuffle: randomization is applied to a whole well, not to each satellite, and the map's seventeen wells carry different numbers of satellites (one of ten, two of eight, eight of seven, six of six). So a shuffle that leaves every ordinary node count intact still moves nitrogen, oil or water onto a bigger or smaller well than it had. `presetSurvey` therefore fills nitrogen only on the default distribution, and `matchingPreset` identifies a world by its ordinary nodes alone.
- Extraction rates are one table, in `preferences.js`: a normal node yields 60/120/240 per minute on a Miner Mk.1/Mk.2/Mk.3, an Oil Extractor 120 on a normal crude oil node and a Resource Well Extractor 60 per normal satellite, each halved when impure, doubled when pure and multiplied by the clock. A test rebuilds `DEFAULT_LIMITS` and `PURE_LIMITS` from `nodeCounts` through that table, so the shipped budgets and the survey can never disagree. `DEFAULT_LIMITS.Limestone` was 69,900 against the 69,300 its own 15/50/29 nodes give, and was corrected to match the wiki and the rest of the table.
- Preserve warnings and infeasible-plan explanations; never present an infeasible result as a completed production plan.

The owner's original handbook starts in Phase 3, with all Tier 6 unlocks, pure nodes/ingot recipes, 50× elevator requirements and half power consumption. Iron expands across phases rather than being fully built in Phase 3. Its storage layout includes an already-built ground floor and a workshop. These are original-profile facts, not defaults for every new user. Use the stored handbook as the source of exact targets rather than reconstructing numbers from this summary.

## ADA

`public/ada.js` holds ADA’s remarks: facts in, ordered plain-text lines out. `adaFacts` in `public/app/ada-panel.js` builds those facts from the same counters the pages render, and escapes the text like any other untrusted name.

**When you add a feature, add ADA’s lines for it in the same change.** A new counter, warning, page or editing mode that ADA cannot see is a gap users notice. Give the rule a stable `id`, an `on` page affinity, a `tone` (`calm`, `warn`, `praise`; `lead` for a state that makes everything else irrelevant), and cover it in `tests/ada.test.mjs`.

Keep the deal the feature rests on: the joke is in the tone, never in the numbers. A remark may only restate what the plan already contains — including repeating the planner’s own infeasibility reason rather than inventing one — must never imply the app has altered saved progress, and must not be the only place some piece of guidance appears. Rules are skipped rather than thrown from, and the panel is wrapped in a guard: ADA must not be able to break the shell.

## Development and verification

Run commands from this repository root. Node 24 is used in CI; the package supports Node >=22. The application has no frontend framework. Source files stay readable: `npm start` serves `public/` unbuilt, and only `build.mjs` minifies, for publishing.

```sh
npm ci
node server.mjs
npm run check
npm test
npm run build
```

`npm run check` is Prettier; run `npm run format` rather than hand-compacting code. `npm test` needs no installed packages. The VM-based interface tests load the `public/app/` modules through `tests/helpers/app-source.mjs`, which concatenates them in ES evaluation order: top-level names must stay unique across those modules, and a module changes another module's `let` only through that module's exported setter.

The server defaults to port 8080. Set `HOST=127.0.0.1` for a local-only preview and `DATA_DIR` to an isolated temporary folder for experiments. Environment-variable syntax differs by shell. Check whether an existing server is running before starting another; never terminate unrelated processes.

For real-browser verification, CI installs Playwright separately:

```sh
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install --with-deps chromium
npm run build
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

Frontend assets added during a redesign need entries in the Pages allowlist in `build.mjs` and must be available in Docker too; a new script at the root of `public/` must be listed as shared or bundled there, or the build fails. Preserve subpath-safe URLs and worker/WASM loading. Do not add a backend dependency to the public edition. Preserve PUID/PGID/TZ, privilege dropping and data-volume compatibility in Docker.

Work in the source repository; direct edits to generated public-site files will be overwritten. Pushing `main` is a live release, so check the user's requested publishing scope. Report what changed, verification performed and any remaining limitation. Update these guides when architecture or commands change.
