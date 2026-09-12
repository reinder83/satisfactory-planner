# Satisfactory Planner

A self-hosted Satisfactory planner with named saves, settings-first profile creation, calculated production targets, chronological checklists, storage maps and optional user accounts.

## Your existing plan is preserved

The original 50× elevator / pure-ingot handbook remains a separate, unchanged profile. On first start after this update, existing `progress.json` is copied into the original save in `workspace.json`. The old file is retained untouched. Checkmarks, deliveries, custom tasks and notes migrate together.

Each **user → named save → profile** has independent progress. Trying another profile does not reset the original. Profiles store a calculation snapshot, so updating the software cannot silently change existing targets. Rename saves and profiles from **Saves & profiles**.

## Create a profile

Open **Saves & profiles → Create a save**, or **Try another profile** on an existing save:

1. Name the save and enter its phase, purity/distribution, elevator multiplier, consumption multiplier and spare existing power.
2. Choose standard/all alternates, pure ingots, SAM conversion policy, nuclear recycling, protected storage and extra Singularity Cell production.
3. Choose minimal construction (24-hour delivery), balanced (8-hour delivery), a target time, or maximum elevator output.
4. Review/edit available raw resource budgets. Confirm these before maximum-output planning.
5. Review calculated buildings, delivery time, power and feasibility by phase, then create the profile.

The wizard supports Phases 1–5. Post-game retains Phase 5 capacity and directs surplus to storage and sinks. Its optional storage template includes 132 addresses, collectables bays Q/R and the workshop underneath. New saves have no pre-completed steps.

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
