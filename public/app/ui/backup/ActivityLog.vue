<!--
  "Recent ticks" (#1214, co-op slice 5 of #1077) in the Backup page's "Co-op progress": the open
  profile's ticks that have a record of who ticked them and when (#1206), newest first, from
  views/activity.ts. Each entry says "Anna ticked <step>, Oct 21, 2:05 PM" (or "Ticked <step>, …"
  without a name) and its phase, and the step's title links to it in the build plan (step-jump.ts:
  that phase is shown, not saved, and the step is drawn and focused whatever the build plan's
  filters would hide). With more than one name, "Show" picks one person's ticks. The first 50 show;
  "Show more" adds 50 at a time. The filter and the count are view state of this visit. Nothing is
  saved or recalculated: the log only reads the records the ticks already carry.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  ACTIVITY_PAGE,
  activityPeople,
  activityWho,
  type ActivityEntry,
} from '../../activity-log.ts';
import { allowSwitch, navigate } from '../../api.ts';
import { phaseLabel, viewPhase } from '../../session.ts';
import { setJumpTarget } from '../../step-jump.ts';
import { tickedAt } from '../../ticked-by.ts';
import { profileActivity } from '../../views/activity.ts';
import type { Phase } from '../../../types/index.ts';
import { legacy } from '../bridge.ts';

// The person "Show" picks ('' is everyone), and how many entries show.
const person = ref('');
const limit = ref(ACTIVITY_PAGE);

const log = computed(() =>
  legacy(() => {
    const all = profileActivity(),
      people = activityPeople(all),
      // A name that left the log (its ticks were unticked) shows everyone again.
      chosen = people.find(name => name === person.value) ?? '',
      entries = chosen ? profileActivity(chosen) : all,
      now = new Date();
    return {
      people,
      chosen,
      total: entries.length,
      entries: entries.slice(0, limit.value).map(entry => ({
        ...entry,
        who: activityWho(entry),
        when: tickedAt(entry.at, now),
        phaseName: phaseLabel(entry.phase),
      })),
    };
  }),
);

function choose(event: Event) {
  person.value = (event.target as HTMLSelectElement).value;
  limit.value = ACTIVITY_PAGE;
}

// "Show more": the next 50, with focus on the first of them, since the button goes once the last
// ones show.
async function showMore() {
  const first = limit.value;
  limit.value += ACTIVITY_PAGE;
  await nextTick();
  document.querySelectorAll<HTMLElement>('[data-activity-entry] a')[first]?.focus();
}

// The step's title: the build plan of its phase, scrolled to the step.
async function jump(entry: ActivityEntry) {
  if (!(await allowSwitch())) return;
  setJumpTarget(entry.id);
  viewPhase(entry.phase as Phase); // A logged step's phase is one phaseOptions() offers.
  navigate('plan');
}
</script>

<template>
  <div class="activity-log" data-activity-log>
    <div class="activity-head">
      <h3 id="activity-title">Recent ticks</h3>
      <label v-if="log.people.length > 1" class="small activity-person"
        >Show<select data-activity-person :value="log.chosen" @change="choose">
          <option value="">Everyone</option>
          <option v-for="name in log.people" :key="name" :value="name">{{ name }}</option>
        </select></label
      >
    </div>
    <ol v-if="log.entries.length" class="activity-list" aria-labelledby="activity-title">
      <li v-for="entry in log.entries" :key="entry.id" data-activity-entry>
        {{ entry.who }}
        <a href="#plan" :data-activity-step="entry.id" @click.prevent="jump(entry)">{{
          entry.title
        }}</a
        >, <span class="activity-when">{{ entry.when }}</span
        ><span class="small muted"> · {{ entry.phaseName }}</span>
      </li>
    </ol>
    <p v-else class="small muted" data-activity-empty>
      No ticks recorded yet. Each step ticked in the build plan from now on is listed here, with who
      ticked it when “Your name” is set.
    </p>
    <button
      v-if="log.total > log.entries.length"
      type="button"
      class="btn"
      data-activity-more
      @click="showMore"
    >
      Show more ({{ log.entries.length }} of {{ log.total }})
    </button>
  </div>
</template>
