<!--
  The "Storage layout" panel while editing the layout of floor `floor`: add a bay to this
  floor under any free letter (the next free one is filled in; the owner's choice on #167),
  add a floor, rename this floor, and remove an added floor once it has no bays. Existing
  addresses and their progress never move. A hidden handbook bay's letter can be taken after a
  confirmation, which clears the records kept for that bay.
  Each form ignores an empty name and empties after a successful save.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { save, toast } from '../../api.ts';
import { setFloor } from '../../session.ts';
import { render } from '../../shell.ts';
import { hiddenStorageBays, nextBayLetter, storageBays } from '../../views/storage.ts';
import type { StorageFloor } from '../../views/storage.ts';
import type { UpdateOp } from '../../../types/index.ts';

// bays: how many bays the floor has; an added floor can only go once it has none.
const props = withDefaults(defineProps<{ floor: StorageFloor; bays?: number }>(), { bays: 0 });

const randomId = (prefix: string, bytes: number) =>
  prefix +
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');

// Saves `op(name)` from a form's name field, then empties the form and redraws.
async function submit(e: Event, op: (name: string) => UpdateOp | null) {
  const form = e.target as HTMLFormElement,
    name = String(new FormData(form).get('name') || '').trim();
  if (!name) return;
  const change = op(name);
  if (!change) return;
  try {
    await save(change);
    form.reset();
    render();
  } catch {}
}

// The letter box starts on the next free letter; the user may type any other.
const suggested = () => nextBayLetter() || '';
const addBay = (e: Event) =>
  submit(e, name => {
    const field = new FormData(e.target as HTMLFormElement).get('letter');
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
      !confirm(
        `Bay ${letter} still has saved progress from the handbook bay. Use ${letter} anyway? Its old checks, notes and names will be removed.`,
      )
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
const addFloor = (e: Event) =>
  submit(e, name => ({ type: 'storageFloorAdd', id: randomId('cf-', 6), label: name }));
const renameFloor = (e: Event) =>
  submit(e, name => ({ type: 'storageFloorRename', id: props.floor.id, label: name }));

// "Hide this floor" (built-in floors, #168): once none of its bays is showing, the tab goes; the
// storage page's Hidden panel brings it back. The page then shows the first visible floor.
const hiding = ref(false);
async function hideFloor() {
  if (!confirm(`Hide ${props.floor.label}? You can bring it back under Hidden bays and floors.`))
    return;
  hiding.value = true;
  try {
    await save({ type: 'storageFloorHide', id: props.floor.id });
    render();
  } catch {
  } finally {
    hiding.value = false;
  }
}

// "Remove this floor", after a confirmation; then back to the ground floor.
const removing = ref(false);
async function removeFloor() {
  if (!confirm('Remove this added floor?')) return;
  removing.value = true;
  try {
    await save({ type: 'storageFloorRemove', id: props.floor.id });
    setFloor('ground');
    render();
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
          :value="suggested()"
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
        :disabled="hiding || bays > 0"
        @click="hideFloor"
      >
        {{ bays ? 'Hide or remove its bays first' : 'Hide this floor' }}
      </button>
      <button
        v-if="!floor.builtin"
        class="btn danger"
        :data-remove-floor="floor.id"
        :class="{ unavailable: !removing }"
        :disabled="removing || bays > 0"
        @click="removeFloor"
      >
        {{ bays ? 'Remove its bays first' : 'Remove this floor' }}
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
