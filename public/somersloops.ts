// The somersloop budget (#1059), shared by the planner's settings check (planner/settings.ts), the
// ledger on All settings step 2 (ui/wizard/SloopLedger.vue) and the notice over a stored plan that
// commits more than its budget (ui/plan/SloopOverCommit.vue), so all three count and word it the
// same way. Each Alien Power Augmenter costs 10 somersloops, each hand-fed use 1, and production
// amplification its whole budget; the save has `somersloops` to spend. A calculation that commits
// more is refused, never clamped: the user decides what to give up.
// Also the words for a somersloop pin a phase could not keep (#1235), which the planner's warning,
// ADA and the production line dialog share.
import { listNames, localeNumber } from './wording.ts';
import type { SloopPinReason } from './types/index.ts';

// The settings the budget reads; absent fields count as none, as settings() defaults them.
export interface SloopSettings {
  somersloops?: number;
  augmenters?: number;
  sloopReserved?: readonly string[];
  amplifySloops?: number;
}

// What the settings commit and have: `committed` against `available`, the three parts of it, and
// how many more than available (0 when it fits).
export interface SloopCommitment {
  available: number;
  committed: number;
  augmenters: number;
  augmenterSloops: number;
  parked: number;
  amplify: number;
  over: number;
}

// Somersloops per Alien Power Augmenter.
export const SLOOPS_PER_AUGMENTER = 10;

// Somersloop slots per production machine, as in the game. Miners, extractors, packagers and
// generators have none. Amplifying a machine fills all its slots, so this is also the somersloop
// cost of one amplified machine. The planner's amplified twins (amplified() in planner/recipes.ts,
// which re-exports this table) and the build plan's somersloop ranking (app/sloop-payoff.ts,
// #1215) read it here.
export const AMPLIFY_SLOTS: Record<string, number> = {
  Smelter: 1,
  Constructor: 1,
  Assembler: 2,
  Foundry: 2,
  Refinery: 2,
  Converter: 2,
  Manufacturer: 4,
  Blender: 4,
  'Particle Accelerator': 4,
  'Quantum Encoder': 4,
};
// An amplified machine, every slot filled: this many times the output from the same inputs, at
// this many times the power, per (1 + filled/total)^2.
export const AMPLIFIED_OUTPUT = 2;
export const AMPLIFIED_POWER = 4;
// The somersloop slots of a recipe's machine when production amplification can amplify it (a
// machine with slots that draws power), else 0 (amplifiable in planner/recipes.ts): one amplified
// machine's somersloops, which a pin on its line counts in (#1235).
export const amplifySlots = (recipe: { machine: string; power: number }): number =>
  recipe.power > 0 ? (AMPLIFY_SLOTS[recipe.machine] ?? 0) : 0;
// The most somersloops a pin may name: the game's 106, as `somersloops` and `amplifySloops`.
export const SLOOP_PIN_MAX = 106;

// Production amplification needs the MAM research Production Amplifier (#1056,
// Research_Alien_ProductionBooster_C in progression.json): machines take somersloops only once it
// is researched. It costs SAM Fluctuators and Circuit Boards, first available in Phase 3
// (milestonePhase in progression.ts, which a test keeps in step), so the planner places no
// amplified lines before AMPLIFIER_PHASE and the build plan lists the research in a phase with
// amplified lines.
export const AMPLIFIER_RESEARCH = 'Production Amplifier';
export const AMPLIFIER_PHASE = 3;
// Whether a phase's plan may amplify: a budget, and the research available by then.
export const amplifiesIn = (settings: Pick<SloopSettings, 'amplifySloops'>, phase: number) =>
  (settings.amplifySloops ?? 0) > 0 && phase >= AMPLIFIER_PHASE;
// The sentence every build-plan step that inserts somersloops ends its advice with: an amplified
// line's (sloopText in app/views/calculated.ts) and the hand-fed constructors' (#1150).
export const AMPLIFIER_WORDS = `Machines take somersloops once the MAM research ${AMPLIFIER_RESEARCH} is done, from Phase ${AMPLIFIER_PHASE} on.`;
// The phase whose build plan lists the hand-fed constructors' step (#1150): the profile's start
// phase, but not before the research their somersloops wait for.
export const handFedPhase = (startPhase: number): number => Math.max(startPhase, AMPLIFIER_PHASE);
// Why a phase could not keep a somersloop pin (#1235, SloopPinReason), as a clause: "machines take
// somersloops only once …". `amplifySloops` is the plan's amplification budget per phase.
export function pinReasonWords(reason: SloopPinReason, amplifySloops: number): string {
  if (reason === 'research')
    return `machines take somersloops only once the MAM research ${AMPLIFIER_RESEARCH} is done, from Phase ${AMPLIFIER_PHASE} on`;
  if (reason === 'budget')
    return amplifySloops > 0
      ? `the phase’s pins add up to more than the ${localeNumber(amplifySloops)} somersloop${amplifySloops === 1 ? '' : 's'} production amplification may place in a phase`
      : 'production amplification has no somersloops to place in this plan';
  if (reason === 'unavailable') return 'the recipe is not available in this phase of the plan';
  return 'no plan of the phase fits with it, so the planner placed the phase’s somersloops itself';
}
// What changes a pin a phase could not keep, after the reason: Edit settings for the budget, the
// line's dialog otherwise.
export function pinRemedyWords(reason: SloopPinReason): string {
  return reason === 'budget'
    ? 'Raise the amplification budget on step 2 of Edit settings, or lower or clear the pins in the production line’s dialog.'
    : 'Change or clear the pin in the production line’s dialog.';
}

export function sloopCommitment(settings: SloopSettings): SloopCommitment {
  const whole = (value: number | undefined) =>
    Number.isFinite(value) && value! > 0 ? Math.floor(value!) : 0;
  const augmenters = whole(settings.augmenters),
    augmenterSloops = SLOOPS_PER_AUGMENTER * augmenters,
    parked = (settings.sloopReserved || []).length,
    amplify = whole(settings.amplifySloops),
    available = whole(settings.somersloops),
    committed = augmenterSloops + parked + amplify;
  return {
    available,
    committed,
    augmenters,
    augmenterSloops,
    parked,
    amplify,
    over: Math.max(0, committed - available),
  };
}

// What the commitment is made of, in words: "100 for 10 Alien Power Augmenters, 3 parked in
// hand-fed lines and 88 for production amplification". '' when nothing is committed.
export function sloopPartsWords(commitment: SloopCommitment): string {
  const figure = (value: number) => localeNumber(value);
  const parts = [
    commitment.augmenters
      ? `${figure(commitment.augmenterSloops)} for ${figure(commitment.augmenters)} Alien Power Augmenter${commitment.augmenters > 1 ? 's' : ''}`
      : '',
    commitment.parked ? `${figure(commitment.parked)} parked in hand-fed lines` : '',
    commitment.amplify ? `${figure(commitment.amplify)} for production amplification` : '',
  ].filter(Boolean);
  return listNames(parts);
}

// The sentence a commitment beyond the budget is refused with, and the stored plan's notice
// starts with: "This plan commits 191 somersloops (100 for 10 Alien Power Augmenters, 3 parked in
// hand-fed lines and 88 for production amplification), but only 106 are available to spend."
export function sloopOverWords(commitment: SloopCommitment): string {
  const figure = (value: number) => localeNumber(value);
  const available = commitment.available;
  return `This plan commits ${figure(commitment.committed)} somersloop${commitment.committed === 1 ? '' : 's'} (${sloopPartsWords(commitment)}), but ${available ? `only ${figure(available)} ${available === 1 ? 'is' : 'are'}` : 'none are'} available to spend.`;
}

// The refusal of a calculation whose settings commit more than the budget: what is wrong and what
// to change, on All settings step 2.
export function sloopRefusal(commitment: SloopCommitment): string {
  return `${sloopOverWords(commitment)} Raise “Somersloops available to spend”, or commit fewer: build fewer augmenters, park fewer in hand-fed lines or lower the amplification budget (All settings, step 2).`;
}
