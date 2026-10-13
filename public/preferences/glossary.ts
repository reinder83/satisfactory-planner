// The glossary (#1076): the game terms a new player meets in the planner, each with a short
// definition and where to get it in the game. The pages mark a term with ui/Term.vue (one term)
// or ui/TermText.vue (the terms in a text), which open the definition on hover, focus and tap;
// docs/USER-GUIDE.md has the same list under "Glossary". Only the words on screen are marked: a
// step's saved `body` and every other text stay as they are, for search and copying.
export interface GlossaryEntry {
  // The term as the glossary heads it.
  label: string;
  // What it is.
  definition: string;
  // Where to get it in the game.
  where: string;
  // The words that mark it in a text, matched whole-word (case as written, see termPattern).
  match: RegExp;
}

export const glossary: Record<string, GlossaryEntry> = {
  mam: {
    label: 'MAM',
    definition:
      'The Molecular Analysis Machine, the research building. You feed it items such as ores, Power Slugs, Somersloops and hard drives to unlock research: Caterium, Quartz, Sulfur, Power Shards and more.',
    where: 'Build it after the Tier 1 milestone Field Research in the HUB.',
    match: /\bMAM\b/,
  },
  sam: {
    label: 'SAM',
    definition:
      'An alien raw resource. Late-game parts use it, mostly as Reanimated SAM and SAM Fluctuators, and converters turn it into other resources.',
    where: 'Mine it from SAM nodes with a Miner, then research it in the MAM to process it.',
    match: /\bSAM\b/,
  },
  slugs: {
    label: 'Power Slugs',
    definition:
      'Glowing blue, yellow and purple creatures found in the world. A Constructor turns each one into Power Shards: 1, 2 or 5.',
    where:
      'Pick them up while exploring, often on cliffs and in caves. Research them in the MAM (Power Slugs) to unlock the shard recipes.',
    match: /\b(?:[Pp]ower )?[Ss]lugs?\b/,
  },
  shards: {
    label: 'Power Shards',
    definition:
      'They let a machine run faster than 100%. Each shard in a machine raises its limit by 50%, up to 250% with three.',
    where:
      'Craft them from Power Slugs in a Constructor, after the MAM research Blue Power Slugs and Overclock Production.',
    match: /\b(?:[Pp]ower )?[Ss]hards?\b/,
  },
  drives: {
    label: 'Hard drives',
    definition:
      'Data drives salvaged from crashed drop pods. Analysing one in the MAM offers a choice of alternate recipes, and you keep the one you pick.',
    where:
      'Open the crash sites around the map. Some need power, an item or a cleared path before they open.',
    match: /\b[Hh]ard[- ][Dd]rives?\b/,
  },
  sink: {
    label: 'AWESOME Sink',
    definition:
      'A building that destroys the items you feed it and pays you points for them. The points print coupons for the AWESOME Shop.',
    where: 'Unlock the Tier 2 milestone Resource Sink Bonus Program in the HUB.',
    match: /\bAWESOME Sink\b/,
  },
  underclock: {
    label: 'Underclock',
    definition:
      'Running a machine slower than 100% by lowering its clock speed. It makes and uses less, and draws less power.',
    where: 'Set the clock speed in any machine’s menu. It needs nothing and works from the start.',
    match: /\b[Uu]nderclock(?:ed|ing|s)?\b/,
  },
  overclock: {
    label: 'Overclock',
    definition:
      'Running a machine faster than 100%, up to 250%. It needs Power Shards in the machine and draws much more power.',
    where:
      'Put Power Shards in the machine’s menu once the MAM research Overclock Production is done.',
    match: /\b[Oo]verclock(?:ed|ing|s)?\b/,
  },
  sloops: {
    label: 'Somersloops',
    definition:
      'Rare alien artifacts. One in a production machine doubles what it makes (production amplification); ten power an Alien Power Augmenter.',
    where:
      'Find them around the map; the world holds 106. Research them in the MAM (Alien Technology) to use them.',
    match: /\b[Ss]omersloops?\b/,
  },
  alternates: {
    label: 'Alternate recipes',
    definition:
      'Other recipes for a part, often with cheaper or different inputs. The standard recipe stays available.',
    where: 'Analyse a hard drive in the MAM and pick one of the recipes it offers.',
    match: /\b[Aa]lternate recipes?\b/,
  },
};

// A part of a text: plain words, or a glossary term (`term` its key) as written in the text.
export interface TermPart {
  text: string;
  term?: string;
}

// `text` split at the first occurrence of each term in `terms` (every glossary term when absent),
// so the parts join back to exactly `text`. A later occurrence, and one overlapping an earlier
// term, stays plain.
export function termParts(text: string, terms?: readonly string[]): TermPart[] {
  const keys = terms ?? Object.keys(glossary);
  const found = keys
    .flatMap(key => {
      const entry = glossary[key];
      const match = entry ? entry.match.exec(text) : null;
      return match ? [{ key, start: match.index, end: match.index + match[0].length }] : [];
    })
    .sort((a, b) => a.start - b.start);
  const parts: TermPart[] = [];
  let at = 0;
  for (const hit of found) {
    if (hit.start < at) continue;
    if (hit.start > at) parts.push({ text: text.slice(at, hit.start) });
    parts.push({ text: text.slice(hit.start, hit.end), term: hit.key });
    at = hit.end;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at) });
  return parts;
}

// For texts shown in this order on one screen, the terms each one marks: a term is marked only in
// the first text that has it, so a screen explains each term once.
export function firstTerms(texts: readonly string[]): string[][] {
  const seen = new Set<string>();
  return texts.map(text =>
    termParts(
      text,
      Object.keys(glossary).filter(key => !seen.has(key)),
    )
      .flatMap(part => (part.term ? [part.term] : []))
      .filter(key => !seen.has(key) && !!seen.add(key)),
  );
}
