// Requests to the server (or the browser-only adapter), the serialized save queue,
// toasts, and navigation that guards unsaved notes.
import { appRoot } from '../app-root.js';
import { browserMode, browserRequest } from '../browser-api.js';
import { $ } from './format.js';
import { currentProfile, currentSave, setState, setView, state } from './session.js';
import { render } from './shell.js';

export let pending = 0;
let toastTimer;

export function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), error ? 9000 : 3500);
}

export async function request(path, options = {}) {
  if (browserMode && path.startsWith('/api/')) return browserRequest(path, options);
  const r = await fetch(browserMode ? new URL('.' + path, appRoot) : path, {
    cache: 'no-store',
    ...options,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

export let writeQueue = Promise.resolve();

export function save(op) {
  const scope = { ...scopeHeaders() };
  pending++;
  saveIndicator();
  const run = writeQueue.then(async () => {
    const next = await request('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...scope },
      body: JSON.stringify(op),
    });
    if (scope['X-Save-Id'] === currentSave.id && scope['X-Profile-Id'] === currentProfile.id)
      setState(next);
    return next;
  });
  writeQueue = run.catch(() => {});
  return run
    .catch(e => {
      toast(e.message, true);
      throw e;
    })
    .finally(() => {
      pending--;
      saveIndicator();
    });
}

export function saveIndicator() {
  const el = $('#saved');
  if (el)
    el.textContent = pending
      ? 'Saving…'
      : browserMode
        ? 'Saved in this browser'
        : 'Saved on server';
}

export function scopeHeaders() {
  return { 'X-Save-Id': currentSave?.id || '', 'X-Profile-Id': currentProfile?.id || '' };
}

export async function post(endpoint, data, scope = true, extra = {}) {
  return request(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Planner-Request': '1',
      ...(scope ? scopeHeaders() : {}),
    },
    body: JSON.stringify(data),
    ...extra,
  });
}

export function navigate(v) {
  setView(v);
  if (location.hash === '#' + v) render();
  else location.hash = v;
}

function hasUnsavedNotes() {
  return [...document.querySelectorAll('textarea.notes')].some(el => {
    const button = document.querySelector(`[data-input="${el.id}"]`);
    return button && el.value !== (state.notes[button.dataset.saveNote] || '');
  });
}

export function allowSwitch() {
  return (
    !hasUnsavedNotes() ||
    confirm('You have notes that have not been saved. Leave without saving those edits?')
  );
}

export function downloadJson(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
