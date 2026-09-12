# Satisfactory Planner

A private, self-hosted checklist for this Satisfactory save: phase build order, 85 factory profiles, 132 storage addresses, collectables, workshop, power and resources. The main interface opens straight onto your current build plan.

## Run the published image

The GitHub Actions workflow tests the app, starts a real Docker container and checks persistence across restart, then publishes an AMD64/ARM64 image to **ghcr.io/reinder83/satisfactory-planner**. The package is private on its first publication.

1. Install Docker with Compose on the machine that will host the planner.
2. Clone this private repository and enter its directory.
3. Authenticate Docker to GHCR with your GitHub username and a **classic personal access token with `read:packages`**. Paste the token at the password prompt; do not put it in the Compose file:

   ```sh
   docker login ghcr.io -u reinder83
   ```

4. Optionally copy `.env.example` to `.env` and adjust the port or password.
5. Start:

   ```sh
   docker compose pull
   docker compose up -d
   ```

6. Open **http://localhost:8080**.

For other devices on your LAN, set `BIND_ADDRESS=0.0.0.0` and an `APP_PASSWORD` in `.env`, then open `http://HOST-IP:8080`. The username defaults to `pioneer`. For internet access, put it behind an HTTPS reverse proxy; Basic Authentication must not be sent over public plain HTTP. There is one shared save, not separate user accounts.

## Build locally instead

No registry login is required for a local build:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Or, with Node.js 22 or newer:

```sh
npm start
```

There are no third-party runtime dependencies and no database service to configure.

## Persistence and backups

Progress is stored in `/data/progress.json`, in the named `planner-data` Docker volume. Container recreation and image updates keep this volume. **Do not run `docker compose down -v` unless you intend to delete the save.** The app also retains the previous successful state as `progress.json.bak`.

Use **Backup & notes → Download progress JSON** for a separate backup. Restore from the same page. Imports are validated and replace progress only, not the production-plan dataset. Do not edit the live JSON file while the server is running. If a file is damaged, the server refuses to reset it silently; stop the container and restore a known-good backup.

To update after GitHub publishes a new image:

```sh
docker compose pull
docker compose up -d
```

For a rollback, use one of the published `sha-...` image tags in `compose.yaml`. Progress IDs are stable; plan changes must preserve existing IDs or include a migration.

## What is included

- Chronological checklists for Phases 3, 4, 5 and post-game, with personal tasks and notes.
- Factory targets, recipe inputs, whole machines, last-machine clock, protected storage and later expansion.
- Corrected resource conversion: 165 Converters and 5,250/min Reanimated SAM.
- Ground and upper storage floors, the Q/R collectables extension and workshop underneath. G08 is Medicinal Inhaler, H01 Iodine-Infused Filter, H02 Gas Filter, H08 Nobelisk.
- Per-container placement, labelling, connection and verification checklists.
- Delivery counts with remaining steady-state production time.
- Resource and power budgets, rocket-fuel modules and nuclear sequence.

Initial progress marks only the facts known from the conversation: the ground-floor structure is built and the Phase 3 Versatile Framework delivery is complete. Containers are not assumed connected or stocked. The user can revise every check.

## Important plan boundaries

This is a plan and checklist, **not a game-save reader or live factory simulator**. It does not detect in-game progress. The plan data is in `public/plan.json`.

The corrected final budget includes retained turbofuel and truck fuel, six new rocket-fuel blocks, full nuclear recycling and resource conversion. It excludes additional post-game completion modules. Storage takes priority over continuing full elevator-export rates after Phase 5. Nitrogen availability and transport capacity still need checking in the randomized save. The late-game targets assume all-pure standard node counts and endgame extraction. Runtime power estimates retain the original conservative allowances.

The old coal and temporary fuel plants retire after testing turbofuel alone. Retained capacity is 44.425 GW; final planned gross capacity is 913.925 GW. These numbers are not live power readings.

All rates derive from the recipe collection pinned in the original handbook. Sources are linked in the app. This is an unofficial personal planner and is not affiliated with Coffee Stain Studios.

## Development and verification

```sh
npm run check
npm test
npm start
```

Tests cover durable state, concurrent updates, backup/restore, invalid input, optional authentication, corrupted-save handling and key corrected plan figures. GitHub Actions also verifies the Docker runtime before publication. Pull requests run checks without publishing an image; pushes to `main` publish `latest` and a commit tag, while `v*` tags publish version tags. The workflow uses the built-in `GITHUB_TOKEN`; no registry secret is required in the repository.

Server configuration: `HOST` (default `0.0.0.0`), `PORT` (`8080`), `DATA_DIR` (`./data` outside Docker), `APP_USER` (`pioneer`) and `APP_PASSWORD` (empty means no login). The Compose file binds only to localhost unless changed.
