// Entry point. The event modules register document-level listeners as a side effect;
// they are imported in the order the listeners must be registered.
//
// How the frontend fits together (read this first):
// 1. boot() in app/session.js fetches /api/workspace (the saves and their profiles), then
//    plan.json and progression.json, and calls loadContext() for the active save/profile.
//    loadContext() fetches /api/context, which returns that profile's state (checks, notes,
//    deliveries, edits) and, for a calculated profile, its frozen calculated plan.
// 2. render() in app/shell.js refreshes the frame (app/ui/Shell.vue: sidebar, ADA, header,
//    phase picker) and fills <main> with the page for the current hash route (#plan,
//    #factories, ...). The interface is moving to Vue in stages (public/AGENTS.md): pages
//    that are components live in app/ui/pages/ (listed in app/ui/pages.js); the others
//    are still legacy views in app/views/*.js (a calculated profile uses
//    app/views/calculated.js for plan/factories/resources) and app/wizard/ for #wizard.
// 3. Legacy views are plain functions returning HTML that render() assigns to innerHTML.
//    They build it with the html`` tag from app/html.js, which escapes every interpolated
//    value, so user-provided text is safe without an esc() call at each place it is shown.
// 4. Components handle their own controls. On legacy pages, user actions are handled by
//    delegated listeners on document in app/events/*.js, matched on data-* attributes
//    (data-check, data-save-note, ...) and form ids.
//    A hashchange listener in events/views.js switches the view; navigate() in api.js too.
// 5. Changes go through save(op) in app/api.js: a serialized queue that POSTs the op to
//    /api/update and replaces the local state with the reply. The handler then calls
//    render() again. Other writes (profiles, imports) use post()/request() from api.js.
//
// Shared state (workspace, current save/profile, state, calculated plan, current view and
// UI flags) lives in app/session.js. ES module imports are read-only bindings, so other
// modules change it through the set*() functions exported there.
//
// Two editions share this code. The Docker edition talks to server.mjs (with workspace.mjs)
// over HTTP. The GitHub Pages build sets globalThis.PLANNER_BROWSER (browserMode in
// browser-api.js), and
// request() then answers /api/* paths with browser-api.js instead: IndexedDB storage and a
// calculator Web Worker, with the same request and response shapes.
import { boot } from './app/session.js';
import './app/events/views.js';
import './app/events/profiles.js';

boot();
