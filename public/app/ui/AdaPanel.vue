<!--
  ADA, the sidebar assistant. What she says comes from adaView() in ada-panel.ts; this
  component draws it and handles her buttons and the poke easter egg on the ◈ mark.
-->
<script setup>
import { computed } from 'vue';
import {
  adaClearFault,
  adaFault,
  adaIndex,
  adaMuted,
  adaPoke,
  adaStore,
  adaView,
  setAdaIndex,
  setAdaMuted,
} from '../ada-panel.ts';
import { invalidate, legacy } from './bridge.ts';

const ada = computed(() => legacy(adaView));

// "Another remark": end a transmission fault, or show the next remark.
function next() {
  if (adaFault) adaClearFault();
  else setAdaIndex(adaIndex + 1);
  invalidate();
}

// "Mute" / "Unmute": remembered in localStorage (adaStore), never in a saved profile.
function mute(on) {
  setAdaMuted(on);
  adaStore();
  adaClearFault();
  invalidate();
}

// The badge is decoration, not a control: it is hidden from assistive software and nothing
// is only reachable through it. Five quick pokes stage a "transmission fault" remark.
function poke() {
  if (!adaMuted) adaPoke();
}
</script>

<template>
  <div v-if="ada?.muted" class="ada is-muted">
    <span class="ada-mark" aria-hidden="true">◈</span><span>ADA muted</span
    ><button class="btn quiet" type="button" data-ada-mute="off" @click="mute(false)">
      Unmute
    </button>
  </div>
  <section v-else-if="ada" class="ada" :data-tone="ada.tone" aria-label="ADA">
    <div class="ada-head">
      <span class="ada-mark" aria-hidden="true" @click="poke">◈</span>
      <div>
        <b>{{ ada.name || 'ADA' }}</b>
        <div class="eyebrow">
          {{ ada.name ? 'Transmission fault' : 'Artificial Directory and Assistant' }}
        </div>
      </div>
    </div>
    <p class="ada-line" id="ada-line" role="status" aria-live="polite">{{ ada.text }}</p>
    <div class="ada-tools">
      <button class="btn quiet" type="button" id="ada-next" data-ada-next @click="next">
        Another remark</button
      ><button class="btn quiet" type="button" data-ada-mute="on" @click="mute(true)">Mute</button>
    </div>
  </section>
</template>
