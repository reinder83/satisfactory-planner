// Resource survey: node counts, presets and extraction budgets. Opened from
// wizard step 4 ("Work these out from my nodes"), it takes over the screen by
// setting wizard.mode = 'extraction'; renderWizard then hands rendering here.
// Draft fields it adds to `wizard`: extraction (the survey being edited),
// extractionStep (1-4), extractionReturn (where to go back to) and
// extractionUndo (the counts before "Reset all counts"). Button and change
// handlers are in events/views.js; form submit is in events/profiles.js.
import { browserMode } from '../../browser-api.js';
import {
  blankCounts,
  blankExtraction,
  clockChoices,
  distributions,
  extractionLimits,
  knownWorld,
  matchingPreset,
  minedResources,
  minerMarks,
  nodePresets,
  nodeYield,
  presetPurities,
  purities,
  purities3,
  resourcePool,
  richShape,
  startingSurvey,
  wellYield,
} from '../../preferences.js';
import { toast } from '../api.js';
import { $, itemIcon, num } from '../format.js';
import { html, raw } from '../html.js';
import { wizard, workspace } from '../session.js';
import { browserNotice, header, render } from '../shell.js';
import { help, selectField } from './fields.js';
import { readGuidedForm } from './guided.js';
import { readWizard, wizardBusy } from './wizard.js';

// --- Working out the resource budgets ---------------------------------------
// The thirteen budget boxes want a rate per minute, which nobody knows. What a
// player can actually read off the interactive map is how many impure, normal
// and pure nodes their world holds, so this asks for that and does the
// arithmetic. It writes the same `limits` the boxes write; the survey itself is
// kept on the profile only so it can be reopened and adjusted.
//
// Four short screens rather than one long one: where the numbers come from and
// how you mine, then the ores, then oil and gas, then the total with whatever
// is already spoken for taken off it.
const EXTRACTION_STEPS = ['How you mine', 'Ore nodes', 'Resource wells', 'Your budgets'];

const MAP_URL = 'https://satisfactory-calculator.com/en/interactive-map';

// The survey being edited, created on first use: a copy of the one saved on the
// settings, or a starting survey for the chosen world settings. Its shape is
// { mark, clock, nodes: { ore: { impure, normal, pure } }, wells: {...}, used }.
// Cached on the draft, so an unapplied survey is still there when reopened.
export function extractionOf(w) {
  if (!w.extraction)
    w.extraction = w.settings.extraction
      ? structuredClone(w.settings.extraction)
      : startingSurvey(w.settings);
  return w.extraction;
}

// The impure/normal/pure inputs for one resource. Input names are
// "node:<name>:<purity>" or "well:<name>:<purity>", parsed by readExtraction.
const countRow = (kind, name, counts) =>
  purities3.map(
    ([key, label]) =>
      html`<label class="field count-cell"
        ><span>${label}</span
        ><input
          name="${kind}:${name}:${key}"
          type="number"
          min="0"
          max="10000"
          step="1"
          value="${counts[key] || 0}"
          aria-label="${label} ${name} ${kind === 'well' ? 'well satellites' : 'nodes'}"
      /></label>`,
  );

// A table of count rows with each resource's resulting rate per minute.
// `kind` is 'node' (ores, crude oil nodes) or 'well' (resource-well satellites).
function extractionTableHtml(kind, names, e) {
  const map = kind === 'well' ? e.wells : e.nodes;
  return html`<div class="count-table">
    ${names.map(name => {
      const counts = { ...blankCounts(), ...(map[name] || {}) };
      const total =
        kind === 'well'
          ? purities3.reduce((a, [k]) => a + (Number(counts[k]) || 0) * wellYield(k, e), 0)
          : purities3.reduce((a, [k]) => a + (Number(counts[k]) || 0) * nodeYield(name, k, e), 0);
      return html`<div class="count-row">
        <span class="count-name">${itemIcon(name)}<span>${name}</span></span>
        ${countRow(kind, name, counts)}
        <span class="count-total">${total ? num(Math.round(total)) + '/min' : '—'}</span>
      </div>`;
    })}
  </div>`;
}

// The two World Randomization settings, exactly as the game presents them.
// They are on All settings step 1 too — this is the same pair, shown here
// because here is where they decide what the counts should be.
const presetBarHtml = () => {
  const s = wizard.settings,
    e = extractionOf(wizard);
  const known = knownWorld(s.purity, s.distribution);
  // Random is a shuffle: it moves nodes but not how many of each resource there
  // are. So it costs us only the purity split, and only for the settings that
  // keep the map's own split.
  const splitShuffled =
    s.distribution === 'randomized' && !known && presetPurities.includes(s.purity);
  const active = matchingPreset(e);
  const label = (nodePresets.find(([v]) => v === active) || [, ''])[1];
  const shuffleNote =
    s.distribution === 'randomized'
      ? ' Random moves nodes around the map; as far as the community has established, it does not change how many of each resource there are. Nitrogen wells are left for you: a well is randomized whole and the map’s wells hold different numbers of satellites, so a shuffle can still leave you more or less nitrogen than the default map.'
      : '';
  let status;
  if (known && active === s.purity)
    status = html`<p class="small">
      The counts below are the map's node totals at <b>${label}</b>.${shuffleNote} Change any that
      do not match your save.
    </p>`;
  else if (known)
    status = html`<p class="small">
      Your world's node counts are known for these settings.
      <button type="button" class="btn quiet" data-node-preset="${s.purity}">
        Fill in the counts below
      </button>
    </p>`;
  else if (splitShuffled)
    status = html`<div class="notice">
      <b>Only the purity split is missing.</b> Random shuffles which resource sits at each location,
      so your world holds the same number of nodes for each resource as the default map — but it
      shuffles their purities too, and
      <b>${(purities.find(([v]) => v === s.purity) || [, ''])[1]}</b> keeps whatever split the
      shuffle produced. How many are impure, normal and pure is therefore yours to count. If you
      actually chose All Pure, Average or All Impure, pick that above and the counts fill
      in.${active &&
      html` The counts below are still the map's totals at <b>${label}</b> — the totals are right,
        the split is not.`}
    </div>`;
  else
    status = html`<div class="notice">
      <b>No preset for these settings.</b>
      ${richShape[s.distribution]
        ? html`A resource-rich distribution changes how many nodes each resource has, and the
          players who have counted these worlds get answers a third apart from one seed to the next
          — so filling anything in here would be a guess wearing a number.
          ${richShape[s.distribution]} Which way it goes is consistent; how far is not.`
        : 'A random or hand-set purity has no fixed split to rearrange.'}
      Count yours on the map linked on the first screen, or upload your save there and it will count
      them for
      you.${active &&
      html` The counts below are still the <b>map's totals at ${label}</b>, so check them against
        your save.`}
    </div>`;
  return html`<div class="node-presets">
    <span class="eyebrow">Your world settings ${help('nodePresets')}</span>
    <div class="form-grid">
      ${selectField('Resource node randomization', 'distribution', distributions, s.distribution)}
      ${selectField('Resource node purity', 'purity', purities, s.purity)}
    </div>
    ${status}
    <p class="small">
      ${wizard.extractionUndo
        ? html`<button type="button" class="btn quiet" data-node-undo>Undo reset</button>
            <span class="muted"
              >Every count was cleared. This puts back what was there before.</span
            >`
        : html`<button type="button" class="btn quiet" data-node-reset>
              Reset all counts to zero
            </button>
            <span class="muted"
              >Clears every ore, well and committed amount so you can enter your own. You can undo
              it.</span
            >`}
    </p>
    <p class="small muted">
      The purity settings do not move nodes or add any, they shift every node up or down the purity
      scale, so a known purity is the known node count rearranged. Oil wells are not in that table —
      count those yourself.
    </p>
  </div>`;
};

// Back to an empty survey. Every count goes, including what was already
// committed; the miner mark and clock stay, because they are equipment rather
// than counts and have no meaningful zero. The old counts are kept aside so the
// clearing can be undone, which is why no confirmation is asked for.
export function resetExtraction() {
  const previous = extractionOf(wizard);
  wizard.extractionUndo = JSON.parse(JSON.stringify(previous));
  wizard.extraction = { ...blankExtraction(), mark: previous.mark, clock: previous.clock };
}

// Put back the counts resetExtraction set aside; offered until the survey closes.
export function undoExtractionReset() {
  if (!wizard.extractionUndo) return;
  wizard.extraction = wizard.extractionUndo;
  wizard.extractionUndo = null;
}

// HTML for the survey screen at wizard.extractionStep. It reuses the
// #wizard-form id, so the shared submit handler advances it (moveExtraction).
export function renderExtraction() {
  const w = wizard,
    e = extractionOf(w),
    step = w.extractionStep;
  const content = [minersScreen, oresScreen, wellsScreen, budgetsScreen][step - 1]?.(w, e);
  const last = step >= EXTRACTION_STEPS.length;
  return String(
    html`${browserMode && browserNotice()}
      ${header(
        'YOUR WORLD',
        'Work out your resource budgets',
        'Count what your world holds; the planner turns it into the rates it plans against.',
      )}
      <div class="wizard-progress">
        ${EXTRACTION_STEPS.map(
          (n, i) =>
            html`<button
              type="button"
              class="${step === i + 1 ? 'current' : ''}"
              data-extraction-step="${i + 1}"
              ${step === i + 1 && raw('aria-current="step"')}
            >
              ${i + 1}. ${n}
            </button>`,
        )}
      </div>
      <form id="wizard-form" class="panel wizard-panel extraction-panel">
        ${content}
        <div class="wizard-actions">
          <button type="button" class="btn" data-extraction-back>
            ${step <= 1 ? 'Cancel' : 'Back'}
          </button>
          <span class="guided-escape"
            >${step > 1 &&
            html`<button type="button" class="btn quiet" data-extraction-cancel>
              Leave these budgets alone
            </button>`}
            <button class="btn primary" type="submit">
              ${last ? 'Use these budgets' : 'Continue →'}
            </button></span
          >
        </div>
        <p id="wizard-error" class="form-error" role="alert"></p>
      </form>`,
  );
}

// Screen 1: where to find counts, plus miner mark and clock speed.
function minersScreen(w, e) {
  const sample = (name, purity) => num(Math.round(nodeYield(name, purity, e)));
  return html`<h2>Where your numbers come from</h2>
    <div class="notice blue">
      <b>You do not have to count nodes by hand.</b> Open the
      <a href="${MAP_URL}" target="_blank" rel="noreferrer"
        >Satisfactory Calculator interactive map</a
      >, upload your save file there, and it lists every resource node your world holds — including
      which are impure, normal and pure, and which resource wells you have found. Copy those counts
      into the next two screens.
      <p class="small">
        Uploading a save to that site is your decision and happens entirely between you and them;
        this planner never sends your save anywhere. If you would rather not, the map also works
        without a save and shows the default world's nodes.
      </p>
    </div>
    <h2>How you will mine them</h2>
    <p>
      Extraction depends on the miner and its clock speed far more than on anything else. Plan for
      the miner this phase can build and power, not the one you happen to have running today.
    </p>
    <div class="form-grid">
      ${selectField(
        'Miner',
        'mark',
        minerMarks.map(([v, l]) => [String(v), l]),
        String(e.mark),
      )}
      ${selectField(
        'Clock speed',
        'clock',
        clockChoices.map(([v, l]) => [String(v), l]),
        String(e.clock),
      )}
    </div>
    <div class="notice">
      <b>At these settings</b> one iron node gives ${sample('Iron Ore', 'impure')}/min impure,
      ${sample('Iron Ore', 'normal')}/min normal and ${sample('Iron Ore', 'pure')}/min pure. A crude
      oil node gives ${sample('Crude Oil', 'normal')}/min normal, and one resource-well satellite
      ${num(Math.round(wellYield('normal', e)))}/min.
    </div>`;
}

// Screen 2: world settings/presets and the ore node counts.
function oresScreen(w, e) {
  return html`<h2>Your ore nodes</h2>
    ${presetBarHtml()}
    <p>
      How many nodes of each purity your world holds for each ore. ${help('extractionNodes')} Zero
      means zero: a purity your world has none of, or an ore you have not found. Whatever you leave
      at zero, the plan cannot mine — so enter everything you intend to work.
    </p>
    ${extractionTableHtml('node', minedResources, e)}`;
}

// Screen 3: crude oil nodes and resource-well satellites (oil, nitrogen).
function wellsScreen(w, e) {
  return html`<h2>Resource wells</h2>
    ${presetBarHtml()}
    <p>
      Crude oil comes from ordinary nodes and from resource wells; nitrogen only from wells.
      ${help('extractionWells')}
    </p>
    <h3>Crude oil nodes</h3>
    ${extractionTableHtml('node', ['Crude Oil'], e)}
    <h3>Resource well satellites</h3>
    ${extractionTableHtml('well', ['Crude Oil', 'Nitrogen Gas'], e)}
    <div class="notice blue">
      ${itemIcon('Water')} <b>Water is not counted.</b> Extractors sit on any lake or ocean and
      there is far more coastline than a factory can draw on, so a node count would be a fiction.
      The planner keeps its standing water allowance of ${num(w.settings.limits.Water)}/min, which
      you can still change in All settings if you want to model a genuinely constrained site.
    </div>`;
}

// Screen 4: pool minus "already committed" per resource, i.e. the budgets.
function budgetsScreen(w, e) {
  const rows = [...minedResources, 'Crude Oil', 'Nitrogen Gas'];
  // Leaving a resource at zero is a legitimate answer, and it is also exactly
  // what a half-finished survey looks like. The plan that follows would simply
  // fail to fit, so name them here rather than let that be a surprise.
  const empty = rows.filter(n => resourcePool(e, n) <= 0);
  return html`<h2>Your budgets</h2>
    <p>
      What those nodes yield, less anything already committed to factories this plan does not
      include. That deduction is what makes a budget mean <em>free for this plan to use</em>.
      ${help('extractionUsed')}
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Whole pool /min</th>
            <th>Already committed /min</th>
            <th>Budget /min</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(name => {
            const pool = Math.round(resourcePool(e, name)),
              used = Number(e.used?.[name]) || 0,
              left = Math.max(0, pool - used);
            return html`<tr>
              <td class="resource-name">${itemIcon(name)}<span>${name}</span></td>
              <td class="number">${pool ? num(pool) : '—'}</td>
              <td>
                <input
                  class="used-input"
                  name="used:${name}"
                  type="number"
                  min="0"
                  max="10000000"
                  step="any"
                  value="${used || ''}"
                  placeholder="0"
                  aria-label="${name} already committed per minute"
                />
              </td>
              <td class="number ${pool && used > pool ? 'warn' : ''}">${pool ? num(left) : '—'}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    ${empty.length > 0 &&
    html`<div class="notice">
      <b
        >${empty.length === 1 ? 'One resource has' : num(empty.length) + ' resources have'} no nodes
        entered:</b
      >
      ${empty.join(', ')}. A zero budget means this plan may not use that resource at all — a fine
      answer for something you have genuinely not found, but if you simply have not counted them
      yet, go back and fill them in or the plan will not fit.
    </div>`}
    <p class="small muted">
      Production you already run is a different question, asked separately: that one credits
      finished parts, this one takes raw extraction off the top. Use this for ore feeding factories
      the plan will not rebuild, and the other for parts the plan would otherwise make again.
    </p>`;
}

// Every screen writes straight into the survey, so moving between them keeps
// what was typed even before the budgets are applied.
// Exception: purity and distribution are the step 1 settings themselves, so they
// are written to wizard.settings at once, even if the survey is left unapplied.
// Counts are whole and non-negative; an all-zero row is dropped from the map.
export function readExtraction(form) {
  const w = wizard,
    e = extractionOf(w),
    f = new FormData(form);
  const raw = new Set(workspace.catalog.raw || []);
  for (const [k, v] of f) {
    if (k === 'purity' || k === 'distribution') w.settings[k] = String(v);
    else if (k === 'mark') e.mark = Number(v);
    else if (k === 'clock') e.clock = Number(v);
    else if (k.startsWith('node:') || k.startsWith('well:')) {
      const [kind, name, purity] = k.split(':');
      if (!raw.has(name) || !purities3.some(([p]) => p === purity)) continue;
      const map = kind === 'well' ? (e.wells ??= {}) : (e.nodes ??= {});
      const row = map[name] || blankCounts();
      row[purity] = Math.max(0, Math.floor(Number(v) || 0));
      if (row.impure || row.normal || row.pure) map[name] = row;
      else delete map[name];
    } else if (k.startsWith('used:')) {
      const name = k.slice(5);
      if (!raw.has(name)) continue;
      const q = Number(v);
      if (String(v).trim() !== '' && Number.isFinite(q) && q > 0) (e.used ??= {})[name] = q;
      else delete e.used?.[name];
    }
  }
}

// Go to survey screen `target`. Below 1 leaves without applying; past the last
// screen applies the survey to settings.limits and leaves.
export async function moveExtraction(target) {
  const w = wizard,
    form = $('#wizard-form');
  if (wizardBusy || !w || target === w.extractionStep) return;
  if (form && target > w.extractionStep && !form.reportValidity()) return;
  if (form) readExtraction(form);
  if (target < 1) {
    leaveExtraction();
    return;
  }
  if (target <= EXTRACTION_STEPS.length) {
    w.extractionStep = target;
    render();
    return;
  }
  // Applying the survey replaces the budgets and the confirmation that went with
  // them: these are counted numbers now, not the starting estimates.
  w.settings.limits = extractionLimits(w.extraction, w.settings.limits);
  w.settings.extraction = structuredClone(w.extraction);
  w.settings.limitsConfirmed = true;
  w.preview = null;
  leaveExtraction();
  toast('Resource budgets set from your nodes. You can still edit any of them in All settings.');
}

// Back to whatever opened the survey, with the five-step wizard as the default.
export function leaveExtraction() {
  const w = wizard;
  w.mode = w.extractionReturn?.mode || 'advanced';
  w.step = w.extractionReturn?.step || 4;
  if (w.extractionReturn?.guidedStep) w.guidedStep = w.extractionReturn.guidedStep;
  w.extractionReturn = null;
  w.extractionUndo = null;
  render();
}

// Start the survey: read the current form into the draft first, and remember
// where we came from so leaveExtraction can return there.
export function openExtraction() {
  const w = wizard,
    form = $('#wizard-form');
  if (form) w.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
  w.extractionReturn = { mode: w.mode, step: w.step, guidedStep: w.guidedStep };
  w.mode = 'extraction';
  w.extractionStep = 1;
  render();
}
