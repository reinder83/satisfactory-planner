// Delegated DOM event handler for the profile wizard's form. The saves, profiles, backup
// and account pages are Vue components that handle their own controls (ui/pages/).
import { navigate, post, toast } from '../api.js';
import { plural } from '../format.js';
import { loadContext, setWizard, setWorkspace, wizard, workspace } from '../session.js';
import { guidedBuiltKeys, guidedFlow, moveGuided } from '../wizard/guided.js';
import { calcProgress, moveWizard, readCarry, wizardError } from '../wizard/wizard.js';

// Registered after the listeners in events/views.js (see public/app.js);
// tests/ui/app-modules.test.mjs pins the order.

// Submit for the profile wizard (#wizard-form). Its submit button is disabled while working
// and re-enabled on failure; on success the page is redrawn anyway.
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id !== 'wizard-form') return;
  e.preventDefault();
  const b = f.querySelector('button[type="submit"]') || f.querySelector('button');
  b.disabled = true;
  try {
    // --- Profile wizard ---
    // Enter or the primary button. In the guided questions it moves to the next step; in
    // the five-step wizard it moves on until Review (step 5), where it creates the profile.
    // The node survey handles its own submit (ui/pages/SurveyPage.vue). The move functions disable the buttons themselves while they
    // calculate, so this one is re-enabled before handing over.
    if (f.id === 'wizard-form') {
      const w = wizard;
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
    }
    // Failure: the error goes in the form, with advice for a timed-out calculation.
  } catch (err) {
    wizardError(f, err);
    b.disabled = false;
    // calcProgress rewrote the button's label, so give it the right one back.
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
