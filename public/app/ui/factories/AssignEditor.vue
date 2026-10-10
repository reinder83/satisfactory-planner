<!--
  A factory card's group editor, shown while editing groups. `factoryKey` is the calculated row
  id. Each membership has a rate (empty: the whole output, or
  the rest) and a ✕; "+ Add to factory…" picks another and Add joins it (#856). Every change saves the factory's
  whole membership list as one `factoryAssign`; the cap of 12 groups matches validation in
  state.ts. A rate field shows the saved rate, then what is typed (ui/draft.ts, #691), and is
  redrawn with the saved rate afterwards, whether or not the save worked.
  `unit` (a calculated generator's card, #374) names what a rate is measured in: a nuclear
  plant's first output, its waste per minute, with `mw` the power one of them stands for, shown
  beside the field while typing; an output-less generator's rate is in MW. Without it the field
  is "Production per minute", the factory's output. `total` is what a rate is a part of (rowTotal
  of the calculated row): a rate too small a part of it to count gets a soft note under its field
  (tinyNote, #942, #1005); it is still saved.
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
import { leaveDraft, resetDraft, useDrafts } from '../draft.ts';
import { power } from '../../wizard/fields.ts';
import { LINK_DUST } from '../../group-order.ts';
import type { GroupAssignment } from '../../../types/index.ts';

// What a rate is measured in: an item per minute, with the MW one stands for, or 'MW'.
export interface RateUnit {
  name: string;
  mw?: number;
}

const props = defineProps<{ factoryKey: string; unit?: RateUnit; total?: number }>();

// Each editor names its hints apart: a factory in two groups has an editor in each section.
const uid = 'assign-unit-' + ++editors;
// The rate fields, by group: the saved rate, then what is typed and not yet saved, which a rate
// saved in another tab does not replace (#691), until the field is left without a commit (#687).
// The power figure beside a field reads it too.
const savedRates = (): Record<string, string> =>
  legacy(() =>
    Object.fromEntries(membershipsOf(props.factoryKey).map(m => [m.group, String(m.rate ?? '')])),
  );
const rates = useDrafts(savedRates);

// The hint under a rate field: its unit, and for a nuclear plant the power a valid rate stands
// for (#374). A field left empty (the whole output or the rest) has no figure.
function hint(unit: RateUnit, raw: string): string {
  if (unit.name === 'MW') return 'MW';
  const rate = raw.trim() === '' ? NaN : Number(raw);
  return (
    unit.name +
    '/min' +
    (unit.mw && Number.isFinite(rate) && rate > 0 ? ' ≈ ' + power(rate * unit.mw) : '')
  );
}

// A soft note under a rate too small a part of the line's output to count (#942): rowShares
// (group-order.ts) leaves out a share of `rate / total` at or below LINK_DUST, so the group's
// flow, the Logistics page and the build plan leave the line out of the group (#1005). Without a
// total, the note falls back to a rate below 0.001. Such a rate is still saved; it is almost
// always a typo.
function tinyNote(unit: RateUnit | undefined, raw: string, total: number | undefined): string {
  const rate = raw.trim() === '' ? NaN : Number(raw);
  if (!(rate > 0)) return '';
  if (total !== undefined && total > LINK_DUST)
    return rate / total <= LINK_DUST
      ? "So small a part of this production line's output that this factory won't count it."
      : '';
  if (rate >= 0.001) return '';
  return `Under 0.001${unit?.name === 'MW' ? ' MW' : '/min'}: so small this factory may not count it.`;
}

const editor = computed(() =>
  legacy(() => {
    const groupsState = factoryGroupsState(),
      memberships = membershipsOf(props.factoryKey);
    const nameOf = (membership: GroupAssignment) =>
      groupsState.groups.find(group => group.id === membership.group)?.name;
    return {
      any: groupsState.groups.length > 0,
      rows: memberships.map((membership, i) => {
        const name = nameOf(membership),
          unit = props.unit,
          raw = rates[membership.group] ?? String(membership.rate ?? ''),
          tiny = tinyNote(unit, raw, props.total),
          hintId = unit ? uid + '-' + i : undefined,
          tinyId = tiny ? uid + '-tiny-' + i : undefined;
        return {
          group: membership.group,
          name,
          label:
            (unit
              ? unit.name === 'MW'
                ? 'MW'
                : unit.name + ' per minute'
              : 'Production per minute') +
            ' in ' +
            (name || 'this factory'),
          hint: unit ? hint(unit, raw) : '',
          hintId,
          tiny,
          tinyId,
          describedBy: [hintId, tinyId].filter(Boolean).join(' ') || undefined,
        };
      }),
      avail:
        memberships.length < 12
          ? groupsState.groups.filter(group => !memberships.some(m => m.group === group.id))
          : [],
    };
  }),
);

// Saves this factory's memberships, `change` applied to the current list of { group, rate }.
// Resolves true once it is saved. The control is busy meanwhile (app/busy.ts, #299); pressed
// again while it is, it saves nothing and resolves false.
async function assign(
  control: HTMLInputElement | HTMLSelectElement | HTMLButtonElement,
  change: (memberships: GroupAssignment[]) => GroupAssignment[],
): Promise<boolean> {
  const groups = change(
    membershipsOf(props.factoryKey).map(m => ({ group: m.group, rate: m.rate })),
  );
  const saved = await whileBusy(control, async () => {
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

// The rate beside a group: empty for the whole output or the rest, anything else above 0.
function setRate(event: Event, group: string) {
  const input = event.target as HTMLInputElement,
    raw = input.value.trim();
  let rate: number | null = null;
  if (raw !== '') {
    rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast(
        'Enter a rate above 0, or leave the field empty for the whole output or the rest.',
        true,
      );
      input.value = savedRate(group);
      return;
    }
  }
  assign(input, memberships =>
    memberships.map(m => (m.group === group ? { group, rate } : m)),
  ).then(() => {
    // The saved rate again: after a failed save, or a rate typed another way ("120.0").
    input.value = savedRate(group);
  });
}

// A group's saved rate, which its field's draft takes again, untouched.
const savedRate = (group: string) => {
  const rate = savedRates()[group] ?? '';
  resetDraft(rates, group, rate);
  return rate;
};

// ✕: leave that group, keeping the other groups' rates. The row goes, and the whole card when it
// was drawn in that group's section, so focus goes to this factory's next ✕, else its previous
// one, else its "+ Add to group…" (ui/refocus.ts, #290): on this card while it is still there,
// else on the factory's card elsewhere on the page.
async function unassign(event: Event, group: string) {
  const button = event.currentTarget as HTMLButtonElement,
    key = CSS.escape(props.factoryKey);
  const refocus = refocusAfterRemoval(button, {
    scope: button.closest('.assign-editor'),
    row: `[data-unassign="${key}"]`,
    fallback: [`[data-assign-add="${key}"]`, `[data-assign-rate="${key}"]`],
  });
  if (await assign(button, memberships => memberships.filter(m => m.group !== group)))
    await refocus();
}

// "+ Add to factory…" only picks a group; Add beside it joins that group with no rate (#856).
// Chrome and Edge on Windows change a closed select's value on each arrow key and fire `change`,
// so a menu that added on `change` added the factory while a keyboard user was still reading the
// groups (as the storage bays' "Move to…" moved a bay, #854). Add is disabled until a group is
// picked, and busy while it saves (app/busy.ts): pressed again meanwhile, it sends nothing. A
// factory that joins its first group moves to that group's section with its editor, so focus
// goes after it: to its "+ Add to factory…" there, else to the new group's rate field (#299). A
// failed add keeps the group picked and focus on Add.
const picked = ref('');
// The picked group, while the factory can still join it.
const target = computed(() => editor.value.avail.find(group => group.id === picked.value));
async function add(event: Event) {
  const button = event.currentTarget as HTMLButtonElement,
    group = target.value?.id,
    key = CSS.escape(props.factoryKey);
  if (!group) return;
  const refocus = refocusAfterRemoval(button, {
    scope: button.closest('.assign-editor'),
    fallback: [
      `[data-assign-add="${key}"]`,
      `[data-assign-rate="${key}"][data-group="${CSS.escape(group)}"]`,
    ],
  });
  if (await assign(button, memberships => [...memberships, { group, rate: null }])) {
    picked.value = '';
    await refocus();
  }
}
</script>

<template>
  <p v-if="!editor.any" class="small muted">
    Create a factory above to place this production line.
  </p>
  <div v-else class="assign-editor">
    <div v-for="row in editor.rows" :key="row.group" class="assign-row">
      <span>{{ row.name || '' }}</span
      ><input
        type="number"
        min="0"
        step="any"
        :data-assign-rate="factoryKey"
        :data-group="row.group"
        placeholder="all / rest"
        :value="rates[row.group]"
        :aria-label="row.label"
        :aria-describedby="row.describedBy"
        @input="rates[row.group] = ($event.target as HTMLInputElement).value"
        @change="setRate($event, row.group)"
        @blur="leaveDraft(rates, row.group, $event)"
      /><button
        class="btn quiet danger"
        :data-unassign="factoryKey"
        :data-group="row.group"
        :aria-label="'Remove from ' + (row.name || 'factory')"
        @click="unassign($event, row.group)"
      >
        ✕</button
      ><small v-if="row.hintId" :id="row.hintId" class="assign-unit">{{ row.hint }}</small
      ><small v-if="row.tinyId" :id="row.tinyId" class="assign-tiny" data-tiny-rate>{{
        row.tiny
      }}</small>
    </div>
    <div v-if="editor.avail.length" class="assign-add">
      <select
        :data-assign-add="factoryKey"
        :value="target?.id ?? ''"
        aria-label="Factory to add this production line to"
        @change="picked = ($event.target as HTMLSelectElement).value"
      >
        <option value="">+ Add to factory…</option>
        <option v-for="group in editor.avail" :key="group.id" :value="group.id">
          {{ group.name }}
        </option></select
      ><button
        class="btn quiet"
        :data-assign-go="factoryKey"
        :aria-label="target ? 'Add to ' + target.name : 'Add to a factory'"
        :disabled="!target"
        @click="add"
      >
        Add
      </button>
    </div>
  </div>
</template>
