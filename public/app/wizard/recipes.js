// Alternate recipe picker, shown on wizard step 2 when Recipe access is "Pick
// specific alternate recipes". Its buttons (Planner's choice, Select/Clear all,
// the filter, the stars, "recipe ↗") are handled in events/views.js.
import { dialog } from '../factory-detail.js';
import { FLUIDS, machinesLabel } from '../flow.js';
import { itemIcon, num3 } from '../format.js';
import { html, raw } from '../html.js';
import { workspace } from '../session.js';

// HTML for the picker. Ticked boxes (name="alt") become s.alternateRecipes and
// ticked stars (name="altpref") s.preferredRecipes, read back by readWizard. A
// recipe your power or ingot preference already requires shows as a locked,
// ticked box with no name, so it is never read back as a pick.
export function altPickerHtml(s) {
  const picked = new Set(s.alternateRecipes || []);
  const pref = new Set(s.preferredRecipes || []);
  const list = workspace.catalog.alternates || [];
  const row = a => {
    const outs = Object.keys(a.outputs);
    const why =
      a.mam && !['auto', 'coal', 'fuel'].includes(s.mainPower || 'auto')
        ? 'power preference'
        : a.pure && s.pureIngots === true
          ? 'ingot preference'
          : '';
    return html`<div
      class="alt-row"
      data-alt-text="${(a.name + ' ' + outs.join(' ')).toLowerCase()}"
    >
      <label class="check-row"
        >${why
          ? html`<input
              type="checkbox"
              checked
              disabled
              aria-label="${a.name} is required by your ${why}"
            />`
          : html`<input
              type="checkbox"
              name="alt"
              value="${a.id}"
              ${picked.has(a.id) && raw('checked')}
            />`}<span
          >${a.name}<small class="muted">
            · ${outs.join(', ')} ·
            ${a.mam ? 'MAM research' : 'Phase ' + a.phase}${why &&
            ' · required by your ' + why}</small
          ></span
        ></label
      >${!why &&
      html`<label
        class="alt-pref"
        title="Force this recipe: the plan will not use any other recipe for ${outs[0]} once this one is available"
        ><input
          type="checkbox"
          name="altpref"
          value="${a.id}"
          ${pref.has(a.id) && raw('checked')}
          ${!picked.has(a.id) && raw('disabled')}
          aria-label="Force ${a.name} as the only ${outs[0]} recipe"
        /><span>★</span></label
      >`}<button
        type="button"
        class="btn quiet alt-info"
        data-alt-info="${a.id}"
        aria-label="Show the ${a.name} recipe"
      >
        recipe ↗
      </button>
    </div>`;
  };
  return html`<div class="alt-picker">
    <div class="alt-picker-head">
      <b>Alternate recipes · ${picked.size} selected</b
      ><span class="alt-tools"
        ><button
          type="button"
          class="btn quiet"
          data-alt-best
          title="Recalculates with every alternate allowed and ticks only the recipes the optimal plan uses"
        >
          Planner’s choice</button
        ><button type="button" class="btn quiet" data-alt-all>Select all</button
        ><button type="button" class="btn quiet" data-alt-none>Clear all</button></span
      ><input
        id="alt-filter"
        type="search"
        placeholder="Filter by recipe or product…"
        aria-label="Filter alternate recipes"
      />
    </div>
    <p class="small muted">
      Only the recipes you tick are allowed in the plan. Hard-drive alternates are unlocked from
      crash sites; Turbofuel and Compacted Coal are researched in the MAM instead. Recipes your
      other choices depend on are selected automatically: a turbofuel-based power route locks its
      MAM recipes, and requiring pure ingots locks the pure recipes. Raw-resource conversion recipes
      are not alternates — they follow the SAM conversion setting and Tier 9 unlocks. Selecting none
      plans with standard recipes only. <b>Planner’s choice</b> recalculates with every alternate
      allowed and ticks only the recipes the optimal plan actually uses — each ticked recipe costs
      one hard drive. Select all and Clear all apply to the rows currently shown by the filter.
    </p>
    <p class="alt-force-hint">
      <span class="alt-force-star">★</span
      ><span
        ><b>Force a recipe:</b> tick it, then click its star. The plan will use
        <b>no other recipe</b> for that product once the starred one is available.</span
      >
    </p>
    <div class="alt-list">${list.map(row)}</div>
  </div>`;
}

// The alternate ids a calculated plan actually uses, sorted. "Planner's choice"
// (events/views.js) calculates with every alternate allowed and ticks these.
// MAM recipes (Turbofuel, Compacted Coal) appear in plans with alternate:false, so match catalog ids too.
export const alternatesUsed = plan => {
  const altIds = new Set((workspace?.catalog?.alternates || []).map(a => a.id));
  return [
    ...new Set(
      Object.values(plan?.stages || {}).flatMap(st =>
        (st.rows || []).filter(r => r.alternate || altIds.has(r.id)).map(r => r.id),
      ),
    ),
  ].sort();
};

// HTML for a "Recipe · …" panel: one machine's inputs → outputs at 100%, per minute, as
// [item, rate] pairs. The factory dialogs draw the same panel with ui/detail/RecipePanel.vue.
function recipePanelHtml(rc) {
  const cell = ([n, q], out) =>
    html`<div class="rail-cell${out ? ' out' : ''}">
      ${itemIcon(n)}<span class="rail-main"
        ><b>${num3(q)}${FLUIDS.has(n) ? ' m³' : ''}</b><small>${n}</small></span
      >
    </div>`;
  return html`<div class="rail-recipe">
    <div class="rail-recipe-head">
      <span>Recipe · ${rc.name}</span
      ><span>what ${machinesLabel(1, rc.machine)} makes @ 100% · per minute</span>
    </div>
    <div class="rail-recipe-body">
      <div class="rail-recipe-ins">
        ${rc.ins.length
          ? rc.ins.map(x => cell(x))
          : html`<div class="rail-cell">
              <span class="rail-main"><small>No belt or pipe inputs</small></span>
            </div>`}
      </div>
      <span class="rail-recipe-arrow">→</span>
      <div class="rail-recipe-outs">${rc.outs.map(x => cell(x, true))}</div>
    </div>
  </div>`;
}

// "recipe ↗": a dialog with the alternate beside the standard recipe(s) for its
// first output, so the two can be compared.
export function openAltRecipe(id) {
  const a = (workspace.catalog.alternates || []).find(x => x.id === id);
  if (!a) return;
  const primary = Object.keys(a.outputs)[0];
  const standards = (workspace.catalog.standardRecipes || []).filter(r => r.outputs[primary]);
  const panel = rc =>
    recipePanelHtml({
      name: rc.name.replace('Alternate: ', ''),
      machine: rc.machine,
      ins: Object.entries(rc.inputs || {}),
      outs: Object.entries(rc.outputs || {}),
    });
  dialog(
    a.name,
    a.mam
      ? `MAM research · unlocked in the MAM, not from hard drives · ${a.machine}`
      : `Alternate recipe · available from Phase ${a.phase} · ${a.machine}`,
    html`${panel(a)}
      ${standards.length
        ? html`<h3>Standard ${standards.length > 1 ? 'recipes' : 'recipe'} for ${primary}</h3>
            ${standards.map(panel)}`
        : html`<p class="small muted">No standard recipe produces ${primary}.</p>`}
      <p class="small muted">
        Rates are per machine at 100%, per minute. Alternates are unlocked with hard drives in game;
        ticking a recipe is a planning allowance, not an in-game unlock.
      </p>`,
    primary,
  );
}
