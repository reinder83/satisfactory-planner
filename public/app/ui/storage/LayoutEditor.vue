<!--
  The "Storage layout" panel while editing the layout of floor `floor`: add a bay to this
  floor under any free letter (the next free one is filled in; the owner's choice on #167),
  add a floor, rename this floor, and remove an added floor once it has no bays. Existing
  addresses and their progress never move. A hidden handbook bay's letter can be taken after a
  confirmation, which clears the records kept for that bay.
  Each form ignores an empty name and empties after a successful save.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { save, toast } from '../../api.ts';
import { setFloor } from '../../session.ts';
import { render } from '../../shell.ts';
import { hiddenStorageBays, nextBayLetter, storageBays } from '../../views/storage.ts';
import type { StorageFloor } from '../../views/storage.ts';
import { confirmAction } from '../confirm.ts';
import { vValue } from '../form/value.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import type { UpdateOp } from '../../../types/index.ts';

// bays: how many bays the floor has; an added floor can only go once it has none.
// hiddenHere: hidden handbook bays moved onto this floor (#216). They are not shown, yet the
// floor cannot be hidden or removed while they are here, so the buttons name them.
const props = withDefaults(
  defineProps<{ floor: StorageFloor; bays?: number; hiddenHere?: string[] }>(),
  { bays: 0, hiddenHere: () => [] },
);
// Why the floor cannot go yet, or '' when it can.
const blocked = computed(() =>
  props.bays
    ? ''
    : props.hiddenHere.length
      ? `Restore and move hidden bay ${props.hiddenHere.join(', ')} first`
      : '',
);

const randomId = (prefix: string, bytes: number) =>
  prefix +
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

// Saves `makeUpdate(name)` from a form's name field, then empties the form and redraws.
// `makeUpdate` may ask first (a promise); null saves nothing. True once saved.
async function submit(
  event: Event,
  makeUpdate: (name: string) => UpdateOp | null | Promise<UpdateOp | null>,
) {
  const form = event.target as HTMLFormElement,
    name = String(new FormData(form).get('name') || '').trim();
  if (!name) return false;
  const change = await makeUpdate(name);
  if (!change) return false;
  try {
    await save(change);
    form.reset();
    render();
    return true;
  } catch {
    return false;
  }
}

// The letter box starts on the next free letter; the user may type any other. It is bound with
// v-value (form/value.ts), so the redraws of other saves leave a typed letter alone (#670); once a
// bay is added the box starts again on the next free letter.
const suggested = () => nextBayLetter() || '';
const letterField = ref<HTMLInputElement>();
const addBay = async (event: Event) => {
  const added = await submit(event, async name => {
    const field = new FormData(event.target as HTMLFormElement).get('letter');
    const letter = String(field || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{1,2}$/.test(letter)) {
      toast('Choose a bay letter: one or two letters, A to ZZ.', true);
      return null;
    }
    if (storageBays().some(b => b.id === letter)) {
      toast(`Bay ${letter} is already in the room. Choose another letter.`, true);
      return null;
    }
    // A hidden handbook bay keeps its records until the user agrees to replace it.
    const replace = hiddenStorageBays().some(b => b.id === letter);
    if (
      replace &&
      !(await confirmAction({
        title: `Reuse bay letter ${letter}?`,
        body: `Bay ${letter} still has saved progress from the handbook bay. Use ${letter} anyway? Its old checks, notes and names will be removed.`,
        confirmLabel: `Use ${letter}`,
        danger: true,
      }))
    )
      return null;
    return {
      type: 'storageBayAdd',
      id: letter,
      name,
      floor: props.floor.id,
      ...(replace ? { replace: true } : {}),
    };
  });
  if (added && letterField.value) letterField.value.value = suggested();
};
const addFloor = (event: Event) =>
  submit(event, name => ({ type: 'storageFloorAdd', id: randomId('cf-', 6), label: name }));
const renameFloor = (event: Event) =>
  submit(event, name => ({ type: 'storageFloorRename', id: props.floor.id, label: name }));

// Once a floor is hidden or removed, focus goes to the tab of the floor now shown
// (ui/refocus.ts, #286).
const floorTabs = { fallback: ['#main .tabs [data-floor].active'] };

// "Hide this floor" (built-in floors, #168): once none of its bays is showing, the tab goes; the
// storage page's Hidden panel brings it back. The page then shows the first visible floor.
// Hide and Remove are busy while they save (bound aria-disabled, app/busy.ts: a failed save
// leaves focus on them, #299).
const hiding = ref(false);
async function hideFloor(event: Event) {
  if (hiding.value) return;
  const refocus = refocusAfterRemoval(event.currentTarget, floorTabs);
  if (
    !(await confirmAction({
      title: `Hide ${props.floor.label}?`,
      body: `Hide ${props.floor.label}? You can bring it back under Hidden bays and floors.`,
      confirmLabel: 'Hide floor',
    }))
  )
    return;
  hiding.value = true;
  try {
    await save({ type: 'storageFloorHide', id: props.floor.id });
    render();
    await refocus();
  } catch {
  } finally {
    hiding.value = false;
  }
}

// "Remove this floor", after a confirmation; then back to the ground floor.
const removing = ref(false);
async function removeFloor(event: Event) {
  if (removing.value) return;
  const refocus = refocusAfterRemoval(event.currentTarget, floorTabs);
  if (
    !(await confirmAction({
      title: 'Remove this floor?',
      body: 'Remove this added floor?',
      confirmLabel: 'Remove floor',
      danger: true,
    }))
  )
    return;
  removing.value = true;
  try {
    await save({ type: 'storageFloorRemove', id: props.floor.id });
    setFloor('ground');
    render();
    await refocus();
  } catch {
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <section class="panel edit-panel">
    <h2>Storage layout</h2>
    <div class="edit-grid">
      <form id="add-bay" class="inline-form" @submit.prevent="addBay">
        <input
          id="new-bay-letter"
          class="new-bay-letter"
          name="letter"
          maxlength="2"
          required
          pattern="[A-Za-z]{1,2}"
          ref="letterField"
          v-value="suggested()"
          aria-label="New bay letter"
        /><input
          id="new-bay-name"
          name="name"
          maxlength="80"
          required
          placeholder="New bay on this floor…"
          aria-label="New bay name"
        /><button class="btn primary" type="submit">+ Add bay</button>
      </form>
      <form id="add-floor" class="inline-form" @submit.prevent="addFloor">
        <input
          id="new-floor-name"
          name="name"
          maxlength="80"
          required
          placeholder="New floor (e.g. Basement overflow)"
          aria-label="New floor name"
        /><button class="btn" type="submit">Add floor</button>
      </form>
      <form id="rename-floor" class="inline-form" @submit.prevent="renameFloor">
        <input
          id="floor-rename-input"
          name="name"
          maxlength="80"
          required
          placeholder="Rename this floor…"
          aria-label="Rename this floor"
        /><button class="btn" type="submit">Rename floor</button>
      </form>
      <button
        v-if="floor.builtin"
        class="btn"
        :data-hide-floor="floor.id"
        :class="{ unavailable: !hiding }"
        :aria-disabled="hiding || undefined"
        :disabled="!hiding && (bays > 0 || !!blocked)"
        @click="hideFloor"
      >
        {{ bays ? 'Hide or remove its bays first' : blocked || 'Hide this floor' }}
      </button>
      <button
        v-if="!floor.builtin"
        class="btn danger"
        :data-remove-floor="floor.id"
        :class="{ unavailable: !removing }"
        :aria-disabled="removing || undefined"
        :disabled="!removing && (bays > 0 || !!blocked)"
        @click="removeFloor"
      >
        {{ bays ? 'Remove its bays first' : blocked || 'Remove this floor' }}
      </button>
    </div>
    <p class="small muted">
      Handbook bays and their addresses stay put: rename them, hide them or fill reserved positions.
      Added bays take any free letter (the next one is filled in), and their addresses and progress
      stay with that letter. A bay with no free position takes extra containers at 09 and upwards.
      Removing a container keeps its saved checkmarks.
    </p>
  </section>
</template>
