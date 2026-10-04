<!-- The "Factories" panel shown while editing groups: "+ Add factory" creates a new, empty
     group with a random fg-… id. A success empties the form. -->
<script setup lang="ts">
import { save } from '../../api.ts';
import { render } from '../../shell.ts';

async function add(event: Event) {
  const form = event.target as HTMLFormElement;
  const name = String(new FormData(form).get('name') || '').trim();
  if (!name) return;
  try {
    await save({
      type: 'factoryGroupAdd',
      id:
        'fg-' +
        Array.from(crypto.getRandomValues(new Uint8Array(6)), byte =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
      name,
    });
    form.reset();
    render();
  } catch {}
}
</script>

<template>
  <section class="panel edit-panel">
    <h2>Factories</h2>
    <form id="add-group" class="inline-form" @submit.prevent="add">
      <input
        id="new-group-name"
        name="name"
        maxlength="80"
        required
        placeholder="New factory (e.g. Cable works)…"
        aria-label="New factory name"
      /><button class="btn primary" type="submit">+ Add factory</button>
    </form>
    <p class="small muted">
      Sort production into factories, the physical sites of your world. A production line can join
      several factories with a production split — for example Wire: 300/min at the cable works and
      the rest beside stitched plates. Leave the rate empty for the whole output or the rest.
      Removing a factory keeps every production line and its progress.
    </p>
  </section>
</template>
