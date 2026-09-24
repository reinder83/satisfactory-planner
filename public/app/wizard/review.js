// Review step notices: somersloops, supply and fuel.
import { esc, itemIcon, num } from '../format.js';
import { workspace } from '../session.js';
import { power } from './fields.js';

// The somersloop ledger. Augmenters and their fuel change the calculation; the hand-fed lines
// do not — their inputs are gathered, never belted — so those only reserve sloops and add steps.
export function sloopLedgerHtml(s) {
  const uses = workspace.catalog.sloopUses || [],
    reserved = s.sloopReserved || [];
  const committed = 10 * (s.augmenters || 0) + reserved.length + (s.amplifySloops || 0),
    have = s.somersloops || 0;
  const boost = Math.round(
    (0.1 * ((s.augmenters || 0) - (s.fueledAugmenters || 0)) + 0.3 * (s.fueledAugmenters || 0)) *
      100,
  );
  return `<div class="notice blue"><b>Somersloop ledger.</b> ${s.augmenters || 0 ? `${s.augmenters} augmenter${s.augmenters > 1 ? 's' : ''} cost ${10 * s.augmenters} sloops and give Phase 5 ${num(500 * s.augmenters)} MW plus a ${boost}% multiplier on the grid's base production. ${s.fueledAugmenters || 0 ? `Fueling ${s.fueledAugmenters} of them adds ${num(5 * s.fueledAugmenters)} Alien Power Matrix/min to the plan — the rate is derived here, never entered.` : 'Unfueled augmenters need no Alien Power Matrix.'}` : 'Enter augmenters to include their power in Phase 5.'} Committed: <b>${committed}</b> of ${have} available.${committed > have ? ' <span class="warn">More than you have.</span>' : ''}</div>
 ${s.amplifySloops || 0 ? `<p class="small muted">Production amplification will place up to ${num(s.amplifySloops)} somersloops in this plan's own machines. An amplified machine keeps its inputs, doubles its output and draws four times the power, so it trades power for ore and buildings. The budget applies to each phase's plan rather than adding up across phases, because every phase is a self-contained steady state.</p>` : `<p class="small muted">Production amplification is off. Somersloops in your production lines cut ore and buildings, but finding and reaching them is a hunt — leave this at 0 to plan without it, exactly as before.</p>`}
 <p class="eyebrow">SOMERSLOOPS PARKED IN HAND-FED LINES</p>
 <div>${uses.map(([id, label]) => `<label class="check-row"><input type="checkbox" name="sloop" value="${id}" ${reserved.includes(id) ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>
 <p class="small muted">These double the output of a finite, hand-gathered input, so they are usually the best sloop you will ever spend: the world's power slugs are worth twice as many Power Shards through an amplified Constructor. Their inputs are carried in by hand, so they stay out of the production balance and only reserve a sloop and add a checklist step. The Crafting Bench cannot be amplified — the constructor recipe is the one that doubles.</p>`;
}

// What the plan actually drew from the production you already run. It asks for
// at most what you declared: the rest of that line's output is yours, and the
// plan neither needs nor counts it.
export function supplyNoticeHtml(p) {
  const declared = p.settings?.existingSupply || {};
  if (!Object.keys(declared).length) return '';
  const start = Number(p.settings.phase || 1);
  const used = {};
  for (const [ph, st] of Object.entries(p.stages))
    if (Number(ph) >= start)
      for (const [n, q] of Object.entries(st.supplied || {})) used[n] = Math.max(used[n] || 0, q);
  const dropped = Object.entries(p.stages)
    .filter(([ph, st]) => st.supplyDropped && Number(ph) >= start)
    .map(([ph]) => ph);
  const lines = Object.entries(declared)
    .map(([n, q]) => {
      const drawn = used[n] || 0;
      return `<li>${itemIcon(n)}<span><b>${esc(n)}</b> ${num(q)}/min declared${drawn > 0.002 ? ` · the plan draws up to ${num(drawn)}/min of it, and builds no line for it` : ' · this plan has no use for it, so nothing changes'}</span></li>`;
    })
    .join('');
  return `<div class="notice blue supply-notice"><b>Crediting production you already run.</b> These lines are not planned again, and neither is the chain behind them.
 <ul class="supply-summary">${lines}</ul>
 <p class="small">Their ore and their power are already spent in your world, so the resource budgets and the spare-power figure should be entered net of them — the same rule that makes "spare existing power" spare.</p>
 ${dropped.length ? `<p class="small"><b>Phase ${dropped.join(' and ')}</b> could not be fitted to whole machines while crediting them, so ${dropped.length > 1 ? 'those phases are' : 'that phase is'} planned as if you built all of it yourself. Nothing is lost — the plan is simply the larger one. Exact ratios instead of whole machines usually keeps the credit.</p>` : ''}</div>`;
}

// Fueling an augmenter trades an Alien Power Matrix line for 20% more grid power. The answer
// depends on the plan's own scale, so show the like-for-like comparison rather than a rule of thumb.
export function fuelVerdictHtml(p) {
  const v = p.stages?.[5]?.fuelVerdict;
  if (!v) return '';
  if (!v.unfueledFeasible)
    return `<div class="notice blue"><b>Fueled augmenters are carrying this plan.</b> Phase 5 does not fit its budgets without them, so the ${num(v.matrixRate)} Alien Power Matrix/min is doing real work.</div>`;
  const worth = v.worthIt,
    delta = v.buildings - v.buildingsUnfueled;
  return `<div class="notice ${worth ? 'blue' : ''}"><b>${worth ? 'Fueling these augmenters pays off.' : 'Fueling these augmenters costs more than it returns.'}</b>
 Producing ${num(v.matrixRate)} Alien Power Matrix/min takes Phase 5 from ${num(v.buildingsUnfueled)} buildings to ${num(v.buildings)} (${delta > 0 ? '+' : ''}${num(delta)}) and from ${power(v.requiredMWUnfueled)} to ${power(v.requiredMW)} of demand, while the boost raises available power from ${power(v.availableMWUnfueled)} to ${power(v.availableMW)}.
 ${worth ? 'The extra 20% is worth more than the fuel line costs at this scale.' : `At this scale the fuel line costs more than the extra 20% returns. Build the augmenter${p.settings.augmenters > 1 ? 's' : ''} unfueled, or put 4 somersloops in the Alien Power Matrix encoder — that halves the whole chain behind it and moves the break-even down.`}</div>`;
}
