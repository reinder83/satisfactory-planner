// What the quick-jump search (Ctrl+K or "/", ui/JumpDialog.vue, #1351) looks through: the open
// profile's production lines (by name and by the parts they make), factories, build-plan steps of
// the phase shown, storage containers (by address or item) and notes. Read-only: it only reads
// session state and saves nothing. A result says what it is (`kind`), the text to show, and a
// small line under it; opening one is jumpTo() in ui/jump.ts.
import { calcStage, calculated, phase, phaseLabel, state, stateLoaded } from './session.ts';
import { planTasks } from './tasks.ts';
import { stepRowName } from './views/calculated.ts';
import { storageMatches } from './views/storage.ts';

export type JumpKind = 'line' | 'factory' | 'step' | 'container' | 'note';

export interface JumpResult {
  kind: JumpKind;
  // Where it leads: a row id, group id, step id, container address or note key.
  id: string;
  label: string;
  hint: string;
}

// The headings of the result groups, in the order they are listed.
export const JUMP_GROUPS: Record<JumpKind, string> = {
  line: 'Production lines',
  factory: 'Factories',
  step: 'Build plan steps',
  container: 'Storage containers',
  note: 'Notes',
};
const ORDER = Object.keys(JUMP_GROUPS) as JumpKind[];
// The most results one group lists, and in all.
export const JUMP_PER_GROUP = 6;
const SNIPPET = 70;

// A line of the note around the first word that matched, so the result shows why it matched.
function snippet(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(words[0] ?? ''));
  const from = Math.max(0, at - 20);
  return (
    (from > 0 ? '…' : '') +
    flat.slice(from, from + SNIPPET) +
    (flat.length > from + SNIPPET ? '…' : '')
  );
}

// The label of the thing a note belongs to: note keys are 'global', 'phase-<phase>',
// 'factory-<row id>' and 'slot-<address>'.
function noteLabel(key: string): string {
  if (key === 'global') return 'Save-wide notes';
  if (key.startsWith('phase-')) return 'Notes for ' + phaseLabel(key.slice(6));
  if (key.startsWith('slot-')) return 'Note on container ' + key.slice(5);
  const row = calcStage()?.rows?.find(r => 'factory-' + r.id === key);
  return row ? 'Note on ' + stepRowName(row) : 'Note';
}

// The results for `query`: every word must appear (case-insensitive) in the text searched.
// Nothing for an empty query or before a profile is open.
export function jumpResults(query: string): JumpResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !stateLoaded) return [];
  const hit = (...texts: string[]) => {
    const text = texts.join(' ').toLowerCase();
    return words.every(word => text.includes(word));
  };
  const found: JumpResult[] = [];
  if (calculated) {
    for (const row of calcStage()?.rows ?? []) {
      const name = stepRowName(row),
        makes = Object.keys(row.outputs || {});
      if (hit(name, makes.join(' ')))
        found.push({
          kind: 'line',
          id: row.id,
          label: name,
          hint: makes.length ? 'Makes ' + makes.join(', ') : 'Production line',
        });
    }
    for (const step of planTasks())
      if (hit(step.title))
        found.push({
          kind: 'step',
          id: step.id,
          label: step.title,
          hint: 'Build plan · ' + phaseLabel(phase()),
        });
  }
  for (const group of state.factoryGroups?.groups ?? [])
    if (hit(group.name))
      found.push({ kind: 'factory', id: group.id, label: group.name, hint: 'Factory' });
  // storageMatches() takes one query, so the words are searched as typed when there is one.
  for (const match of storageMatches(query.trim()))
    found.push({
      kind: 'container',
      id: match.id,
      label: match.id + ' · ' + match.name,
      hint: match.floorLabel,
    });
  for (const [key, text] of Object.entries(state.notes || {}))
    if (text.trim() && hit(text))
      found.push({ kind: 'note', id: key, label: noteLabel(key), hint: snippet(text, words) });
  return ORDER.flatMap(kind => found.filter(r => r.kind === kind).slice(0, JUMP_PER_GROUP));
}
