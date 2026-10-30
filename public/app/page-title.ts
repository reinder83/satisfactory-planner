// The browser tab's title (#1254, WCAG 2.4.2 Page Titled): the page's heading, the page it is on
// and the app, "Phase 3 · Build plan · Satisfactory Planner", so the tab, the history and a screen
// reader's window title say which page is open. PageHeader.vue sets it from its h1 in both
// editions; index.html's own title only shows until the first page is drawn.
import type { View } from './session.ts';

const APP_TITLE = 'Satisfactory Planner';

// Each route's page name: the sidebar's labels (Shell.vue), and the pages it has no link for.
// The wizard's headings name their page themselves ("Create your factory plan", "Edit the
// settings of …"), so it has none.
export const PAGE_NAMES: Record<View, string> = {
  plan: 'Build plan',
  factories: 'Factories',
  logistics: 'Logistics',
  map: 'World map',
  storage: 'Storage room',
  resources: 'Power & resources',
  notes: 'Notes',
  session: "Today's session",
  backup: 'Backup',
  profiles: 'Saves & profiles',
  wizard: '',
  account: 'Account',
};

// The title for a page whose heading is `heading` on route `view`; a heading that is the page's
// name ("Factories" on Factories) is said once.
export function pageTitle(heading: string, view: View): string {
  const parts = [heading.trim(), PAGE_NAMES[view]].filter(Boolean);
  return [...new Set(parts), APP_TITLE].join(' · ');
}
