// The "Rename to …" offer on Saves & profiles (#1071): only a card still named after its goal alone
// offers the descriptive name (goal, changes, date), numbered when two would be the same. Showing
// it sends nothing. "Rename to “…”" renames the profile through /api/rename and the offer goes;
// ✕ (labelled "Keep the name “…”") sends /api/dismiss-rename-offer, the offer goes and stays gone
// when the page is drawn again from the stored summary. Either way focus goes to the card's ✎.
// A profile with a name of its own never shows it.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWorkspace, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { nameDate } from '../../public/app/profile-edit.ts';
import type { ProfileSummary, StoredSettings, WorkspaceSummary } from '../../public/types/index.ts';
import { $, $$, evil, generated, go, open, page } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const DAY = '2026-10-07T12:00:00.000Z';
const day = nameDate(new Date(DAY));
const GOALS = [
  { id: 'minimal', name: 'Minimal construction', description: '' },
  { id: 'balanced', name: 'Balanced progression', description: '' },
  { id: 'timed', name: 'Target completion time', description: '' },
  { id: 'maximum', name: 'Maximum elevator output', description: '' },
];
const SETTINGS = {
  ...generated().settings,
  goal: 'balanced',
  phase: '1',
  purity: 'vanilla',
  multiplier: 1,
  powerFactor: 1,
  recipes: 'standard',
  wholeMachines: true,
} as StoredSettings;

const card = (id: string, name: string, extra: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id,
  name,
  kind: 'calculated',
  completed: 0,
  phase: '1',
  settings: SETTINGS,
  planCreatedAt: DAY,
  ...extra,
});

// A stand-in server: the stored cards, the requests it got (path, body, scoped profile), and the
// routes the page sends: the summary, a rename and a dismissal.
function server(profiles: ProfileSummary[], goals: typeof GOALS = GOALS) {
  const calls: [path: string, body: Record<string, unknown> | undefined, profile?: string][] = [];
  const summary = (): WorkspaceSummary => ({
    ...workspace,
    catalog: { ...workspace.catalog, goals },
    saves: [{ id: 's', name: 'World', activeProfile: 'p', profiles: structuredClone(profiles) }],
  });
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    const profileId = (options.headers as Record<string, string> | undefined)?.['X-Profile-Id'];
    calls.push([String(path), body, profileId]);
    const profile = profiles.find(p => p.id === profileId);
    if (String(path) === '/api/rename' && profile) profile.name = body.name;
    else if (String(path) === '/api/dismiss-rename-offer' && profile)
      profile.renameOfferDismissed = true;
    else if (String(path) !== '/api/workspace')
      return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
    return new Response(JSON.stringify(summary()), { status: 200 });
  };
  return { calls, summary };
}
async function showProfiles(summary: () => WorkspaceSummary) {
  setWorkspace(summary());
  go('profiles');
  render();
  await settle();
}
const offered = () =>
  $$('[data-rename-offer]').map(offer => offer.getAttribute('data-rename-offer'));

beforeEach(() => {
  page();
  open({ name: 'Balanced progression', calculated: generated() });
});

test('only cards named after their goal alone offer a name, and showing them sends nothing', async () => {
  const { calls, summary } = server([
    card('p', 'Balanced progression'),
    card('q', 'Balanced progression', { settings: { ...SETTINGS, wholeMachines: false } }),
    card('r', 'Balanced progression'),
    card('m', 'Minimal construction', { settings: { ...SETTINGS, goal: 'minimal', phase: '3' } }),
    card('c', 'My coal power'),
    card('k', 'Balanced progression · copy'),
    card('d', 'Balanced progression', { renameOfferDismissed: true }),
  ]);
  await showProfiles(summary);
  assert.deepEqual(offered(), ['p', 'q', 'r', 'm']);
  assert.equal(text('[data-rename-offer-accept="p"]'), `Rename to “Balanced progression · ${day}”`);
  assert.equal(
    text('[data-rename-offer-accept="q"]'),
    `Rename to “Balanced progression · exact ratios · ${day}”`,
  );
  assert.equal(
    text('[data-rename-offer-accept="r"]'),
    `Rename to “Balanced progression · ${day} · 2”`,
    'numbered apart from the first card',
  );
  assert.equal(
    text('[data-rename-offer-accept="m"]'),
    `Rename to “Minimal construction · from Phase 3 · ${day}”`,
  );
  // Real buttons; ✕ is named by its label, its glyph hidden.
  for (const id of offered()) {
    assert.equal($(`[data-rename-offer-accept="${id}"]`)!.tagName, 'BUTTON');
    const dismiss = $(`[data-rename-offer-dismiss="${id}"]`)!;
    assert.equal(dismiss.tagName, 'BUTTON');
    assert.equal(dismiss.getAttribute('type'), 'button');
    assert.match(dismiss.getAttribute('aria-label')!, /^Keep the name “.+”$/);
    assert.equal(dismiss.querySelector('[aria-hidden="true"]')?.textContent, '✕');
  }
  assert.deepEqual(
    calls.filter(([path]) => path !== '/api/workspace'),
    [],
    'nothing is renamed or stored by showing the offer',
  );
});

test('Rename to renames the profile through /api/rename; the offer goes and focus lands on ✎', async () => {
  const { calls, summary } = server([
    card('p', 'Balanced progression'),
    card('q', 'Balanced progression', { settings: { ...SETTINGS, wholeMachines: false } }),
  ]);
  await showProfiles(summary);
  calls.length = 0;
  $('[data-rename-offer-accept="q"]')!.click();
  await settle();
  assert.deepEqual(calls, [
    [
      '/api/rename',
      { target: 'profile', name: `Balanced progression · exact ratios · ${day}` },
      'q',
    ],
  ]);
  assert.deepEqual(offered(), ['p']);
  assert.ok(
    $$('.profile-card h3').some(
      h => h.textContent === `Balanced progression · exact ratios · ${day}`,
    ),
    'the card shows the new name',
  );
  const focused = document.activeElement as HTMLElement;
  assert.equal(focused.getAttribute('data-rename-profile'), 'q', 'focus goes to the card’s ✎');
  assert.equal(
    focused.getAttribute('aria-label'),
    `Rename profile Balanced progression · exact ratios · ${day}`,
  );
});

test('✕ keeps the name, stores the dismissal, and the offer stays gone when drawn again', async () => {
  const { calls, summary } = server([
    card('p', 'Balanced progression'),
    card('q', 'Balanced progression', { settings: { ...SETTINGS, wholeMachines: false } }),
  ]);
  await showProfiles(summary);
  calls.length = 0;
  $('[data-rename-offer-dismiss="p"]')!.click();
  await settle();
  assert.deepEqual(calls, [['/api/dismiss-rename-offer', {}, 'p']], 'only the dismissal is sent');
  assert.deepEqual(offered(), ['q']);
  const focused = document.activeElement as HTMLElement;
  assert.equal(focused.getAttribute('data-rename-profile'), 'p', 'focus goes to the card’s ✎');
  assert.equal(focused.getAttribute('aria-label'), 'Rename profile Balanced progression');
  // Drawn again from the stored summary, as after a reload: still gone, the name unchanged.
  page();
  open({ name: 'Balanced progression', calculated: generated() });
  await showProfiles(summary);
  assert.deepEqual(offered(), ['q']);
  assert.equal(
    $$('.profile-card h3').filter(h => h.textContent === 'Balanced progression').length,
    2,
  );
});

test('a profile with a name of its own never offers one, and names stay text', async () => {
  const { summary } = server([card('p', 'My coal power'), card('e', evil)]);
  await showProfiles(summary);
  assert.deepEqual(offered(), []);
});

test('the offered name and the ✕ label are text, never markup', async () => {
  // A catalog whose goal is named like markup, and a profile carrying that name.
  const { summary } = server([card('p', evil)], [{ id: 'balanced', name: evil, description: '' }]);
  await showProfiles(summary);
  assert.deepEqual(offered(), ['p']);
  assert.equal(document.querySelector('x-evil'), null);
  assert.equal(text('[data-rename-offer-accept="p"]'), `Rename to “${evil} · ${day}”`);
  assert.equal(
    $('[data-rename-offer-dismiss="p"]')!.getAttribute('aria-label'),
    `Keep the name “${evil}”`,
  );
});
