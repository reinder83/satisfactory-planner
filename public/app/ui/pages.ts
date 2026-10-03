// The page component for each hash route. render() in shell.ts mounts it into <main>.
import type { Component } from 'vue';
import type { View } from '../session.ts';
import { guidedFlow } from '../wizard/guided.ts';
import type { WizardDraft } from '../wizard/wizard.ts';
import AccountPage from './pages/AccountPage.vue';
import BackupPage from './pages/BackupPage.vue';
import CalculatedFactoriesPage from './pages/CalculatedFactoriesPage.vue';
import CalculatedPlanPage from './pages/CalculatedPlanPage.vue';
import CalculatedResourcesPage from './pages/CalculatedResourcesPage.vue';
import GuidedPage from './pages/GuidedPage.vue';
import LogisticsPage from './pages/LogisticsPage.vue';
import NoSavePage from './pages/NoSavePage.vue';
import NotesPage from './pages/NotesPage.vue';
import ProfilesPage from './pages/ProfilesPage.vue';
import StoragePage from './pages/StoragePage.vue';
import SurveyPage from './pages/SurveyPage.vue';
import WizardPage from './pages/WizardPage.vue';

// The pages that show the open save's plan: with no save open (an empty workspace, #281) they
// give way to NoSavePage, which offers to create one.
const NEEDS_SAVE: View[] = ['plan', 'factories', 'logistics', 'storage', 'resources', 'notes'];

// The component for `view`, or null for an unknown one. #wizard depends on the draft
// (`draft`, the wizard object): the node survey, the guided questions until they are
// answered, and otherwise the five steps, whose Review also ends the guided start.
export function vuePage(view: View, draft: WizardDraft | null, hasSave = true): Component | null {
  if (!hasSave && NEEDS_SAVE.includes(view)) return NoSavePage;
  if (view === 'plan') return CalculatedPlanPage;
  if (view === 'factories') return CalculatedFactoriesPage;
  if (view === 'logistics') return LogisticsPage;
  if (view === 'storage') return StoragePage;
  if (view === 'profiles') return ProfilesPage;
  if (view === 'account') return AccountPage;
  if (view === 'notes') return NotesPage;
  if (view === 'backup') return BackupPage;
  if (view === 'resources') return CalculatedResourcesPage;
  if (view === 'wizard') {
    if (draft?.mode === 'extraction') return SurveyPage;
    if (draft?.mode === 'guided' && draft.guidedStep <= guidedFlow().length) return GuidedPage;
    return WizardPage;
  }
  return null;
}
