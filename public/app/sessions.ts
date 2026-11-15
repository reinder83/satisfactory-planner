// Per-browser facts that are not progress (#1353, #1355): how many times this browser has opened the
// app, and whether it has shown the build plan's intro. Both are localStorage only, like the ADA
// chatter setting (`planner-ada`) and the detail level: never in a saved profile, an export or a
// backup, so the saved-state version does not change. Every access is guarded: a browser without
// storage (a private window, a blocked one, a full one) still works, it only forgets: the count is
// then 1 on every load, and the intro shows once per page load instead of once per browser.

// How many times the app was opened in this browser, a whole number from 1; bumped once per load.
export const SESSIONS_KEY = 'planner-sessions';
// '1' once the build plan's intro has been shown (BP-13).
export const INTRO_SEEN_KEY = 'planner-intro-seen';
// Enough to know "many"; stops a counter that is never reset from growing for ever.
const SESSIONS_CAP = 999;

// The stored count after `bump`, 1 when storage cannot be read or written.
export function bumpSessions(): number {
  let count = 1;
  try {
    const kept = Number(localStorage.getItem(SESSIONS_KEY));
    count = Number.isInteger(kept) && kept >= 1 ? Math.min(kept + 1, SESSIONS_CAP) : 1;
  } catch {
    return 1;
  }
  try {
    localStorage.setItem(SESSIONS_KEY, String(count));
  } catch {}
  return count;
}

// This load's count, taken once when the module is first used.
let sessions: number | undefined;
export function sessionCount(): number {
  sessions ??= bumpSessions();
  return sessions;
}

// Forgets this load's count so the next sessionCount() bumps again (tests only).
export function resetSessionCount() {
  sessions = undefined;
}

// Whether the intro was shown before; without storage, whether it was shown in this page load.
let introShownInMemory = false;
export function introSeen(): boolean {
  if (introShownInMemory) return true;
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen() {
  introShownInMemory = true;
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {}
}

// Forgets the in-memory fallback (tests only).
export function resetIntroSeen() {
  introShownInMemory = false;
}
