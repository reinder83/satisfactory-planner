// The phase tabs of a factory's views (#1317, ui/PhaseTabs.vue): the build order page
// (ui/pages/GroupFlowPage.vue) and the flow graph dialog (ui/detail/FlowGraphDialog.vue) draw
// any phase of the plan for one factory without switching the profile's phase. This is which
// tabs there are, which one is open first and what each is called. View state only: nothing here
// is saved.
import type { StageKey } from '../types/index.ts';
import { phase, phaseLabel, phaseOptions, stage } from './session.ts';
import { shownGroupFlow } from './shown-group-flow.ts';

export interface PhaseTab {
  key: StageKey;
  // "Phase 4", "Post Phase 5".
  label: string;
  // The phase on screen: its tab says "· current".
  current: boolean;
  // The factory has no lines in this phase (or it is a milestone-only one).
  empty: boolean;
}

// The id of a tab, so a panel can be labelled by it.
export const tabId = (prefix: string, key: StageKey) => `${prefix}-tab-${key}`;

// A tab for each phase the profile offers, in order: Post Phase 5 shares Phase 5's stage, so it
// has no tab of its own and labels Phase 5's while it is the phase on screen. The phase on
// screen (phase(): the working phase unless this tab shows another) is the current one.
export function phaseTabs(groupId: string): PhaseTab[] {
  const current = stage();
  const keys = [...new Set(phaseOptions().map(option => (option === 'post' ? '5' : option)))];
  return keys.map(key => ({
    key,
    label: phaseLabel(key === current ? phase() : key),
    current: key === current,
    empty: !shownGroupFlow(groupId, key)?.lines.length,
  }));
}

// The tab a page opens on: the one asked for (an address's ?view=) when it is a tab with lines,
// else the current one.
export function openTab(tabs: readonly PhaseTab[], asked: string | null): StageKey {
  const found = tabs.find(tab => tab.key === asked && !tab.empty);
  return found?.key ?? tabs.find(tab => tab.current)?.key ?? stage();
}
