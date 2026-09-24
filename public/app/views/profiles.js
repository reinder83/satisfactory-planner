// Saves & profiles view (#profiles): every save in the workspace with its profile cards.
import { browserMode } from '../../browser-api.js';
import { num } from '../format.js';
import { html } from '../html.js';
import { currentProfile, currentSave, phaseLabel, workspace } from '../session.js';
import { header } from '../shell.js';
import { browserNotice } from './backup.js';

// HTML for #profiles. A card is marked "PRESERVED HANDBOOK" for the original profile and
// "CALCULATED PROFILE" otherwise; only calculated ones have `settings` to summarise. The
// browser edition links to backups instead of accounts. Buttons are handled in
// events/views.js: `data-new-save`, `data-new-profile`, `data-open-save`/`-profile`,
// `data-duplicate-*`, `data-share-*`, `data-remove-*`; #rename-form is submitted in
// events/profiles.js.
export function renderProfiles() {
  return String(
    html`${browserMode && browserNotice()}
      ${header(
        'YOUR FACTORY WORLDS',
        'Saves & profiles',
        'Each save keeps separate progress for every profile. Switching back restores its checklist, deliveries and notes.',
      )}
      <div class="toolbar">
        <button class="btn primary" data-new-save>Create a save</button>
        ${browserMode
          ? html`<a class="btn" href="#backup">Backups & transfer</a>`
          : html`<a class="btn" href="#account"
              >${workspace.accountsEnabled ? 'Your account' : 'Set up user accounts'}</a
            >`}
      </div>
      ${workspace.saves.map(
        s =>
          html`<section class="panel save-panel">
            <div class="section-head">
              <h2>${s.name}</h2>
              <button class="btn" data-new-profile="${s.id}">Try another profile</button>
            </div>
            <div class="profile-cards">${s.profiles.map(p => profileCard(s, p))}</div>
          </section>`,
      )}
      <p class="small muted">
        Duplicate copies a profile with its progress so you can try changes without touching the
        original. Share downloads a file with the plan, storage layout, factory groups and step
        edits — without your checkmarks or notes — that anyone can import under Backup → Import
        saves.
      </p>
      <section class="panel">
        <h2>Rename the current save or profile</h2>
        <form id="rename-form" class="inline-form">
          <select name="target" aria-label="What to rename">
            <option value="save">Save</option>
            <option value="profile">Profile</option></select
          ><input
            name="name"
            required
            maxlength="80"
            aria-label="New name"
            placeholder="New name"
          /><button class="btn">Rename</button>
        </form>
        <p class="small muted">
          Renaming does not change progress. Profiles keep a frozen calculation so later planner
          updates cannot silently change your targets.
        </p>
      </section>`,
  );
}

// HTML for one profile card `p` of save `s`.
function profileCard(s, p) {
  const open = s.id === currentSave.id && p.id === currentProfile.id;
  return html`<article class="profile-card ${open ? 'selected' : ''}">
    <div class="eyebrow">
      ${p.kind === 'original' ? 'PRESERVED HANDBOOK' : 'CALCULATED PROFILE'}
    </div>
    <h3>${p.name}</h3>
    <p>
      ${p.settings
        ? `${p.settings.purity} purity · ${num(p.settings.multiplier)}× elevator · ${num(p.settings.powerFactor)}× power`
        : '50× elevator · pure ingots · nuclear recycling'}
    </p>
    <p class="small">${p.completed} checks complete · ${phaseLabel(p.phase)}</p>
    <button
      class="btn ${open ? '' : 'primary'}"
      data-open-save="${s.id}"
      data-open-profile="${p.id}"
    >
      ${open ? 'Continue current profile' : 'Open profile'}
    </button>
    <button class="btn" data-duplicate-profile="${p.id}" data-duplicate-save="${s.id}">
      Duplicate
    </button>
    <button class="btn" data-share-profile="${p.id}" data-share-save="${s.id}">Share</button>
    <button class="btn" data-remove-profile="${p.id}" data-remove-save="${s.id}">
      Remove profile
    </button>
  </article>`;
}
