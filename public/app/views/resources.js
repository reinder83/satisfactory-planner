// Power & resources view for the original handbook.
import { esc, itemIcon, num, stat } from '../format.js';
import { doneAttr, plan, stage } from '../session.js';
import { header } from '../shell.js';

export function renderResources() {
  const raw = plan.resources[stage()],
    p = plan.plans[stage()];
  return (
    header(
      'CAPACITY BEFORE CONSTRUCTION',
      'Power & resources',
      'These are planned full-stage requirements, not live readings from your save. Mining totals already include retained turbofuel, trucks and all new power.',
    ) +
    `<div class="stats">${stat('Gross generation', num(plan.power[stage()]) + ' GW', 'At this stage’s completion')}${stat('Production peak', num(p.manufacturingPeakGW) + ' GW', 'Before the utility allowance')}${stat('Production average', num(p.manufacturingAvgGW) + ' GW', 'Half-consumption setting')}${stat('Coal remaining', num(74400 - raw.Coal) + '/min', 'Against all-pure mining limit')}</div>
 <div class="notice">Verify your randomized nitrogen wells can supply <b>${num(raw['Nitrogen Gas'] || 0)}/min</b> at this stage. The all-pure resource limits assume fully developed extraction and logistics. Additional completion modules are not included.</div>
 <div class="table-wrap"><table><thead><tr><th>Fresh resource</th><th>Required /min</th><th>Available /min</th><th>Remaining /min</th><th>Use</th></tr></thead><tbody>${Object.entries(
   raw,
 )
   .sort(([a], [b]) => a.localeCompare(b))
   .map(([n, q]) => {
     const cap = plan.capacities[n],
       fraction = cap ? q / cap : 0;
     return `<tr><td class="resource-name">${itemIcon(n)}<span>${esc(n)}</span></td><td class="number">${num(q)}</td><td class="number">${cap ? num(cap) : n === 'Water' ? 'Extraction limited' : 'Verify wells'}</td><td class="number ${cap && fraction > 0.9 ? 'warn' : ''}">${cap ? num(cap - q) : '—'}</td><td>${cap ? `${num(fraction * 100)}%<div class="resource-bar ${fraction > 0.9 ? 'tight' : ''}"><span style="width:${Math.min(100, fraction * 100)}%"></span></div>` : '—'}</td></tr>`;
   })
   .join(
     '',
   )}</tbody></table></div><p class="small muted">Crude availability counts 30 ordinary pure nodes; oil wells are additional. Water includes a 2,000/min reserve for retained turbofuel and resin processing.</p>
 <div class="backup-grid" style="margin-top:24px"><section class="panel"><h2>Power commissioning</h2><div class="checklist">${[['power-retained', 'Retained turbofuel: 44.425 GW'], ['power-rocket-1', 'Rocket-fuel block 1: +72 GW'], ['power-rocket-2', 'Rocket-fuel block 2: +72 GW'], ['power-u4', 'Phase 4 uranium: +125 GW'], ...Array.from({ length: 4 }, (_, i) => ['power-rocket-' + (i + 3), 'Rocket-fuel block ' + (i + 3) + ': +72 GW']), ['power-nuclear-final', 'Complete nuclear fleet: 437.5 GW total']].map(([id, title]) => `<label class="check-row"><input type="checkbox" data-check="${id}" ${doneAttr(id)}>${title}</label>`).join('')}</div></section>
 <section class="panel"><h2>One 72 GW rocket-fuel block</h2><p><b>Inputs/min:</b> 300 Crude, 800 Sulfur, 400 Coal, 600 Nitrogen and 1,000 Water.</p><p>10 Heavy Oil Residue refineries → 8 Diluted Fuel blenders → 8 Nitro Rocket Fuel blenders. Add 5 Residual Rubber refineries and 288 Fuel Generators at 100%.</p><p class="small muted">Produces 1,200 Rocket Fuel, 200 Compacted Coal and 100 Rubber/min. These byproducts are not credited against other factory contracts.</p><div class="notice blue">At Phase 5: (579.231 × 1.2 + 20) ÷ 0.8 ≈ <b>894 GW</b> preliminary requirement. Planned gross capacity: <b>913.925 GW</b>. Replace the 20 GW existing-load allowance with your measured load.</div></section></div>
 <section class="panel" style="margin-top:24px"><h2>Nuclear sequence</h2><p>Phase 4: 50 uranium reactors generate 500 waste/min. Process it into 2.5 Plutonium Fuel Rods/min and sink those rods.</p><p>Phase 5: 100 uranium reactors → 1,000 Uranium Waste/min → 5 Plutonium Fuel Rods/min → 50 plutonium reactors → 50 Plutonium Waste/min → 25 Ficsonium Fuel Rods/min → 25 Ficsonium reactors.</p><p class="small muted">Build downstream processing and burning capacity first. Final reactor cooling needs 42,000 Water/min, already included in the resource table. Keep radioactive buffers at the nuclear site.</p></section>`
  );
}
