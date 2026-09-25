<!--
  A factory card's group editor, shown while editing groups. `factoryKey` is the handbook
  factory id or the calculated row id. Each membership has a rate (empty: the whole output, or
  the remainder) and a ✕; "+ Add to group…" adds another. Every change saves the factory's
  whole membership list as one `factoryAssign`; the cap of 12 groups matches validation in
  state.ts. A field is redrawn with the saved value afterwards, whether or not the save worked.
-->
<script setup>
import { computed } from 'vue';
import { save, toast } from '../../api.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';

const props = defineProps({ factoryKey: { type: String, required: true } });

const editor = computed(() =>
  legacy(() => {
    const g = factoryGroupsState(),
      ms = membershipsOf(props.factoryKey);
    const nameOf = m => g.groups.find(x => x.id === m.group)?.name;
    return {
      any: g.groups.length > 0,
      rows: ms.map(m => ({ group: m.group, rate: m.rate ?? '', name: nameOf(m) })),
      avail: ms.length < 12 ? g.groups.filter(gr => !ms.some(m => m.group === gr.id)) : [],
    };
  }),
);

// Saves this factory's memberships, `change` applied to the current list of { group, rate }.
async function assign(el, change) {
  const groups = change(
    membershipsOf(props.factoryKey).map(m => ({ group: m.group, rate: m.rate })),
  );
  el.disabled = true;
  try {
    await save({ type: 'factoryAssign', key: props.factoryKey, groups });
  } catch {
  } finally {
    el.disabled = false;
    render();
  }
}

// The rate beside a group: empty for the whole output or the remainder, anything else above 0.
function setRate(e, group) {
  const el = e.target,
    raw = el.value.trim();
  let rate = null;
  if (raw !== '') {
    rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast(
        'Enter a rate above 0, or leave the field empty for the whole output or the remainder.',
        true,
      );
      el.value = membershipsOf(props.factoryKey).find(m => m.group === group)?.rate ?? '';
      return;
    }
  }
  assign(el, ms => ms.map(m => (m.group === group ? { group, rate } : m)));
}

// ✕: leave that group, keeping the other groups' rates.
const unassign = (e, group) => assign(e.currentTarget, ms => ms.filter(m => m.group !== group));

// "+ Add to group…": join the chosen group with no rate.
function add(e) {
  const el = e.target,
    group = el.value;
  el.value = '';
  if (group) assign(el, ms => [...ms, { group, rate: null }]);
}
</script>

<template>
  <p v-if="!editor.any" class="small muted">Create a group above to place this factory.</p>
  <div v-else class="assign-editor">
    <div v-for="m in editor.rows" :key="m.group" class="assign-row">
      <span>{{ m.name || '' }}</span
      ><input
        type="number"
        min="0"
        step="any"
        :data-assign-rate="factoryKey"
        :data-group="m.group"
        placeholder="all / remainder"
        :value="m.rate"
        :aria-label="'Production per minute in ' + (m.name || 'this group')"
        @change="setRate($event, m.group)"
      /><button
        class="btn quiet danger"
        :data-unassign="factoryKey"
        :data-group="m.group"
        :aria-label="'Remove from ' + (m.name || 'group')"
        @click="unassign($event, m.group)"
      >
        ✕
      </button>
    </div>
    <select
      v-if="editor.avail.length"
      :data-assign-add="factoryKey"
      aria-label="Add to a group"
      @change="add"
    >
      <option value="">+ Add to group…</option>
      <option v-for="gr in editor.avail" :key="gr.id" :value="gr.id">{{ gr.name }}</option>
    </select>
  </div>
</template>
