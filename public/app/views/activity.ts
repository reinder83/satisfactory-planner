// The open profile's activity log (#1214, app/activity-log.ts) from session state: the steps it can
// name are every phase's build-plan steps as that phase's build plan lists them (planTasks: the
// user's edited titles, personal tasks included, removed steps left out), in phase order, so a
// step Post Phase 5 shares with Phase 5 is named under Phase 5. The Backup page's log
// (ui/backup/ActivityLog.vue) and ADA's `activity-log` line read it.
import { activityEntries, type ActivityEntry, type LoggedStep } from '../activity-log.ts';
import { currentSave, phaseOptions, state } from '../session.ts';
import { planTasks } from '../tasks.ts';

export function loggedSteps(): LoggedStep[] {
  if (!currentSave?.id || !state) return [];
  return phaseOptions().flatMap(phase =>
    planTasks(phase).map(step => ({ id: step.id, title: step.title, phase })),
  );
}

// The open profile's ticks with a record, newest first; with `person`, only theirs.
export const profileActivity = (person = ''): ActivityEntry[] =>
  currentSave?.id && state?.tickedBy ? activityEntries(state, loggedSteps(), person) : [];
