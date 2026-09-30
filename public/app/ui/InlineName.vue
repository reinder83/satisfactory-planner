<!--
  A name that is renamed in place (SP-31, #266): the heading with an ✎ button beside it, which
  swaps them for an input. Enter or Save commits, Esc or Cancel puts the heading back; either
  way focus returns to the ✎ button. A failed save keeps the input open, with focus in it, and
  the caller's toast says why. An unchanged name closes without saving. `save` resolves once the
  new name is stored.
-->
<script setup lang="ts">
import { nextTick, ref } from 'vue';

const props = defineProps<{
  name: string;
  // What is being renamed, for the labels: "save" or "profile".
  what: string;
  tag: 'h2' | 'h3';
  // The data attribute the ✎ button and the input carry, e.g. data-rename-save="<id>".
  hook: Record<string, string>;
  save: (name: string) => Promise<void>;
}>();

const editing = ref(false),
  busy = ref(false),
  value = ref('');
const edit = ref<HTMLButtonElement | null>(null),
  input = ref<HTMLInputElement | null>(null);

async function start() {
  value.value = props.name;
  editing.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}
// Back to the ✎ button; after a save the page may have been drawn anew, so it is found again by
// its hook when this one has left the page.
async function close() {
  editing.value = false;
  await nextTick();
  const again = () =>
    document.querySelector<HTMLElement>(
      'button' +
        Object.entries(props.hook)
          .map(([attribute, hookValue]) => `[${attribute}="${CSS.escape(hookValue)}"]`)
          .join(''),
    );
  (edit.value?.isConnected ? edit.value : again())?.focus();
}
async function commit() {
  if (busy.value) return;
  const next = value.value.trim();
  if (next === props.name) return close();
  busy.value = true;
  try {
    await props.save(next);
    await close();
  } catch {
    input.value?.focus();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="inline-name">
    <template v-if="!editing">
      <component :is="tag">{{ name }}</component>
      <button
        ref="edit"
        type="button"
        class="btn inline-name-edit"
        :aria-label="`Rename ${what} ${name}`"
        v-bind="hook"
        @click="start"
      >
        <span aria-hidden="true">✎</span>
      </button>
    </template>
    <form v-else class="inline-form" @submit.prevent="commit">
      <input
        ref="input"
        v-model="value"
        name="name"
        required
        maxlength="80"
        :aria-label="`New ${what} name`"
        v-bind="hook"
        @keydown.esc.prevent="close"
      /><button class="btn primary" :aria-disabled="busy || undefined">
        {{ busy ? 'Saving…' : 'Save' }}</button
      ><button type="button" class="btn" @click="close">Cancel</button>
    </form>
  </div>
</template>
