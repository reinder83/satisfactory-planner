// Where each protected container's rate comes from (#1061), read beside the stored plan, nothing
// stored. A whole-machine plan calculated with `storageFromSurplus` records what the settings ask
// (`storageAsked`) and what storage receives (`storage`): from the plan's surplus, or from
// storage-only lines (`stock` rows) for an item with no surplus. No session imports, so the node
// tests read it directly.
import type { CalcRow, ItemRates } from '../types/index.ts';

export interface StorageSource {
  item: string;
  filled: number;
  asked: number;
  // 'surplus': the plan makes more than it uses; 'line': storage-only lines make it; 'both': the
  // surplus, topped up to a rate set for the item itself; 'none': nothing spare and no
  // storage-only line fits the budgets.
  source: 'surplus' | 'line' | 'both' | 'none';
}

// The containers of `stage` with a rate asked, or null for a plan that reserved its storage rates
// in its lines (stored before #1061, or calculated without storageFromSurplus).
export function storageSources(stage: {
  storage?: ItemRates;
  storageAsked?: ItemRates;
  rows?: CalcRow[];
}): StorageSource[] | null {
  const asked = stage.storageAsked;
  if (!asked) return null;
  // What the storage-only lines make of each item beyond what they use themselves.
  const lined: ItemRates = {};
  for (const row of (stage.rows || []).filter(row => row.stock)) {
    for (const [item, rate] of Object.entries(row.outputs)) lined[item] = (lined[item] || 0) + rate;
    for (const [item, rate] of Object.entries(row.inputs)) lined[item] = (lined[item] || 0) - rate;
  }
  return Object.entries(asked)
    .filter(([, rate]) => rate > 0)
    .map(([item, rate]) => {
      const filled = stage.storage?.[item] || 0;
      return {
        item,
        filled,
        asked: rate,
        source: !filled
          ? 'none'
          : (lined[item] || 0) <= 0.002
            ? 'surplus'
            : filled - (lined[item] || 0) > 0.002
              ? 'both'
              : 'line',
      };
    });
}
