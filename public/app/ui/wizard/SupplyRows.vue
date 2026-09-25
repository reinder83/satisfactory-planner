<!--
  "Production you already run": one row per declared item plus a blank one, on All settings
  step 1 and as the guided "already producing" question. Each row pairs a supplyItem and a
  supplyRate input, read back by readSupply (wizard/supply.ts) with the rest of the screen;
  the rows as typed live on the draft (wizard.supplyRows), so a half-finished row survives a
  redraw. The item search is an in-page listbox rather than a native <datalist>, which is
  browser chrome: it cannot be themed or read back, and Chrome suppresses it on an input with
  autocomplete off. It works from the keyboard: ↓ opens or walks the suggestions, ↑ walks
  back, Enter picks the highlighted one (or the first), Escape closes, and leaving the row
  closes it. Committing an item or a rate reads the screen and redraws.
-->
<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { wizard, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { readScreen, removeSupplyRow, supplyMatches, supplyRows } from '../../wizard/supply.ts';
import { legacy } from '../bridge.ts';
import { vValue } from '../form/value.ts';
import ItemIcon from '../ItemIcon.vue';

const root = ref(null);

const rows = computed(() =>
  legacy(() => {
    if (!wizard) return [];
    const known = new Set(workspace.catalog.supplyItems || []);
    return [...supplyRows(wizard), { name: '', rate: '' }].map(r => {
      const name = r.name.trim();
      return {
        name: r.name,
        rate: r.rate,
        filled: !!name,
        // Why a row does not count yet: an unknown name, or no rate.
        hint: !name ? '' : !known.has(name) ? 'unknown' : !String(r.rate).trim() ? 'rate' : '',
      };
    });
  }),
);

// What is typed in each item field since the last redraw, so its icon follows the typing.
const typed = reactive({});
watch(rows, () => {
  for (const k of Object.keys(typed)) delete typed[k];
});
const iconOf = i => {
  const name = String(typed[i] ?? rows.value[i].name).trim();
  return (workspace.catalog.supplyItems || []).includes(name) ? name : '';
};

// The open suggestion list: its row, the items offered and the highlighted one.
const open = ref(-1);
const matches = ref([]);
const active = ref(-1);

function show(i, value) {
  const m = supplyMatches(value).filter(n => n.toLowerCase() !== value.trim().toLowerCase());
  if (!m.length) return hide();
  open.value = i;
  matches.value = m;
  active.value = -1;
}
function hide() {
  open.value = -1;
  matches.value = [];
  active.value = -1;
}

const rowEl = i => root.value?.querySelectorAll('.supply-row')[i];

function typing(i, e) {
  typed[i] = e.target.value;
  show(i, e.target.value);
}

function key(i, e) {
  const shown = open.value === i && matches.value.length > 0;
  if (e.key === 'Escape') {
    if (shown) {
      e.preventDefault();
      hide();
    }
    return;
  }
  if (e.key === 'ArrowDown' && !shown) {
    show(i, e.target.value);
    e.preventDefault();
    return;
  }
  if (!shown) return;
  const n = matches.value.length,
    at = active.value;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = e.key === 'ArrowDown' ? (at + 1) % n : at <= 0 ? n - 1 : at - 1;
    nextTick(() =>
      rowEl(i)
        ?.querySelectorAll('.supply-option')
        [active.value]?.scrollIntoView({ block: 'nearest' }),
    );
  } else if (e.key === 'Enter') {
    // Enter picks the highlighted suggestion rather than submitting the step.
    e.preventDefault();
    pick(i, matches.value[at >= 0 ? at : 0]);
  }
}

// Leaving the row closes its list; moving inside it (input to suggestion) does not.
function left(i, e) {
  const field = e.target.closest('.supply-field');
  if (open.value === i && !field?.contains(e.relatedTarget)) hide();
}

// An item or rate, once committed: read the screen into the settings and redraw.
function committed(e) {
  hide();
  readScreen(e.target.form);
  render();
}

// Picking a suggestion commits it and moves to the rate, which is the next thing you were
// going to type anyway.
async function pick(i, name) {
  const row = rowEl(i),
    input = row?.querySelector('input[name=supplyItem]');
  if (!input) return;
  input.value = name;
  hide();
  readScreen(input.form);
  render();
  await nextTick();
  rowEl(i)?.querySelector('input[name=supplyRate]')?.focus();
}

function remove(i, e) {
  removeSupplyRow(e.currentTarget.form, i);
  render();
}
</script>

<template>
  <div ref="root" class="supply-picker">
    <div class="supply-list">
      <div v-for="(r, i) in rows" :key="i" class="supply-row" :data-supply-row="i">
        <div class="supply-field">
          <label class="field"
            >Item<span :class="['supply-input', iconOf(i) ? 'has-icon' : '']" :data-icon="iconOf(i)"
              ><ItemIcon v-if="iconOf(i)" :name="iconOf(i)" /><input
                name="supplyItem"
                v-value="r.name"
                maxlength="80"
                autocomplete="off"
                spellcheck="false"
                placeholder="Search item"
                role="combobox"
                :aria-expanded="String(open === i)"
                aria-autocomplete="list"
                :aria-controls="'supply-options-' + i"
                aria-label="Search for an item you already produce"
                @input="typing(i, $event)"
                @keydown="key(i, $event)"
                @focusout="left(i, $event)"
                @change="committed" /></span
          ></label>
          <div
            :id="'supply-options-' + i"
            class="supply-options"
            role="listbox"
            :hidden="open !== i"
          >
            <template v-if="open === i"
              ><button
                v-for="(n, k) in matches"
                :key="n"
                type="button"
                role="option"
                :aria-selected="String(k === active)"
                class="supply-option"
                :data-supply-pick="n"
                @click="pick(i, n)"
              >
                <ItemIcon :name="n" /><span>{{ n }}</span>
              </button></template
            >
          </div>
        </div>
        <label class="field"
          >Per minute<input
            name="supplyRate"
            type="number"
            min="0"
            max="1000000"
            step="any"
            v-value="r.rate"
            aria-label="Rate you already produce, per minute"
            @change="committed"
        /></label>
        <button
          type="button"
          :class="['btn quiet supply-remove', r.filled ? '' : 'is-blank']"
          :data-supply-remove="i"
          :aria-label="r.filled ? 'Remove ' + r.name : null"
          :tabindex="r.filled ? null : -1"
          :aria-hidden="r.filled ? null : 'true'"
          @click="remove(i, $event)"
        >
          Remove
        </button>
        <span v-if="r.hint === 'unknown'" class="supply-hint warn"
          >No item of that name — pick one from the list.</span
        ><span v-else-if="r.hint === 'rate'" class="supply-hint"
          >Add a rate and this line is credited; leave it blank and it is not.</span
        >
      </div>
    </div>
    <p class="small muted">
      The plan credits these and builds only the remainder — and it does not build the chain behind
      them either. What you make it with is your business: the recipe and machine count do not have
      to match anything this plan would choose. Their ore and their power are already spent in your
      world, so enter your resource budgets and spare power net of them, exactly as for any other
      existing factory.
    </p>
  </div>
</template>
