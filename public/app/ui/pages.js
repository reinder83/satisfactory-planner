// The pages that are Vue components so far, by hash route. render() in shell.js mounts one
// of these into <main>, and draws any other page with its legacy render function. Grows
// with each stage of the migration (see public/AGENTS.md).
import AccountPage from './pages/AccountPage.vue';
import BackupPage from './pages/BackupPage.vue';
import CalculatedFactoriesPage from './pages/CalculatedFactoriesPage.vue';
import CalculatedPlanPage from './pages/CalculatedPlanPage.vue';
import FactoriesPage from './pages/FactoriesPage.vue';
import PlanPage from './pages/PlanPage.vue';
import ProfilesPage from './pages/ProfilesPage.vue';
import ResourcesPage from './pages/ResourcesPage.vue';
import StoragePage from './pages/StoragePage.vue';

// The component for `view`, or null while it is still a legacy page. A calculated
// profile's resources page is still legacy (renderCalculatedResources).
export function vuePage(view, calculated) {
  if (view === 'plan') return calculated ? CalculatedPlanPage : PlanPage;
  if (view === 'factories') return calculated ? CalculatedFactoriesPage : FactoriesPage;
  if (view === 'storage') return StoragePage;
  if (view === 'profiles') return ProfilesPage;
  if (view === 'account') return AccountPage;
  if (view === 'backup') return BackupPage;
  if (view === 'resources' && !calculated) return ResourcesPage;
  return null;
}
