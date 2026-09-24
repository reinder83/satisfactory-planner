<!-- The "Factory groups" panel shown while editing groups: "+ Add group" creates a new, empty
     group with a random fg-… id. A success empties the form. -->
<script setup>
import { save } from '../../api.js';
import { render } from '../../shell.js';

async function add(e) {
  const form = e.target;
  const name = String(new FormData(form).get('name') || '').trim();
  if (!name) return;
  try {
    await save({
      type: 'factoryGroupAdd',
      id:
        'fg-' +
        Array.from(crypto.getRandomValues(new Uint8Array(6)), b =>
          b.toString(16).padStart(2, '0'),
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
    <h2>Factory groups</h2>
    <form id="add-group" class="inline-form" @submit.prevent="add">
      <input
        id="new-group-name"
        name="name"
        maxlength="80"
        required
        placeholder="New group (e.g. Cable factory)…"
        aria-label="New group name"
      /><button class="btn primary" type="submit">+ Add group</button>
    </form>
    <p class="small muted">
      Group production into the physical sites of your world. A factory can join several groups with
      a production split — for example Wire: 300/min at the cable factory and the remainder beside
      stitched plates. Leave the rate empty for the whole output or the remainder. Removing a group
      keeps every factory and its progress.
    </p>
  </section>
</template>
