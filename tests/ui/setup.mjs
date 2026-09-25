// Shared set-up for the component tests: a page with #app, and a save opened the way
// loadContext() opens one, with a hostile name wherever user text appears.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { setContext, setProgressionData, setView, setWorkspace } from '../../public/app/session.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';

// Vitest runs from the repository root.
export const handbook = JSON.parse(fs.readFileSync('public/plan.json', 'utf8'));
setProgressionData(JSON.parse(fs.readFileSync('public/progression.json', 'utf8')));
// A real calculated plan (planner.mjs with default settings), made once per test file. The
// planner reads its data files through import.meta.url, which happy-dom does not give it, so
// it runs in Node.
let generatedPlan;
export const generated = () =>
  structuredClone(
    (generatedPlan ??= JSON.parse(
      execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        "import('./planner.mjs').then(m => process.stdout.write(JSON.stringify(m.calculate({}))))",
      ]),
    )),
  );
// The server's item catalog (planner.mjs catalog(): raw resources, budgets, goals, …), made
// once per test file in Node for the same reason.
let catalogData;
export const catalog = () =>
  structuredClone(
    (catalogData ??= JSON.parse(
      execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        "import('./planner.mjs').then(m => process.stdout.write(JSON.stringify(m.catalog())))",
      ]),
    )),
  );
export const evil = '<x-evil onclick=alert(1)> & "quoted"';
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

export function page() {
  unmountShell();
  document.body.innerHTML =
    '<div id="app"></div><div id="toast"></div><dialog id="detail"></dialog>';
}

// Opens the handbook profile (calculated: false), a small calculated one (true) or the
// given calculated plan. `workspace` and `state` fields override the defaults.
export function open({
  name = evil,
  calculated = false,
  phase = '3',
  notes = {},
  workspace,
  state,
} = {}) {
  const profile = calculated
    ? { id: 'p', kind: 'calculated', name }
    : { id: 'original', kind: 'original', name };
  setWorkspace({
    user: { id: 'owner', username: evil },
    accountsEnabled: false,
    catalog: {},
    saves: [
      {
        id: 's',
        name,
        activeProfile: profile.id,
        profiles: [
          { id: 'original', kind: 'original', name, completed: 2, phase: '3' },
          {
            id: 'p',
            kind: 'calculated',
            name,
            completed: 5,
            phase: '4',
            settings: { purity: evil, multiplier: 2, powerFactor: 3 },
          },
        ],
      },
    ],
    ...workspace,
  });
  setContext({
    save: { id: 's', name },
    profile,
    state: { settings: { phase }, checks: {}, notes, deliveries: {}, customTasks: [], ...state },
    plan:
      typeof calculated === 'object'
        ? calculated
        : calculated
          ? {
              createdAt: '2026-09-24T10:00:00Z',
              settings: { phase: '3', purity: 'normal', multiplier: 1, powerFactor: 1 },
              stages: {},
              warnings: [evil, 'Second assumption'],
            }
          : null,
    handbook,
  });
}

export function go(view) {
  setView(view);
}

// Replies to fetch() calls from a table of path -> reply (a value, or a function of the
// parsed body), recording each call as [path, body].
export function stubFetch(replies) {
  const calls = [];
  globalThis.fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push([String(path), body]);
    const key = Object.keys(replies).find(k => String(path).startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
    const reply = typeof replies[key] === 'function' ? replies[key](body) : replies[key];
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return calls;
}
