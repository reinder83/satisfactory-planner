// The somersloop budget (#1059), shared by the planner's settings check (planner/settings.ts), the
// ledger on All settings step 2 (ui/wizard/SloopLedger.vue) and the notice over a stored plan that
// commits more than its budget (ui/plan/SloopOverCommit.vue), so all three count and word it the
// same way. Each Alien Power Augmenter costs 10 somersloops, each hand-fed use 1, and production
// amplification its whole budget; the save has `somersloops` to spend. A calculation that commits
// more is refused, never clamped: the user decides what to give up.
import { listNames, localeNumber } from './wording.ts';

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
