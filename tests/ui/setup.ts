// Shared set-up for the component tests: a page with #app, and a save opened the way
// loadContext() opens one, with a hostile name wherever user text appears.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterEach } from 'vitest';
import {
  setContext,
  setProgressionData,
  setView,
  setWorkspace,
  state,
} from '../../public/app/session.ts';
import { mutate } from '../../public/state.ts';
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
  UpdateOp,
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
// A plan for the given planner settings, made in Node the same way (not cached).
export const generatedWith = (settings: object): CurrentCalculatedPlan =>
  JSON.parse(
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      "import('./planner.ts').then(m => process.stdout.write(JSON.stringify(m.calculate(JSON.parse(process.argv[1])))))",
      JSON.stringify(settings),
    ]).toString(),
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

// Every notice names exactly one tone (SP-12, #247); .blue is only the stylesheet's older name
// for .info. Checked after every component test, on whatever page it left drawn.
export const TONES = ['info', 'warn', 'error'];
export const untonedNotices = () =>
  [...document.querySelectorAll('.notice')]
    .filter(
      notice =>
        TONES.filter(t => notice.classList.contains(t)).length !== 1 ||
        notice.classList.contains('blue'),
    )
    .map(notice => `${notice.className}: ${(notice.textContent || '').trim().slice(0, 60)}`);
afterEach(() => assert.deepEqual(untonedNotices(), [], 'every notice names one tone'));
// Typed as HTMLElement, which every element these tests look up is; `$` still returns null
// for a missing one.
export const $ = <E extends Element = HTMLElement>(selector: string) =>
  document.querySelector<E>(selector);
export const $$ = <E extends Element = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<E>(selector),
];

export function page() {
  unmountShell();
  confirms?.disconnect();
  confirms = null;
  document.body.innerHTML =
    '<div id="app"></div><div id="toast"></div><dialog id="detail"></dialog><dialog id="confirm"></dialog>';
}

// Answers every in-app confirmation (#confirm, ui/confirm.ts) that opens from now on by
// pressing its real Cancel or confirm button: `reply` is the answer, or a function of the
// question's text that returns it. Returns the questions asked, in order. The dialog opens
// after the click that asks, so a test awaits a tick before counting on the answer. A later
// call or page() replaces it.
let confirms: MutationObserver | null = null;
export function answerConfirms(reply: boolean | ((question: string) => boolean)) {
  confirms?.disconnect();
  const asked: string[] = [];
  const dialog = document.querySelector<HTMLDialogElement>('#confirm')!;
  confirms = new MutationObserver(() => {
    if (!dialog.open) return;
    const question = dialog.querySelector('#confirm-body')?.textContent || '';
    asked.push(question);
    const ok = typeof reply === 'function' ? reply(question) : reply;
    dialog.querySelector<HTMLElement>(ok ? '[data-confirm-ok]' : '[data-confirm-cancel]')!.click();
  });
  confirms.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  return asked;
}

// Opens the handbook profile (calculated: false), a small calculated one (true) or the
// given calculated plan. `workspace` and `state` fields override the defaults.
interface OpenOptions {
  name?: string;
  calculated?: boolean | StoredCalculatedPlan;
  phase?: Phase;
  // The original profile's id: a duplicated or imported copy has its own.
  profileId?: string;
  notes?: Record<string, string>;
  workspace?: Partial<WorkspaceSummary>;
  state?: Partial<ProgressState>;
}
export function open({
  name = evil,
  calculated = false,
  phase = '3',
  profileId = 'original',
  notes = {},
  workspace,
  state,
}: OpenOptions = {}) {
  const profile: ContextReply['profile'] = calculated
    ? { id: 'p', kind: 'calculated', name }
    : { id: profileId, kind: 'original', name };
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
    // The fields these pages read, plus the version and revision every stored state has, so an
    // update applied by applyUpdate below is validated as the server would validate it.
    state: {
      version: 1,
      revision: 0,
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

// A stand-in for POST /api/update that applies `update` the way the server does: to a copy of the open
// profile's state, validated. A refused op throws (the stub then answers 500, so save() fails)
// and leaves the page's state alone; mutate on the live state would change it before refusing.
export const applyUpdate = (update: UpdateOp) => mutate(structuredClone(state), update);

// Until a test stubs fetch, a request answers 503 at once rather than reaching happy-dom's
// network, which has no server to talk to: Saves & profiles asks for the workspace summary as it
// opens (#418), and a test that only draws the page need not stub that.
globalThis.fetch = async () =>
  new Response(JSON.stringify({ error: 'No fetch stubbed in this test.' }), { status: 503 });

// Replies to fetch() calls from a table of path -> reply (a value, or a function of the
// parsed body), recording each call as [path, body] and its headers in `calls.headers`. `B` is
// the request body's shape, for a test that reads fields of it.
export function stubFetch<B = unknown>(replies: Record<string, unknown>) {
  // Not enumerable, so a test that compares the calls themselves sees only [path, body] pairs.
  const calls = Object.defineProperty([] as [path: string, body: B][], 'headers', {
    value: [],
  }) as [path: string, body: B][] & { headers: Record<string, string>[] };
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const body: B = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push([String(path), body]);
    calls.headers.push({ ...(options.headers as Record<string, string> | undefined) });
    const key = Object.keys(replies).find(k => String(path).startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: 'unexpected ' + path }), { status: 500 });
    const entry = replies[key];
    const reply = typeof entry === 'function' ? entry(body) : entry;
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return calls;
}
