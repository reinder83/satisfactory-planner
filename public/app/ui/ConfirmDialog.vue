<!--
  The contents of #confirm, the in-app confirmation (confirmAction in ui/confirm.ts, #241): a
  title, the question and two buttons. `answer` settles the question: true for the confirm
  button, false for Cancel. A destructive action (`danger`) gets a red confirm button;
  confirmAction() then puts focus on Cancel, and on the confirm button otherwise. The text is
  interpolated, so a user's name in it stays text.
-->
<script setup lang="ts">
import type { ConfirmOptions } from './confirm.ts';

defineProps<ConfirmOptions & { answer: (ok: boolean) => void }>();
</script>

<template>
  <header class="dialog-head">
    <div class="dialog-title">
      <div>
        <div class="eyebrow">{{ danger ? 'Please confirm' : 'Confirm' }}</div>
        <h2 id="confirm-title">{{ title }}</h2>
      </div>
    </div>
  </header>
  <div class="dialog-body">
    <p id="confirm-body">{{ body }}</p>
    <div class="detail-actions">
      <button type="button" class="btn" data-confirm-cancel @click="answer(false)">Cancel</button>
      <button
        type="button"
        :class="['btn', danger ? 'danger' : 'primary']"
        data-confirm-ok
        @click="answer(true)"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </div>
</template>
