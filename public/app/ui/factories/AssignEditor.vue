<!--
  A factory card's group editor, shown while editing groups. `factoryKey` is the handbook
  factory id or the calculated row id. Each membership has a rate (empty: the whole output, or
  the remainder) and a ✕; "+ Add to group…" adds another. Every change saves the factory's
  whole membership list as one `factoryAssign`; the cap of 12 groups matches validation in
  state.ts. A field is redrawn with the saved value afterwards, whether or not the save worked.
  `unit` (a calculated generator's card, #374) names what a rate is measured in: a nuclear
  plant's first output, its waste per minute, with `mw` the power one of them stands for, shown
  beside the field while typing; an output-less generator's rate is in MW. Without it the field
  is "Production per minute", the factory's output.
-->
<script lang="ts">
// Numbers each editor, so the ids of its hints are unique on the page.
let editors = 0;
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { save, toast } from '../../api.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { whileBusy } from '../../busy.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import { vValue } from '../form/value.ts';
import { power } from '../../wizard/fields.ts';
import type { GroupAssignment } from '../../../types/index.ts';

// What a rate is measured in: an item per minute, with the MW one stands for, or 'MW'.
export interface RateUnit {
  name: string;
  mw?: number;
}

const props = defineProps<{ factoryKey: string; unit?: RateUnit }>();

// Each editor names its hints apart: a factory in two groups has an editor in each section.
const uid = 'assign-unit-' + ++editors;
// What is typed in a rate field and not yet saved, by group, for the power figure beside it.
const typed = ref<Record<string, string>>({});

// The hint under a rate field: its unit, and for a nuclear plant the power a valid rate stands
// for (#374). A field left empty (the whole output or the remainder) has no figure.
function hint(unit: RateUnit, raw: string): string {
  if (unit.name === 'MW') return 'MW';
  const q = raw.trim() === '' ? NaN : Number(raw);
  return (
    unit.name + '/min' + (unit.mw && Number.isFinite(q) && q > 0 ? ' ≈ ' + power(q * unit.mw) : '')
  );
}

const editor = computed(() =>
  legacy(() => {
    const g = factoryGroupsState(),
      ms = membershipsOf(props.factoryKey);
    const nameOf = (m: GroupAssignment) => g.groups.find(x => x.id === m.group)?.name;
    return {
      any: g.groups.length > 0,
      rows: ms.map((m, i) => {
        const name = nameOf(m),
          u = props.unit;
        return {
          group: m.group,
          rate: m.rate ?? '',
          name,
          label:
            (u ? (u.name === 'MW' ? 'MW' : u.name + ' per minute') : 'Production per minute') +
            ' in ' +
            (name || 'this group'),
          hint: u ? hint(u, typed.value[m.group] ?? String(m.rate ?? '')) : '',
          hintId: u ? uid + '-' + i : undefined,
        };
      }),
      avail: ms.length < 12 ? g.groups.filter(gr => !ms.some(m => m.group === gr.id)) : [],
    };
  }),
);

// Saves this factory's memberships, `change` applied to the current list of { group, rate }.
// Resolves true once it is saved. The control is busy meanwhile (app/busy.ts, #299); pressed
// again while it is, it saves nothing and resolves false.
async function assign(
  el: HTMLInputElement | HTMLSelectElement | HTMLButtonElement,
  change: (memberships: GroupAssignment[]) => GroupAssignment[],
): Promise<boolean> {
  const groups = change(
    membershipsOf(props.factoryKey).map(m => ({ group: m.group, rate: m.rate })),
  );
  const saved = await whileBusy(el, async () => {
    try {
      await save({ type: 'factoryAssign', key: props.factoryKey, groups });
      return true;
    } catch {
      return false;
    } finally {
      render();
    }
  });
  return saved ?? false;
}

// The rate beside a group: empty for the whole output or the remainder, anything else above 0.
function setRate(e: Event, group: string) {
  const el = e.target as HTMLInputElement,
    raw = el.value.trim();
  let rate: number | null = null;
  if (raw !== '') {
    rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast(
        'Enter a rate above 0, or leave the field empty for the whole output or the remainder.',
        true,
      );
      el.value = savedRate(group);
      delete typed.value[group];
      return;
    }
  }
  assign(el, ms => ms.map(m => (m.group === group ? { group, rate } : m))).then(() => {
    // The field is bound with v-value, which only redraws a changed rate, so put the saved one
    // back here: after a failed save, or a rate typed another way ("120.0").
    el.value = savedRate(group);
    delete typed.value[group];
  });
}

const savedRate = (group: string) =>
  String(membershipsOf(props.factoryKey).find(m => m.group === group)?.rate ?? '');

// ✕: leave that group, keeping the other groups' rates. The row goes, and the whole card when it
// was drawn in that group's section, so focus goes to this factory's next ✕, else its previous
// one, else its "+ Add to group…" (ui/refocus.ts, #290): on this card while it is still there,
// else on the factory's card elsewhere on the page.
async function unassign(e: Event, group: string) {
  const button = e.currentTarget as HTMLButtonElement,
    key = CSS.escape(props.factoryKey);
  const refocus = refocusAfterRemoval(button, {
    scope: button.closest('.assign-editor'),
    row: `[data-unassign="${key}"]`,
    fallback: [`[data-assign-add="${key}"]`, `[data-assign-rate="${key}"]`],
  });
  if (await assign(button, ms => ms.filter(m => m.group !== group))) await refocus();
}

// "+ Add to group…": join the chosen group with no rate. A factory that joins its first group
// moves to that group's section with its editor, so focus goes after it: to its "+ Add to
// group…" there, else to the new group's rate field (#299).
async function add(e: Event) {
  const el = e.target as HTMLSelectElement,
    group = el.value,
    key = CSS.escape(props.factoryKey);
  el.value = '';
  if (!group) return;
  const refocus = refocusAfterRemoval(el, {
    scope: el.closest('.assign-editor'),
    fallback: [
      `[data-assign-add="${key}"]`,
      `[data-assign-rate="${key}"][data-group="${CSS.escape(group)}"]`,
    ],
  });
  if (await assign(el, ms => [...ms, { group, rate: null }])) await refocus();
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
        v-value="m.rate"
        :aria-label="m.label"
        :aria-describedby="m.hintId"
        @input="typed[m.group] = ($event.target as HTMLInputElement).value"
        @change="setRate($event, m.group)"
      /><button
        class="btn quiet danger"
        :data-unassign="factoryKey"
        :data-group="m.group"
        :aria-label="'Remove from ' + (m.name || 'group')"
        @click="unassign($event, m.group)"
      >
        ✕</button
      ><small v-if="m.hintId" :id="m.hintId" class="assign-unit">{{ m.hint }}</small>
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
