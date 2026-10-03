<!--
  ADA, the assistant. What she says comes from adaView() in ada-panel.ts; this component draws
  it and handles her buttons and the poke easter egg. She is a one-line ticker everywhere
  (SP-38, #273; #738): the ticker button shows ◈ and the remark cut to one line, and unfolds the
  full panel in place (the whole remark, Another remark and Mute) and folds it again. Shell.vue
  places her: in the top bar beside the phone layout (`topbar`), so the sidebar never grows with
  a long remark (#738), and in the menu drawer at phone width (≤720px). Folded, the remark stays
  in the page as #ada-line, out of sight, so a new one is still announced.
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

const props = withDefaults(defineProps<{ topbar?: boolean }>(), { topbar: false });

const ada = computed(() => legacy(adaView));
// Whether the ticker has unfolded the full panel. View state only, never saved.
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
  // Unmuting unfolds the panel, so the Mute that takes focus is on screen.
  if (!on) open.value = true;
  adaStore();
  adaClearFault();
  invalidate();
  void refocus();
}

// The badge is decoration, not a control: it is hidden from assistive software and nothing
// is only reachable through it. Five quick pokes stage a "transmission fault" remark. In the
// top bar the ticker's ◈ takes the pokes (and does not fold or unfold the panel); the phone
// drawer's ticker has no easter egg, as before.
function poke(event: Event) {
  if (!props.topbar) return;
  event.stopPropagation();
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
      <span class="ada-mark" aria-hidden="true" @click="poke">◈</span
      ><span class="ada-ticker-text">{{ open ? ada.name || 'ADA' : ada.text }}</span
      ><span class="ada-ticker-sign" aria-hidden="true">{{ open ? '−' : '+' }}</span>
    </button>
    <div id="ada-body" class="ada-body">
      <div class="ada-head eyebrow">
        {{ ada.name ? 'Transmission fault' : 'Artificial Directory and Assistant' }}
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
