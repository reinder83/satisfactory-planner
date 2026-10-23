// The build-plan step an activity-log entry jumps to (#1214, ui/backup/ActivityLog.vue): view state
// of this tab, never saved. While it is set the build plan draws that step whatever "Hide
// completed", "Required steps only" and "Mine only" would hide (filteredPlanTasks in tasks.ts),
// unfolds the "Done" list it is in, scrolls it into view, marks it and focuses its checkbox
// (ui/plan/Checklist.vue). Leaving the build plan drops it.
let jumpedStep = '';

export const jumpTarget = (): string => jumpedStep;
export function setJumpTarget(id: string) {
  jumpedStep = id;
}
