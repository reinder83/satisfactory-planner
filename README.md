<p align="center">
  <img src="docs/assets/banner.svg" alt="Satisfactory Planner, Project Assembly: production plans, build order and progress you keep" width="960">
</p>

<p align="center">
  <a href="https://reinder83.github.io/satisfactory-planner/"><b>Open the planner in your browser →</b></a>
</p>

A production planner and progress notebook for **Satisfactory**. Tell it where you are in the game and what you want, and it calculates every phase up to the Space Elevator — then turns the plan into a build order you tick off as you go, with your progress kept per save.

Most calculators stop at the numbers. This one keeps going: which milestone to unlock next, which production line to build first, where every item goes in storage, and what you have already done.

## What it does

- **Plans every phase.** Production lines, power, storage and elevator deliveries for Phases 1–5 and post-game, calculated with a real solver within your resource budgets.
- **Starts in six questions.** A short guided start (your phase, your goal, which recipes, what to keep stocked, how exact, how to power it) — or the full settings wizard if you want every control.
- **Fits your world.** Count your nodes or just pick your World Randomization settings and it works out the budgets. Already producing something? Enter the rate and the plan builds only the rest.
- **Turns the plan into a checklist.** A chronological build order with HUB milestones, MAM research, hard drives and power upgrades in the order you need them.
- **Whole machines.** Solid-part lines run at 100% by default, with the surplus listed and what that costs against exact clocks; any single line can be set to exact clocks, and fluids and power stay precisely balanced.
- **Storage map.** Every item gets a container address in a storage room you can rearrange.
- **Yours to edit.** Reorder and rewrite steps, sort production lines into factories at your own sites, add notes and personal tasks.
- **Progress you keep.** Several saves, several profiles per save, each with its own progress. Updates never change an existing plan behind your back.
- **ADA.** A sarcastic assistant who reads your plan and tells you what is actually next.

The [user guide](docs/USER-GUIDE.md) covers every screen and exactly what the calculator does and does not model.

<img src="docs/assets/hazard-divider.svg" alt="" width="100%">

## Use it in your browser

**[reinder83.github.io/satisfactory-planner](https://reinder83.github.io/satisfactory-planner/)** — nothing to install, no account.

1. Open the planner and answer the guided start's six questions.
2. Check the **Review**: buildings, delivery time and power per phase.
3. Create the profile and work through the **Build plan**, ticking steps as you build.

Everything runs in your browser. Your saves stay in that browser's storage (IndexedDB) and are never uploaded; GitHub only serves the site.

> **Back up your saves.** Browser data belongs to one browser on one device; clearing site data deletes it and private windows may discard it. Use **Backup → Export all saves** now and then — the file imports into any copy of the planner, the browser edition or a self-hosted one.

To share a plan, use **Saves & profiles → Share**: it sends the plan and layout without your checkmarks or notes, and arrives as a new save for whoever imports it.

<img src="docs/assets/hazard-divider.svg" alt="" width="100%">

## Host it yourself

Prefer your saves on your own server, synced between devices, or separate accounts for friends? Run the Docker image (AMD64 and ARM64). It is public, so pulling it needs no GitHub account. Use a `compose.yaml` like this (the one [in this repository](compose.yaml) adds a few hardening options):

```yaml
services:
  planner:
    image: ghcr.io/reinder83/satisfactory-planner:latest
    restart: unless-stopped
    ports:
      - '127.0.0.1:8080:8080' # use '8080:8080' to reach it from other devices
    environment:
      PUID: 1000 # owner of the data folder
      PGID: 1000
      TZ: Europe/Amsterdam
      COOKIE_SECURE: 'false' # 'true' behind an HTTPS reverse proxy
    volumes:
      - planner-data:/data

volumes:
  planner-data:
```

```sh
docker compose up -d
```

Open **http://localhost:8080**. To update, run `docker compose pull` and `docker compose up -d` again; your data lives in the `planner-data` volume and survives updates. **Never run `docker compose down -v` unless you mean to delete it.**

[Self-hosting](docs/SELF-HOSTING.md) covers all settings, user accounts, data folder permissions, backups and moving saves between editions.

<img src="docs/assets/hazard-divider.svg" alt="" width="100%">

## More

- [User guide](docs/USER-GUIDE.md) — every feature in detail, and the calculation's scope and assumptions.
- [Self-hosting](docs/SELF-HOSTING.md) — Docker settings, accounts, permissions and backups.
- [Development](docs/DEVELOPMENT.md) — running from source, tests, builds, CI and data internals. Coding assistants start with [AGENTS.md](AGENTS.md).
- [Third-party licences](THIRD_PARTY.md)

## Support

Enjoying the planner? You can support its development through the **Sponsor** button at the top of this repository ([github.com/sponsors/reinder83](https://github.com/sponsors/reinder83)).

<sub>Satisfactory is a trademark of Coffee Stain Studios. This is an unofficial fan project.</sub>
