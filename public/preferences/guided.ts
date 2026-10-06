// The guided start.
//
// A short sequence of plain-language questions that produces the same settings
// object the five-step wizard produces. Nothing here is a new kind of setting:
// every answer writes fields `settings()` already validates, so a profile made
// this way is indistinguishable from one built by hand, and every existing
// profile keeps calculating exactly as before.
//
// Which questions exist was decided by measurement rather than taste. Against
// the default Phase 3/4/5 plan (229/844/1879 buildings), moving one setting off
// its default changes the plan by:
//
//   storage refill rates   +425%   (buildRate 1 -> 20)
//   goal / hours           +4600%  (maximum output) .. -22% (minimal)
//   elevator multiplier    +1102%  (50x)
//   recipe access           -57%   (all alternates), and on a heavy plan it
//                                  decides whether Phase 5 fits at all
//   whole machines          -64%   (precise balancing instead; measured again for #1066:
//                                  Phase 5 1,893 buildings and 73.9 GW of power needed whole,
//                                  688 and 23.6 GW exact, which the 'exact' question's lead
//                                  words)
//   storage supply          +56%   (everything, rather than construction)
//
// Since #1061 a plan the wizard calculates fills protected storage from surplus first, and only
// items with no surplus get storage-only lines, which are optional. Measured on the guided
// start's defaults (Phase 1 start, whole machines, 20 Concrete/min), buildings per Phase 1-5:
// no storage 17/61/208/787/1798; "My building materials" 26/77/217/823/1802 (before: 40/127/
// 238/859/1804); "Everything" 28/93/265/870/1932 (before: 41/158/359/1363/2530). The stock
// question's details quote the first three phases.
//
// while eleven of the wizard's controls — world seed, mod notes, SAM
// conversion, collectables, somersloops held, unfueled augmenters, sloops
// parked in hand-fed lines, the budget confirmation, resource purity, and both
// halving and doubling all thirteen resource budgets — changed a default plan
// by exactly nothing. Those keep their defaults until someone goes looking in
// All settings, which is always one click away.
import type { GuidedQuestion, StageKey } from '../types/index.ts';

// The items/min a guided top-up item gets as a per-item storage override (storageOverrides).
export const GUIDED_TOPUP_RATE = 20;
// The construction materials you carry out of a container by the hundred.
// A per-item floor for these costs 1-2% more buildings; raising the general
// construction rate to reach the same number costs 81-425%, because it applies
// to all eighteen construction materials at once. Concrete leads the list
// because it is the one the plan leaves least surplus for: at a floor of 1/min
// a default Phase 3 plan already spills 29 Wire/min and 19 Iron Plate/min into
// storage, and 2 Concrete/min.
export const guidedTopupItems: string[] = [
  'Concrete',
  'Iron Plate',
  'Iron Rod',
  'Steel Beam',
  'Steel Pipe',
  'Cable',
];
// The Space Elevator parts each phase delivers, for the phase cards' artwork.
// Kept in step with the planner's DELIVERIES by a test; the icons are already
// bundled and attributed in icons/sources.json, so the guided start adds no new
// imagery and no new attribution.
export const phaseParts: Record<number, string[]> = {
  1: ['Smart Plating'],
  2: ['Smart Plating', 'Versatile Framework', 'Automated Wiring'],
  3: ['Versatile Framework', 'Modular Engine', 'Adaptive Control Unit'],
  4: [
    'Assembly Director System',
    'Magnetic Field Generator',
    'Thermal Propulsion Rocket',
    'Nuclear Pasta',
  ],
  5: ['Nuclear Pasta', 'Biochemical Sculptor', 'AI Expansion Server', 'Ballistic Warp Drive'],
};
// Each question names the advanced step that owns the same settings, so
// "All settings" lands where you already were instead of at the top.
// Each option's `set` is merged into the settings; `handoff` names the All settings step
// the guided flow jumps to after it; `glyph` or `items` picks the card's artwork.
export const guidedQuestions: GuidedQuestion[] = [
  {
    id: 'phase',
    step: 1,
    short: 'Your phase',
    title: 'Where are you in the game right now?',
    lead: 'A plan is built for one phase. Earlier phases are behind you, so the build steps start where you are.',
    options: [1, 2, 3, 4, 5].map(phase => ({
      value: String(phase),
      label: 'Phase ' + phase,
      detail:
        phase === 1
          ? 'The first Space Elevator delivery. Starting out.'
          : 'Delivering ' +
            phaseParts[phase]!.slice(0, 2).join(' and ') +
            (phaseParts[phase]!.length > 2 ? ', and more' : '.'),
      // Every phase 1-5 has its parts listed above.
      items: phaseParts[phase]!,
      set: { phase: String(phase) as StageKey },
    })),
  },
  {
    id: 'goal',
    step: 3,
    short: 'Your goal',
    title: 'What should this plan do for you?',
    lead: 'The biggest single choice: it decides how much you build and how long a phase takes.',
    options: [
      {
        value: 'minimal',
        label: 'Build as little as possible',
        detail:
          'The fewest machines that deliver a phase within 24 hours, run as fast as they allow.',
        glyph: 'minimal',
        set: { goal: 'minimal' },
      },
      {
        value: 'balanced',
        label: 'Steady progress',
        detail: 'About 8 hours a phase. A practical middle, and the usual starting point.',
        glyph: 'balanced',
        set: { goal: 'balanced' },
      },
      {
        value: 'timed',
        label: 'Finish by a deadline',
        detail: 'You choose the hours per phase; the planner sizes the factory to hit it.',
        glyph: 'timed',
        set: { goal: 'timed' },
      },
      {
        value: 'maximum',
        label: 'As fast as the map allows',
        detail: 'Fastest delivery inside your resource budgets. You confirm those budgets first.',
        glyph: 'maximum',
        set: { goal: 'maximum' },
        handoff: 4,
      },
    ],
  },
  {
    id: 'recipes',
    step: 2,
    short: 'Recipes',
    title: 'Which recipes can the plan use?',
    lead: 'Alternate recipes come from hard drives. Allowing them typically halves the factory, and on a heavy plan it can decide whether the plan fits your resources at all.',
    options: [
      {
        value: 'standard',
        label: 'Standard recipes only',
        detail: 'Nothing that needs a hard drive. The simplest factory to follow, and the largest.',
        glyph: 'standard',
        set: { recipes: 'standard', pureIngots: false },
      },
      {
        value: 'all',
        label: 'Whatever works best',
        detail:
          'The planner picks from every alternate and adds the hard-drive hunts you need as build steps.',
        glyph: 'alternates',
        set: { recipes: 'all', pureIngots: false },
      },
      {
        value: 'custom',
        label: 'I will choose them myself',
        detail:
          'Pick recipe by recipe in All settings. Useful when you know which drives you have unlocked.',
        glyph: 'custom',
        set: { recipes: 'custom' },
        handoff: 2,
      },
    ],
  },
  {
    id: 'stock',
    step: 2,
    short: 'Stocked for you',
    title: 'What should the factory keep stocked for you?',
    lead: 'Beyond the Space Elevator, the plan can reserve production to keep containers filled for your own building.',
    options: [
      {
        value: 'none',
        label: 'Nothing — just the elevator',
        detail:
          'Every part goes to deliveries. You gather and handcraft your own building materials.',
        glyph: 'stock-none',
        set: { storage: 'none', collectables: false },
      },
      {
        value: 'construction',
        label: 'My building materials',
        detail:
          'Plates, rods, concrete, wire, cable, beams, pipes, frames, plastic and rubber each get a container. The plan’s surplus fills them first; an item with no surplus gets a small storage-only line, optional and built last. On a default plan: 9 more buildings in Phase 1, 16 in Phase 2, 9 in Phase 3.',
        glyph: 'stock-build',
        set: { storage: 'construction', collectables: false },
      },
      {
        value: 'all',
        label: 'Everything it can automate',
        detail:
          'A container for every automatable solid, filled from surplus first. The biggest storage room, and the most storage-only lines: on a default plan 11 more buildings in Phase 1, 32 in Phase 2, 57 in Phase 3, all optional.',
        glyph: 'stock-all',
        set: { storage: 'all', collectables: true },
      },
    ],
  },
  {
    id: 'exact',
    step: 3,
    short: 'Exactness',
    title: 'How exact should the build be?',
    lead: 'Whole machines are easier to set up but build more. Measured on a default plan, Phase 5 takes nearly three times the buildings and the power with whole machines.',
    options: [
      {
        value: 'whole',
        label: 'Whole machines at 100%',
        detail:
          'Nothing to underclock, but every machine runs at full speed, so the lines feeding it do too. Extra output fills storage and then goes to the sink.',
        glyph: 'whole',
        set: { wholeMachines: true },
      },
      {
        value: 'precise',
        label: 'Exact ratios',
        detail:
          'Far fewer machines and less power, but the last machine of each line runs at an odd clock speed you set by hand.',
        glyph: 'precise',
        set: { wholeMachines: false },
      },
    ],
  },
];
// Asked only where it means something: the tutorial question belongs to a
// Phase 1 save, the already-built question to any later one. Neither changes a
// setting — both record what is already standing in the world.
export const guidedStandingQuestion = (phase: string): GuidedQuestion =>
  phase === '1'
    ? {
        id: 'tutorial',
        step: 1,
        short: 'Tutorial',
        title: 'Have you finished the HUB tutorial?',
        lead: 'HUB Upgrades 1 to 6, before the first Space Elevator delivery.',
        options: [
          {
            value: 'doing',
            label: 'Still working through it',
            detail: 'The HUB steps stay at the top of your build plan as your next jobs.',
            glyph: 'tutorial',
            set: {},
          },
          {
            value: 'done',
            label: 'Finished it — skip those steps',
            detail: 'The HUB steps start ticked. You can untick any of them later.',
            glyph: 'tutorial-done',
            set: {},
          },
        ],
      }
    : {
        id: 'supply',
        step: 1,
        short: 'Already running',
        kind: 'supply',
        title: 'What are you already producing?',
        lead: 'If a line already runs in your world, say what it makes and how fast. The plan builds only the remainder, and it does not build the chain behind what you already make. Leave this empty if you are starting from scratch here.',
      };
// Ticked when someone says the HUB tutorial is behind them. Both keys already
// exist: the Phase 1 build step, and HUB Upgrade 6 in the unlock data.
// Used by guidedBuiltKeys in app/wizard/guided.ts.
export const tutorialKeys: string[] = ['early-base-hub', 'unlock-Schematic_Tutorial5_C'];
