<!--
  Review, only when adding a profile to a save that already has profiles: which of that save's
  profiles to continue, and which records to copy from it. The select (carryFrom) and the
  checkboxes (carry) are read by readCarry when the profile is created. Carrying copies: the
  create request names the source profile, and newProfileState (state.ts) reads its records
  into the new profile's fresh state without writing to the source. Recipe picks are offered
  only when the plan picks its own recipes.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { carryOptions, pickedRecipeUnlocks } from '../../../state.ts';
import { num } from '../../format.ts';
import { wizard, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { RESOLVE_WARNING } from '../../../handbook-migration.ts';

const view = computed(() =>
  legacy(() => {
    const wizardDraft = wizard,
      save = wizardDraft && workspace.saves.find(s => s.id === wizardDraft.saveId);
    if (!save?.profiles.length) return null;
    // save is only found with a draft open, and has profiles (checked above).
    const source = save.profiles.find(p => p.id === wizardDraft!.carryFrom) || save.profiles[0]!;
    const picks = wizardDraft!.carry || {},
      picked = pickedRecipeUnlocks(wizardDraft!.preview).length;
    return {
      profiles: save.profiles.map(p => ({ id: p.id, name: p.name })),
      source: source.id,
      // The source is a transcribed handbook, which the new plan solves afresh (#480).
      transcribed: !!source.transcribed,
      options: carryOptions
        .filter(([key]) => key !== 'picked' || picked > 0)
        .map(([key, label, detail]) => ({
          key,
          label,
          detail,
          on: !!picks[key],
          count: key === 'picked' ? ' (' + num(picked) + ')' : '',
        })),
    };
  }),
);
</script>

<template>
  <section v-if="view" class="panel carry-panel">
    <h3>Continue the progress in this save</h3>
    <p>
      A new profile is a new plan for the same world, so it can start from what you have already
      done. Nothing is moved — the profile you carry from keeps all of it.
    </p>
    <label class="field"
      >Carry progress from
      <select name="carryFrom" :value="view.source">
        <option v-for="profile in view.profiles" :key="profile.id" :value="profile.id">
          {{ profile.name }}
        </option>
      </select></label
    >
    <p v-if="view.transcribed" class="notice warn" data-resolve-warning>{{ RESOLVE_WARNING }}</p>
    <div class="carry-list">
      <label v-for="option in view.options" :key="option.key" class="check-row"
        ><input type="checkbox" name="carry" :value="option.key" :checked="option.on" /><span
          ><b>{{ option.label }}</b
          >{{ option.count }}<br /><small class="muted">{{ option.detail }}</small></span
        ></label
      >
    </div>
    <p class="small muted">
      Production lines this plan expands are carried unticked for review. Steps this plan does not
      contain stay with the profile you carried from.
    </p>
  </section>
</template>
