// ADA's remark is never cut (#738, option B): she stays in the sidebar with all of it, and the
// sidebar makes room instead. Beside the phone layout it reserves its scrollbar's room, so a
// long remark that makes it scroll never re-wraps the profile footer, and a short or narrow
// window tightens the sidebar's spacing (style.css).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, setAdaIndex, setAdaMuted } from '../../public/app/ada-panel.ts';
import { setContext, setView, setWorkspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { $, $$, handbook, migratedPlan } from './setup.ts';
import type { ProgressState, TaskEdits, WorkspaceSummary } from '../../public/types/index.ts';

// A step title long enough to make ADA's first remark well over 240 characters.
const longTitle =
  'Build the north-east iron outpost with its own coal generators, a train station for the ' +
  'screws and rotors, and a second floor reserved for the steel line that comes in Phase 4';

// A profile migrated from the handbook (#387), whose guide keeps the handbook's steps.
function open() {
  // Partial fixtures: only the fields the frame reads.
  setWorkspace({
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: {},
    saves: [
      { id: 's', name: 'Save', profiles: [{ id: 'original', kind: 'calculated', name: 'P' }] },
    ],
  } as WorkspaceSummary);
  const plan = handbook.phases['3']!;
  const state: Partial<ProgressState> = {
    settings: { phase: '3' },
    checks: {},
    notes: {},
    deliveries: {},
    customTasks: [],
    taskEdits: { titles: { [plan[0]!.id]: longTitle } } as TaskEdits,
  };
  setContext({
    save: { id: 's', name: 'Save' },
    profile: { id: 'original', kind: 'calculated', name: 'P' },
    state: state as ProgressState,
    plan: migratedPlan(),
  });
}

beforeEach(() => {
  unmountShell();
  document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
  setAdaMuted(false);
  setAdaIndex(0);
  adaClearFault();
  setView('plan');
  open();
});

const css = fs.readFileSync('public/style.css', 'utf8').replace(/\r/g, '');
// The bodies of every top-level `@media <query> {`, each up to its closing brace.
function mediaBlock(query: string) {
  const head = `\n@media ${query} {`;
  const bodies: string[] = [];
  for (let start = css.indexOf(head); start >= 0; start = css.indexOf(head, start + 1)) {
    let depth = 0;
    for (let i = start + head.length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        bodies.push(css.slice(start + head.length, i));
        break;
      }
    }
  }
  assert.ok(bodies.length, `@media ${query}`);
  return bodies.join('\n');
}
// One rule's declarations, inside `source` (a media block's body, or the whole sheet for a
// top-level rule, which is not indented).
function rule(source: string, selector: string, indent = '') {
  const start = source.indexOf(`\n${indent}${selector} {`);
  assert.ok(start >= 0, `${selector} {`);
  return source.slice(start, source.indexOf('}', start));
}

test('ADA keeps her whole remark in the sidebar, with no More/Less (#738)', async () => {
  render();
  await nextTick();
  const ada = $('#sidebar .ada')!;
  assert.ok(ada, 'ADA is in the sidebar');
  assert.equal($('.topbar .ada'), null, 'not in the top bar');
  const line = $('#ada-line')!;
  assert.ok(ada.contains(line));
  assert.ok(line.textContent!.includes(longTitle), 'the whole remark, not cut');
  assert.ok(line.textContent!.length > 240);
  assert.equal(document.querySelectorAll('#ada-line').length, 1);
  assert.equal(line.getAttribute('aria-live'), 'polite');
  // No button to see more or less of it.
  const buttons = $$('#sidebar .ada button').map(button => button.textContent!.trim());
  assert.ok(!buttons.some(text => /^(More|Less)$/.test(text)), buttons.join(', '));
  assert.ok(!line.classList.contains('is-full'));
  // Her tools and the badge's easter egg stay where they were.
  assert.ok(ada.querySelector('[data-ada-next]'));
  assert.ok(ada.querySelector('[data-ada-mute="on"]'));
  assert.ok(ada.querySelector('.ada-head .ada-mark'));
});

test('the stylesheet never cuts the remark (#738)', () => {
  assert.doesNotMatch(css, /line-clamp/);
  assert.doesNotMatch(rule(css, '.ada-line'), /overflow|max-height/);
});

test('beside the phone layout the sidebar reserves its scrollbar’s room (#738)', () => {
  const desktop = mediaBlock('(min-width: 721px)');
  assert.match(rule(desktop, '.sidebar', '  '), /scrollbar-gutter: stable;/);
  // The phone drawer is not touched: the base rule has no gutter of its own.
  assert.doesNotMatch(rule(css, '.sidebar'), /scrollbar-gutter/);
});

test('a short or narrow desktop window tightens the sidebar’s spacing only (#738)', () => {
  const compact = mediaBlock(
    '(min-width: 721px) and (max-height: 900px), (min-width: 721px) and (max-width: 1100px)',
  );
  // The navigation links are shorter there than in a tall, wide window.
  const padding = (source: string, indent: string) =>
    rule(source, '.nav a', indent).match(/padding(?:-top)?: (\d+)px/)![1]!;
  assert.equal(padding(css, ''), '12');
  assert.ok(Number(padding(compact, '  ')) < 12);
  for (const selector of ['.sidebar', '.brand', '.ada', '.save-status', '.sidebar-foot'])
    assert.ok(rule(compact, selector, '  '), selector);
  // Spacing, not a cut: nothing in it hides part of the remark.
  assert.doesNotMatch(compact, /line-clamp|overflow|max-height|display: none/);
});
