// Bringing a factory section or a line to the user on the factories page: the jump bar's buttons,
// the "Show" of a held-back banner (FAC-2, #1342) and the edit-mode factory switch (FAC-3). A
// folded section is unfolded first and stays unfolded, since going there is asking to see it. In
// edit mode only one factory is open, so going to another one switches to it (groupFolded in
// views/factories.ts), unless the open one still shows a "Made on site" choice that is not saved:
// then that picker says so (holdUnsavedChoices) and nothing moves.
import { nextTick } from 'vue';
import { holdUnsavedChoices } from '../../api.ts';
import {
  factoryEditing,
  sectionCollapsed,
  setFactoryFilter,
  setQuery,
  setSectionCollapsed,
} from '../../session.ts';
import { render } from '../../shell.ts';
import {
  groupFolded,
  openFactoryId,
  setGroupFolded,
  factoryGroupsState,
} from '../../views/factories.ts';
import { focusSection } from '../refocus.ts';

// Unfolds section `key` (a factory id, or 'site-oil' / 'site-nuclear') and redraws. False when an
// unsaved choice in the factory open now keeps it from switching.
export async function revealSection(key: string): Promise<boolean> {
  const isFactory = factoryGroupsState().groups.some(group => group.id === key);
  if (isFactory ? !groupFolded(key) : !sectionCollapsed(key)) return true;
  if (isFactory && factoryEditing) {
    const open = document.getElementById('section-' + openFactoryId());
    if (open && holdUnsavedChoices(open)) return false;
  }
  if (isFactory) setGroupFolded(key, false);
  else setSectionCollapsed(key, false);
  render();
  await nextTick();
  return true;
}

// Focuses section `key`'s heading, unfolding it first.
export async function showSection(key: string) {
  if (!(await revealSection(key))) return;
  const section = document.getElementById('section-' + key);
  if (section) focusSection(section);
}

// Focuses the card of line `rowId` (its name link), in `section` unfolded first; when the search
// or the status chip hides the card, All and an empty search come back, as "Show all" does.
export async function showLine(rowId: string, section: string | null) {
  if (section && !(await revealSection(section))) return;
  const find = () =>
    document.querySelector<HTMLElement>(`.factory-card [data-calc-factory="${CSS.escape(rowId)}"]`);
  let link = find();
  if (!link) {
    setFactoryFilter('all');
    setQuery('');
    render();
    await nextTick();
    link = find();
  }
  if (!link) return;
  link.focus({ preventScroll: true });
  link.scrollIntoView({ block: 'center' });
}
