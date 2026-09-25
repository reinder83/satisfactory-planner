# Satisfactory Planner

For coding-assistant handoff, start with [AGENTS.md](AGENTS.md). Interface redesign guidance lives in [public/AGENTS.md](public/AGENTS.md), and [CLAUDE.md](CLAUDE.md) points Claude to the same shared instructions.

A self-hosted Satisfactory planner with named saves, settings-first profile creation, calculated production targets, chronological checklists, storage maps and optional user accounts.

## Your existing plan is preserved

The original 50× elevator / pure-ingot handbook remains a separate, unchanged profile. On first start after this update, existing `progress.json` is copied into the original save in `workspace.json`. The old file is retained untouched. Checkmarks, deliveries, custom tasks and notes migrate together.

Each **user → named save → profile** has independent progress. Trying another profile does not reset the original. Profiles store a calculation snapshot, so updating the software cannot silently change existing targets. Rename saves and profiles from **Saves & profiles**.

## Create a profile

Open **Saves & profiles → Create a save**, or **Try another profile** on an existing save.

### The guided start

A new save opens on a short illustrated sequence rather than the full settings form. Five questions, each a picture and a sentence: which phase you are on, what the plan should do for you, which recipes it may use, what it should keep stocked, and how exact the build should be. Everything else keeps a default that was chosen by measuring what it actually changes — eleven of the settings form's controls, including the world seed, SAM conversion, somersloops held and every resource budget, do not move a default plan at all.

Two of the questions are about your world rather than about the plan. On Phase 1 you are asked whether the HUB tutorial is behind you; if it is, its steps start ticked.

From Phase 2 on you are asked **what you are already producing**, as a rate: search for the item, then type what it makes per minute. Leave the rate blank and that line simply is not counted yet — the row stays where it is and says so. The planner credits that and builds only the remainder — and it does not build the chain behind it either, so the iron, the plastic and the power that line consumes all leave the plan with it. What you built it out of is your business: the recipe and the machine count do not have to match anything this plan would have chosen, which is the whole point of entering a rate rather than ticking the planner's own list. Declaring 50/min of something a phase only needs 15/min of simply credits the 15; the rest is yours. Nothing is pre-ticked, because there is no build step to tick — the line is not in the plan at all. The same control is in **All settings → Game settings**, beside spare existing power.

One assumption comes with it, the same one that already applies to spare power: an existing line's ore and electricity are already spent in your world, so enter your resource budgets and spare power net of it. Review states this every time it credits something, and names what it credited.

**All settings →** is on every screen and opens the five-step wizard below at the step that owns the same question, keeping every answer; **← Guided start** comes back the same way. Picking *I will choose them myself* for recipes, or *as fast as the map allows* for the goal, hands over to the step that can answer it properly.

Adding a profile to a save you already play starts from that save's settings instead, and asks only **what is different this time?**

### All settings

1. Name the save and enter its phase, purity/distribution, elevator multiplier, consumption multiplier and spare existing power.
2. Choose recipe access (standard, all alternates, or hand-pick specific alternate recipes), pure ingots, SAM conversion policy, nuclear recycling, protected storage and extra Singularity Cell production.

   Protected storage reserves production for every selected item, permanently, so it is often the largest single cost in a plan. On the default Phase 3/4/5 plan, raising **Construction materials refill /min** from 1 to 5 adds 81% more buildings, and raising it to 20 adds 425%, because it applies to all eighteen construction materials at once. A per-item rate is far cheaper for the same reassurance: 20/min of Concrete costs about 1% more buildings, and 20/min of Iron Plate costs nothing measurable, because the plan already spills far more than that into storage as surplus — a default Phase 3 plan sends 29 Wire and 19 Iron Plate a minute to storage on top of the reserved rate, and 2 Concrete. That is why the guided start leaves the general rates at 1 and offers per-item floors instead. It is set by two rates: **Construction materials refill /min** for the parts you carry out by hand (plates, rods, concrete, wire, cable, beams, pipes, frames, plastic, rubber) and **Other items refill /min** for everything else. **Per-item storage rates** overrides single items; `0` keeps an item's container and address without reserving any production for it, and surplus still fills it. Settings saved before this existed use their one rate for both, so existing profiles are unchanged.

   Space Elevator parts start at `0`. Deliveries and the later project parts that consume them are already planned, so a standing buffer on top would be production nobody draws from. They keep their containers and addresses; enter a rate against one if you want a buffer anyway.

   **Somersloops.** Record how many somersloops you have to spend, how many Alien Power Augmenters Phase 5 builds and how many of those you will fuel. Each augmenter costs 10 somersloops permanently, generates 500 MW and multiplies the whole grid's base production — 10% unfueled, 30% fueled — so step 1 also asks for your **total installed power**, not only the spare part of it. Fuel is derived, never entered: each fueled augmenter adds 5 Alien Power Matrix/min to the plan and the Quantum Encoder chain behind it. Review then compares that plan against the same plan unfueled and says which is cheaper for your scale.

   Somersloops parked in hand-fed constructors — power slugs into Power Shards, creature remains into Alien DNA, biomass into Solid Biofuel — reserve a somersloop and add a checklist step. Their inputs are carried in by hand, so they stay out of the continuous production balance.

   **Production amplification** is optional and starts at 0. Give it a budget and the planner puts that many somersloops in the plan's own machines, choosing where they pay best: an amplified machine keeps its inputs, doubles its output and draws four times the power, so it buys ore and buildings with power. Collecting every somersloop is a hunt, and some are hard to reach, so leaving this at 0 plans exactly as before. The budget applies to each phase's plan rather than adding up across phases, because each phase is a self-contained steady state and the somersloops move as you rebuild.
3. Choose minimal construction (24-hour delivery), balanced (8-hour delivery), a target time, or maximum elevator output.

   **Target time applies to** decides whether that time is each phase's target or only the final phase's. On *The final phase*, earlier phases run their lines as hard as the machines a later phase already builds allow, so they finish sooner without adding a building the plan later drops — an early phase is never made slower, never runs more of a recipe than a later phase keeps, and never uses a recipe no later phase uses. Their delivery rates are not rounded, and Review shows what each pulled-forward phase would otherwise have taken. Ignored for maximum output, which already maximizes every phase.
4. Review/edit available raw resource budgets. Confirm these before maximum-output planning.

   **Work these out from my nodes** opens a short survey instead, because a rate per minute is not something anyone knows off the top of their head. It asks what you can actually read off a map: which miner you will use and at what clock, how many impure, normal and pure nodes your world holds for each ore, and how many resource-well satellites you have for crude oil and nitrogen. It then does the arithmetic — a normal node is 60/min on a Mk.1, 120 on a Mk.2 and 240 on a Mk.3, halved when impure and doubled when pure, all multiplied by the clock; an oil node is 120/min normal and a well satellite 60/min, neither of which has miner marks.

   **You usually do not have to count anything.** The counting screens carry the game's own two **World Randomization** settings — *Resource node randomization* and *Resource node purity*, with the same options in the same order — and fill the counts in from them. Set them to what you chose when you created the save and the whole world appears; change either and the counts follow. They are the same two settings as on **Game settings**, so if you set the purity there the survey opens already filled in.

   That works because the purity settings do not move nodes or add any: they shift every node up or down the purity scale. Each setting is therefore the known map count rearranged, and lands on exactly the budget the planner already ships for it — All Pure gives 127 pure iron nodes and 152,400 iron/min, the same number as the planner's own all-pure table. Anything you counted yourself that the table does not cover, such as oil well satellites, is left alone.

   **Random** randomization is a shuffle: it moves which resource sits at each location, but every resource keeps its node count — nineteen SAM nodes are still nineteen SAM nodes, somewhere else. So under Random the counts still fill in for the uniform purities (All Pure, Average, All Impure), where the split across purities stops mattering. Random shuffles the purities too, so for Default, Mostly Pure and Mostly Impure the totals are still right but the split is yours to count, and the survey says exactly that rather than refusing outright.

   **Reset all counts to zero** is on both counting screens, for when you would rather enter your own map than correct a filled-in one. It clears every ore, well and committed amount, and your miner mark and clock speed stay because those are equipment rather than counts. Nothing is asked first — **Undo reset** takes its place in the same spot and puts back exactly what was on screen, until you fill the counts in again or leave the survey.

   **Resource wells are the exception.** A well is randomized as a whole rather than satellite by satellite, and the map's seventeen wells carry different numbers of satellites, so a shuffle that leaves every ordinary node count untouched can still land nitrogen on a bigger or smaller well than it had. Under Random the survey fills the ordinary nodes and leaves the nitrogen wells for you to count, and says why.

   The **resource-rich** distributions genuinely do change how many nodes each resource has, and players who have generated them get answers a third apart from one seed to the next, so no table can be right — those are not filled in, and neither is a Random purity. What the survey does say is which way each one pushes the map, because every count published so far agrees on that much: Basic favours limestone, iron, copper and coal, Advanced favours caterium, sulfur, bauxite, quartz, uranium and SAM, and Fossil Fuel favours coal, oil and sulfur. If counts from another world are still on screen the survey says so rather than passing them off as yours.

   For a seed like that — or any world you have edited — the survey links to the [Satisfactory Calculator interactive map](https://satisfactory-calculator.com/en/interactive-map), where uploading your save lists every node your world holds by purity. That upload is between you and that site; this planner never sends your save anywhere, and the map also works without one.

   The last screen takes off whatever extraction is **already committed** to factories this plan does not include, which is what makes a budget mean *free for this plan to use*. That is a different question from **what you are already producing** on the guided start: this one takes raw ore off the top, that one credits finished parts. Water is deliberately not counted — extractors sit on any lake or ocean, so the planner keeps its standing allowance, editable like any other budget. Your answers are stored with the profile, so the survey reopens where you left it.
5. Review calculated buildings, delivery time, power and feasibility by phase, then create the profile.

When you add a profile to a save you are already playing, Review also offers **Continue the progress in this save**. A new plan does not undo the world: choose the profile to carry from and which of its records come along — milestone/MAM and hard-drive unlocks, the storage room layout and its built containers, power and start-up steps, elevator deliveries already handed in, notes and personal tasks, build-plan edits and factory group names, and factory progress for production lines the new plan does not expand. Lines that now need more machines or more input are carried unticked so you can review them, exactly as **Round up production** does. Hand-picking alternate recipes for a save you play also states which recipes you own, so their unlock steps can start ticked. Nothing is moved: the profile you carry from keeps all of it, and a brand new save still starts empty.

A profile only offers the phases from the one it was created for onward: if you start at Phase 3, Phases 1 and 2 are not in its phase picker, its Review table or its expansion tables, because you have already passed them and each phase plan is self-contained. Where a phase stops using a line an earlier phase built, the build plan ends with a step naming those lines — its budgets no longer count them, and a replacement is usually a different machine rather than an upgrade in place, so commission the replacement before dismantling anything.

The wizard supports Phases 1–5. Post-game retains Phase 5 capacity and directs surplus to storage and sinks. Its optional storage template includes 132 addresses, collectables bays Q/R and the workshop underneath. New saves have no pre-completed steps.

On the storage map, **Complete room** marks all four checklist steps for the room's selected containers. Each container also has a direct **Done** checkbox; click its item icon/name for individual checks and notes. Unchecking Done clears that container's four steps. Successful note saves close the details dialog; saving a blank note deletes the note. Existing container addresses and progress keys are unchanged.

## Make the plan your own

- **Build plan → Edit steps** lets you rearrange steps with the arrow buttons, rewrite a step's title and details, link a step to one of your factories, or remove steps you do not want. Removed steps keep their checkmarks and can be restored from **Removed steps** while editing; clearing an edited field restores the original text. Calculated production steps link to their factory details automatically.
- **Factories → Edit groups** organizes production into named factory groups — the physical sites of your world. A factory can join several groups with a production split: for example Wire at 300/min in your cable factory with the remainder beside stitched plates. Leave a rate empty for the whole output or the remainder. Removing a group never touches the factories or their progress.
- **Storage room → Edit layout** renames floors and bays, adds your own, and assigns or clears containers. A bay holds the eight printed positions, 01–08, and takes more when you need them: adding a container to a full bay gives it the next address, 09 upwards, marked off below the two banks. Printed addresses never move, and a cleared container keeps its checkmarks for when you assign it again.
- **Saves & profiles → Duplicate** copies a profile including its progress, so you can try changes without touching the original plan.
- **Saves & profiles → Share** downloads a share file with the profile's plan, storage layout, factory groups, personal tasks and step edits — but none of your checkmarks, notes or delivery counts. Anyone can import it in either edition under **Backup → Import saves**; it arrives as a new save without affecting theirs. (A share link in a URL is not offered: a profile snapshot is far larger than links reliably allow.) Older planner versions refuse a share that contains step edits, groups or container positions past 08 and ask for an update instead of dropping them.

## ADA

ADA — the Artificial Directory and Assistant — sits under the navigation and comments on the plan you have open. Every remark is built from the same counters the pages show: steps left in this phase and which one is next, factory targets not yet marked running, unverified container positions, elevator parts short of target, retirement steps still open, resources over the budget you entered, missing power headroom, and (in the browser edition) how long ago you exported a full backup. The tone is a joke; the advice is not, and ADA never invents a number the plan does not already contain.

**Another remark** cycles through everything that applies right now: whole-page states first ("no save is open"), then real problems, then whatever the current page is about, then ADA’s general observations. Keep going past the last one and she notices. **Mute** silences ADA; the choice is remembered in that browser and is never part of a save, so muting changes nothing about your progress and nothing about a transfer.

Prod the small badge beside her name five times in a row and the corporate voice slips into a transmission fault. Prod it again for another one; the last one hands the terminal back, and anything else you click restores normal service immediately. It is decoration — nothing is only reachable that way.

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

Alien Power Augmenters are Phase 5 buildings. Available power is `(new generators + existing installed + 500 per augmenter) x (1 + 0.1 per unfueled + 0.3 per fueled)`, less the existing consumption implied by your spare figure. Profiles with no augmenters calculate exactly as before. Somersloop amplification of production machines is not modelled.

Items the AWESOME Sink cannot accept — Power Shards among them — are balanced exactly rather than run whole at 100%: they have nowhere to overflow, so a rounded-up line would back up and stall. Their last machine is underclocked, and they are never listed as sinkable surplus.

Production amplification is fitted to the recipe network the unamplified solve chooses, and only the largest lines are offered a somersloop, so the result is not a global optimum over amplified and unamplified recipes together. Amplified machines are planned as whole machines at 100%. If a phase cannot fit amplification inside the solver's time limit it is planned without it and says so, rather than losing a plan that fits.

New power plants and their fuel inputs are included. Existing power is entered as **spare** capacity; its resource use must already be deducted from the entered budgets. A 20% utility allowance covers unmodelled mining, pumps and transport. Whole-building peak headroom is shown separately when needed. Phase 1 requires biomass or existing power. This is a steady-state estimate, not a simulation of startup, variable demand or your actual game grid.

Storage is an explicit protected output per item. Unpackaged fluids, radioactive items and gathered feedstock are excluded from continuous storage production. Gathered items still have storage locations. Some standard-recipe items need alternates to become sustainably automatable. Singularity Cells are an explicit extra supply rate; teleport use and operating power are not inferred automatically.

Purity does not determine randomized node counts. Reference budgets use standard counts at endgame extraction; oil wells are excluded and nitrogen is separate. Edit the budgets to match your seed and accessible mining. Other mods/settings are notes only: changed recipes, boosts and modded items are not simulated. The app does not read game-save files.

The preserved original handbook retains its previous assumptions and corrected resource ledger. It is not recalculated by this new engine.

## Development

Node.js 22 or newer is sufficient. The MIT-licensed solver is bundled with its WebAssembly asset and license; see `THIRD_PARTY.md`.

The frontend is readable ES modules and Vue components (`public/app/ui/`). `npm start` serves `public/` as it is: outside production it runs Vite inside the planner's own server, which compiles the `.vue` files on request and reloads the browser on edits, so there is still no separate build or dev server to run. Install the packages first:

```sh
npm ci            # Vue, Vite, Vitest, Prettier and esbuild
npm run check     # formatting; `npm run format` fixes it
npm test          # node --test for the logic and pages, Vitest for the components
npm start
npm run build     # minified editions in dist/web (Docker) and dist/satisfactory-planner (Pages)
```

With `NODE_ENV=production` (as in the Docker image) the server serves `public/` as plain files and never loads Vite; that `public/` is the `dist/web` build.

The frontend lives in `public/`: `app.js` is the entry point and `public/app/` holds the UI modules (the Vue components under `ui/`, the data behind the pages under `views/`, the profile wizard under `wizard/`). The release build bundles `public/app/` into a single minified `app.js` and minifies the other scripts and the stylesheet file by file. The Docker image runs that build in its first stage and serves `dist/web`; the Pages workflow publishes `dist/satisfactory-planner`. The server-side modules in the image (`server.mjs`, `planner.mjs`, …) are not minified.

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

`npm run build -- pages` creates an allowlisted, minified static site in `dist/satisfactory-planner`. Serve `dist` with any static HTTP server to test it. `node browser-check.mjs` exercises the browser calculator, persistence, profile isolation, concurrent tabs and Docker transfers; install Playwright and Chromium first.

Pushes to private-source `main` run server, browser and Docker checks, publish the Docker image, and push only the built website to the public `reinder83.github.io` deployment repository. Its Pages workflow publishes the site. `PAGES_DEPLOY_KEY` is a write deploy key limited to that public repository. Source-side pull requests run checks without deploying. Saved user data is never included in the static build.
