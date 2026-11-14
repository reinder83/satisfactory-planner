// The facts on a factory's card on the world map (MAP-3, #1348) from the open profile: the pure
// part, factoryFacts, is in map-factory-card.ts.
import { groupBuiltCount } from '../views/calculated.ts';
import { factoryWaiting } from '../factory-waiting.ts';
import { groupLinks } from '../group-links.ts';
import { rowPlaces } from '../group-order.ts';
import { calcStage, calculated, checked, stage } from '../session.ts';
import { factoryFacts, type FactoryFacts } from '../map-factory-card.ts';
import { factoryGroupsState, membershipsOf } from '../views/factories.ts';
import type { StoredStage } from '../../types/index.ts';

// The facts of factory `groupId` in the open profile, or null while there is no calculated plan.
export function liveFactoryFacts(groupId: string): FactoryFacts | null {
  const rows = calcStage()?.rows;
  const snapshot: StoredStage | undefined = calcStage();
  if (!calculated || !rows || !snapshot) return null;
  const groups = factoryGroupsState();
  const own = rows.filter(row => membershipsOf(row.id).some(m => m.group === groupId));
  return factoryFacts(rows, groups, groupId, {
    isRunning: row => checked('calc-' + stage() + '-' + row.id),
    count: groupBuiltCount(groupId, row => rowPlaces(row, groups).get(groupId) ?? 0),
    heldBack: !!factoryWaiting(
      groupId,
      own.map(row => row.id),
    ),
    links: groupLinks(snapshot, groups, calculated.settings.onSite),
  });
}
