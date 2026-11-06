<!--
  The built-machines counter of one production line (#1300): "Built [−] 41 / 58 [+]" on the line's
  card, in its dialog and in its build-plan step, the player's count of the machines that stand on
  it in the phase shown (lineCountOf in views/calculated.ts, countOfLine and countUpdate in
  app/built-lines.ts). It saves the builtCount update: the count goes in `builtMachines`, the field
  a carry keeps a grown line's machines in (#1174), so a counted line is partly built everywhere a
  grown one is. Reaching the line's machines ticks it Running in the same write, and counting a
  ticked line below them unticks it; ticking or unticking Running elsewhere leaves the count, so an
  untick reads it again. A line the phase before hands over starts from those machines.

  − and + step by one, and the number can be typed (committed on Enter, a spin of the field or
  leaving it), kept between the lowest count and the line's machines. Each press saves the count it
  shows, in order, so quick presses all count; the field shows the count pressed meanwhile. At
  either end its button has nothing to do, so it is aria-disabled, never disabled: a focused button
  that becomes disabled loses focus (#299). The group, the field and both buttons are named for
  the line ("Built machines: <line>", #1254), and each saved count is announced ("41 of 58
  Refineries built"). `hooks` lets the card and the step handle a tick that moves the counter away
  (a filter that hides the card, a step that goes to Done); `place` keeps the ids apart when the
  card and its dialog show the same line.
-->
<script lang="ts">
import type { UpdateOp } from '../../types/index.ts';

type CountUpdate = Extract<UpdateOp, { type: 'builtCount' }>;
// What the card and the step do around a write that ticks or unticks the line: `control` is the
// pressed control's selector inside a counter, for focus to go to its counterpart.
export interface CounterHooks {
  before?: (trigger: EventTarget | null, update: CountUpdate, control: string) => void;
  after?: (saved: boolean, update: CountUpdate, control: string) => Promise<void> | void;
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { save } from '../api.ts';
import { announce } from '../announce.ts';
import { countUpdate, countWords, counterTop } from '../built-lines.ts';
import { num } from '../format.ts';
import { stage } from '../session.ts';
import { render } from '../shell.ts';
import { lineCountOf } from '../views/calculated.ts';
import { legacy } from './bridge.ts';
import { leave, reset, useDraft } from './draft.ts';
import type { CalcRow } from '../../types/index.ts';

const props = withDefaults(
  defineProps<{ row: CalcRow; name: string; place: string; hooks?: CounterHooks }>(),
  { hooks: () => ({}) },
);

const saved = computed(() =>
  legacy(() => ({ key: 'calc-' + stage() + '-' + props.row.id, ...lineCountOf(props.row) })),
);
// The count and tick pressed while their writes are on their way, shown until the last is answered.
const pending = ref<{ built: number; ticked: boolean } | null>(null);
let inFlight = 0;
const count = computed(() => ({ ...saved.value, ...pending.value }));

const id = computed(() => `built-${props.place}-${saved.value.key}`);
const draft = useDraft(() => String(count.value.built));
const left = (event: FocusEvent) => leave(draft, event);

async function commit(value: number, trigger: EventTarget | null, control: string) {
  const now = count.value,
    update = countUpdate(now, now.key, value);
  if (!update) {
    reset(draft, String(now.built));
    if (trigger instanceof HTMLInputElement) trigger.value = draft.value;
    return;
  }
  const next = { built: update.value ?? now.floor, ticked: update.running ?? now.ticked };
  pending.value = next;
  reset(draft, String(next.built));
  if (trigger instanceof HTMLInputElement) trigger.value = draft.value;
  inFlight++;
  props.hooks.before?.(trigger, update, control);
  let done = false;
  try {
    await save(update);
    done = true;
    render();
  } catch {}
  if (!--inFlight) pending.value = null;
  if (done)
    announce(
      countWords({ ...now, built: next.built }, props.row.machine) +
        (update.running === true ? `: ${props.name} marked running.` : '.') +
        (update.running === false ? ` ${props.name} no longer marked running.` : ''),
    );
  if (!inFlight) reset(draft, String(count.value.built));
  await props.hooks.after?.(done, update, control);
}

const atFloor = computed(() => count.value.built <= count.value.floor);
const atTop = computed(() => count.value.built >= count.value.needed);

function step(event: Event, delta: number) {
  if (delta < 0 ? atFloor.value : atTop.value) return;
  void commit(count.value.built + delta, event.currentTarget, `[data-built-step="${delta}"]`);
}

// Escape puts the shown count back: the field would else commit the typed number as it loses focus.
function cancel(event: Event) {
  reset(draft, String(count.value.built));
  (event.target as HTMLInputElement).value = draft.value;
}

function typed(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim() === '' ? NaN : Number(input.value);
  if (!Number.isFinite(value)) {
    reset(draft, String(count.value.built));
    input.value = draft.value;
    return;
  }
  void commit(value, input, '[data-built-input]');
}
</script>

<template>
  <div
    v-if="count.needed >= 1"
    class="built-counter"
    role="group"
    :aria-label="'Built machines: ' + name"
    :data-built-counter="count.key"
  >
    <label class="built-counter-label" :for="id">Built</label
    ><button
      type="button"
      class="btn built-step"
      data-built-step="-1"
      :aria-label="'One fewer built: ' + name"
      :aria-disabled="atFloor || undefined"
      @click="step($event, -1)"
    >
      −</button
    ><input
      :id="id"
      class="built-input"
      type="number"
      inputmode="numeric"
      :min="count.floor"
      :max="counterTop(count)"
      step="1"
      :data-built-input="count.key"
      :aria-label="'Machines built: ' + name"
      :aria-describedby="id + '-of'"
      :value="draft"
      @input="draft = ($event.target as HTMLInputElement).value"
      @change="typed"
      @keydown.esc="cancel"
      @blur="left"
    /><span :id="id + '-of'" class="built-of"
      ><span aria-hidden="true">/ </span><span class="visually-hidden">of </span
      >{{ num(count.needed) }}</span
    ><button
      type="button"
      class="btn built-step"
      data-built-step="1"
      :aria-label="'One more built: ' + name"
      :aria-disabled="atTop || undefined"
      @click="step($event, 1)"
    >
      +
    </button>
  </div>
</template>
