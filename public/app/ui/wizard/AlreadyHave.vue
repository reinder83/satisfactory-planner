<!--
  Review, "What you already have" (#1068), for a new profile of a game already under way. Two
  parts, each only where the plan has something to say:

  - "Everything before Phase N is done", for a profile made for Phase 2 or later: ticks every step
    the milestone-only phases before the start phase list (stepsBeforeStart in progression.ts: HUB
    milestones and MAM research, all unlock-<id> keys), so a mid-game start does not open on a list
    of earlier steps. The build plan offers the same later (ui/plan/MilestoneOnlyNotice.vue).
  - "Alternates you own": one box per alternate recipe the plan's hard-drive steps ask for
    (alternateHunts), ticked when the player owns it. An owned recipe's unlock step starts ticked,
    and a phase's hard-drive hunt too once every recipe it lists is owned (ownedAlternateKeys); the
    rest stay to hunt. Later, the recipe's own unlock step on the build plan is the same record.
    A recipe chosen under "Alternates you already own" on step 2 (settings.ownedAlternates, which
    the plan was calculated with) shows here ticked and fixed: it is changed on step 2.

  Everything starts off. The choices are the draft's `earlierDone` and `ownedAlternates`, set as
  each box changes (so a redraw keeps them), and createProfile sends the steps they tick as the new
  profile's `built` work (alreadyHaveKeys in wizard/wizard.ts); nothing new is stored, and records
  carried from another profile still win. Draws nothing when neither part applies.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { draft, phaseLabel, progressionData } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { settingsOwnedKeys } from '../../wizard/wizard.ts';
import {
  alternateHunts,
  earlierPhasesWords,
  milestoneOnlyPhases,
  stepsBeforeStart,
} from '../../../progression.ts';

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      plan = wizardDraft.preview;
    // progression.json arrives at boot; without it (or a plan) there is nothing to offer.
    if (!plan || !progressionData?.buildings) return null;
    const count = stepsBeforeStart(plan, { checks: {} }, progressionData).length,
      owned = new Set(wizardDraft.ownedAlternates || []),
      fixed = new Set(settingsOwnedKeys(wizardDraft));
    const alternates = alternateHunts(plan, progressionData).flatMap(({ phase, recipes }) =>
      recipes.map(recipe => ({
        ...recipe,
        phase: phaseLabel(phase),
        fixed: fixed.has(recipe.key),
        on: owned.has(recipe.key) || fixed.has(recipe.key),
      })),
    );
    if (!count && !alternates.length) return null;
    return {
      earlier: count
        ? {
            start: phaseLabel(String(plan.settings.phase)),
            phases: earlierPhasesWords(milestoneOnlyPhases(plan)),
            steps: count === 1 ? '1 step' : `${count} steps`,
            on: !!wizardDraft.earlierDone,
          }
        : null,
      alternates,
      owned: alternates.filter(alternate => alternate.on).length,
    };
  }),
);

function chooseEarlier(event: Event) {
  draft().earlierDone = (event.target as HTMLInputElement).checked;
}

function chooseAlternate(event: Event) {
  const box = event.target as HTMLInputElement,
    wizardDraft = draft(),
    owned = new Set(wizardDraft.ownedAlternates || []);
  if (box.checked) owned.add(box.value);
  else owned.delete(box.value);
  wizardDraft.ownedAlternates = [...owned];
}
</script>

<template>
  <section v-if="view" class="panel already-have" data-already-have>
    <h3>What you already have</h3>
    <label v-if="view.earlier" class="check-row"
      ><input
        type="checkbox"
        name="earlierDone"
        data-earlier-done
        :checked="view.earlier.on"
        @change="chooseEarlier"
      /><span
        ><b>Everything before {{ view.earlier.start }} is done</b><br /><small class="muted"
          >Ticks the {{ view.earlier.steps }} {{ view.earlier.phases }} list: HUB milestones and MAM
          research. The plan then opens on {{ view.earlier.start }}. You can untick any of them
          later.</small
        ></span
      ></label
    >
    <details v-if="view.alternates.length" class="owned-alternates" data-owned-alternates>
      <summary>
        Alternates you own ({{ view.owned }} of {{ view.alternates.length }} ticked)
      </summary>
      <p class="small muted">
        Tick the alternate recipes you have already unlocked: their unlock steps start ticked, and a
        phase's hard-drive hunt too once you own every recipe it asks for. The rest stay on the
        build plan to hunt for.
      </p>
      <div class="owned-list" role="group" aria-label="Alternates you own">
        <label v-for="alternate in view.alternates" :key="alternate.key" class="check-row"
          ><input
            type="checkbox"
            name="ownedAlternate"
            data-owned-alternate
            :value="alternate.key"
            :checked="alternate.on"
            :disabled="alternate.fixed"
            @change="chooseAlternate"
          /><span
            ><b>{{ alternate.name }}</b
            ><br /><small class="muted"
              >First used in {{ alternate.phase
              }}{{ alternate.fixed ? ' · owned, set on step 2' : '' }}</small
            ></span
          ></label
        >
      </div>
    </details>
  </section>
</template>
