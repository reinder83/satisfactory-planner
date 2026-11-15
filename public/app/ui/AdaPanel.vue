<!--
  ADA, the sidebar assistant. What she says comes from adaView() in ada-panel.ts; this
  component draws it and handles her buttons and the poke easter egg on the ◈ mark. The header has
  the waveform (flat while she is Off, still under reduced motion) and her mood label; the body the
  log stamp, the line and its one button; the footer "Another remark (2/5)", "Later" for an event
  remark and the speaker, which opens the chatter setting: Off / Essential / Chatty (#1353). It is
  one panel in every setting, so a focused control stays where it is when the setting changes.
  At phone width (≤720px, style.css) she is a one-line ticker in the menu drawer (SP-38, #273):
  the ticker button unfolds the full panel in place and folds it again. Folded, a strip under
  the ticker carries her button and "Later" when the line has them. Wider screens hide the ticker
  and the strip and always show the panel.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  adaChatter,
  adaClearFault,
  adaDismissEvent,
  adaFault,
  adaIndex,
  adaPoke,
  adaStore,
  adaView,
  setAdaChatter,
  setAdaIndex,
} from '../ada-panel.ts';
import { navigate } from '../api.ts';
import { setLogisticsTab } from '../session.ts';
import { setJumpTarget } from '../step-jump.ts';
import type { AdaAction, AdaChatter } from '../../ada.ts';
import type { View } from '../session.ts';
import { invalidate, legacy } from './bridge.ts';
import { focusPageHeading } from './refocus.ts';

// A pressed button or "Later" in the phone strip: the menu drawer around it closes (Shell.vue).
// `acted` closes the phone drawer around the panel; with `refocus` the ☰ button that opened it takes
// focus back (a press that opens no page), otherwise the page it opened does.
const emit = defineEmits<{ acted: [refocus?: boolean] }>();
const ada = computed(() => legacy(adaView));
// Whether the phone ticker has unfolded the full panel. View state only, never saved.
const open = ref(false);
// Whether the chatter setting is showing, and, with the chatter Off, whether the problem she holds
// back is read out and whether she has just said her one line about being switched off.
const settings = ref(false);
const reading = ref(false);
const farewell = ref(false);

const CHOICES: { value: AdaChatter; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Nothing speaks. A problem waits behind a dot.' },
  {
    value: 'essential',
    label: 'Essential',
    hint: 'Problems, milestones and data-loss warnings only.',
  },
  { value: 'chatty', label: 'Chatty', hint: 'Adds remarks and easter eggs.' },
];
const hint = computed(
  () => CHOICES.find(choice => choice.value === ada.value?.chatter)?.hint ?? '',
);

// What the polite live region holds: her one line after being switched off, the problem the dot
// holds when read, else her remark.
const said = computed(() => {
  const now = ada.value;
  if (!now) return '';
  if (now.chatter !== 'off') return now.text;
  if (farewell.value) return 'Understood. Your feedback has been forwarded to no one.';
  return reading.value && now.pending ? now.pending.text : '';
});
const tickerText = computed(() => {
  const now = ada.value;
  if (!now) return '';
  if (now.chatter !== 'off') return now.text;
  return now.pending?.count ? `● ${now.pending.count} essential` : 'ADA is off';
});

// "Another remark": end a transmission fault, or show the next remark.
function next() {
  if (adaFault) adaClearFault();
  else setAdaIndex(adaIndex + 1);
  invalidate();
}

// The chatter setting: remembered in localStorage (adaStore), never in a saved profile.
function choose(value: AdaChatter) {
  if (value === adaChatter) return;
  setAdaChatter(value);
  adaStore();
  adaClearFault();
  farewell.value = value === 'off';
  reading.value = false;
  invalidate();
}

// "Read" / "Hide": the problem she holds back while Off.
function toggleRead() {
  reading.value = !reading.value;
  farewell.value = false;
}

// The one button of the line she says: it opens the page that fixes or shows what she named.
// A step to show is marked by the build plan (step-jump.ts) and its checkbox focused here; a target is focused
// once its page has drawn. Both the panel's button and the phone strip's press it.
function focusWhenDrawn(selector: string, tries = 30) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) {
    // A step inside "Done (n)" or an unlock group is unfolded first, as an activity-log jump does.
    for (
      let fold = element.closest('details');
      fold;
      fold = fold.parentElement?.closest('details') ?? null
    )
      fold.open = true;
    element.scrollIntoView?.({ block: 'center' });
    element.focus({ preventScroll: true });
  } else if (tries > 0) requestAnimationFrame(() => focusWhenDrawn(selector, tries - 1));
}
function act(fromStrip = false) {
  const action: AdaAction | null | undefined = ada.value?.action;
  if (!action) return;
  if (action.step) setJumpTarget(action.step);
  if (action.tab) setLogisticsTab(action.tab);
  // At phone width the panel sits in the modal menu drawer: close it before the page is focused.
  // The strip's button lets go of focus first, as a followed drawer link does (Shell.vue
  // navFollowed): while it still held it, the page the press opens would not take focus (#1355).
  if (fromStrip) (document.activeElement as HTMLElement | null)?.blur?.();
  emit('acted');
  navigate(action.view as View);
  // The step's checkbox: the build plan only focuses it when it is opened, not when it is already
  // the page shown.
  const target = action.step
    ? `#main input[data-check="${CSS.escape(action.step)}"]`
    : action.target;
  if (target) requestAnimationFrame(() => focusWhenDrawn(target));
  // The strip's button goes with the drawer it was in, which would leave focus on <body> (#1355):
  // with no target to focus, the opened page's heading takes it, as after any page change.
  else if (fromStrip) requestAnimationFrame(() => focusPageHeading());
}
// The phone strip under the folded ticker: her button and "Later", when the line has them.
const strip = computed(() => {
  const now = ada.value;
  return !!now && now.chatter !== 'off' && !!(now.action || now.event);
});

// "Later": an event remark goes, and the others wait for the next one. The button goes with it, so
// focus must not fall to <body> (#1355): the phone strip's press closes the drawer, whose ☰ takes
// focus back (no page opens), and the panel's press leaves it on "Another remark" beside it.
function later(fromStrip = false) {
  if (fromStrip) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    emit('acted', true);
  }
  adaDismissEvent();
  invalidate();
  if (!fromStrip) void nextTick(() => document.querySelector<HTMLElement>('#ada-next')?.focus());
}

// The badge is decoration, not a control: it is hidden from assistive software and nothing
// is only reachable through it. Five quick pokes stage a "transmission fault" remark, which is an
// easter egg, so only at Chatty.
function poke() {
  if (adaChatter === 'chatty') adaPoke();
}
</script>

<template>
  <section
    v-if="ada"
    :class="['ada', open ? 'is-open' : '', ada.chatter === 'off' ? 'is-off' : '']"
    :data-tone="ada.tone"
    :data-chatter="ada.chatter"
    :data-mood="ada.mood"
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
      ><span class="ada-ticker-text">{{ open ? ada.name || 'ADA' : tickerText }}</span
      ><span class="ada-ticker-sign" aria-hidden="true">{{ open ? '−' : '+' }}</span>
    </button>
    <div v-if="strip" class="ada-strip" data-ada-strip>
      <button
        v-if="ada.action"
        class="btn ada-strip-action"
        type="button"
        data-ada-strip-action
        @click="act(true)"
      >
        {{ ada.action.label }}
      </button>
      <button
        v-if="ada.event"
        class="btn quiet"
        type="button"
        data-ada-strip-later
        @click="later(true)"
      >
        Later
      </button>
    </div>
    <div id="ada-body" class="ada-body">
      <div class="ada-head">
        <span class="ada-mark" aria-hidden="true" @click="poke">◈</span>
        <div class="ada-who">
          <b>{{ ada.name || 'ADA' }}</b>
          <div class="eyebrow">
            {{ ada.name ? 'Transmission fault' : 'Artificial Directory and Assistant' }}
          </div>
          <div class="ada-moodline">
            <span class="ada-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            <span
              class="ada-mood"
              data-ada-mood
              :aria-label="ada.mood === 'garbled' ? 'Mood: signal garbled' : undefined"
              >{{ ada.chatter === 'off' ? 'OFF' : ada.moodLabel }}</span
            >
          </div>
        </div>
      </div>
      <div v-if="ada.stamp" class="ada-stamp" data-ada-stamp>{{ ada.stamp }}</div>
      <p class="ada-line" id="ada-line" role="status" aria-live="polite">{{ said }}</p>
      <button v-if="ada.action" class="btn ada-action" type="button" data-ada-action @click="act()">
        {{ ada.action.label }}
      </button>
      <div class="ada-tools">
        <template v-if="ada.chatter === 'off'">
          <span v-if="ada.pending?.count" class="ada-pending" data-ada-pending
            ><span class="ada-dot" aria-hidden="true">●</span>
            {{ ada.pending.count }} essential</span
          ><button
            v-if="ada.pending?.count"
            class="btn quiet"
            type="button"
            data-ada-read
            :aria-expanded="reading ? 'true' : 'false'"
            @click="toggleRead"
          >
            {{ reading ? 'Hide' : 'Read' }}
          </button>
        </template>
        <template v-else>
          <button class="btn quiet" type="button" id="ada-next" data-ada-next @click="next">
            Another remark ({{ ada.position }}/{{ ada.total }})</button
          ><button v-if="ada.event" class="btn quiet" type="button" data-ada-later @click="later()">
            Later
          </button>
        </template>
        <button
          class="btn quiet ada-speaker"
          type="button"
          aria-controls="ada-chatter"
          :aria-expanded="settings ? 'true' : 'false'"
          aria-label="Chatter settings"
          data-ada-settings
          @click="settings = !settings"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
            <path
              v-if="ada.chatter !== 'off'"
              d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <path
              v-else
              d="M11 6l4 4M15 6l-4 4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </button>
      </div>
      <div v-if="settings" id="ada-chatter" class="ada-chatter" data-ada-chatter-panel>
        <div class="ada-chatter-label">Chatter</div>
        <div class="ada-chatter-choices" role="group" aria-label="ADA chatter">
          <button
            v-for="choice in CHOICES"
            :key="choice.value"
            type="button"
            :aria-pressed="ada.chatter === choice.value ? 'true' : 'false'"
            :data-ada-chatter="choice.value"
            @click="choose(choice.value)"
          >
            {{ choice.label }}
          </button>
        </div>
        <p class="ada-chatter-hint">{{ hint }}</p>
      </div>
    </div>
  </section>
</template>
