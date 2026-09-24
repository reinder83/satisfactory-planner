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

// Listeners here are registered after those in events/views.js and before backup.js
// (see public/app.js); tests/app-modules.test.mjs pins the order.

// Submit for three forms: the profile wizard (#wizard-form), sign-in / register / account
// setup (#auth-form, views/account.js) and the rename form on the profiles page
// (#rename-form). Its submit button is disabled while working and re-enabled on failure;
// on success the page is redrawn anyway.
document.addEventListener('submit', async e => {
  const f = e.target;
  if (!['wizard-form', 'auth-form', 'rename-form'].includes(f.id)) return;
  e.preventDefault();
  const b = f.querySelector('button[type="submit"]') || f.querySelector('button');
  b.disabled = true;
  try {
    // --- Profile wizard ---
    // Enter or the primary button. In the node survey and the guided questions it moves to
    // the next step; in the five-step wizard it moves on until Review (step 5), where it
    // creates the profile. The move functions disable the buttons themselves while they
    // calculate, so this one is re-enabled before handing over.
    if (f.id === 'wizard-form') {
      const w = wizard;
      // Node survey: next survey step; past the last it applies the counts.
      if (w.mode === 'extraction') {
        b.disabled = false;
        await moveExtraction(w.extractionStep + 1);
        return;
      }
      // Guided questions: the next question, or calculate the preview after the last one.
      if (w.mode === 'guided' && w.guidedStep <= guidedFlow().length) {
        b.disabled = false;
        await moveGuided(w.guidedStep + 1);
        return;
      }
      // Five-step wizard: the next step; moving onto step 5 calculates the preview.
      if (w.step < 5) {
        b.disabled = false;
        await moveWizard(w.step + 1);
        return;
      }
      // Review, "Create profile": create the profile (in a new save when saveId is empty).
      // readCarry reads which records to copy from a sibling profile of the same save;
      // guidedBuiltKeys marks the tutorial steps built when the guided answers say it is done.
      // Then the new profile is loaded and opened on its plan page, and the toast says what
      // was carried over. Nothing is created until this post succeeds.
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
      // --- Account ---
      // Sign-in, register or account setup. Until accounts are enabled the form is the setup
      // form (/api/setup); otherwise authMode picks /api/login or /api/register. boot() then
      // reloads the workspace, which shows the planner or the sign-in screen again.
    } else if (f.id === 'auth-form') {
      const data = Object.fromEntries(new FormData(f));
      data.registration = new FormData(f).has('registration');
      const mode = workspace.accountsEnabled ? authMode : 'setup';
      await post('/api/' + mode, data, false);
      await boot();
      // --- Rename (profiles page) ---
      // #rename-form renames the open save or the open profile (its "target" select), then
      // copies the new names into the session's currentSave and currentProfile and redraws.
    } else {
      setWorkspace(await post('/api/rename', Object.fromEntries(new FormData(f))));
      const s = workspace.saves.find(s => s.id === currentSave.id);
      currentSave.name = s.name;
      currentProfile.name = s.profiles.find(p => p.id === currentProfile.id).name;
      render();
    }
    // Failure: the wizard shows the error in its form (with advice for a timed-out
    // calculation); the others use their .form-error line, or a toast without one.
  } catch (err) {
    if (f.id === 'wizard-form') wizardError(f, err);
    else {
      const el = f.querySelector('.form-error');
      if (el) el.textContent = err.message;
      else toast(err.message, true);
    }
    b.disabled = false;
    // calcProgress rewrote the wizard button's label, so give it the right one back.
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

// Clicks on the Backup page's "Full saves & transfer" panel and the browser edition's
// "Keep a backup" panel. Index: export all saves, request persistent storage.
// The "Import saves" file picker next to the export button is handled in backup.js.
document.addEventListener('click', async e => {
  const button = e.target.closest('button');
  if (!button) return;
  // "Export all saves": wait for queued saves, download every save of this user as one
  // full-save file, then refetch the workspace, which carries lastBackup (when a full
  // export last ran in the browser edition). There is no redraw, so the Backup page's
  // "Last export" line only catches up on the next render.
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
  // "Request persistent browser storage" (browser edition): ask the browser not to evict
  // this site's storage, and say whether it agreed. Nothing is saved.
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
