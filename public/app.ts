// Entry point. listeners.ts registers the page-wide listeners as a side effect,
// in the order they must run (tests/ui/app-modules.test.ts pins it).
//
// How the frontend fits together (read this first):
// 1. boot() in app/session.ts fetches /api/workspace (the saves and their profiles), then
//    plan.json and progression.json, and calls loadContext() for the active save/profile.
//    loadContext() fetches /api/context, which returns that profile's state (checks, notes,
//    deliveries, edits) and, for a calculated profile, its frozen calculated plan.
// 2. render() in app/shell.ts refreshes the frame (app/ui/Shell.vue: sidebar, ADA, header,
//    phase picker) and mounts the page for the current hash route (#plan, #factories, ...)
//    into <main>. Every page is a Vue component in app/ui/pages/, listed by route in
//    app/ui/pages.ts; #wizard shows the node survey, the guided start or the five steps by
//    the wizard draft's mode. The data behind them lives in plain modules: app/views/*.js
//    (factories, storage, a calculated profile's plan) and app/wizard/*.js (the draft, its
//    readers and moves).
// 3. Session state is not reactive: components read it inside legacy() from
//    app/ui/bridge.ts, which re-runs whenever render() calls invalidate().
// 4. Components handle their own controls; the ones several components share (checkboxes,
//    "Save notes", factory links, ...) call the handlers in app/ui/actions.ts. The few
//    page-wide listeners live in app/listeners.ts: the hashchange listener there switches
//    the view, and navigate() in api.ts does too.
// 5. Changes go through save(op) in app/api.ts: a serialized queue that POSTs the op to
//    /api/update and replaces the local state with the reply. The handler then calls
//    render() again. Other writes (profiles, imports) use post()/request() from api.ts.
//
// Shared state (workspace, current save/profile, state, calculated plan, current view and
// UI flags) lives in app/session.ts. ES module imports are read-only bindings, so other
// modules change it through the set*() functions exported there.
//
// Two editions share this code. The Docker edition talks to server.ts (with workspace.ts)
// over HTTP. The GitHub Pages build sets globalThis.PLANNER_BROWSER (browserMode in
// browser-api.ts), and
// request() then answers /api/* paths with browser-api.ts instead: IndexedDB storage and a
// calculator Web Worker, with the same request and response shapes.
import { boot } from './app/session.ts';
import './app/listeners.ts';

boot();
