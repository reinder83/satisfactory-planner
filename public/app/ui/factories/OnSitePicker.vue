<!--
  "Made on site" for one factory group, while groups are edited (#877, part of #868): a checkbox
  per item the group can make on site (onSitePickerOffers in app/on-site-picker.ts: an item a plan
  row makes and one of the group's rows other than its lines made on site uses in any phase, or an
  ingredient of a part ticked here, named after it, #967; one only its lines in other phases use
  comes last and names them, #941), and Save. Ticking a box only changes the choice on this
  page; Save sends the whole list as one `factoryLocal` update (factoryGroups.local). That is the
  explicit action (#854, #856): nothing is saved while a keyboard user moves through the boxes.
  Save is disabled while the choice is the saved one, marked .unavailable so it is drawn as having
  nothing to do rather than as busy (style.css draws a bare disabled button with the wait cursor,
  #939), and busy only while it saves (app/busy.ts); once saved it has nothing to do again, so
  focus goes on to the first box (ui/refocus.ts). An item the group marks that it no longer uses
  stays listed, so it can be cleared. Saving never recalculates: the page then says the plan needs
  a recalculation and offers it (OnSiteRecalc.vue), at the top of the page, far above this group.
  So after a save the picker says "Saved." in a live region and, while the plan needs a
  recalculation, offers "Go to the recalculation", which brings that notice into view and focuses
  its button.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { save } from '../../api.ts';
import { calculated, stage } from '../../session.ts';
import { render } from '../../shell.ts';
import { onSiteChange, onSitePickerOffers, RAW_NOTE, UNUSED_NOTE } from '../../on-site-picker.ts';
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
// Set by a save from this picker, until a box is ticked or cleared again.
const justSaved = ref(false);
// Whether the plan needs a recalculation for the marks as saved (OnSiteRecalc.vue shows it).
const needsRecalc = computed(() =>
  legacy(() => !!calculated && !!onSiteChange(calculated, factoryGroupsState())),
);

const items = computed(() =>
  legacy(() => {
    // The items its lines in this phase use, then the ingredients of the parts ticked here
    // (#967), then those only its lines in other phases use, each with a note (#941). The boxes
    // ticked count before they are saved, so ticking Wire offers Copper Ingot at once.
    const offered = calculated
      ? onSitePickerOffers(calculated, factoryGroupsState(), props.groupId, stage(), chosen.value)
      : [];
    // A marked or ticked item no row of the group uses any more (an ingredient whose part was
    // cleared, #951) stays, so it can be cleared, with the heading's note. A raw resource marked
    // in an older or hand-edited save (such as Water) can never be made on site (#921), so its
    // note says that instead.
    const stale = sorted([...new Set([...saved.value, ...chosen.value])]).filter(
      item => !offered.some(entry => entry.item === item),
    );
    return [
      ...offered,
      ...stale.map(item => ({ item, note: onSitePlannable(item) ? UNUSED_NOTE : RAW_NOTE })),
    ];
  }),
);
const id = computed(() => 'on-site-' + props.groupId);

function toggle(item: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(item);
  else next.delete(item);
  draft.value = sorted([...next]);
  justSaved.value = false;
}

// "Go to the recalculation": the page's notice into view, and focus on its button.
function showRecalc() {
  const notice = document.querySelector<HTMLElement>('[data-on-site-recalc]');
  notice?.scrollIntoView({ block: 'center' });
  notice?.querySelector<HTMLElement>('[data-recalc-on-site]')?.focus({ preventScroll: true });
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
      justSaved.value = true;
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
            >{{ entry.item
            }}<small v-if="entry.note" class="muted">{{ ' ' + entry.note }}</small></span
          ></label
        >
      </div>
      <div class="on-site-actions">
        <button
          class="btn primary"
          type="button"
          :data-on-site-save="groupId"
          :aria-label="'Save made on site for ' + groupName"
          :class="{ unavailable: !changed }"
          :disabled="!changed"
          @click="apply"
        >
          Save
        </button>
        <span v-if="changed" class="small muted" data-on-site-unsaved>Not saved yet.</span>
        <span :id="id + '-saved'" class="small" role="status" data-on-site-saved
          ><template v-if="justSaved && !changed"
            >Saved.<template v-if="needsRecalc">
              This plan now needs a recalculation.</template
            ></template
          ></span
        >
        <button
          v-if="justSaved && !changed && needsRecalc"
          class="btn"
          type="button"
          data-on-site-next
          :aria-describedby="id + '-saved'"
          @click="showRecalc"
        >
          Go to the recalculation <span aria-hidden="true">↑</span>
        </button>
      </div>
    </template>
  </fieldset>
</template>
