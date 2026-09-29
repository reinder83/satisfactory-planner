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
    const w = wizard,
      save = w && workspace.saves.find(s => s.id === w.saveId);
    if (!save?.profiles.length) return null;
    // save is only found with a draft open, and has profiles (checked above).
    const source = save.profiles.find(p => p.id === w!.carryFrom) || save.profiles[0]!;
    const picks = w!.carry || {},
      picked = pickedRecipeUnlocks(w!.preview).length;
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
        <option v-for="p in view.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select></label
    >
    <p v-if="view.transcribed" class="notice warn" data-resolve-warning>{{ RESOLVE_WARNING }}</p>
    <div class="carry-list">
      <label v-for="o in view.options" :key="o.key" class="check-row"
        ><input type="checkbox" name="carry" :value="o.key" :checked="o.on" /><span
          ><b>{{ o.label }}</b
          >{{ o.count }}<br /><small class="muted">{{ o.detail }}</small></span
        ></label
      >
    </div>
    <p class="small muted">
      Production lines this plan expands are carried unticked for review. Steps this plan does not
      contain stay with the profile you carried from.
    </p>
  </section>
</template>
