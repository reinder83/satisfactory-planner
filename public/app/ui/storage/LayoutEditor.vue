<!--
  The "Storage layout" panel while editing the layout of floor `floor`: add a bay to this
  floor (named by the next free letter, so existing addresses and their progress never
  move), add a floor, rename this floor, and remove an added floor once it has no bays.
  Each form ignores an empty name and empties after a successful save.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { save, toast } from '../../api.ts';
import { setFloor } from '../../session.ts';
import { render } from '../../shell.ts';
import { nextBayLetter } from '../../views/storage.ts';
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

const addBay = (e: Event) =>
  submit(e, name => {
    const letter = nextBayLetter();
    if (!letter) {
      toast('No free bay letters left.', true);
      return null;
    }
    return { type: 'storageBayAdd', id: letter, name, floor: props.floor.id };
  });
const addFloor = (e: Event) =>
  submit(e, name => ({ type: 'storageFloorAdd', id: randomId('cf-', 6), label: name }));
const renameFloor = (e: Event) =>
  submit(e, name => ({ type: 'storageFloorRename', id: props.floor.id, label: name }));

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
      Handbook bays and their addresses stay put: rename them or fill reserved positions. Added bays
      get the next free letter so container addresses and progress stay stable. A bay with no free
      position takes extra containers at 09 and upwards. Removing a container keeps its saved
      checkmarks.
    </p>
  </section>
</template>
