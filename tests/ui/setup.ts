// Shared set-up for the component tests: a page with #app, and a save opened the way
// loadContext() opens one, with a hostile name wherever user text appears.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { setContext, setProgressionData, setView, setWorkspace } from '../../public/app/session.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import type { View } from '../../public/app/session.ts';
import type {
  Catalog,
  ContextReply,
  CurrentCalculatedPlan,
  Handbook,
  Phase,
  Purity,
  ProgressState,
  StoredCalculatedPlan,
  StoredSettings,
  WorkspaceSummary,
} from '../../public/types/index.ts';

// Vitest runs from the repository root.
export const handbook: Handbook = JSON.parse(fs.readFileSync('public/plan.json', 'utf8'));
setProgressionData(JSON.parse(fs.readFileSync('public/progression.json', 'utf8')));
// A real calculated plan (planner.ts with default settings), made once per test file. The
// planner reads its data files through import.meta.url, which happy-dom does not give it, so
// it runs in Node.
let generatedPlan: CurrentCalculatedPlan | undefined;
export const generated = (): CurrentCalculatedPlan =>
  structuredClone(
    (generatedPlan ??= JSON.parse(
      execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        "import('./planner.ts').then(m => process.stdout.write(JSON.stringify(m.calculate({}))))",
      ]).toString(),
    )),
  );
// The server's item catalog (planner.ts catalog(): raw resources, budgets, goals, …), made
// once per test file in Node for the same reason.
let catalogData: Catalog | undefined;
export const catalog = (): Catalog =>
  structuredClone(
    (catalogData ??= JSON.parse(
      execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        "import('./planner.ts').then(m => process.stdout.write(JSON.stringify(m.catalog())))",
      ]).toString(),
    )),
  );
export const evil = '<x-evil onclick=alert(1)> & "quoted"';
// Typed as HTMLElement, which every element these tests look up is; `$` still returns null
// for a missing one.
export const $ = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s);
export const $$ = <E extends Element = HTMLElement>(s: string) => [
  ...document.querySelectorAll<E>(s),
];

export function page() {
  unmountShell();
  document.body.innerHTML =
    '<div id="app"></div><div id="toast"></div><dialog id="detail"></dialog>';
}

// Opens the handbook profile (calculated: false), a small calculated one (true) or the
// given calculated plan. `workspace` and `state` fields override the defaults.
interface OpenOptions {
  name?: string;
  calculated?: boolean | StoredCalculatedPlan;
  phase?: Phase;
  notes?: Record<string, string>;
  workspace?: Partial<WorkspaceSummary>;
  state?: Partial<ProgressState>;
}
export function open({
  name = evil,
  calculated = false,
  phase = '3',
  notes = {},
  workspace,
  state,
}: OpenOptions = {}) {
  const profile: ContextReply['profile'] = calculated
    ? { id: 'p', kind: 'calculated', name }
    : { id: 'original', kind: 'original', name };
  setWorkspace({
    user: { id: 'owner', username: evil },
    accountsEnabled: false,
    // No test here reads the catalog; the wizard tests use catalog() above.
    catalog: {} as Catalog,
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
            // A hostile stored value, to show the page escapes it.
            settings: { purity: evil as Purity, multiplier: 2, powerFactor: 3 } as StoredSettings,
          },
        ],
      },
    ],
    ...workspace,
  });
  setContext({
    save: { id: 's', name },
    profile,
    // Only the fields these pages read; the app fills nothing else in.
    state: {
      settings: { phase },
      checks: {},
      notes,
      deliveries: {},
      customTasks: [],
      ...state,
    } as ProgressState,
    plan:
      typeof calculated === 'object'
        ? calculated
        : calculated
          ? ({
              createdAt: '2026-09-24T10:00:00Z',
              settings: { phase: '3', purity: 'normal', multiplier: 1, powerFactor: 1 },
              stages: {},
              warnings: [evil, 'Second assumption'],
            } as StoredCalculatedPlan)
          : null,
    handbook,
  });
}

export function go(view: View) {
  setView(view);
}

// Replies to fetch() calls from a table of path -> reply (a value, or a function of the
// parsed body), recording each call as [path, body]. `B` is the request body's shape, for a
// test that reads fields of it.
export function stubFetch<B = unknown>(replies: Record<string, unknown>) {
  const calls: [path: string, body: B][] = [];
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const body: B = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push([String(path), body]);
    const key = Object.keys(replies).find(k => String(path).startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
    const entry = replies[key];
    const reply = typeof entry === 'function' ? entry(body) : entry;
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return calls;
}
