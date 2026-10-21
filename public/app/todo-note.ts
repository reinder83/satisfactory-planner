// The short note "Today's session" offers for the game's To-Do list (#1073), which takes at most
// 256 characters: the phase, the builds in order with their buildings, then as many of the parts
// as fit. It reads only its arguments (no session), so the limit is tested on its own.

// The most the in-game To-Do list takes.
export const TODO_LIMIT = 256;

// One build of the note: its step title and its buildings ("2 Refineries + 1 Water Extractor").
export interface NoteBuild {
  title: string;
  buildings: string;
}

// The note's length as the game counts it: characters, not UTF-16 units.
export const noteLength = (note: string): number => [...note].length;

// `text` cut to `limit` characters, ending in "…" when cut.
function clipNote(text: string, limit: number): string {
  const characters = [...text];
  return characters.length <= limit ? text : characters.slice(0, limit - 1).join('') + '…';
}

// The builds part: "1) Residual Plastic: 2 Refineries + 1 Water Extractor; 2) Iron Plate: 6
// Constructors", or, when that is too long, the titles alone ("1) Residual Plastic; 2) …").
function buildsPart(builds: readonly NoteBuild[], room: number): string {
  const full = builds
    .map((build, i) => `${i + 1}) ${build.title}${build.buildings ? ': ' + build.buildings : ''}`)
    .join('; ');
  if (noteLength(full) <= room) return full;
  return clipNote(builds.map((build, i) => `${i + 1}) ${build.title}`).join('; '), room);
}

// "Phase 3: 1) Residual Plastic: 2 Refineries + 1 Water Extractor; 2) Iron Plate: 6
// Constructors. Parts: 108 Cable, 60 Copper Sheet, …", at most `limit` characters: the builds
// first, the titles alone when their buildings do not fit, then each part while it fits, with "…"
// when some do not.
export function todoNote(
  heading: string,
  builds: readonly NoteBuild[],
  parts: readonly (readonly [string, number])[],
  limit = TODO_LIMIT,
): string {
  const head = heading + ': ';
  let note = head + buildsPart(builds, limit - noteLength(head));
  if (!builds.length) note = clipNote(heading + ': nothing left to build.', limit);
  const words = parts.map(([item, amount]) => `${Math.round(amount)} ${item}`);
  let listed = '';
  for (const [i, word] of words.entries()) {
    const next = (i ? listed + ', ' : '. Parts: ') + word;
    const rest = i < words.length - 1 ? ', …' : '';
    if (noteLength(note + next + rest) > limit) {
      if (i) listed += noteLength(note + listed + ', …') <= limit ? ', …' : '';
      break;
    }
    listed = next;
  }
  return clipNote(note + listed, limit);
}
