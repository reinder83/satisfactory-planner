# Satisfactory Planner

For coding-assistant handoff, start with [AGENTS.md](AGENTS.md). Interface redesign guidance lives in [public/AGENTS.md](public/AGENTS.md), and [CLAUDE.md](CLAUDE.md) points Claude to the same shared instructions.

A self-hosted Satisfactory planner with named saves, settings-first profile creation, calculated production targets, chronological checklists, storage maps and optional user accounts.

## Your existing plan is preserved

The original 50× elevator / pure-ingot handbook remains a separate, unchanged profile. On first start after this update, existing `progress.json` is copied into the original save in `workspace.json`. The old file is retained untouched. Checkmarks, deliveries, custom tasks and notes migrate together.

Each **user → named save → profile** has independent progress. Trying another profile does not reset the original. Profiles store a calculation snapshot, so updating the software cannot silently change existing targets. Rename saves and profiles from **Saves & profiles**.

## Create a profile

Open **Saves & profiles → Create a save**, or **Try another profile** on an existing save:

1. Name the save and enter its phase, purity/distribution, elevator multiplier, consumption multiplier and spare existing power.
2. Choose recipe access (standard, all alternates, or hand-pick specific alternate recipes), pure ingots, SAM conversion policy, nuclear recycling, protected storage and extra Singularity Cell production.
3. Choose minimal construction (24-hour delivery), balanced (8-hour delivery), a target time, or maximum elevator output.
4. Review/edit available raw resource budgets. Confirm these before maximum-output planning.
5. Review calculated buildings, delivery time, power and feasibility by phase, then create the profile.

The wizard supports Phases 1–5. Post-game retains Phase 5 capacity and directs surplus to storage and sinks. Its optional storage template includes 132 addresses, collectables bays Q/R and the workshop underneath. New saves have no pre-completed steps.

On the storage map, **Complete room** marks all four checklist steps for the room's selected containers. Each container also has a direct **Done** checkbox; click its item icon/name for individual checks and notes. Unchecking Done clears that container's four steps. Successful note saves close the details dialog; saving a blank note deletes the note. Existing container addresses and progress keys are unchanged.

## Make the plan your own

- **Build plan → Edit steps** lets you rearrange steps with the arrow buttons, rewrite a step's title and details, link a step to one of your factories, or remove steps you do not want. Removed steps keep their checkmarks and can be restored from **Removed steps** while editing; clearing an edited field restores the original text. Calculated production steps link to their factory details automatically.
- **Factories → Edit groups** organizes production into named factory groups — the physical sites of your world. A factory can join several groups with a production split: for example Wire at 300/min in your cable factory with the remainder beside stitched plates. Leave a rate empty for the whole output or the remainder. Removing a group never touches the factories or their progress.
- **Saves & profiles → Duplicate** copies a profile including its progress, so you can try changes without touching the original plan.
- **Saves & profiles → Share** downloads a share file with the profile's plan, storage layout, factory groups, personal tasks and step edits — but none of your checkmarks, notes or delivery counts. Anyone can import it in either edition under **Backup → Import saves**; it arrives as a new save without affecting theirs. (A share link in a URL is not offered: a profile snapshot is far larger than links reliably allow.) Older planner versions refuse a share that contains step edits or groups and ask for an update instead of dropping them.

## Run with Docker

The private image is **ghcr.io/reinder83/satisfactory-planner:latest**, available for AMD64 and ARM64. Clone this repository on your Docker host, enter the directory, then authenticate with a GitHub classic personal access token carrying `read:packages`:

```sh
docker login ghcr.io -u reinder83
docker compose pull
docker compose up -d
```

Open **http://localhost:8080**. To update later, repeat the last two commands.

Optionally copy `.env.example` to `.env`. For LAN access, set `BIND_ADDRESS=0.0.0.0`, then visit `http://HOST-IP:8080`. For public internet access use an HTTPS reverse proxy and set `COOKIE_SECURE=true`.

A local build needs no registry login:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

## Synology and custom user IDs

The image supports `PUID`, `PGID` (default 1000:1000), and `TZ`. For DSM, use your own numeric NAS user/group IDs, for example:

```yaml
services:
  planner:
    image: ghcr.io/reinder83/satisfactory-planner:latest
    restart: unless-stopped
    ports:
      - "8888:8080"
    environment:
      PUID: "1028"
      PGID: "100"
      TZ: Europe/Amsterdam
    volumes:
      - ./data:/data
```

Pull the new image and rebuild the existing DSM project. Keep the same data mapping. Omit `user:` to let startup prepare ownership automatically. Startup briefly runs as root to prepare the dedicated data directory and known planner files, then clears supplementary groups and drops to PUID/PGID before opening the app. Unrelated files and subfolders are not changed. It does not delete or reset progress. Use a dedicated planner folder; symlinks and hard-linked data files are rejected.

Explicit Docker `user:` remains supported when the directory is already writable and PUID/PGID match (or are omitted). Root IDs and invalid numeric values are rejected. Read-only mounts, restrictive NAS ACLs or filesystems that reject ownership changes still require host-side correction; the container reports the startup failure.

If you use `cap_drop: ALL`, use the startup capabilities from the included Compose file: CHOWN, DAC_OVERRIDE, FOWNER, SETUID and SETGID. `no-new-privileges:true` is supported. Timezone controls server-side dates; the browser still formats displayed dates in its own timezone.

## User accounts

The existing single-user workspace continues to work in **local mode**. Local mode shares the owner workspace with anyone who can reach the server; it is not user isolation. Enable accounts before sharing:

1. Open **Saves & profiles → Set up user accounts**.
2. Read the host-only setup token:

   ```sh
   docker compose exec planner cat /data/account-setup-token.txt
   ```

3. Enter the token and choose your owner username and password. Your existing saves become this account’s saves.
4. Optionally enable registration so other people can create accounts. Each new account starts without access to your saves or progress.

Passwords are scrypt-hashed. Login sessions use HttpOnly, SameSite cookies and persist across container restarts. API reads and writes enforce ownership. The host setup token is never served through the API. Do not share it. There is no email/password-reset service in this version; keep your password securely and retain host backups.

The previous `APP_USER` / `APP_PASSWORD` Basic Auth gate remains available as an additional host-wide gate. It is separate from individual accounts.

## Persistence and backups

The Docker `planner-data` volume stores `/data/workspace.json`: accounts, named saves, profiles, calculation snapshots and progress. Updates and container recreation preserve it. **Do not run `docker compose down -v` unless you intend to delete this data.**

- **Backup & notes** exports the current profile’s progress. Restore only to its matching profile; other profiles are untouched.
- For a complete backup, stop the container and back up its data volume, including `workspace.json`. This contains password hashes and session records; keep the backup private.
- `workspace.json.bak` retains the previous successful workspace write. Writes are serialized and atomically replaced. Corrupted data causes startup to fail rather than silently reset progress.
- `progress.json` remains the pre-migration backup and is no longer the live store. Do not run old and new planner versions simultaneously against one volume.

## Calculation scope

The generated plans solve material and resource constraints using HiGHS. Standard recipes are always available at their modeled phase; the alternate option enables phase-eligible alternates. Pure ingots override other ingot recipes when available. Actual recipe/milestone unlocking still has to happen in game.

Fixed-time plans minimize production-building equivalents, then report whole buildings and the last machine’s underclock. They do not claim the absolute minimum number of integer buildings. Maximum output maximizes simultaneous elevator delivery within the entered budgets and selected recipe set, then minimizes building equivalents at that output. It does not optimize AWESOME Sink points.

SAM policies affect raw-resource conversion only. Essential SAM ingredients remain available. Full nuclear recycling burns plutonium and Ficsonium rods in Phase 5, enforcing zero accumulated radioactive waste. Phase 4 sinks plutonium fuel rods until Ficsonium is available.

New power plants and their fuel inputs are included. Existing power is entered as **spare** capacity; its resource use must already be deducted from the entered budgets. A 20% utility allowance covers unmodelled mining, pumps and transport. Whole-building peak headroom is shown separately when needed. Phase 1 requires biomass or existing power. This is a steady-state estimate, not a simulation of startup, variable demand or your actual game grid.

Storage is an explicit protected output per item. Unpackaged fluids, radioactive items and gathered feedstock are excluded from continuous storage production. Gathered items still have storage locations. Some standard-recipe items need alternates to become sustainably automatable. Singularity Cells are an explicit extra supply rate; teleport use and operating power are not inferred automatically.

Purity does not determine randomized node counts. Reference budgets use standard counts at endgame extraction; oil wells are excluded and nitrogen is separate. Edit the budgets to match your seed and accessible mining. Other mods/settings are notes only: changed recipes, boosts and modded items are not simulated. The app does not read game-save files.

The preserved original handbook retains its previous assumptions and corrected resource ledger. It is not recalculated by this new engine.

## Development

Node.js 22 or newer is sufficient; no package installation is required. The MIT-licensed solver is bundled with its WebAssembly asset and license; see `THIRD_PARTY.md`.

```sh
npm run check
npm test
npm start
```

Tests cover migration, durable progress, concurrent updates, backup restore, corrupted saves, save/profile isolation, account ownership, authentication, calculator constraints and interface rendering. GitHub Actions additionally builds and restarts a real Docker container before publishing. Pushes to `main` publish `latest` and a commit tag; `v*` tags publish version tags. No additional registry secrets are required.

Server options: `HOST`, `PORT`, `DATA_DIR`, optional `APP_USER`/`APP_PASSWORD`, and `COOKIE_SECURE=true` behind HTTPS. One server process should own one data directory. This JSON-backed deployment is intended for personal/small-group hosting.

## Progression guidance

Calculated profiles now include a Phase 1 construction-stock base, manually supplied Biomass/Solid Biofuel startup, phase-appropriate power commissioning, HUB milestone costs and MAM research suggestions. Mark unlocks in the checklist to update current-power advice. Unlock and alternate-recipe checkmarks persist across phases within the profile. Hard-drive tasks list the actual selected alternates and their recorded prerequisites; random scans do not guarantee a fixed drive count.

Milestone cost notes use factories explicitly marked running in this or earlier phases. They do not assume that inventory or spare output exists. Starter construction and biomass lines are separate startup guidance, not added to the frozen continuous-production calculation. Existing factory targets and progress IDs are preserved.

## Whole-machine production

New profiles default to running solid-part production machines at 100%. The solver selects a recipe network first and fits whole-machine production within the resource budgets, recalculating upstream requirements and handling liquid byproducts. Extra solids are listed as surplus: supply downstream factories, refill storage, then sink the rest. This can increase the scale of the entire chain, not only the last machine in one factory.

Fluid, generator and nuclear/waste-processing lines remain precisely balanced and may retain underclocks. Detailed instructions separate total machines, full-speed machines and the adjustable machine, and show output per machine next to its clock setting.

For a previously calculated profile, use **Factories → Round up production**. This creates a new profile revision, copies notes/unlocks/progress, and clears completed factory checks only where increased inputs or machine counts need review. The previous profile and all its progress remain untouched. The preserved original handbook is not recalculated.

If resource limits or solver limits prevent a rounded plan, affected phases are flagged for review. When only the whole-machine fit exceeds a budget, the draft names each short resource with the rate that would fit and offers the alternative of precise balancing. Whole-machine maximum output is bounded to the selected recipe network; it is not a global mixed-recipe integer optimum.
# Public browser edition

Use [Satisfactory Planner](https://reinder83.github.io/satisfactory-planner/) without installing a server. The calculator runs in a browser worker and saves profiles, checkmarks, notes and delivery counts in IndexedDB on that browser. No account is required and save contents are not uploaded to GitHub. GitHub serves the site and can receive ordinary web access information.

Browser data is specific to the browser, device and site address. Clearing site data deletes saves; private browsing may discard them when closed. Use **Backups & transfer → Export all saves** regularly. Import adds separate copies rather than overwriting existing saves. The **Keep browser storage** button requests protection from automatic eviction where supported; it is not a backup.

To move an existing Docker plan, update the Docker image, open **Backups → Export all saves**, then import that file on the public site. The transfer includes original handbooks, calculated profiles and progress, but excludes accounts, passwords and sessions. The same full export can be imported into Docker. There is no automatic synchronization between installations.

`node build-browser.mjs` creates an allowlisted static site in `dist/satisfactory-planner`. Serve `dist` with any static HTTP server to test it. `node browser-check.mjs` exercises the browser calculator, persistence, profile isolation, concurrent tabs and Docker transfers; install Playwright and Chromium first.

Pushes to private-source `main` run server, browser and Docker checks, publish the Docker image, and push only the built website to the public `reinder83.github.io` deployment repository. Its Pages workflow publishes the site. `PAGES_DEPLOY_KEY` is a write deploy key limited to that public repository. Source-side pull requests run checks without deploying. Saved user data is never included in the static build.
