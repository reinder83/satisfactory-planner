// Create stations from train links (#1301): Create saves the ticked proposals' new stations and
// lines as one `trainAdd` update through save(), so it reaches the profile it was made on and
// nothing else, and is never half applied. It says so in a toast with Undo (Ctrl+Z or ⌘Z too), as
// the other removals and bulk changes do, which takes them away again in one `trainRemove` update:
// only on the profile they were created on, and only those still as Create left them, so an edit
// made since (a renamed station, a wagon added to a line, a station another line now calls at) is
// kept.
import { save, toast } from '../api.ts';
import { onProfile, profileScope, state, type ProfileScope } from '../session.ts';
import { render } from '../shell.ts';
import { createdNews, undoneNews } from '../train-proposal.ts';
import type { TrainLine, TrainStation } from '../../types/index.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Saves `stations` and `lines` in one write. Resolves false when it was refused (save() has said
// why in a toast).
export async function createTrains(stations: TrainStation[], lines: TrainLine[]): Promise<boolean> {
  const profile = profileScope();
  try {
    await save({ type: 'trainAdd', stations, lines });
  } catch {
    render();
    return false;
  }
  render();
  // Compared later as the profile keeps them (validated), not as they were sent.
  const ids = new Set([...stations, ...lines].map(entry => entry.id));
  const saved = {
    stations: (state.trainStations ?? []).filter(station => ids.has(station.id)),
    lines: (state.trainLines ?? []).filter(line => ids.has(line.id)),
  };
  toast(createdNews(stations.length, lines.length), false, {
    label: 'Undo',
    run: () => void undoCreate(saved.stations, saved.lines, profile),
  });
  return true;
}

// Undo, from the toast: the created lines still as created, and the created stations still as
// created that no other line calls at.
async function undoCreate(stations: TrainStation[], lines: TrainLine[], profile: ProfileScope) {
  if (!onProfile(profile)) return;
  const nowLines = state.trainLines ?? [];
  const goneLines = lines.filter(line => {
    const now = nowLines.find(entry => entry.id === line.id);
    return now && same(now, line);
  });
  const kept = new Set(goneLines.map(line => line.id));
  const goneStations = stations.filter(station => {
    const now = state.trainStations?.find(entry => entry.id === station.id);
    const calledElsewhere = nowLines.some(
      line => !kept.has(line.id) && line.stops.includes(station.id),
    );
    return now && same(now, station) && !calledElsewhere;
  });
  if (!goneStations.length && !goneLines.length) return;
  try {
    await save({
      type: 'trainRemove',
      stations: goneStations.map(station => station.id),
      lines: goneLines.map(line => line.id),
    });
  } catch {
    render();
    return;
  }
  render();
  toast(undoneNews(goneStations.length, goneLines.length));
}
