// Factories view (#factories) for the original handbook: cards, shared sites and
// user-defined factory groups. The group helpers here are also used by the calculated
// factories page (calculated.js), factory-detail.js and ada-panel.js.
import { esc, itemIcon, num } from '../format.js';
import {
  checked,
  doneAttr,
  factoryEditing,
  factoryFilter,
  phase,
  plan,
  query,
  stage,
  state,
} from '../session.js';
import { header } from '../shell.js';
import { inputText } from './storage.js';

// Which shared site a handbook factory is drawn under: Plastic and Rubber come out of one
// oil campus, nuclear factories out of the nuclear site; null means a card of its own.
const siteOf = f => (['Plastic', 'Rubber'].includes(f.name) ? 'oil' : f.nuclear ? 'nuclear' : null);

// The profile's factory groups with defaults filled in. `assignments` maps a factory key
// (a handbook factory id, or a calculated row id) to a list of { group, rate } memberships;
// a null rate means the whole output, or the remainder once other groups take theirs.
export function factoryGroupsState() {
  const g = state?.factoryGroups || {};
  return { groups: g.groups || [], assignments: g.assignments || {} };
}

export const membershipsOf = key => factoryGroupsState().assignments[key] || [];

// HTML line on a grouped card saying how much of the factory's output this group gets.
// Empty when the factory sits whole in a single group. A null-rate membership receives
// what the fixed-rate ones leave over; machines are scaled by the same share.
export function allocationHtml(key, groupId, total, machines, unit = '/min') {
  const ms = membershipsOf(key),
    m = ms.find(x => x.group === groupId);
  if (!m || (ms.length === 1 && m.rate == null)) return '';
  const rate =
    m.rate == null ? Math.max(0, total - ms.reduce((a, x) => a + (x.rate || 0), 0)) : m.rate;
  const share = total > 0 ? Math.min(1, rate / total) : 0;
  return `<div class="small allocation">${m.rate == null ? 'Remaining here: ' : 'Here: '}${num(rate)}${unit} of ${num(total)}${unit}${machines && share < 1 ? ` · ≈ ${num(machines * share)} of ${num(machines)} machines` : ''}</div>`;
}

// HTML for a card's group editor, shown while editing groups. Its `data-assign-rate`,
// `data-unassign` and `data-assign-add` controls are handled in events/views.js, which
// saves a `factoryAssign` change. The cap of 12 groups matches validation in state.js.
// Group names are user text, so every one goes through esc().
export function assignEditor(key) {
  const g = factoryGroupsState();
  if (!g.groups.length)
    return '<p class="small muted">Create a group above to place this factory.</p>';
  const ms = membershipsOf(key);
  const avail = g.groups.filter(gr => !ms.some(m => m.group === gr.id));
  return `<div class="assign-editor">${ms.map(m => `<div class="assign-row"><span>${esc(g.groups.find(x => x.id === m.group)?.name || '')}</span><input type="number" min="0" step="any" data-assign-rate="${key}" data-group="${m.group}" placeholder="all / remainder" value="${m.rate ?? ''}" aria-label="Production per minute in ${esc(g.groups.find(x => x.id === m.group)?.name || 'this group')}"><button class="btn quiet danger" data-unassign="${key}" data-group="${m.group}" aria-label="Remove from ${esc(g.groups.find(x => x.id === m.group)?.name || 'group')}">✕</button></div>`).join('')}${avail.length && ms.length < 12 ? `<select data-assign-add="${key}" aria-label="Add to a group"><option value="">+ Add to group…</option>${avail.map(gr => `<option value="${gr.id}">${esc(gr.name)}</option>`).join('')}</select>` : ''}</div>`;
}

// HTML for the "Factory groups" panel with the #add-group form (submitted through
// events/views.js). Shown on both factories pages while editing groups.
export function groupEditPanel() {
  return `<section class="panel edit-panel"><h2>Factory groups</h2><form id="add-group" class="inline-form"><input id="new-group-name" name="name" maxlength="80" required placeholder="New group (e.g. Cable factory)…" aria-label="New group name"><button class="btn primary" type="submit">+ Add group</button></form><p class="small muted">Group production into the physical sites of your world. A factory can join several groups with a production split — for example Wire: 300/min at the cable factory and the remainder beside stitched plates. Leave the rate empty for the whole output or the remainder. Removing a group keeps every factory and its progress.</p></section>`;
}

// HTML for one section per user group, holding the cards from `list` assigned to it.
// Shared by both factories pages: `keyOf` gives an entry's assignment key and `cardFn`
// draws its card for a group. Empty groups are hidden unless groups are being edited.
// `data-group-rename`/`data-remove-group`/`data-group-chain` are handled in events/views.js.
export function groupSections(list, keyOf, cardFn) {
  return factoryGroupsState()
    .groups.map(gr => {
      const members = list.filter(x => membershipsOf(keyOf(x)).some(m => m.group === gr.id));
      if (!members.length && !factoryEditing) return '';
      return `<section class="site-group user-group"><header class="site-head"><div><span class="eyebrow">FACTORY GROUP · ${members.length} ${members.length === 1 ? 'FACTORY' : 'FACTORIES'}</span>${factoryEditing ? `<input class="bay-rename" data-group-rename="${gr.id}" value="${esc(gr.name)}" maxlength="80" aria-label="Rename group ${esc(gr.name)}">` : `<h2>${esc(gr.name)}</h2>`}</div>${factoryEditing ? `<button class="btn danger" data-remove-group="${gr.id}">Remove group</button>` : members.length > 1 ? `<button class="btn" data-group-chain="${gr.id}">Build order ↗</button>` : ''}</header><div class="cards">${members.map(x => cardFn(x, gr.id)).join('') || '<div class="empty-state">Empty group. Add factories with the group selector on their cards.</div>'}</div></section>`;
    })
    .join('');
}

export function factoryEditToolbar() {
  return `<button class="btn ${factoryEditing ? 'primary' : ''}" data-toggle-factory-edit>${factoryEditing ? 'Done editing' : 'Edit groups'}</button>`;
}

// HTML card for one handbook factory at the current stage. Its Running box writes the saved
// check key `factory-<stage>-<id>`, which must stay stable. `data-factory` opens the detail
// dialog (openFactory in factory-detail.js). With a groupId it also shows that group's share.
function factoryCard(f, groupId = null) {
  const r = f.stages[stage()],
    id = 'factory-' + stage() + '-' + f.id;
  return `<article class="factory-card ${checked(id) ? 'done' : ''}"><div class="card-top"><span class="card-icon">${itemIcon(f.name)}</span><div class="card-main"><button class="name" data-factory="${f.id}">${esc(f.name)}</button><div class="output">${num(r.output)} <span>/min</span></div></div>${f.local ? '<span class="badge">Local</span>' : f.conversion ? '<span class="badge orange">Convert</span>' : ''}</div><div class="recipe">${esc(r.recipe.replace('Alternate: ', ''))}</div><div class="small">${r.machines ? `${num(r.machines)} × ${esc(r.machine)}` : 'See shared oil campus'} <span class="muted">· storage ${num(r.storage)}/min</span></div>${groupId ? allocationHtml(f.id, groupId, r.output, r.machines) : ''}<footer><label class="check-row"><input type="checkbox" data-check="${id}" ${doneAttr(id)}>Running</label><button class="btn quiet" data-factory="${f.id}">Details ↗</button></footer>${factoryEditing ? assignEditor(f.id) : ''}</article>`;
}

// HTML section for the oil campus or nuclear site, holding its ungrouped factory cards.
function siteGroupHtml(site, members) {
  if (!members.length) return '';
  const p = plan.plans[stage()];
  const label = site === 'oil' ? 'Oil campus' : 'Nuclear site';
  const sub =
    site === 'oil'
      ? `One shared machine set produces these outputs together: ${num(p.oil.reduce((a, x) => a + x.machines, 0))} buildings · crude ${num(p.oilTotals.crude)}/min · water ${num(p.oilTotals.water)}/min. Open a card for the shared recipe table.`
      : 'Build and balance this radioactive chain as one site at the power plants. Process buffers stay here; the general storage surplus does not apply.';
  return `<section class="site-group"><header class="site-head"><div><span class="eyebrow">SHARED SITE · ${members.length} OUTPUTS</span><h2>${label}</h2></div><p class="small muted">${sub}</p></header><div class="cards">${members.map(f => factoryCard(f)).join('')}</div></section>`;
}

// HTML for the #factories page of the original handbook. Filters by the shared search
// query (#factory-search) and the status select (#factory-filter), both read back by
// events/views.js. Cards go into user groups first, then the shared sites, then the rest.
// Post-game adds the completion modules, whose boxes write `completion-<id>` checks.
export function renderFactories() {
  // Factories at this stage that match the search text and the status filter.
  const list = plan.factories
    .filter(f => f.stages[stage()])
    .filter(f =>
      (f.name + ' ' + f.stages[stage()].recipe).toLowerCase().includes(query.toLowerCase()),
    )
    .filter(
      f =>
        factoryFilter === 'all' ||
        (factoryFilter === 'todo' && !checked('factory-' + stage() + '-' + f.id)) ||
        (factoryFilter === 'done' && checked('factory-' + stage() + '-' + f.id)) ||
        (factoryFilter === 'local' && f.local),
    );
  // A factory in any user group is drawn there only; the rest split by shared site.
  const ungrouped = list.filter(f => !membershipsOf(f.id).length);
  const singles = ungrouped.filter(f => !siteOf(f)),
    oil = ungrouped.filter(f => siteOf(f) === 'oil'),
    nuclear = ungrouped.filter(f => siteOf(f) === 'nuclear');
  const groupsHtml = groupSections(
    list,
    f => f.id,
    (f, gid) => factoryCard(f, gid),
  );
  return (
    header(
      'PRODUCTION LIBRARY',
      'Factory targets',
      'Outputs include downstream supply, protected storage and elevator exports. Click a factory for its inputs and expansion history.',
    ) +
    `${phase() === 'post' ? '<div class="notice">These are retained Phase 5 capacities, not mandatory post-game output rates. Give new storage items priority before committing all spare output to sinks.</div>' : ''}
 <div class="toolbar"><input id="factory-search" class="search" placeholder="Find a part or recipe…" aria-label="Find a factory" value="${esc(query)}"><select id="factory-filter" aria-label="Factory status">${[
   ['all', 'All factories'],
   ['todo', 'Not running yet'],
   ['done', 'Running'],
   ['local', 'Made beside consumers'],
 ]
   .map(([v, l]) => `<option value="${v}" ${factoryFilter === v ? 'selected' : ''}>${l}</option>`)
   .join(
     '',
   )}</select><span class="small muted">${list.length} targets</span>${factoryEditToolbar()}</div>
 ${factoryEditing ? groupEditPanel() : ''}
 ${groupsHtml}
 ${siteGroupHtml('oil', oil)}${siteGroupHtml('nuclear', nuclear)}
 ${(groupsHtml || oil.length || nuclear.length) && singles.length ? '<p class="eyebrow">UNGROUPED FACTORIES</p>' : ''}<div class="cards">${singles.map(f => factoryCard(f)).join('') || (list.length ? '' : '<div class="empty-state">No factories match this filter.</div>')}</div>
 ${
   phase() === 'post'
     ? `<section style="margin-top:32px"><h2>Additional completion modules</h2><div class="notice">These recipe inputs are additional to the main resource budget. Allocate their supply first. Gathered feedstock and byproducts still need handling.</div><div class="completion-grid">${plan.completion
         .filter(r => r.name.toLowerCase().includes(query.toLowerCase()))
         .map(
           r =>
             `<article class="completion-item"><label class="check-row"><input type="checkbox" data-check="completion-${r.id}" ${doneAttr('completion-' + r.id)}><strong>${esc(r.name)}</strong></label><p>${num(r.output)}/min · ${num(r.machines)} ${esc(r.machine)} · last at ${num(r.lastClock)}%<br>${esc(r.recipe)}</p><p><b>Inputs:</b> ${inputText(r.inputs)}${Object.keys(r.byproducts).length ? `<br><b>Byproducts:</b> ${inputText(r.byproducts)}` : ''}</p></article>`,
         )
         .join('')}</div></section>`
     : ''
 }`
  );
}
