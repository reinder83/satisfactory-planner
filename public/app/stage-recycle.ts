// The recycling model (recycleModel in recycle.ts) of a stage of the open plan, for the profile's
// factory groups: every line-level transfer of the phase, as the Logistics page's books share each
// item out. The build plan, a group's flow page and the production line dialog (its byproduct
// advice, its burn note and, since #1155, each line's part of the sink in its flow) ask for it once
// per line, so it is worked out once per stage, groups and plan. Its Water Extractor options follow
// the stage's phase and the plan's settings (waterChoice, #1142). It reads the stored plan and
// changes nothing.
import { recycleModel } from './recycle.ts';
import type { RecycleModel } from './recycle.ts';
import { calculated } from './session.ts';
import { factoryGroupsState } from './views/factories.ts';
import { waterChoice } from '../mining.ts';
import type { StoredStage } from '../types/index.ts';

let recycleCache:
  { snapshot: StoredStage; groups: string; plan: unknown; model: RecycleModel } | undefined;

// The recycling model of `snapshot`, a stage of the open plan (see the top of this file).
export function recycleModelOf(snapshot: StoredStage): RecycleModel {
  const groups = factoryGroupsState(),
    key = JSON.stringify(groups);
  const cache = recycleCache;
  if (cache?.snapshot === snapshot && cache.groups === key && cache.plan === calculated)
    return cache.model;
  // The phase the stage is, for its Water Extractor options (#1142).
  const phase = Object.entries(calculated?.stages ?? {}).find(
    ([, stage]) => stage === snapshot,
  )?.[0];
  const model = recycleModel(
    snapshot,
    groups,
    calculated?.settings.onSite,
    waterChoice(snapshot, Number(phase ?? 0), calculated?.settings),
  );
  recycleCache = { snapshot, groups: key, plan: calculated, model };
  return model;
}
