// Persistent browser storage (#1368), browser edition only. Without it the browser treats the
// workspace's IndexedDB as best effort and may clear it (storage pressure, or cleared together
// with cookies), which is how a user once lost every save. The page asks the browser to keep it
// and says on Backup whether it agreed.
//
//   - persisted() is only read: on startup (readPersistence), it asks nothing.
//   - persist() is called from a user action, because Firefox shows a permission prompt for it:
//     the first save once the workspace has one (askAfterSave, which queuedWrite calls while the
//     user's click is still being handled) and the "Keep my saves" button (keepSaves). The
//     automatic ask happens once per browser: the answer is remembered in this browser's
//     localStorage (a per-viewer setting, like "Hide completed"; no saved data and no state
//     version change), so a refusal is not asked again on every tick. The button always asks.
//   - Every call is feature-checked and wrapped: a browser without navigator.storage, or with
//     a persist()/persisted() that throws, leaves the state 'unsupported' and nothing else
//     changes. The Docker edition never calls any of it (its saves live on the server).
import { ref } from 'vue';
import { browserMode } from '../browser-api.ts';

// 'unknown' until persisted() answers, 'kept' when the browser will not clear the saves on its
// own, 'not-kept' when it may, 'unsupported' when there is no API to ask (or it threw).
export type Persistence = 'unknown' | 'kept' | 'not-kept' | 'unsupported';

export const persistence = ref<Persistence>('unknown');

export const ASKED_KEY = 'planner-persist-asked';

function wasAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    // Storage blocked: ask at most once per page load instead (the `asking` flag).
    return false;
  }
}

function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Remembering is a convenience.
  }
}

// Reads the state without asking. Runs at startup and after a request.
export async function readPersistence(): Promise<Persistence> {
  if (!browserMode) return persistence.value;
  try {
    const storage = navigator.storage;
    if (!storage || typeof storage.persisted !== 'function') {
      persistence.value = 'unsupported';
    } else {
      persistence.value = (await storage.persisted()) ? 'kept' : 'not-kept';
    }
  } catch {
    persistence.value = 'unsupported';
  }
  return persistence.value;
}

// Asks the browser to keep the storage. Returns whether it agreed. Never throws.
export async function requestPersistence(): Promise<boolean> {
  markAsked();
  try {
    const storage = navigator.storage;
    if (!storage || typeof storage.persist !== 'function') {
      persistence.value = 'unsupported';
      return false;
    }
    const granted = await storage.persist();
    persistence.value = granted ? 'kept' : 'not-kept';
    return granted;
  } catch {
    persistence.value = 'unsupported';
    return false;
  }
}

// The "Keep my saves" button.
export const keepSaves = requestPersistence;

let asking = false;

// Called when a save is written (queuedWrite). Asks once per browser, after the workspace has
// a save and only when the browser has not already kept it or been asked before.
export function askAfterSave(hasSave: boolean) {
  if (!browserMode || !hasSave || asking || wasAsked()) return;
  if (persistence.value === 'kept' || persistence.value === 'unsupported') return;
  asking = true;
  void (async () => {
    // persisted() first: a browser that already keeps the storage is never asked. Startup has
    // usually read it already, so the request goes out while the click is still being handled.
    const known = persistence.value === 'unknown' ? await readPersistence() : persistence.value;
    if (known === 'not-kept') await requestPersistence();
  })();
}
