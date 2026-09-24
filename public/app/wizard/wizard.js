// The five-step profile wizard ("All settings"): creating the draft, drawing
// each step, reading the form back into the draft, moving between steps and
// calculating the Review preview. The draft is the `wizard` object in
// session.js (set with setWizard). The guided start (guided.js) and the resource
// survey (extraction.js) edit the same draft and are drawn from renderWizard.
// Events: form submit is in events/profiles.js (Continue, and "Create profile"
// on step 5, which posts /api/profiles); step buttons are in events/views.js.
import { browserMode } from '../../browser-api.js';
import {
  distributions,
  droneFuels,
  GUIDED_TOPUP_RATE,
  powerOptions,
  purities,
  resourceDefaults,
  storageOptions,
  storageRateFor,
  wantsStorage,
} from '../../preferences.js';
import { carryOptions, pickedRecipeUnlocks } from '../../state.js';
import { allowSwitch, navigate, post, toast } from '../api.js';
import { $, esc, num } from '../format.js';
import { setWizard, wizard, workspace } from '../session.js';
import { header, render } from '../shell.js';
import { browserNotice } from '../views/backup.js';
import { draftOptions } from '../views/calculated.js';
import { renderExtraction } from './extraction.js';
import { field, help, option, power, selectField } from './fields.js';
import { guidedFlow, renderGuided } from './guided.js';
import { altPickerHtml } from './recipes.js';
import { fuelVerdictHtml, sloopLedgerHtml, supplyNoticeHtml } from './review.js';
import { readSupply, supplyRowsHtml } from './supply.js';

// Review step only, and only when adding a profile to a save that already has
// profiles. The checkboxes become wizard.carry (readCarry). Carrying copies: the
// create request names the source profile, and newProfileState (state.js) reads
// its records into the new profile's fresh state without writing to the source.
// Everything a new profile can inherit from the profile it continues, so a new
// plan for a save you already play does not start from an empty checklist.
function carryPanelHtml(w) {
  const save = workspace.saves.find(s => s.id === w.saveId);
  if (!save?.profiles.length) return '';
  const source = save.profiles.find(p => p.id === w.carryFrom) || save.profiles[0];
  const picks = w.carry || {},
    picked = pickedRecipeUnlocks(w.preview).length;
  return `<section class="panel carry-panel"><h3>Continue the progress in this save</h3><p>A new profile is a new plan for the same world, so it can start from what you have already done. Nothing is moved — the profile you carry from keeps all of it.</p><label class="field">Carry progress from <select name="carryFrom">${save.profiles.map(p => option(esc(p.id), esc(p.name), source.id)).join('')}</select></label><div class="carry-list">${carryOptions
    .filter(([key]) => key !== 'picked' || picked > 0)
    .map(
      ([key, label, detail]) =>
        `<label class="check-row"><input type="checkbox" name="carry" value="${key}" ${picks[key] ? 'checked' : ''}><span><b>${esc(label)}</b>${key === 'picked' ? ' (' + num(picked) + ')' : ''}<br><small class="muted">${esc(detail)}</small></span></label>`,
    )
    .join(
      '',
    )}</div><p class="small muted">Production lines this plan expands are carried unticked for review. Steps this plan does not contain stay with the profile you carried from.</p></section>`;
}

// Step 2. Inputs named "rate:<item>" become s.storageOverrides in readWizard;
// each placeholder shows the item's group rate, ignoring overrides.
// Per-item storage rates. Blank means "use the rate for its group", so the list
// stays readable at a glance: only the items you singled out carry a number.
function storageRatesHtml(s) {
  const items = (workspace.catalog.storageItems || []).filter(i => wantsStorage(i.name, s.storage));
  if (!items.length) return '';
  const over = s.storageOverrides || {},
    set = items.filter(i => over[i.name] !== undefined).length;
  return `<details class="panel rate-picker" ${set ? 'open' : ''}><summary>Per-item storage rates${set ? ' · ' + num(set) + ' set' : ''} ${help('storageOverrides')}</summary><p class="small muted">Leave a box blank to use the rate for its group. Enter <b>0</b> to keep an item’s container and address without reserving any production for it. Space Elevator parts start at 0: deliveries and later project parts already consume them, so a standing buffer would be production nobody draws from. ${num(items.length)} items are in your selected storage supply.</p><input id="rate-filter" type="search" placeholder="Filter by item…" aria-label="Filter storage items"><div class="rate-list">${items.map(i => `<label class="rate-row field" data-rate-text="${esc(i.name.toLowerCase())}" data-rate-group="${i.build ? 'build' : i.delivered ? 'delivered' : 'other'}"><span>${esc(i.name)}${i.build ? ' <small class="muted">· construction</small>' : i.delivered ? ' <small class="muted">· delivered</small>' : ''}</span><input name="rate:${esc(i.name)}" type="number" min="0" max="300" step="0.1" value="${over[i.name] ?? ''}" placeholder="${num(storageRateFor({ ...s, storageOverrides: {} }, i.name))}" aria-label="Storage refill for ${esc(i.name)} per minute"></label>`).join('')}</div></details>`;
}

// Copy the carry panel's choices into wizard.carryFrom / wizard.carry. Does
// nothing when the panel is not on screen. Also called by the create submit.
export function readCarry(form, data) {
  const w = wizard;
  if (!form?.querySelector('.carry-list')) return;
  const f = data || new FormData(form),
    on = new Set(f.getAll('carry').map(String));
  w.carryFrom = f.get('carryFrom') || null;
  w.carry = Object.fromEntries(carryOptions.map(([key]) => [key, on.has(key)]));
}

// Open a new draft and show it: saveId null creates a new save, otherwise the
// profile is added to that save. Callers: "Create a save" / "Try another
// profile" buttons (events/views.js) and session.js when there is no save yet.
export function startWizard(saveId = null) {
  if (!allowSwitch()) return;
  const existing = workspace.saves.find(s => s.id === saveId);
  const selected = existing?.profiles.find(p => p.id === existing.activeProfile);
  // A new profile for an existing save starts from its active profile's
  // settings (the workspace summary exposes plan.settings). The preserved
  // handbook profile ('original') has no calculated settings, so this literal
  // stands in for the handbook's own assumptions.
  const previous =
    selected?.settings ||
    (selected?.kind === 'original'
      ? {
          phase: '3',
          purity: 'pure',
          distribution: 'randomized',
          multiplier: 50,
          powerFactor: 0.5,
          availablePowerGW: 0,
          recipes: 'all',
          pureIngots: true,
          sam: 'needed',
          nuclear: 'recycle',
          uraniumReactors: 1,
          storage: 'all',
          storageRate: 1,
          cellsPerMinute: 20,
          goal: 'timed',
          hours: 8,
          roundRates: true,
          wholeMachines: true,
          limitsConfirmed: false,
          limits: { ...workspace.catalog.pureLimits },
        }
      : null);
  // The draft. Fields:
  //   step              five-step wizard position, 1-5 (5 = Review)
  //   saveId, saveName  target save (null = create one) and its name
  //   name              profile name; blank takes the goal's name on calculate
  //   settings          everything the planner calculates from; both the guided
  //                     questions and the five steps write it; sent to
  //                     /api/preview and /api/profiles
  //   preview           the last calculated plan, shown on Review; any form
  //                     read clears it. Creating the profile calculates again.
  //   carryFrom, carry  source profile id and carryOptions picks (Review panel)
  //   mode              'guided' | 'advanced' | 'extraction': which screen draws
  //   guidedStep, guidedAsk, tutorial  guided.js state; tutorial also feeds
  //                     guidedBuiltKeys and ada-panel.js
  //   usedGuided        set by toAdvanced; nothing reads it at present
  // Added later: supplyRows (supply.js) and extraction, extractionStep,
  // extractionReturn, extractionUndo (extraction.js).
  setWizard({
    step: 1,
    saveId,
    saveName: existing?.name || '',
    name: '',
    settings: previous
      ? structuredClone(previous)
      : {
          phase: '3',
          purity: 'vanilla',
          distribution: 'original',
          multiplier: 1,
          powerFactor: 1,
          availablePowerGW: 0,
          recipes: 'standard',
          pureIngots: false,
          sam: 'needed',
          nuclear: 'none',
          uraniumReactors: 1,
          storage: 'construction',
          storageRate: 1,
          cellsPerMinute: 0,
          goal: 'balanced',
          hours: 8,
          roundRates: true,
          wholeMachines: true,
          limitsConfirmed: false,
          limits: { ...workspace.catalog.limits },
        },
    preview: null,
    carryFrom: existing?.activeProfile || null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    // The guided start asks a handful of plain questions and writes the same
    // settings object; All settings is the wizard exactly as it was. A save you
    // already play arrives with settings worth keeping, so it is asked what
    // changed rather than everything again.
    mode: 'guided',
    guidedStep: 1,
    guidedAsk: null,
    usedGuided: false,
    tutorial: 'doing',
  });
  // Fresh settings only: Concrete starts pre-ticked as a guided top-up, and the
  // browser-only edition starts a fresh plan at Phase 1.
  if (!previous) wizard.settings.storageOverrides = { Concrete: GUIDED_TOPUP_RATE };
  if (browserMode && !previous) wizard.settings.phase = '1';
  navigate('wizard');
}

// HTML for the wizard view (shell.js calls it for #wizard). Delegates to the
// survey or the guided start when those are active; otherwise draws the current
// five-step screen inside #wizard-form. Every input's name is the key readWizard
// reads; where a label and a setting differ, readWizard does the conversion.
export function renderWizard() {
  if (!wizard)
    return (
      header('NEW PROFILE', 'Choose a save first') +
      '<button class="btn primary" data-new-save>Create a save</button><a class="btn" href="#profiles">Existing saves</a>'
    );
  const w = wizard,
    s = w.settings;
  let content = '';
  if (w.mode === 'extraction') return renderExtraction();
  // Past its last question (after calculating) the guided start shows this
  // wizard's Review, so both modes end on the same screen.
  if (w.mode === 'guided' && w.guidedStep <= guidedFlow().length) return renderGuided();
  // Step 1, game settings: save name (read-only when adding to a save), phase,
  // world settings, multipliers, power in MW (stored as GW) and existing supply.
  if (w.step === 1)
    content = `<h2>Your save and game settings</h2><p>Use the settings shown in your game. Values are multipliers: half consumption is 0.5.</p><div class="form-grid">${field('Save name', 'saveName', w.saveName, 'text', 'required maxlength="80" ' + (w.saveId ? 'readonly' : ''))}${selectField(
      'Currently working on',
      'phase',
      ['1', '2', '3', '4', '5'].map(x => [x, 'Phase ' + x]),
      s.phase,
    )}${selectField('Resource purity', 'purity', purities, s.purity)}${selectField('Node distribution', 'distribution', distributions, s.distribution)}${field('World seed (optional)', 'worldSeed', s.worldSeed || '', 'number', 'min="-2147483648" max="2147483647" step="1"')}${field('Elevator requirement multiplier', 'multiplier', s.multiplier, 'number', 'min="0.1" max="1000" step="0.1" required')}${field('Power consumption multiplier', 'powerFactor', s.powerFactor, 'number', 'min="0" max="10" step="0.1" required')}${field('Spare existing power (MW)', 'availablePowerMW', s.availablePowerGW * 1000, 'number', 'min="0" max="10000000" step="1" required')}${field('Total installed power (MW)', 'installedPowerMW', (s.installedPowerGW ?? s.availablePowerGW) * 1000, 'number', 'min="0" max="10000000" step="1" required')}${field('Other settings / mod notes', 'modNotes', s.modNotes || '', 'text', 'maxlength="500"')}</div><h3>Production you already run ${help('existingSupply')}</h3>${supplyRowsHtml(s)}<p class="small muted">Other settings are notes only. Modified recipes, production boosts and modded items are not simulated. Phase plans assume the necessary milestones and MAM research are unlocked by commissioning.</p>`;
  // Step 2, preferences: recipes, ingots, SAM, power and drone fuel, nuclear,
  // storage and refill rates, somersloops/augmenters, plus the ledger, per-item
  // storage rates and (for custom recipes) the alternate picker.
  if (w.step === 2)
    content = `<h2>How do you want to build?</h2><div class="form-grid">${selectField(
      'Recipe access',
      'recipes',
      [
        ['standard', 'Standard recipes'],
        ['all', 'Allow all alternate recipes as they become available'],
        ['custom', 'Pick specific alternate recipes'],
      ],
      s.recipes,
    )}${selectField(
      'Ingot factories',
      'pureIngots',
      [
        ['false', 'Let the planner choose'],
        ['true', 'Require pure ingot recipes when unlocked'],
      ],
      String(s.pureIngots),
    )}${selectField(
      'SAM resource conversion',
      'sam',
      [
        ['avoid', 'Avoid ore / gas conversion'],
        ['needed', 'Only to meet resource limits or improve maximum output'],
        ['allow', 'Allow whenever useful'],
      ],
      s.sam,
    )}${field('Extra utilities power (%)', 'utilityPercent', s.utilityPercent ?? 20, 'number', 'min="0" max="200" step="1" required')}${selectField(
      'Drone fuel',
      'droneFuel',
      droneFuels.map(n => [n, n === 'none' ? 'No dedicated drone fuel' : n]),
      s.droneFuel || 'none',
    )}${field('Drone fuel supply (items/min, entire fleet)', 'droneFuelRate', s.droneFuelRate ?? 10, 'number', 'min="0.01" max="10000" step="any" required')}${field('Phase 4 battery bridge /min (ionized fuel only)', 'droneBridgeRate', s.droneBridgeRate ?? 10, 'number', 'min="0.01" max="10000" step="any" required')}${selectField('Preferred main power', 'mainPower', powerOptions, s.mainPower || 'auto')}${selectField(
      'Nuclear goal',
      'nuclear',
      [
        ['none', 'No nuclear power'],
        ['sink', 'Uranium power; sink plutonium fuel rods'],
        ['recycle', 'Full waste recycling in Phase 5'],
      ],
      s.nuclear,
    )}${field('Minimum uranium reactors from Phase 4', 'uraniumReactors', s.uraniumReactors, 'number', 'min="1" max="1000" step="1" required')}${selectField('Storage supply', 'storage', storageOptions, s.storage)}${selectField(
      'Collectables storage',
      'collectables',
      [
        ['false', 'No collectables bays'],
        ['true', 'Include leaves, wood, slugs, food, protein and DNA'],
      ],
      String(s.collectables ?? s.storage === 'all'),
    )}${field('Construction materials refill /min', 'buildRate', s.buildRate ?? s.storageRate, 'number', 'min="0" max="300" step="0.1" required')}${field('Other items refill /min', 'storageRate', s.storageRate, 'number', 'min="0.1" max="300" step="0.1" required')}${field('Extra Singularity Cells /min in Phase 5', 'cellsPerMinute', s.cellsPerMinute, 'number', 'min="0" max="1000" step="0.1" required')}${field('Somersloops available to spend', 'somersloops', s.somersloops ?? 0, 'number', 'min="0" max="106" step="1" required')}${field('Alien Power Augmenters in Phase 5', 'augmenters', s.augmenters ?? 0, 'number', 'min="0" max="10" step="1" required')}${field('Of those, fueled with Alien Power Matrix', 'fueledAugmenters', s.fueledAugmenters ?? 0, 'number', 'min="0" max="10" step="1" required')}${field('Somersloops for production amplification', 'amplifySloops', s.amplifySloops ?? 0, 'number', 'min="0" max="106" step="1" required')}</div>${sloopLedgerHtml(s)}${storageRatesHtml(s)}${s.recipes === 'custom' ? altPickerHtml(s) : ''}<div class="notice blue">SAM conversion controls raw resource conversion, not SAM ingredients required by late-game parts. Pure recipes still need unlocking. Gathered items get storage positions but cannot have an unlimited automatic source.</div><p class="small muted">Each Main Portal consumes <b>2 Singularity Cells/min</b> to maintain its connection; the Satellite Portal does not consume cells. <b>10/min supplies five connections</b> (the standard recipe produces 10/min). Reserve portal operating power separately. <a href="https://satisfactory.wiki.gg/wiki/Portal" target="_blank" rel="noreferrer">Portal reference</a>. Nuclear waste and unpackaged fluids stay outside the storage room.</p>`;
  // Step 3, goal: goal cards (radio "goal"), profile name, hours, rounding and
  // whole machines. The two checkboxes are read only on this step.
  if (w.step === 3) {
    const recommended = s.multiplier > 5 ? 'timed' : 'balanced';
    content = `<h2>Choose your production goal</h2><p>${s.multiplier > 5 ? 'Your elevator multiplier makes completion time a useful starting point.' : 'Balanced progression is a practical starting point for these settings.'} Storage and your selected preferences apply to every option.</p><div class="goal-grid">${workspace.catalog.goals.map(g => `<label class="goal-card"><input type="radio" name="goal" value="${g.id}" ${s.goal === g.id ? 'checked' : ''}><strong>${g.name}</strong>${recommended === g.id ? '<span class="badge orange">Suggested</span>' : ''}<p>${g.description}</p></label>`).join('')}</div><div class="form-grid">${field('Profile name', 'profileName', w.name || workspace.catalog.goals.find(g => g.id === s.goal).name, 'text', 'required maxlength="80"')}${field('Hours per phase (target-time option)', 'hours', s.hours, 'number', 'min="0.25" max="2000" step="0.25" required')}${selectField(
      'Target time applies to',
      'phaseTime',
      [
        ['every', 'Every phase'],
        ['final', 'The final phase; earlier phases run as fast as their kept buildings allow'],
      ],
      s.phaseTime || 'every',
    )}</div><label class="check-row"><input type="checkbox" name="roundRates" ${s.roundRates ? 'checked' : ''}>Round delivery rates to convenient numbers (may change completion time)</label><label class="check-row"><input type="checkbox" name="wholeMachines" ${s.wholeMachines !== false ? 'checked' : ''}>Run solid-part machines at 100%; send surplus to storage, then the sink</label><p class="small muted">Inputs and byproducts are recalculated. Fluid, generator and nuclear/recycling lines may still need balancing. Recipe choices are selected first, then whole-machine counts are fitted within your budgets.</p><p class="small muted">Maximum output means fastest simultaneous elevator completion, within your resource budgets. It does not maximize sink points. Rounding is ignored for maximum output.</p>`;
  }
  // Step 4, resource budgets: one "limit:<resource>" box per raw resource, the
  // survey button and the limitsConfirmed box (needed for maximum output).
  if (w.step === 4)
    content = `<h2>Available resource budgets</h2><p><button type="button" class="btn primary" data-open-extraction>Work these out from my nodes →</button> <span class="small muted">Count what your world holds and the planner turns it into these rates.</span></p><p>Enter the extraction you can allocate to this new plan, per minute, after existing factories and power fuel. Starter values are full-map estimates at endgame extraction, not resources already connected.</p><div class="notice blue">${esc(resourceDefaults(s.purity, s.distribution).description)} ${s.worldSeed ? 'Recorded seed: ' + esc(s.worldSeed) + '. ' : ''}<a href="https://satisfactoryworldseed.com/" target="_blank" rel="noreferrer">Look up your seed totals</a> · <a href="https://satisfactory.wiki.gg/wiki/Resource_Node" target="_blank" rel="noreferrer">Node reference</a>. Resource-rich counts cannot be filled accurately without your seed: enter the lookup totals below. Oil-well extraction may be added after its unlock.</div><div class="resource-inputs">${workspace.catalog.raw.map(n => field(n, 'limit:' + n, s.limits[n], 'number', 'min="0" max="10000000" step="any" required')).join('')}</div><label class="check-row"><input name="limitsConfirmed" type="checkbox" ${s.limitsConfirmed ? 'checked' : ''}>I have checked these budgets for my save (required for maximum output)</label>`;
  // Step 5, Review: drawn from w.preview (never null here: moving to step 5
  // always calculates). Phases before the current one are left out. User text
  // (the profile name, phase reasons, warnings) goes through esc().
  if (w.step === 5) {
    const p = w.preview;
    content = `<h2>Review ${esc(w.name)}</h2><p>Nothing has been created yet. Your other profiles and their progress stay intact.</p><div class="table-wrap"><table><thead><tr><th>Phase</th><th>Delivery time</th><th>Buildings</th><th>New generation</th><th>Budget</th></tr></thead><tbody>${Object.entries(
      p.stages,
    )
      .filter(([ph]) => Number(ph) >= Number(p.settings.phase || 1))
      .map(
        ([ph, x]) =>
          `<tr><td>${ph}</td><td>${x.hours ? num(x.hours) + ' h' : '—'}${x.aheadOf !== undefined ? ` <span class="badge">was ${num(x.aheadOf)} h</span>` : ''}</td><td>${x.rows ? num(x.rows.reduce((a, r) => a + r.machines, 0)) : '—'}</td><td>${x.generationMW !== undefined ? power(x.generationMW) : '—'}</td><td>${x.feasible ? 'Within entered limits' : 'Needs adjustment'}</td></tr>`,
      )
      .join('')}</tbody></table></div>${supplyNoticeHtml(p)}${fuelVerdictHtml(p)}${Object.entries(
      p.stages,
    )
      .filter(([ph, x]) => !x.feasible && Number(ph) >= Number(p.settings.phase || 1))
      .map(
        ([ph, x]) =>
          `<div class="notice"><b>Phase ${ph}:</b> ${esc(x.reason)}${draftOptions(x, p.settings)}</div>`,
      )
      .join(
        '',
      )}<details class="panel"><summary>Assumptions and calculation limits</summary>${p.warnings.map(x => `<p class="small">${esc(x)}</p>`).join('')}</details><p class="small muted">You can save a plan that exceeds your budgets as a planning draft; its affected phases remain clearly flagged. Profiles are calculated snapshots. Create another profile to compare different settings.</p>${carryPanelHtml(w)}`;
  }
  return (
    (browserMode ? browserNotice() : '') +
    header(
      'SAVE → SETTINGS → GOALS → PLAN',
      w.saveId ? 'Add a profile to ' + esc(w.saveName) : 'Create your factory plan',
    ) +
    `<div class="wizard-progress">${['Game settings', 'Preferences', 'Goals', 'Resources', 'Review'].map((n, i) => `<button type="button" class="${w.step === i + 1 ? 'current' : ''}" data-wizard-step="${i + 1}" ${w.step === i + 1 ? 'aria-current="step"' : ''}>${i + 1}. ${n}</button>`).join('')}</div><form id="wizard-form" class="panel wizard-panel">${content}<div class="wizard-actions"><button type="button" class="btn" ${w.step === 1 ? 'data-cancel-wizard' : 'data-wizard-back'}>${w.step === 1 ? 'Cancel' : 'Back'}</button><span class="guided-escape">${w.step < 5 ? '<button type="button" class="btn quiet" data-guided-start>← Guided start</button>' : ''}<button class="btn primary" type="submit">${w.step === 5 ? 'Create profile' : w.step === 4 ? 'Calculate plan' : 'Continue →'}</button></span></div><p id="wizard-error" class="form-error" role="alert"></p></form>`
  );
}

// Copy the five-step form on screen into the draft (all steps share this one
// reader; each only finds its own fields). Mutates wizard and wizard.settings
// and clears the preview. Does not re-render.
export function readWizard(form) {
  const f = new FormData(form),
    w = wizard,
    s = w.settings,
    oldPreset = s.purity + '|' + s.distribution;
  // Name -> setting: MW fields are stored as GW, saveName/profileName go on the
  // draft, "limit:<r>" into s.limits, then numeric, boolean and text settings.
  // Other names (carry, alt, rate:, supply rows, sloop) are handled below.
  for (const [k, v] of f) {
    if (k === 'availablePowerMW') s.availablePowerGW = Number(v) / 1000;
    if (k === 'installedPowerMW') s.installedPowerGW = Number(v) / 1000;
    if (k === 'saveName') w.saveName = v;
    if (k === 'profileName') w.name = v;
    else if (k.startsWith('limit:')) s.limits[k.slice(6)] = Number(v);
    else if (
      [
        'utilityPercent',
        'droneFuelRate',
        'droneBridgeRate',
        'multiplier',
        'powerFactor',
        'availablePowerGW',
        'uraniumReactors',
        'storageRate',
        'buildRate',
        'cellsPerMinute',
        'somersloops',
        'augmenters',
        'fueledAugmenters',
        'amplifySloops',
        'hours',
      ].includes(k)
    )
      s[k] = Number(v);
    else if (k === 'collectables') s.collectables = v === 'true';
    else if (k === 'pureIngots') s[k] = v === 'true';
    else if (
      [
        'phase',
        'purity',
        'distribution',
        'recipes',
        'sam',
        'nuclear',
        'storage',
        'goal',
        'phaseTime',
        'modNotes',
        'mainPower',
        'worldSeed',
        'droneFuel',
      ].includes(k)
    )
      s[k] = v;
  }
  if (form.querySelector('[name=sloop]')) s.sloopReserved = f.getAll('sloop').map(String);
  if (form.querySelector('.alt-list')) {
    s.alternateRecipes = f.getAll('alt').map(String);
    s.preferredRecipes = f
      .getAll('altpref')
      .map(String)
      .filter(id => s.alternateRecipes.includes(id));
  }
  {
    const supply = readSupply(form, f);
    if (supply) s.existingSupply = supply;
  }
  if (form.querySelector('.rate-list')) {
    const over = {};
    for (const [k, v] of f)
      if (k.startsWith('rate:') && String(v).trim() !== '' && Number.isFinite(Number(v)))
        over[k.slice(5)] = Number(v);
    s.storageOverrides = over;
  }
  // An unticked checkbox is absent from FormData, so these are read only on the
  // step that draws them, or leaving another step would clear them.
  if (w.step === 3) {
    s.roundRates = f.has('roundRates');
    s.wholeMachines = f.has('wholeMachines');
  }
  if (w.step === 4) s.limitsConfirmed = f.has('limitsConfirmed');
  readCarry(form, f);
  // Changing purity or distribution on step 1 replaces the budgets with that
  // world's starting estimates, which then need confirming again.
  if (w.step === 1 && oldPreset !== s.purity + '|' + s.distribution) {
    s.limits = resourceDefaults(s.purity, s.distribution).limits;
    s.limitsConfirmed = false;
  }
  w.preview = null;
}

// True while calculateWizard runs; the move functions here, in guided.js and in
// extraction.js ignore clicks meanwhile, so a second request cannot start.
export let wizardBusy = false;

// The public edition reports each phase from the calculator worker; the server edition shows the static label.
// Returns the options object for post(): relabels `button` now and on progress.
export const calcProgress = (button, label) => {
  if (button) button.textContent = label;
  return {
    onProgress: phase => {
      if (button) button.textContent = `${label} Phase ${phase} of 5…`;
    },
  };
};

// Show a failed calculation or create in the form's error line (a toast when
// there is none). A timeout gets suggestions; the message itself is escaped.
export function wizardError(form, err) {
  const el = form?.querySelector('.form-error');
  if (!el) {
    toast(err.message, true);
    return;
  }
  if (/timed out/i.test(err.message))
    el.innerHTML = `${esc(err.message)}<span class="error-options"><b>Ways to get a plan:</b><span>Try again — speed varies with your device and other open tabs.</span><span>In the recipe picker, use <b>Planner’s choice</b> or untick alternates you don’t need; many recipes for the same product slow the search the most.</span><span>In Goals, turn off whole-machine production — exact balancing calculates much faster.</span><span>Lower the elevator multiplier or allow more hours per phase.</span></span>`;
  else el.textContent = err.message;
}

// Go to step `target` (1-5): read the form first, validating only when moving
// forward. Reaching step 5 always recalculates the preview.
export async function moveWizard(target) {
  if (wizardBusy || !wizard || target === wizard.step || target < 1 || target > 5) return;
  const form = $('#wizard-form');
  if (target > wizard.step && !form.reportValidity()) return;
  readWizard(form);
  if (target !== 5) {
    wizard.step = target;
    render();
    return;
  }
  await calculateWizard(form);
}

// Shared by both modes: the guided questions and the five-step wizard reach the
// same Review with the same settings, so they calculate through one path.
// Posts the settings to /api/preview (server, or the browser worker in the
// Pages edition), stores the result as wizard.preview and shows Review. All
// step and submit buttons are disabled meanwhile; on failure the draft stays
// where it was and the error is shown in the form.
export async function calculateWizard(form) {
  wizardBusy = true;
  const buttons = document.querySelectorAll(
    '[data-wizard-step],[data-guided-advanced],#wizard-form button',
  );
  buttons.forEach(b => (b.disabled = true));
  const submit = form?.querySelector('button[type="submit"]'),
    label = submit?.textContent;
  try {
    wizard.name =
      wizard.name.trim() || workspace.catalog.goals.find(g => g.id === wizard.settings.goal).name;
    wizard.preview = await post(
      '/api/preview',
      { settings: wizard.settings },
      true,
      calcProgress(submit, 'Calculating…'),
    );
    wizard.step = 5;
    wizard.guidedStep = guidedFlow().length + 1;
    render();
  } catch (err) {
    wizardError(form, err);
    if (submit) submit.textContent = label;
  } finally {
    wizardBusy = false;
    buttons.forEach(b => (b.disabled = false));
  }
}
