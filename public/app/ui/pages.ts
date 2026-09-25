// The page component for each hash route. render() in shell.ts mounts it into <main>.
import type { Component } from 'vue';
import type { View } from '../session.ts';
import { guidedFlow } from '../wizard/guided.ts';
import type { WizardDraft } from '../wizard/wizard.ts';
import type { StoredCalculatedPlan } from '../../types/index.ts';
import AccountPage from './pages/AccountPage.vue';
import BackupPage from './pages/BackupPage.vue';
import CalculatedFactoriesPage from './pages/CalculatedFactoriesPage.vue';
import CalculatedPlanPage from './pages/CalculatedPlanPage.vue';
import CalculatedResourcesPage from './pages/CalculatedResourcesPage.vue';
import FactoriesPage from './pages/FactoriesPage.vue';
import GuidedPage from './pages/GuidedPage.vue';
import PlanPage from './pages/PlanPage.vue';
import ProfilesPage from './pages/ProfilesPage.vue';
import ResourcesPage from './pages/ResourcesPage.vue';
import StoragePage from './pages/StoragePage.vue';
import SurveyPage from './pages/SurveyPage.vue';
import WizardPage from './pages/WizardPage.vue';

// The component for `view`, or null for an unknown one. #wizard depends on the draft
// (`draft`, the wizard object): the node survey, the guided questions until they are
// answered, and otherwise the five steps, whose Review also ends the guided start.
export function vuePage(
  view: View,
  calculated: StoredCalculatedPlan | null,
  draft: WizardDraft | null,
): Component | null {
  if (view === 'plan') return calculated ? CalculatedPlanPage : PlanPage;
  if (view === 'factories') return calculated ? CalculatedFactoriesPage : FactoriesPage;
  if (view === 'storage') return StoragePage;
  if (view === 'profiles') return ProfilesPage;
  if (view === 'account') return AccountPage;
  if (view === 'backup') return BackupPage;
  if (view === 'resources') return calculated ? CalculatedResourcesPage : ResourcesPage;
  if (view === 'wizard') {
    if (draft?.mode === 'extraction') return SurveyPage;
    if (draft?.mode === 'guided' && draft.guidedStep <= guidedFlow().length) return GuidedPage;
    return WizardPage;
  }
  return null;
}
