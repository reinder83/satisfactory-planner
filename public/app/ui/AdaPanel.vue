<!--
  ADA, the sidebar assistant. What she says comes from adaView() in ada-panel.ts; this
  component draws it and handles her buttons and the poke easter egg on the ◈ mark. At phone
  width (≤720px, style.css) she is a one-line ticker in the menu drawer (SP-38, #273): the
  ticker button unfolds the full panel in place and folds it again. Wider screens hide the
  ticker and always show the panel.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
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
import { refocusAfterRemoval } from './refocus.ts';

const ada = computed(() => legacy(adaView));
// Whether the phone ticker has unfolded the full panel. View state only, never saved.
const open = ref(false);

// "Another remark": end a transmission fault, or show the next remark.
function next() {
  if (adaFault) adaClearFault();
  else setAdaIndex(adaIndex + 1);
  invalidate();
}

// "Mute" / "Unmute": remembered in localStorage (adaStore), never in a saved profile. The panel is
// swapped for the other one, so focus goes to its Unmute / Mute (ui/refocus.ts, #290).
function mute(on: boolean, event: Event) {
  const refocus = refocusAfterRemoval(event.currentTarget, {
    fallback: [`[data-ada-mute="${on ? 'off' : 'on'}"]`],
  });
  setAdaMuted(on);
  // Unmuting unfolds the panel, so the Mute that takes focus is on screen at phone width too.
  if (!on) open.value = true;
  adaStore();
  adaClearFault();
  invalidate();
  void refocus();
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
    ><button class="btn quiet" type="button" data-ada-mute="off" @click="mute(false, $event)">
      Unmute
    </button>
  </div>
  <section
    v-else-if="ada"
    :class="['ada', open ? 'is-open' : '']"
    :data-tone="ada.tone"
    aria-label="ADA"
  >
    <button
      class="ada-ticker"
      type="button"
      aria-controls="ada-body"
      :aria-expanded="open ? 'true' : 'false'"
      data-ada-ticker
      @click="open = !open"
    >
      <span class="ada-mark" aria-hidden="true">◈</span
      ><span class="ada-ticker-text">{{ open ? ada.name || 'ADA' : ada.text }}</span
      ><span class="ada-ticker-sign" aria-hidden="true">{{ open ? '−' : '+' }}</span>
    </button>
    <div id="ada-body" class="ada-body">
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
        ><button class="btn quiet" type="button" data-ada-mute="on" @click="mute(true, $event)">
          Mute
        </button>
      </div>
    </div>
  </section>
</template>
