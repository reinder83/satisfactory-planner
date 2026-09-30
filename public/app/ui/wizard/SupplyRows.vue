<!--
  "Production you already run": one row per declared item plus a blank one, on All settings
  step 1 and as the guided "already producing" question. Each row pairs a supplyItem and a
  supplyRate input, read back by readSupply (wizard/supply.ts) with the rest of the screen;
  the rows as typed live on the draft (wizard.supplyRows), so a half-finished row survives a
  redraw. The item search is the in-page listbox of form/ItemSearch.vue, shared with the
  storage room's "Add container" field (#295): arrows, Enter and Escape, each suggestion with
  its icon. Committing an item or a rate reads the screen and redraws.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { wizard, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { readScreen, removeSupplyRow, supplyRows } from '../../wizard/supply.ts';
import { legacy } from '../bridge.ts';
import ItemSearch from '../form/ItemSearch.vue';
import { vValue } from '../form/value.ts';
import { refocusAfterRemoval } from '../refocus.ts';

const root = ref<HTMLElement | null>(null);

// The items the search offers: what the planner can credit.
const items = computed(() => legacy(() => workspace.catalog.supplyItems || []));

const rows = computed(() =>
  legacy(() => {
    if (!wizard) return [];
    const known = new Set(items.value);
    return [...supplyRows(wizard), { name: '', rate: '' }].map(row => {
      const name = row.name.trim();
      return {
        name: row.name,
        rate: row.rate,
        filled: !!name,
        // Why a row does not count yet: an unknown name, or no rate.
        hint: !name ? '' : !known.has(name) ? 'unknown' : !String(row.rate).trim() ? 'rate' : '',
      };
    });
  }),
);

const rowEl = (index: number) => root.value?.querySelectorAll<HTMLElement>('.supply-row')[index];

// An item, once committed by leaving its field, or a rate: read the screen into the settings and
// redraw.
function committed(event: Event) {
  readScreen((event.target as HTMLInputElement).form);
  render();
}

// Picking a suggestion commits it and moves to the rate, which is the next thing you were
// going to type anyway. The field already holds the name (form/ItemSearch.vue).
async function pick(index: number, input: HTMLInputElement) {
  readScreen(input.form);
  render();
  await nextTick();
  rowEl(index)?.querySelector<HTMLInputElement>('input[name=supplyRate]')?.focus();
}

// "Remove": the row goes, so focus goes to the next row's Remove, else the previous one's, else the
// blank row's item field (ui/refocus.ts, #290). A blank row's Remove is hidden and out of the tab
// order, so it never takes focus.
function remove(index: number, event: Event) {
  const button = event.currentTarget as HTMLButtonElement;
  const refocus = refocusAfterRemoval(button, {
    scope: root.value,
    row: '.supply-row',
    control: '.supply-remove:not(.is-blank)',
    fallback: ['.supply-row:last-child [name=supplyItem]'],
  });
  removeSupplyRow(button.form, index);
  render();
  void refocus();
}
</script>

<template>
  <div ref="root" class="supply-picker">
    <div class="supply-list">
      <div v-for="(row, i) in rows" :key="i" class="supply-row" :data-supply-row="i">
        <ItemSearch
          :items="items"
          name="supplyItem"
          :list-id="'supply-options-' + i"
          :value="row.name"
          label="Item"
          placeholder="Search item"
          aria-label="Search for an item you already produce"
          @pick="(_name, input) => pick(i, input)"
          @commit="committed"
        />
        <label class="field"
          >Per minute<input
            name="supplyRate"
            type="number"
            min="0"
            max="1000000"
            step="any"
            v-value="row.rate"
            aria-label="Rate you already produce, per minute"
            @change="committed"
        /></label>
        <button
          type="button"
          :class="['btn quiet supply-remove', row.filled ? '' : 'is-blank']"
          :data-supply-remove="i"
          :aria-label="row.filled ? 'Remove ' + row.name : undefined"
          :tabindex="row.filled ? undefined : -1"
          :aria-hidden="row.filled ? undefined : 'true'"
          @click="remove(i, $event)"
        >
          Remove
        </button>
        <span v-if="row.hint === 'unknown'" class="supply-hint warn"
          >No item of that name — pick one from the list.</span
        ><span v-else-if="row.hint === 'rate'" class="supply-hint"
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
