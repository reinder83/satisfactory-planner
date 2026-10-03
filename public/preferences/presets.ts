// Prefilling the node counts for the default world.
//
// The purity world settings do not move a node or add one: they shift every
// node up or down the purity scale, which is exactly what `resourceDefaults`
// encodes as per-purity weights. So the counts for each setting fall straight
// out of the known node table, and a test checks that each preset reproduces
// that setting's shipped budget to the item.
//
// The resource-rich distributions are deliberately absent. They change how many
// nodes each resource has, per seed, and no authoritative per-purity table for
// them exists — only approximate community observations. Inventing one would be
// worse than asking, so for those the survey points at the map upload instead.
import type { NodeCounts, Survey } from '../types/index.ts';
import { blankCounts, blankExtraction } from './extraction.ts';
import { nodeCounts, purities } from './world.ts';

// The purity settings the known node table can be rearranged into. Random and
// Custom are not among them: there is no fixed layout to rearrange.
export const presetPurities: string[] = [
  'vanilla',
  'pure',
  'mostly-pure',
  'normal',
  'mostly-impure',
  'impure',
];
// Purity settings that give every node the same purity. Under these the purity
// split stops mattering: only the total node count does.
export const uniformPurities: string[] = ['pure', 'normal', 'impure'];
// Whether the node counts for a world are actually knowable.
//
// Random node randomization is a shuffle: it moves which resource sits at which
// location, and the purity with it, but the number of nodes each resource has
// is unchanged — nineteen SAM nodes are still nineteen SAM nodes, somewhere
// else. So under a uniform purity the counts are exactly the default map's; it
// is only the split across impure, normal and pure that the shuffle destroys.
//
// The resource-rich distributions do change how many nodes each resource has,
// by amounts that depend on the seed, so nothing is knowable there.
export const knownWorld = (purity: string | undefined, distribution = 'original'): boolean =>
  distribution === 'original'
    ? presetPurities.includes(purity as string)
    : distribution === 'randomized'
      ? uniformPurities.includes(purity as string)
      : false;
// What a resource-rich distribution does to the map, in the only terms that
// have held up. Players who have generated these worlds report per-resource
// counts that swing by a third or more between seeds, so there is no table
// here and there never should be one — but every count published so far pushes
// each resource the same way, and that much is worth telling someone who is
// about to count their own map.
export const richShape: Record<string, string> = {
  basic:
    'Basic Resource Rich trades the late-game ores for the early ones: expect more limestone, iron, copper and coal, and less caterium, sulfur, bauxite, quartz, uranium and SAM.',
  advanced:
    'Advanced Resource Rich does the reverse: expect far more caterium, sulfur, bauxite, quartz, uranium and SAM, and roughly half the limestone, iron, copper, coal and oil.',
  fossil:
    'Fossil Fuel Rich concentrates on what burns: expect much more coal, crude oil and sulfur, and less of nearly everything else.',
};
// [id, label] for each preset purity, labelled as in `purities`.
export const nodePresets: [id: string, label: string][] = presetPurities.map(id => [
  id,
  (purities.find(([value]) => value === id) || [, id])[1],
]);
// One resource's [impure, normal, pure] counts redistributed by a purity
// setting. Mostly Pure shifts each node up one level, Mostly Impure down one.
export function presetCounts(
  purity: string,
  [impure, normal, pure]: [number, number, number],
): NodeCounts {
  const all = impure + normal + pure;
  if (purity === 'pure') return { impure: 0, normal: 0, pure: all };
  if (purity === 'normal') return { impure: 0, normal: all, pure: 0 };
  if (purity === 'impure') return { impure: all, normal: 0, pure: 0 };
  if (purity === 'mostly-pure') return { impure: 0, normal: impure, pure: normal + pure };
  if (purity === 'mostly-impure') return { impure: impure + normal, normal: pure, pure: 0 };
  return { impure, normal, pure };
}
// The whole default world at one purity setting. Resource wells other than
// nitrogen are left alone: the known table does not cover oil wells, and
// whatever was entered for them is the user's own count.
//
// Nitrogen is filled only on the default distribution. Well randomization is
// applied to a whole well rather than to each satellite, and the map's wells
// hold different numbers of satellites, so a shuffle that leaves every ordinary
// node count intact still moves nitrogen onto a bigger or smaller well than it
// had. Under Random its satellites are the user's to count.
export function presetSurvey(
  purity: string,
  base?: Survey | null,
  distribution = 'original',
): Required<Survey> {
  const survey = { ...blankExtraction(), ...(base || {}) };
  survey.nodes = { ...survey.nodes };
  survey.wells = { ...survey.wells };
  for (const [name, counts] of Object.entries(nodeCounts)) {
    const row = presetCounts(purity, counts);
    if (name !== 'Nitrogen Gas') survey.nodes[name] = row;
    else if (distribution === 'original') survey.wells[name] = row;
  }
  return survey;
}

// Which preset, if any, the counts in a survey currently are. Used to show the
// active preset and to say where untouched numbers came from.
export function matchingPreset(extraction: Survey | null | undefined): string {
  const survey = { ...blankExtraction(), ...(extraction || {}) };
  for (const [id] of nodePresets) {
    const preset = presetSurvey(id);
    const same = Object.keys(nodeCounts)
      .filter(name => name !== 'Nitrogen Gas')
      .every(name => {
        const counted = { ...blankCounts(), ...(survey.nodes || {})[name] };
        // presetSurvey fills every resource of nodeCounts but nitrogen.
        const expected = preset.nodes[name]!;
        return (
          counted.impure === expected.impure &&
          counted.normal === expected.normal &&
          counted.pure === expected.pure
        );
      });
    if (same) return id;
  }
  return '';
}
// Where a survey starts when one has not been made yet: the world settings
// already entered on Game settings. Only where those counts are known — a
// resource-rich or randomised distribution, or a random or hand-set purity, has
// no table to start from, so it starts empty and asks.
export function startingSurvey(
  settings: { purity?: string; distribution?: string } = {},
): Required<Survey> {
  const distribution = settings.distribution || 'original';
  return knownWorld(settings.purity, distribution)
    ? presetSurvey(settings.purity as string, null, distribution)
    : blankExtraction();
}
