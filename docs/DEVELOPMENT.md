# Development and deployment

This page is for people working on the planner itself: running it from source, testing, building both editions, how CI publishes them, and how saved data is stored. For using the planner see the [README](../README.md) and the [user guide](USER-GUIDE.md); for running your own server see [self-hosting](SELF-HOSTING.md).

For coding-assistant handoff, start with [AGENTS.md](../AGENTS.md). Interface redesign guidance lives in [public/AGENTS.md](../public/AGENTS.md), and [CLAUDE.md](../CLAUDE.md) points Claude to the same shared instructions.

## Run from source

Node.js 22.18 or newer is sufficient. The MIT-licensed solver is bundled with its WebAssembly asset and license; see [THIRD_PARTY.md](../THIRD_PARTY.md).

The frontend is TypeScript modules and Vue components (`public/app/ui/`); nothing is compiled ahead of time, the types are stripped as the code is served. `npm start` serves `public/` as it is: outside production it runs Vite inside the planner's own server, which compiles the `.vue` files on request and reloads the browser on edits, so there is still no separate build or dev server to run. Install the packages first:

```sh
npm ci            # Vue, Vite, Vitest, TypeScript, Prettier and esbuild
npm run check     # formatting; `npm run format` fixes it
npm run typecheck # TypeScript types (vue-tsc)
npm test          # node --test for the logic and pages, Vitest for the components
npm start
npm run build     # minified editions in dist/web (Docker) and dist/satisfactory-planner (Pages)
```

With `NODE_ENV=production` (as in the Docker image) the server serves `public/` as plain files and never loads Vite; that `public/` is the `dist/web` build.

Server options: `HOST`, `PORT`, `DATA_DIR`, optional `APP_USER`/`APP_PASSWORD`, and `COOKIE_SECURE=true` behind HTTPS. One server process should own one data directory. This JSON-backed deployment is intended for personal/small-group hosting.

## Builds

The frontend lives in `public/`: `app.ts` is the entry point and `public/app/` holds the UI modules (the Vue components under `ui/`, the data behind the pages under `views/`, the profile wizard under `wizard/`). The release build bundles `public/app/` into a single minified `app.js` and minifies the other scripts and the stylesheet file by file. The Docker image runs that build in its first stage and serves `dist/web`; the Pages workflow publishes `dist/satisfactory-planner`. The server-side modules in the image (`server.ts`, `planner.ts`, …) are not minified.

`npm run build -- pages` creates an allowlisted, minified static site in `dist/satisfactory-planner`. Serve `dist` with any static HTTP server to test it.

To build and run the Docker image from your checkout:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

## Tests

Tests cover migration, durable progress, concurrent updates, backup restore, corrupted saves, save/profile isolation, account ownership, authentication, calculator constraints and interface rendering.

`node browser-check.ts` exercises the browser calculator, persistence, profile isolation, concurrent tabs and Docker transfers; run `npx playwright install chromium` once first (`npm ci` installs Playwright itself).

## CI and publishing

The workflow in [.github/workflows/docker.yml](../.github/workflows/docker.yml) runs server, browser and Docker checks on pushes to `main`, `v*` tags and pull requests. GitHub Actions additionally builds and restarts a real Docker container before publishing. Source-side pull requests run checks without deploying.

- **Docker image.** Pushes to `main` publish `latest` and a commit tag to `ghcr.io/reinder83/satisfactory-planner`, for AMD64 and ARM64; `v*` tags publish version tags. No additional registry secrets are required.
- **GitHub Pages.** Pushes to `main` push only the built website to the public `reinder83.github.io` deployment repository. Its Pages workflow publishes the site. `PAGES_DEPLOY_KEY` is a write deploy key limited to that public repository. Saved user data is never included in the static build.

## Data and migrations

### Docker edition

The Docker `planner-data` volume stores `/data/workspace.json`: accounts, named saves, profiles, calculation snapshots and progress. Updates and container recreation preserve it.

- `workspace.json.bak` retains the previous successful workspace write. Writes are serialized and atomically replaced. Corrupted data causes startup to fail rather than silently reset progress.
- `progress.json` remains the pre-migration backup and is no longer the live store. On the first start after the update that introduced saves, an existing `progress.json` was copied into the original save in `workspace.json`, with its checkmarks, deliveries, custom tasks and notes; the old file is retained untouched. Do not run old and new planner versions simultaneously against one volume.

### Browser edition

The browser edition saves profiles, checkmarks, notes and delivery counts in IndexedDB on that browser. Browser data is specific to the browser, device and site address.

### Profiles and snapshots

Each **user → named save → profile** has independent progress. Profiles store a calculation snapshot, so updating the software cannot silently change existing targets.

Data saved by an earlier release is migrated automatically with all its progress: by the Docker server when it opens `workspace.json` or `progress.json`, by the browser edition when it opens its IndexedDB record, and by both editions when they import an older full export or restore an older progress backup. The Docker server keeps its backups in the data volume: `workspace.json.bak`, the retained `progress.json` and a one-off copy made before one past migration (see [Persistence and backups](SELF-HOSTING.md#persistence-and-backups)). The browser edition keeps a copy of its IndexedDB record only from before that one past migration, and none for any other update; export a full backup (**Backup → Export all saves**) before updating if you want a copy. See [AGENTS.md](../AGENTS.md) for the migration and compatibility rules every change must follow.
