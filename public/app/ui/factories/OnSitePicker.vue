<!--
  "Made on site" for one factory group, while groups are edited (#877, part of #868): a checkbox
  per item the group can make on site (onSitePickerOffers in app/on-site-picker.ts: an item a plan
  row makes and one of the group's rows uses in any phase; one only its lines in other phases use
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
import { onSiteChange, onSitePickerOffers } from '../../on-site-picker.ts';
import { onSitePlannable } from '../../on-site.ts';
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
          :class="{ unavailable: !changed }"
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
