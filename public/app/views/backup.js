// Backup & notes view (#backup), in server and browser-only editions. The browser edition
// (browserMode) has no server, so it never shows the /api/export progress download and
// instead explains that saves live in this browser. Its handlers: `data-export-saves` and
// `data-persist-storage` in events/profiles.js, #import-saves in events/backup.js, and
// #import-file (progress-only restore) and `data-save-note` in events/views.js.
import { browserMode } from '../../browser-api.js';
import { esc } from '../format.js';
import { calculated, currentProfile, currentSave, plan, state, workspace } from '../session.js';
import { header } from '../shell.js';

// HTML for #backup. Picks the browser-edition page, the calculated-profile page, or (below)
// the server page for the original handbook, with its plan assumptions and sources.
// The save-wide note is stored under the key `global`.
export function renderBackup() {
  if (browserMode) return renderBrowserBackup();
  if (calculated) return renderCalculatedBackup();
  return (
    portablePanel() +
    header(
      'YOUR PROGRESS',
      'Backup & notes',
      'Progress is stored on the server, so the same Docker instance works across your devices.',
    ) +
    `<div class="backup-grid"><section class="panel"><h2>Download a backup</h2><p>Save a copy of your checkmarks, delivery counts, personal tasks and notes.</p><a class="btn primary" href="/api/export?save=${currentSave.id}&profile=${currentProfile.id}" download>Download progress JSON ↓</a><p class="small muted">The Docker volume keeps progress through container updates. This download gives you a separate copy.</p></section><section class="panel"><h2>Restore a backup</h2><p>Import a backup from this planner. It replaces current progress after confirmation; factory-plan data stays unchanged.</p><label class="btn">Choose backup file<input id="import-file" type="file" accept="application/json,.json" hidden></label><p class="small muted">Up to 2 MB. The previous state is also retained as workspace.json.bak on the server. The original progress file is kept during migration.</p></section></div><section class="panel" style="margin-top:24px"><h2>Save-wide notes</h2><textarea id="global-note" class="notes" maxlength="6000" aria-label="Save-wide notes">${esc(state.notes.global || '')}</textarea><div class="note-save"><span class="small muted">Seed, locations, routes and decisions.</span><button class="btn" data-save-note="global" data-input="global-note">Save notes</button></div></section><section class="panel"><h2>Plan assumptions</h2><p class="small">All tiers through 6 unlocked. Phase 3 Versatile Frameworks delivered. Pure nodes, 50× elevator costs, half consumption. Retire coal and temporary fuel; retain turbofuel. Phase 5 resource conversion and extra Reanimated SAM are included. Ground-floor storage shell is already built; individual containers are not assumed connected.</p><p class="small">The final extra storage modules need additional input allocations. After Phase 5, storage takes priority over maintaining full elevator-export rates for sinking. Gathered items require collection; equipment and inhalers are manually crafted.</p><div class="list-links">${plan.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)} ↗</a>`).join('')}</div></section>`
  );
}

// HTML notice that saves are browser-local. Shown at the top of the browser edition's
// backup, profiles, wizard, guided-start and extraction-survey pages.
export function browserNotice() {
  return `<div class="notice blue">Your saves stay in this browser on this device. Clearing site data or using private browsing can remove them. Export a full backup before switching devices or website addresses. <a href="#backup">Backups & transfer</a></div>`;
}

// HTML panel for full-save export and import (the `satisfactory-planner-saves` format),
// offered in both editions. Import always adds copies; it never replaces a save.
function portablePanel() {
  return `<section class="panel"><h2>Full saves & transfer</h2><p>Export all your saves, profile calculations, checkmarks and notes. Account passwords and sessions are excluded. Import adds copies without replacing existing saves.</p><button class="btn primary" data-export-saves>Export all saves</button> <label class="btn">Import saves<input id="import-saves" type="file" accept="application/json,.json" hidden></label></section>`;
}

// HTML for the browser edition's backup page. Also what #account shows in that edition,
// since there are no accounts. workspace.lastBackup is when a full export last ran here.
export function renderBrowserBackup() {
  return (
    header(
      'SAVED ON THIS DEVICE',
      'Backups & transfer',
      'No account or server is needed. Saves do not sync automatically between browsers.',
    ) +
    browserNotice() +
    portablePanel() +
    `<section class="panel"><h2>Keep a backup</h2><p>${workspace.lastBackup ? 'Last export: ' + esc(new Date(workspace.lastBackup).toLocaleString()) : 'No full backup has been exported from this browser yet.'} Export after major changes and before clearing browser data.</p><button class="btn" data-persist-storage>Request persistent browser storage</button><p class="small">This reduces automatic eviction when supported. It cannot protect against manually clearing site data.</p><p>To move from Docker, update the Docker app and use Backup & notes → Export all saves, then import that file here. A legacy progress-only export is not a full save.</p><h2>Self-hosted edition</h2><p>The Docker edition keeps server storage and user accounts for access across devices. Browser storage remains local to each visitor.</p></section>`
  );
}

// HTML for #backup on a calculated profile in the server edition: this profile's progress
// download and restore, its save-wide note, and the calculation's warnings. The save and
// profile names are user text, so they are escaped. (renderBackup has already routed the
// browser edition away, so the browserMode check here is only a safeguard.)
function renderCalculatedBackup() {
  if (browserMode) return renderBrowserBackup();
  return (
    portablePanel() +
    header(
      'THIS PROFILE',
      'Backup & notes',
      'Checkmarks, deliveries and notes belong to ' +
        esc(currentSave.name) +
        ' / ' +
        esc(currentProfile.name),
    ) +
    `<div class="backup-grid"><section class="panel"><h2>Download progress</h2><a class="btn primary" href="/api/export?save=${currentSave.id}&profile=${currentProfile.id}" download>Download progress JSON</a><p class="small muted">For all accounts, profiles and calculation snapshots, back up the Docker data volume. This download contains only this profile’s progress.</p></section><section class="panel"><h2>Restore this profile</h2><p>Restore replaces only this profile’s progress, after confirmation.</p><label class="btn">Choose backup<input id="import-file" type="file" accept="application/json,.json" hidden></label></section></div><section class="panel"><h2>Save-wide notes for this profile</h2><textarea id="global-note" class="notes" maxlength="6000">${esc(state.notes.global || '')}</textarea><button class="btn" data-save-note="global" data-input="global-note">Save notes</button></section><section class="panel"><h2>Calculation assumptions</h2>${calculated.warnings.map(x => `<p>${esc(x)}</p>`).join('')}<a href="https://github.com/greeny/SatisfactoryTools" target="_blank" rel="noreferrer">Recipe data source</a></section>`
  );
}
