// "Restore this version" on Saves & profiles (#1071): only the card of a version a recalculation
// in place kept (its summary names the profile it was kept for, backupOf) says so and offers the
// action in its ⋯ menu. Pressed, it asks first, naming both profiles and the name the replaced
// version will be kept under; Cancel sends nothing. Confirmed, it sends POST
// /api/restore-version scoped to the kept version, naming the plans both cards show, reloads the
// open profile when it was one of the two, and says what happened. A 409 brings the list up to
// date.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWorkspace, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { restoreStale } from '../../public/state.ts';
import type { ProfileSummary, WorkspaceSummary } from '../../public/types/index.ts';
import { $, $$, answerConfirms, evil, generated, go, open, page, stubFetch } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const KEPT = 'Balanced (before edit, Oct 7, 2:05 PM)';

const card = (id: string, name: string, extra: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id,
  name,
  kind: 'calculated',
  completed: 3,
  phase: '1',
  settings: generated().settings,
  ...extra,
});
// A save with the edited profile (open), the version its edit kept and an unrelated profile.
function summary(into = 'Balanced'): WorkspaceSummary {
  return {
    ...workspace,
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'p',
        profiles: [
          card('p', into, { planCreatedAt: 'plan-edited' }),
          card('b', KEPT, { backupOf: 'p', planCreatedAt: 'plan-kept' }),
          card('o', 'Other', { planCreatedAt: 'plan-other' }),
        ],
      },
    ],
  };
}
const context = {
  save: { id: 's', name: 'World' },
  profile: { id: 'p', kind: 'calculated', name: 'Balanced' },
  state: { settings: { phase: '1' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
  plan: generated(),
};

async function showProfiles(into = 'Balanced') {
  setWorkspace(summary(into));
  go('profiles');
  render();
  await settle();
}
async function pressRestore() {
  $('[data-profile-menu="b"]')!.click();
  await nextTick();
  $('[data-restore-version="b"]')!.click();
  await settle();
  await settle();
}

beforeEach(() => {
  page();
  open({ name: 'Balanced', calculated: generated() });
});

test('only a kept version’s card says so and offers Restore this version', async () => {
  stubFetch({ '/api/workspace': summary() });
  await showProfiles();
  assert.deepEqual(
    $$('[data-restore-version]').map(item => item.getAttribute('data-restore-version')),
    ['b'],
  );
  assert.equal(text('[data-restore-version="b"]'), 'Restore this version…');
  assert.equal(text('[data-kept-for="b"]'), 'Kept version of “Balanced”');
  assert.deepEqual(
    $$('[data-kept-for]').map(line => line.getAttribute('data-kept-for')),
    ['b'],
  );
});

test('Cancel sends nothing', async () => {
  const calls = stubFetch({ '/api/workspace': summary() });
  await showProfiles();
  const asked = answerConfirms(false);
  calls.length = 0;
  await pressRestore();
  assert.equal(asked.length, 1);
  assert.match(
    asked[0]!,
    /^“Balanced” gets the plan and progress of “Balanced \(before edit, Oct 7, 2:05 PM\)” back, under its own name\. Its current version is kept as “Balanced \(before restore, .+\)”, with all of its progress, so you can switch back the same way\.$/,
  );
  assert.deepEqual(calls, [], 'nothing is sent');
});

test('confirmed, it restores, reloads the open profile and says where the replaced version is', async () => {
  const calls = stubFetch<Record<string, unknown>>({
    '/api/workspace': summary(),
    '/api/restore-version': { workspace: summary(), saveId: 's', profileId: 'p', backupId: 'b' },
    '/api/context': context,
  });
  await showProfiles();
  answerConfirms(true);
  // calls.headers keeps every request's headers, so the calls are not cleared here.
  await pressRestore();
  const sent = calls.findIndex(([path]) => path === '/api/restore-version');
  assert.ok(sent >= 0, 'the restore is sent');
  const body = calls[sent]![1];
  assert.equal(body.into, 'p');
  assert.equal(body.planCreatedAt, 'plan-edited', 'naming the plans the cards show');
  assert.equal(body.backupPlanCreatedAt, 'plan-kept');
  assert.match(String(body.backupName), /^Balanced \(before restore, .+\)$/);
  assert.equal(calls.headers[sent]!['X-Profile-Id'], 'b', 'scoped to the kept version');
  assert.equal(calls.headers[sent]!['X-Save-Id'], 's');
  assert.ok(
    calls.slice(sent).some(([path]) => path.startsWith('/api/context')),
    'the open profile, one of the two, is loaded again',
  );
  assert.match(
    text('#toast'),
    /^Restored\. “Balanced” has this version’s plan and progress again\. The version it replaced is kept as “Balanced \(before restore, .+\)” under Profiles\.$/,
  );
});

test('a profile changed meanwhile is refused, said, and the list brought up to date', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (path: RequestInfo | URL) => {
    calls.push(String(path));
    if (String(path).startsWith('/api/restore-version'))
      return new Response(JSON.stringify({ error: restoreStale }), { status: 409 });
    return new Response(JSON.stringify(summary()), { status: 200 });
  };
  await showProfiles();
  answerConfirms(true);
  calls.length = 0;
  await pressRestore();
  assert.deepEqual(calls, ['/api/restore-version', '/api/workspace']);
  assert.equal(text('#toast'), restoreStale);
});

test('names are text, never markup', async () => {
  stubFetch({ '/api/workspace': summary(evil) });
  await showProfiles(evil);
  assert.equal(text('[data-kept-for="b"]'), `Kept version of “${evil}”`);
  const asked = answerConfirms(false);
  await pressRestore();
  assert.ok(asked[0]!.startsWith(`“${evil}” gets the plan`));
  assert.equal(document.querySelector('x-evil'), null);
});
