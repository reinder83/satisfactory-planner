<!--
  "Made on site" for one factory group, while groups are edited (#877, part of #868): a checkbox
  per item the group can make on site (onSitePickerOffers in app/on-site-picker.ts: an item a plan
  row makes and one of the group's rows other than its lines made on site uses in any phase, or an
  ingredient of a part ticked here, named after it, #967), and Save. The items the page's cards
  use come first, then those ingredients, then any mark no line uses now. The items only the
  group's lines in other phases use (#941) come last, under a heading per set of phases ("Used
  only by this group's lines in Phases 4 and 5", #963) that also names their group of boxes, and
  each names only its lines, so the phases are not repeated on every box. Ticking a box only
  changes the choice on this page; Save sends the whole list as one `factoryLocal` update
  (factoryGroups.local). That is the explicit action (#854, #856): nothing is saved while a
  keyboard user moves through the boxes.
  Save is disabled while the choice is the saved one, which style.css draws as having nothing to
  do rather than as busy (#939, #948), and busy only while it saves (app/busy.ts); once saved it
  has nothing to do again, so focus goes on to the first box (ui/refocus.ts). An item the group marks that it no longer uses
  stays listed, so it can be cleared. Saving never recalculates: the page then says the plan needs
  a recalculation and offers it (OnSiteRecalc.vue), at the top of the page, far above this group.
  So after a save the picker says "Saved." in a live region and, while the plan needs a
  recalculation, offers "Go to the recalculation", which brings that notice into view and focuses
  its button.

  A choice not saved yet is never dropped without a word, and never saved by anything but Save
  (#930). Discard, beside Save while there is something to save, puts the saved choice back.
  The picker registers with api.ts (choiceDrafts): Done editing and folding the group keep it on
  screen while its choice is unsaved, and it then says so in a live region and focuses Save, with
  Discard beside it (holdUnsavedChoices); leaving the page, the profile or the phase asks first,
  as for an unsaved note (allowSwitch), and closing the tab warns (listeners.ts).
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { choiceDrafts, save, type ChoiceDraft } from '../../api.ts';
import { calculated, stage } from '../../session.ts';
import { render } from '../../shell.ts';
import { onSiteChange, onSitePickerOffers, type OnSiteEntry } from '../../on-site-picker.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { isBusy, whileBusy } from '../../busy.ts';
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
// Set by Discard, until a box is ticked or cleared again: the live region says so.
const discarded = ref(false);
// Set when Done editing or folding the group was held back by this unsaved choice (#930), until
// it is saved or discarded: the picker says why, beside Save and Discard.
const held = ref(false);
const holding = computed(() => held.value && changed.value);
// Whether the plan needs a recalculation for the marks as saved (OnSiteRecalc.vue shows it).
const needsRecalc = computed(() =>
  legacy(() => !!calculated && !!onSiteChange(calculated, factoryGroupsState())),
);

// The boxes in sections: first the one without a heading, then one per set of other phases
// (`key`, "4-5"), headed by them.
interface PickerSection {
  key: string;
  heading: string;
  entries: OnSiteEntry[];
}
const sections = computed(() =>
  legacy((): PickerSection[] => {
    // The items its lines in this phase use, then the ingredients of the parts ticked here
    // (#967), then by phase those only its lines in other phases use (#941, #963). The boxes
    // ticked count before they are saved, so ticking Wire offers Copper Ingot at once. A marked
    // or ticked item it does not offer stays, after the first part, so it can be cleared, with
    // the heading's own note (#951, #953, #1007): an ingredient whose part was cleared, a raw
    // resource marked in an older or hand-edited save (#921), or a radioactive item (#933).
    const offers = calculated
      ? onSitePickerOffers(calculated, factoryGroupsState(), props.groupId, stage(), chosen.value, [
          ...saved.value,
          ...chosen.value,
        ])
      : { here: [], elsewhere: [] };
    return [
      { key: '', heading: '', entries: offers.here },
      ...offers.elsewhere.map(group => ({
        key: group.phases.join('-'),
        heading: "Used only by this factory's lines in " + group.where,
        entries: group.entries,
      })),
    ].filter(section => section.entries.length);
  }),
);
const id = computed(() => 'on-site-' + props.groupId);

function toggle(item: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(item);
  else next.delete(item);
  draft.value = sorted([...next]);
  justSaved.value = false;
  discarded.value = false;
  if (!changed.value) held.value = false;
}

// The picker's element and its Save, for the registration below.
const fieldset = ref<HTMLFieldSetElement | null>(null);
const saveButton = ref<HTMLButtonElement | null>(null);

// Done editing or folding the group while the choice is unsaved (holdUnsavedChoices in api.ts):
// the picker says so, and the first one held comes into view with focus on its Save.
async function hold(focus: boolean) {
  held.value = true;
  if (!focus) return;
  await nextTick();
  fieldset.value
    ?.querySelector('[data-on-site-held]')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  saveButton.value?.focus({ preventScroll: true });
}

const registration: ChoiceDraft = {
  el: () => fieldset.value,
  label: () => 'Made on site in ' + props.groupName,
  unsaved: () => changed.value,
  hold: focus => void hold(focus),
  discard: () => {
    draft.value = null;
    held.value = false;
    justSaved.value = false;
    discarded.value = true;
  },
};
onMounted(() => choiceDrafts.add(registration));
onBeforeUnmount(() => choiceDrafts.delete(registration));

// Discard: the saved choice again, nothing sent. Discard goes and Save has nothing left to do,
// so focus goes on to the first box, as after a save. Pressed while Save's write is on its way,
// it does nothing: that write lands whatever this says.
async function discard(event: Event) {
  const button = event.currentTarget as HTMLButtonElement;
  if (!changed.value || isBusy(saveButton.value)) return;
  const refocus = refocusAfterRemoval(button, {
    scope: button.closest('[data-on-site-picker]'),
    fallback: ['input[type=checkbox]'],
  });
  registration.discard();
  await refocus();
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
      discarded.value = false;
      held.value = false;
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
  <fieldset
    ref="fieldset"
    class="on-site-picker"
    :data-on-site-picker="groupId"
    :aria-describedby="id + '-hint'"
  >
    <legend>Made on site in {{ groupName }}</legend>
    <p :id="id + '-hint'" class="small muted">
      Tick the parts this factory makes for itself, next to the lines that use them, rather than
      bringing them in from a central line. Saving does not change the plan: a recalculation you
      start does.
    </p>
    <p v-if="!sections.length" class="small muted" data-on-site-none>
      None of this factory's lines uses a part the plan makes.
    </p>
    <template v-else>
      <div
        v-for="section in sections"
        :key="section.key"
        :class="{ 'on-site-elsewhere': section.heading }"
        :role="section.heading ? 'group' : undefined"
        :aria-labelledby="section.heading ? id + '-phases-' + section.key : undefined"
        :data-on-site-elsewhere="section.heading ? section.key : undefined"
      >
        <p v-if="section.heading" :id="id + '-phases-' + section.key" class="on-site-sub">
          {{ section.heading }}
        </p>
        <div class="on-site-items">
          <label v-for="entry in section.entries" :key="entry.item" class="on-site-item"
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
      </div>
      <div :id="id + '-held'" class="on-site-held" role="status" data-on-site-held>
        <p v-if="holding" class="notice warn">
          This choice is not saved yet. Save it or discard it first.
        </p>
      </div>
      <div class="on-site-actions">
        <button
          ref="saveButton"
          class="btn primary"
          type="button"
          :data-on-site-save="groupId"
          :aria-label="'Save made on site for ' + groupName"
          :aria-describedby="holding ? id + '-held' : undefined"
          :disabled="!changed"
          @click="apply"
        >
          Save
        </button>
        <button
          v-if="changed"
          class="btn"
          type="button"
          :data-on-site-discard="groupId"
          :aria-label="'Discard made on site for ' + groupName"
          @click="discard"
        >
          Discard
        </button>
        <span v-if="changed && !holding" class="small muted" data-on-site-unsaved
          >Not saved yet.</span
        >
        <span :id="id + '-saved'" class="small" role="status" data-on-site-saved
          ><template v-if="justSaved && !changed"
            >Saved.<template v-if="needsRecalc">
              This plan now needs a recalculation.</template
            ></template
          ><template v-else-if="discarded && !changed"
            >Discarded. The saved choice is back.</template
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
