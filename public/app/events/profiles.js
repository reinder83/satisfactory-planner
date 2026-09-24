// Delegated DOM event handlers for saves, profiles, the wizard and the account.
import { downloadJson, navigate, post, request, toast, writeQueue } from '../api.js';
import { plural } from '../format.js';
import {
  authMode,
  boot,
  currentProfile,
  currentSave,
  loadContext,
  setWizard,
  setWorkspace,
  wizard,
  workspace,
} from '../session.js';
import { render } from '../shell.js';
import { moveExtraction } from '../wizard/extraction.js';
import { guidedBuiltKeys, guidedFlow, moveGuided } from '../wizard/guided.js';
import { calcProgress, moveWizard, readCarry, wizardError } from '../wizard/wizard.js';

document.addEventListener('submit', async e => {
  const f = e.target;
  if (!['wizard-form', 'auth-form', 'rename-form'].includes(f.id)) return;
  e.preventDefault();
  const b = f.querySelector('button[type="submit"]') || f.querySelector('button');
  b.disabled = true;
  try {
    if (f.id === 'wizard-form') {
      const w = wizard;
      if (w.mode === 'extraction') {
        b.disabled = false;
        await moveExtraction(w.extractionStep + 1);
        return;
      }
      if (w.mode === 'guided' && w.guidedStep <= guidedFlow().length) {
        b.disabled = false;
        await moveGuided(w.guidedStep + 1);
        return;
      }
      if (w.step < 5) {
        b.disabled = false;
        await moveWizard(w.step + 1);
        return;
      }
      if (w.step === 5) {
        readCarry(f);
        const r = await post(
          '/api/profiles',
          {
            saveId: w.saveId,
            saveName: w.saveName,
            name: w.name,
            settings: w.settings,
            carryFrom: w.saveId ? w.carryFrom : null,
            carry: w.carry,
            built: guidedBuiltKeys(w, f),
          },
          true,
          calcProgress(b, 'Saving profile…'),
        );
        setWorkspace(r.workspace);
        await loadContext(r.saveId, r.profileId);
        setWizard(null);
        navigate('plan');
        const carried = [
          r.carriedChecks ? plural(r.carriedChecks, 'step') + ' carried over' : '',
          r.reviewCount
            ? plural(r.reviewCount, 'expanded production line') + ' left for review'
            : '',
        ]
          .filter(Boolean)
          .join('; ');
        toast(
          'Profile created' +
            (carried ? ': ' + carried + '. ' : '. ') +
            'Your other progress is unchanged.',
        );
        return;
      }
    } else if (f.id === 'auth-form') {
      const data = Object.fromEntries(new FormData(f));
      data.registration = new FormData(f).has('registration');
      const mode = workspace.accountsEnabled ? authMode : 'setup';
      await post('/api/' + mode, data, false);
      await boot();
    } else {
      setWorkspace(await post('/api/rename', Object.fromEntries(new FormData(f))));
      const s = workspace.saves.find(s => s.id === currentSave.id);
      currentSave.name = s.name;
      currentProfile.name = s.profiles.find(p => p.id === currentProfile.id).name;
      render();
    }
  } catch (err) {
    if (f.id === 'wizard-form') wizardError(f, err);
    else {
      const el = f.querySelector('.form-error');
      if (el) el.textContent = err.message;
      else toast(err.message, true);
    }
    b.disabled = false;
    if (f.id === 'wizard-form')
      b.textContent =
        wizard.mode === 'guided' && wizard.guidedStep <= guidedFlow().length
          ? wizard.guidedStep >= guidedFlow().length
            ? 'Calculate plan'
            : 'Continue →'
          : wizard.step === 5
            ? 'Create profile'
            : wizard.step === 4
              ? 'Calculate plan'
              : 'Continue →';
  }
});

document.addEventListener('click', async e => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-export-saves')) {
    button.disabled = true;
    try {
      await writeQueue;
      downloadJson(await request('/api/export-saves'), 'satisfactory-full-saves.json');
      setWorkspace(await request('/api/workspace'));
      toast('Full save backup downloaded.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  }
  if (button.hasAttribute('data-persist-storage')) {
    try {
      const granted = await navigator.storage?.persist?.();
      toast(
        granted
          ? 'Persistent browser storage enabled.'
          : 'Browser did not grant persistence. Keep downloaded backups.',
      );
    } catch (err) {
      toast(err.message, true);
    }
  }
});
