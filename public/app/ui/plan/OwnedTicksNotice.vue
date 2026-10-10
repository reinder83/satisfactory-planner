<!--
  The build plan's notice when the ticks show more than the plan's "What you already have"
  settings count (#1068, "ticks keep it current"; ownedTicksNotice in views/calculated.ts,
  ownedFromTicks in owned-ticks.ts): a better miner or belt milestone ticked, a hard-drive
  alternate's unlock ticked that the plan does not hold, or generators marked running beyond what
  some phase from the working phase on runs. One notice for all of them, on the saved working
  phase only. The plan is never recalculated by itself (AGENTS.md): "Recalculate in place with what
  you have" recalculates this profile in place with the plan's settings and those owned fields
  raised (withOwnedFound), after a confirmation that names the backup kept of the current version
  (recalculateOffer in ui/recalc-offer.ts, #1071, as the other offers do: progress carried, a line
  that grew left for review, a 409 opens the plan the profile has now). "Dismiss" hides it in this
  browser until the ticks add something new (setTicksNoticeDismissed in session.ts); focus then
  goes to the page's heading.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { foundList, foundWords, alternatesPhrase, withOwnedFound } from '../../owned-ticks.ts';
import { calculated, setTicksNoticeDismissed, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { ownedTicksNotice } from '../../views/calculated.ts';
import { listNames } from '../../../wording.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { legacy } from '../bridge.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';
import { refocusAfterRemoval } from '../refocus.ts';

const LABEL = 'Recalculate in place with what you have';

const notice = computed(() =>
  legacy(() => {
    const found = ownedTicksNotice();
    if (!found) return null;
    const words = foundWords(found, workspace.catalog?.alternates);
    return {
      found,
      list: foundList(words),
      unlocked: listNames(words.unlocked),
      alternates: alternatesPhrase(words.alternates),
      generators: listNames(words.generators),
    };
  }),
);
// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

function recalculate(event: Event) {
  const shown = notice.value;
  if (!calculated || !shown) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: withOwnedFound(calculated.settings, shown.found),
    change: `with what your ticks show you already have: ${shown.list}`,
    label: LABEL,
  });
}

function dismiss(event: Event) {
  const shown = notice.value;
  if (!shown) return;
  const refocus = refocusAfterRemoval(event.currentTarget, { fallback: ['#main h1'] });
  setTicksNoticeDismissed(shown.found);
  render();
  void refocus();
}
</script>

<template>
  <div v-if="notice" class="notice info owned-ticks-notice" role="status" data-owned-ticks>
    <p>
      <strong>Your ticks show more than this plan counts.</strong>
      <template v-if="notice.unlocked"
        ><span data-owned-ticks-found="unlocked">You have unlocked {{ notice.unlocked }}.</span>
      </template>
      <template v-if="notice.alternates"
        ><span data-owned-ticks-found="alternates">You own {{ notice.alternates }}.</span>
      </template>
      <template v-if="notice.generators"
        ><span data-owned-ticks-found="generators">You run {{ notice.generators }}.</span>
      </template>
      This plan was calculated without them. Nothing changes until you start it.
    </p>
    <p>
      <button class="btn primary" data-recalc-owned-ticks @click="recalculate">{{ LABEL }}</button>
      {{ IN_PLACE_NOTE
      }}<template v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
    <p>
      <button
        type="button"
        class="btn quiet"
        data-owned-ticks-dismiss
        aria-describedby="owned-ticks-dismiss-note"
        @click="dismiss"
      >
        Dismiss
      </button>
      <span id="owned-ticks-dismiss-note" class="small muted"
        >It comes back when your ticks show something new.</span
      >
    </p>
  </div>
</template>
