<!--
  "Made on site" for one factory group, while groups are edited (#877, part of #868): a checkbox
  per item the group can make on site (onSitePickerOffers in app/on-site-picker.ts: an item a plan
  row makes and one of the group's rows uses in any phase; one only its lines in other phases use
  comes last and names them, #941), and Save. Ticking a box only changes the choice on this
  page; Save sends the whole list as one `factoryLocal` update (factoryGroups.local). That is the
  explicit action (#854, #856): nothing is saved while a keyboard user moves through the boxes.
  Save is disabled while the choice is the saved one, and busy while it saves (app/busy.ts); once
  saved it has nothing to do again, so focus goes on to the first box (ui/refocus.ts). An item the
  group marks that it no longer uses stays listed, so it can be cleared. Saving never recalculates:
  the page then says the plan needs a recalculation and offers it (OnSiteRecalc.vue).
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { save } from '../../api.ts';
import { calculated, stage } from '../../session.ts';
import { render } from '../../shell.ts';
import { onSitePickerOffers } from '../../on-site-picker.ts';
import { onSitePlannable } from '../../on-site.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { whileBusy } from '../../busy.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import ItemIcon from '../ItemIcon.vue';

const props = defineProps<{ groupId: string; groupName: string }>();

const sorted = (items: readonly string[]) => [...items].sort((a, b) => a.localeCompare(b));

// The items saved for this group, and what the boxes show: the saved items until a box is
// ticked or cleared, then this page's choice until it is saved.
const saved = computed(() =>
  legacy(() => sorted(factoryGroupsState().local?.[props.groupId] || [])),
);
const draft = ref<string[] | null>(null);
const chosen = computed(() => draft.value ?? saved.value);
const changed = computed(
  () => draft.value !== null && draft.value.join('|') !== saved.value.join('|'),
);

const items = computed(() =>
  legacy(() => {
    // The items its lines in this phase use, then those only its lines in other phases use, each
    // with a note naming those lines (#941).
    const offered = calculated
      ? onSitePickerOffers(calculated, factoryGroupsState(), props.groupId, stage())
      : [];
    // A marked item no row of the group uses any more stays, so it can be cleared. A raw resource
    // marked in an older or hand-edited save (such as Water) can never be made on site (#921), so
    // its note says that instead.
    const stale = saved.value.filter(item => !offered.some(entry => entry.item === item));
    return [
      ...offered,
      ...stale.map(item => ({
        item,
        note: onSitePlannable(item) ? '(no line here uses it now)' : "(can't be made on site)",
      })),
    ];
  }),
);
const id = computed(() => 'on-site-' + props.groupId);

function toggle(item: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(item);
  else next.delete(item);
  draft.value = sorted([...next]);
}

// Save: the group's whole list, then the page redrawn from the saved state. A failed save keeps
// the choice and focus on Save (save() shows the error).
async function apply(event: Event) {
  const button = event.currentTarget as HTMLButtonElement;
  if (!changed.value) return;
  const refocus = refocusAfterRemoval(button, {
    scope: button.closest('[data-on-site-picker]'),
    fallback: ['input[type=checkbox]'],
  });
  const done = await whileBusy(button, async () => {
    try {
      await save({ type: 'factoryLocal', id: props.groupId, items: chosen.value });
      draft.value = null;
      return true;
    } catch {
      return false;
    } finally {
      render();
    }
  });
  if (done) await refocus();
}
</script>

<template>
  <fieldset class="on-site-picker" :data-on-site-picker="groupId" :aria-describedby="id + '-hint'">
    <legend>Made on site in {{ groupName }}</legend>
    <p :id="id + '-hint'" class="small muted">
      Tick the parts this group makes for itself, next to the lines that use them, rather than
      bringing them in from a central line. Saving does not change the plan: a recalculation you
      start does.
    </p>
    <p v-if="!items.length" class="small muted" data-on-site-none>
      None of this group's lines uses a part the plan makes.
    </p>
    <template v-else>
      <div class="on-site-items">
        <label v-for="entry in items" :key="entry.item" class="on-site-item"
          ><input
            type="checkbox"
            :data-on-site-item="entry.item"
            :checked="chosen.includes(entry.item)"
            @change="toggle(entry.item, ($event.target as HTMLInputElement).checked)"
          /><ItemIcon :name="entry.item" /><span
            >{{ entry.item }}<small v-if="entry.note" class="muted"> {{ entry.note }}</small></span
          ></label
        >
      </div>
      <div class="on-site-actions">
        <button
          class="btn primary"
          type="button"
          :data-on-site-save="groupId"
          :aria-label="'Save made on site for ' + groupName"
          :disabled="!changed"
          @click="apply"
        >
          Save
        </button>
        <span v-if="changed" class="small muted" data-on-site-unsaved>Not saved yet.</span>
      </div>
    </template>
  </fieldset>
</template>
