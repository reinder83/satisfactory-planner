// The plan's warnings: plain sentences, one group after another (WARNING_GROUPS).
// Re-exported by ../planner.ts.
import { durationOfHours, listNames } from '../public/wording.ts';
import type {
  CurrentSettings,
  CalcRow,
  CurrentStage,
  FractionalAfterStop,
  ItemRates,
  StageKey,
} from '../public/types/index.ts';
import { DATA, RAW, exactBalance } from './data.ts';
import { exactClockLine, roundsToWholeMachines } from './model.ts';
import { productRate } from './rounding.ts';
import { primaryOutput } from './recipes.ts';
import type { PhaseStages } from './calculate.ts';

// What each group of warnings reads: the settings, and the stages after the adjustments.
interface FinishedPlan {
  config: CurrentSettings;
  stages: PhaseStages;
}
// The plan's remaining warnings, one group after another in the order the plan lists them.
type WarningGroup = (plan: FinishedPlan) => string[];
export const planWarnings = (config: CurrentSettings, stages: PhaseStages) =>
  WARNING_GROUPS.flatMap(group => group({ config, stages }));
// Somersloop accounting: each augmenter costs 10, each reserved hand-fed use 1, plus the
// amplification budget. Warned about, never enforced: the plan is still calculated.
function somersloopWarnings({ config }: FinishedPlan): string[] {
  if (!config.augmenters && !config.amplifySloops) return [];
  const warnings: string[] = [];
  const committed = 10 * config.augmenters + config.sloopReserved.length + config.amplifySloops;
  if (config.augmenters)
    warnings.push(
      `${config.augmenters} Alien Power Augmenter${config.augmenters > 1 ? 's' : ''}: ${500 * config.augmenters} MW of generation, plus a ${Math.round((0.1 * (config.augmenters - config.fueledAugmenters) + 0.3 * config.fueledAugmenters) * 100)}% multiplier on the Phase 5 grid's base production. That multiplier applies to installed capacity, so it is calculated from the total installed generation in your settings, not from the spare part of it. Augmenters are Phase 5 buildings; earlier phases are planned without them.`,
    );
  if (config.somersloops && committed > config.somersloops)
    warnings.push(
      `This plan commits ${committed} somersloops — 10 per augmenter${config.sloopReserved.length ? `, ${config.sloopReserved.length} reserved for hand-fed lines` : ''}${config.amplifySloops ? `, ${config.amplifySloops} for production amplification` : ''} — but ${config.somersloops} are recorded as available. Collect more, or build fewer augmenters.`,
    );
  return warnings;
}
// Amplification: the busiest phase's somersloop use, and phases whose fit fell back.
function amplificationWarnings({ config, stages }: FinishedPlan): string[] {
  const warnings: string[] = [];
  const used = Math.max(0, ...Object.values(stages).map(stage => stage.sloopsUsed || 0));
  const dropped = Object.entries(stages)
    .filter(([, stage]) => stage.amplificationDropped)
    .map(([phase]) => phase);
  if (config.amplifySloops > 0)
    warnings.push(
      `Production amplification may place up to ${config.amplifySloops} somersloops in each phase's plan, and this plan uses ${used}. Each phase is a self-contained steady state, so that budget is per phase rather than a running total: the somersloops move as you rebuild. Amplified machines are whole machines at 100% — same inputs, double output, four times the power — and the recipe network is chosen before amplification is fitted to it, so the result is not a global optimum over amplified and unamplified recipes together.`,
    );
  if (dropped.length)
    warnings.push(
      `${dropped.length > 1 ? 'Phases' : 'Phase'} ${listNames(dropped)} could not fit production amplification: the search stopped before it could prove the best plan, so ${dropped.length > 1 ? 'those phases are' : 'that phase is'} planned without it and no somersloops are placed there. A smaller amplification budget usually fits.`,
    );
  return warnings;
}
// Existing production: which credits some phase drew on, and phases that had to drop them.
function existingSupplyWarnings({ stages }: FinishedPlan): string[] {
  const warnings: string[] = [];
  const supplied = [
    ...new Set(Object.values(stages).flatMap(stage => Object.keys(stage.supplied || {}))),
  ].sort();
  const lost = Object.entries(stages)
    .filter(([, stage]) => stage.supplyDropped)
    .map(([phase]) => phase);
  if (supplied.length)
    warnings.push(
      `This plan draws on production you already run: ${supplied.join(', ')}. Those lines are not planned or built again, and the chain behind them is not planned either. Their ore and their power are already spent in your world, so the resource budgets and the spare-power figure must be entered net of them, exactly as for any other existing factory.`,
    );
  if (lost.length)
    warnings.push(
      `${lost.length > 1 ? 'Phases' : 'Phase'} ${listNames(lost)} could not be fitted to whole machines while crediting the production you already run, so ${lost.length > 1 ? 'those phases are' : 'that phase is'} planned as if you built all of it yourself. Nothing is lost: the plan is simply the larger one. Precise balancing instead of whole machines usually keeps the credit.`,
    );
  return warnings;
}
// Vehicle fuel for the factory-group links (#206): what each phase plans for, and fuel a phase
// cannot make yet, which is left out there.
function vehicleFuelWarnings({ config, stages }: FinishedPlan): string[] {
  const warnings: string[] = [];
  const rate = (perMinute: number) => Math.round(perMinute * 100) / 100;
  const planned = Object.entries(config.transportFuel) as [StageKey, ItemRates][];
  if (planned.length)
    warnings.push(
      `Fuel for the vehicles on the links between your factories is planned as extra demand: ${planned
        .map(
          ([phase, fuels]) =>
            `Phase ${phase} ${Object.entries(fuels)
              .map(([fuel, perMinute]) => `${rate(perMinute)} ${fuel}/min`)
              .join(', ')}`,
        )
        .join(
          '; ',
        )}. It comes from the previous revision's links, as if the vehicles never stop; the fuel chain adds a little traffic of its own, so recalculating again can raise it slightly.`,
    );
  const missing = planned.flatMap(([phase, fuels]) =>
    Object.keys(fuels)
      .filter(fuel => stages[phase]?.feasible && !stages[phase]?.transport?.[fuel])
      .map(fuel => `${fuel} in Phase ${phase}`),
  );
  if (missing.length)
    warnings.push(
      `This plan cannot make ${missing.join(', ')} yet, so that vehicle fuel is left out there. Pick a fuel the phase can make, or plan the vehicles for a later phase.`,
    );
  return warnings;
}
// Items factory groups make on site (#875): which groups make what (and which of those items the
// central lines make as a byproduct that goes to the group first, byproductFeeds), and the phases
// whose per-group whole-machine lines did not fit, so they make those items centrally.
function onSiteWarnings({ config, stages }: FinishedPlan): string[] {
  const warnings: string[] = [];
  const groupName = (group: string) => config.onSite?.[group]?.name || 'a factory';
  const made: Record<string, Set<string>> = {};
  for (const stage of Object.values(stages))
    for (const row of stage.rows || [])
      if (row.onSite)
        for (const item of Object.keys(row.outputs))
          if (config.onSite?.[row.onSite.group]?.items.includes(item))
            (made[row.onSite.group] ??= new Set()).add(item);
  // In the order of settings.onSite.
  const makers = Object.keys(config.onSite || {})
    .filter(group => made[group])
    .map((group): [string, Set<string>] => [group, made[group]!]);
  if (makers.length)
    warnings.push(
      `Factories make items on site: ${makers
        .map(([group, items]) => `${groupName(group)} makes ${listNames([...items].sort())}`)
        .join(
          '; ',
        )}. Each such factory has its own whole-machine line, sized to its own consumers as the factories were when this plan was calculated, and a central line makes the rest.` +
        feedSentences(config, stages, groupName),
    );
  for (const [phase, stage] of Object.entries(stages)) {
    const dropped = Object.entries(stage.onSiteDropped || {});
    if (!dropped.length) continue;
    const items = [...new Set(dropped.flatMap(([, list]) => list))].sort();
    warnings.push(
      `Phase ${phase} makes ${listNames(items)} centrally: the whole-machine lines of ${listNames(dropped.map(([group]) => groupName(group)))} for ${items.length > 1 ? 'those items' : 'that item'} need more than your budgets allow, while central lines fit. Raise a budget a little, or make fewer items on site.`,
    );
  }
  return warnings;
}
// A sentence per item byproductFeeds finds, each starting with a space; '' for none.
function feedSentences(
  config: CurrentSettings,
  stages: PhaseStages,
  groupName: (group: string) => string,
): string {
  return byproductFeeds(config, stages)
    .map(([item, groups]) => {
      const lines =
        groups.length > 1
          ? "each factory's own line makes"
          : possessive(groupName(groups[0]!)) + ' own line makes'; // byproductFeeds: never empty
      return ` Central lines also make ${item} as a byproduct, which cannot go to the sink: it goes to ${listNames(groups.map(groupName))} first, and ${lines} only the rest.`;
    })
    .join('');
}
// "Gamma's", or "Alpha Works'".
const possessive = (name: string) => name + (name.endsWith('s') ? "'" : "'s");
// The items a group's own line makes in some phase while another line there makes them as a
// byproduct that balances exactly (a fluid): the planner sends that byproduct to the group first
// (siteFeeds in on-site.ts, #1012), so the group's line makes only the rest. As [item, groups],
// sorted, the groups in the order of settings.onSite.
function byproductFeeds(config: CurrentSettings, stages: PhaseStages): [string, string[]][] {
  const fed = new Map<string, Set<string>>();
  for (const stage of Object.values(stages)) {
    const rows = stage.rows || [];
    for (const row of rows) {
      const group = row.onSite?.group;
      if (!group) continue;
      for (const item of Object.keys(row.outputs))
        if (
          exactBalance(item) &&
          config.onSite?.[group]?.items.includes(item) &&
          rows.some(other => other.outputs[item] && primaryOutput(other) !== item)
        )
          fed.set(item, (fed.get(item) ?? new Set()).add(group));
    }
  }
  const order = Object.keys(config.onSite || {});
  return [...fed]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([item, groups]) => [item, order.filter(group => groups.has(group))]);
}
// The fueled augmenters' Alien Power Matrix line.
function augmenterFuelWarnings({ config }: FinishedPlan): string[] {
  if (!config.fueledAugmenters) return [];
  return [
    `Fuel for ${config.fueledAugmenters} augmenter${config.fueledAugmenters > 1 ? 's' : ''} adds ${5 * config.fueledAugmenters} Alien Power Matrix/min to Phase 5, with the Quantum Encoder chain behind it. That rate is derived from the augmenter count, never entered separately.`,
  ];
}
// Unsinkable solid outputs (Power Shards today), which are balanced exactly, not rounded.
function unsinkableWarnings({ stages }: FinishedPlan): string[] {
  const stuck = [
    ...new Set(
      Object.values(stages)
        .flatMap(stage => (stage.rows || []).flatMap(row => Object.keys(row.outputs)))
        .filter(
          item =>
            !DATA.items[item]?.fluid &&
            !DATA.items[item]?.radioactive &&
            !item.endsWith('Waste') &&
            !RAW.includes(item) &&
            !((DATA.items[item]?.sink ?? 0) > 0),
        ),
    ),
  ];
  if (!stuck.length) return [];
  return [
    `${listNames(stuck)} cannot be sent to the AWESOME Sink, so ${stuck.length > 1 ? 'those lines are' : 'that line is'} balanced exactly instead of run whole at 100%: the last machine is underclocked and nothing is left over to back the line up.`,
  ];
}
// Budgets the user still has to check: a seed-dependent map, and budgets not yet confirmed.
function budgetWarnings({ config }: FinishedPlan): string[] {
  const warnings: string[] = [];
  if (config.distribution !== 'original' || config.purity === 'custom')
    warnings.push(
      'Seed-dependent distribution: confirm resource-rich node counts, mixed purity and well totals against your save. Zero budgets mean unallocated resources.',
    );
  if (!config.limitsConfirmed)
    warnings.push(
      'Resource budgets are provisional. Confirm available extraction after reserving resources for existing factories.',
    );
  return warnings;
}
// What every plan assumes about unlocks and power.
function assumptionWarnings({ config }: FinishedPlan): string[] {
  return [
    'Phase targets assume that phase’s milestones and required MAM research are unlocked. Gathered items, buildings and equipment are not continuously automated.',
    `Power includes new generators and their fuel chains, with a ${config.utilityPercent}% allowance for trains, drone ports, mining and pumps. Existing plants are represented only by spare capacity; subtract their fuel from available resources. Drone fuel is a separate protected supply contract, not a route-consumption estimate.`,
  ];
}
// Whole machines, and how the nuclear plants were rounded (#370).
function wholeMachineWarnings({ config, stages }: FinishedPlan): string[] {
  if (!config.wholeMachines) return [];
  const warnings: string[] = [];
  const period = stages[5]?.nuclearPeriod;
  warnings.push(
    'Solid-part production uses whole machines at 100%. Surplus goes to storage then the sink. Recipe choices are selected first; the result is not a global mixed-recipe integer optimum. Fluid and power balancing can retain fractional clocks.',
  );
  // The lines set to exact clocks (#1066), counted per phase as the build plan lists them.
  const exact = Object.values(config.exactClocks || {}).flat().length;
  if (exact)
    warnings.push(
      `${exact === 1 ? 'One production line runs' : `${exact} production lines run`} at exact clocks, as asked: the last machine is underclocked to the exact remainder instead of sending the overflow to the sink.`,
    );
  if (config.nuclear !== 'none')
    warnings.push(
      'Uranium-fuelled Nuclear Power Plants are whole buildings wherever the budgets allow' +
        (period
          ? `. In Phase 5, which recycles the waste, they come in multiples of ${period}, so every line of the waste chain there, the plutonium and ficsonium plants included, also runs whole at 100%; the extra plants only add generation. Other nuclear fuel and waste lines balance exactly and can retain fractional clocks.`
          : '. Their fuel and waste lines balance exactly and can retain fractional clocks.'),
    );
  const fractional = Object.entries(stages)
    .filter(([, stage]) => stage.nuclearFractional)
    .map(([phase]) => phase);
  if (fractional.length)
    warnings.push(
      `${fractional.length > 1 ? 'Phases' : 'Phase'} ${listNames(fractional)} could not fit whole Nuclear Power Plants within the resource budgets, so ${fractional.length > 1 ? 'those phases keep' : 'that phase keeps'} a fractional uranium plant count, and ${fractional.length > 1 ? 'their' : 'its'} waste chain fractional clocks, as precise balancing would. A little more uranium or water budget usually lets it round.`,
    );
  return warnings;
}
// The lines of a phase that round to whole machines: those roundsToWholeMachines picks, less the
// lines set to exact clocks (#1066), whose last machine is meant to be fractional.
const roundingLines = (config: CurrentSettings, phase: string) => (row: CalcRow) =>
  roundsToWholeMachines(row) && !exactClockLine(config, Number(phase), row.id);
// Phases whose whole-machine search stopped and whose exact plan was rounded instead (#593), one
// sentence each, since each can take its own time. Not "to the nearest": where only the plan with
// every line rounded up fits, that one is used (roundedTry, #698). The time is compared with the
// exact plan's, which the stage records (#708).
function roundedWarnings({ config, stages }: FinishedPlan): string[] {
  return Object.entries(stages)
    .filter(([, stage]) => stage.feasible && stage.roundedAfterStop !== undefined)
    .map(([phase, stage]) => {
      const target = stage.roundedAfterStop!,
        longer = stage.hours! > target * 1.01;
      // Lines roundedRun left fractional because it rounded them up more than ROUNDING_RAISES times.
      const rounds = roundingLines(config, phase);
      const left = (stage.rows || []).filter(row => rounds(row) && row.lastClock < 100 - 1e-6);
      const kept = raisedLines(stage, left, 'whole-machine', 'a fractional clock', rounds);
      return `Phase ${phase}: the whole-machine search stopped before it could prove the best plan, so its exact plan is rounded to whole machines instead. That can take more machines and resources than the best whole-machine plan${longer ? `, and this phase takes ${warningDuration(stage.hours!)} instead of ${warningDuration(target)}` : ''}.${kept} Fewer alternates or precise balancing usually let the search finish.`;
    });
}
// A phase time in a warning or draft reason, given in hours, in the words ADA, the plan header
// and the Review step use (#740): "45 minutes", "about 7 h 52 min", "about 8 h". The same
// function as public/app/format.ts's durationOfHours, from public/wording.ts (#763).
export const warningDuration = durationOfHours;
// Phases whose search stopped and that no rounded whole-machine plan fit, so they are the exact
// plan with easy clocks (#694), one sentence each.
function fractionalWarnings({ config, stages }: FinishedPlan): string[] {
  return Object.entries(stages)
    .filter(([, stage]) => stage.feasible && stage.fractionalAfterStop !== undefined)
    .map(([phase, stage]) => {
      const { target, clocks } = stage.fractionalAfterStop!;
      const longer =
        stage.hours! > target * 1.01
          ? ` It takes ${warningDuration(stage.hours!)} instead of ${warningDuration(target)}.`
          : '';
      return `Phase ${phase} is not whole machines: its whole-machine search stopped before it could prove the best plan, and rounding its exact plan to whole machines found no plan that fits the budgets within 50% more time. ${fractionalClocks(clocks)}${longer}${offGridLines(stage, clocks, roundingLines(config, phase))} Fewer alternates or precise balancing usually let the search finish.`;
    });
}
// How the last machines of a phase in fractionalWarnings are clocked.
const fractionalClocks = (clocks: FractionalAfterStop['clocks']) =>
  clocks === 'precise'
    ? 'So this phase is its exact plan, with precise clocks.'
    : `So this phase is its exact plan with easy clocks: every solid-part line runs whole machines at 100% except the last, which runs at 25%, 50% or 75%${clocks === 'rate' ? ', or at the clock that makes a whole number of items per minute' : ''}.`;
// The solid-part lines of a phase in fractionalWarnings whose last machine is not on an easy
// clock (roundedRun raised them more than EASY_RAISES times), as sentences (raisedLines).
function offGridLines(
  stage: CurrentStage,
  clocks: FractionalAfterStop['clocks'],
  rounds: (row: CalcRow) => boolean,
): string {
  if (clocks === 'precise') return '';
  const easy = (row: CalcRow) => {
    const last = row.lastClock / 100;
    if (Math.abs(last * 4 - Math.round(last * 4)) < 1e-4) return true;
    const perMachine = row.equivalent > 0 ? productRate(row) / row.equivalent : 0;
    return clocks === 'rate' && Math.abs(perMachine * last - Math.round(perMachine * last)) < 1e-4;
  };
  const left = (stage.rows || []).filter(row => rounds(row) && !row.amplified && !easy(row));
  return raisedLines(stage, left, 'solid-part', 'a precise clock', rounds);
}
// Why roundedRun left the `left` lines of a stage off their grid, as sentences: it rounded each
// up more than its raise limit (ROUNDING_RAISES, EASY_RAISES). Two whole lines tied by a fluid
// that balances exactly (Rubber and Petroleum Coke by Heavy Oil Residue) take turns without end;
// only a line that makes or uses a non-raw fluid (an exact balance, addBalances) another such line
// of the stage also makes or uses is said to share a fluid (#714). A line at the top of a long
// chain (Iron Plate, Copper Ingot) reaches the limit too, raised again each time the lines it
// feeds were rounded.
function raisedLines(
  stage: CurrentStage,
  left: CalcRow[],
  kind: string,
  clock: string,
  rounds: (row: CalcRow) => boolean,
): string {
  const lines = (stage.rows || []).filter(rounds);
  const fluids = (row: CalcRow) =>
    [...Object.keys(row.inputs), ...Object.keys(row.outputs)].filter(
      item => DATA.items[item]?.fluid && !RAW.includes(item),
    );
  const sharesFluid = (row: CalcRow) =>
    fluids(row).some(item =>
      lines.some(other => other.id !== row.id && fluids(other).includes(item)),
    );
  const sentence = (rows: CalcRow[], plural: string, single: string) =>
    rows.length
      ? ` ${listNames(rows.map(row => row.name))} ${rows.length > 1 ? plural : single}, so ${rows.length > 1 ? 'they keep' : 'it keeps'} ${clock} on the last machine.`
      : '';
  return (
    sentence(
      left.filter(sharesFluid),
      `share a fluid with another ${kind} line`,
      `shares a fluid with another ${kind} line`,
    ) +
    sentence(
      left.filter(row => !sharesFluid(row)),
      'kept being rounded up as the lines they feed were rounded',
      'kept being rounded up as the lines it feeds were rounded',
    )
  );
}
// What the plan does not claim: a global optimum, or simulated mods.
function scopeWarnings({ config }: FinishedPlan): string[] {
  const warnings = [
    'Maximum output optimizes elevator completion within the entered budgets and allowed recipes; it is not an unrestricted global game optimum.',
  ];
  if (config.modNotes)
    warnings.push(
      'Mod notes are recorded only. Changed recipes, output boosts and modded items are not simulated.',
    );
  return warnings;
}
const WARNING_GROUPS: WarningGroup[] = [
  somersloopWarnings,
  amplificationWarnings,
  existingSupplyWarnings,
  vehicleFuelWarnings,
  onSiteWarnings,
  augmenterFuelWarnings,
  unsinkableWarnings,
  budgetWarnings,
  assumptionWarnings,
  wholeMachineWarnings,
  roundedWarnings,
  fractionalWarnings,
  scopeWarnings,
];
