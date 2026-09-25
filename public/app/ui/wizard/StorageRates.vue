<!--
  Per-item storage rates on All settings step 2, for the items the selected storage supply
  stocks. Inputs named "rate:<item>" become settings.storageOverrides in readWizard; blank
  means "use the rate for its group", so only the items singled out carry a number. Each
  box's placeholder is the rate its group would give it: 0 for delivered items, the
  construction rate (or the general one when that is empty) for construction materials, and
  the general rate for the rest. Editing either group rate on the step refreshes them as you
  type; a half-typed rate leaves the last usable placeholder in place.
-->
<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { storageRateFor, wantsStorage } from '../../../preferences.ts';
import { num } from '../../format.ts';
import { wizard, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import HelpTip from '../form/HelpTip.vue';
import { vValue } from '../form/value.ts';

const view = computed(() =>
  legacy(() => {
    if (!wizard) return null;
    const s = wizard.settings;
    const items = (workspace.catalog.storageItems || []).filter(i =>
      wantsStorage(i.name, s.storage),
    );
    if (!items.length) return null;
    const over = s.storageOverrides || {};
    return {
      set: items.filter(i => over[i.name] !== undefined).length,
      rows: items.map(i => ({
        name: i.name,
        group: i.build ? 'build' : i.delivered ? 'delivered' : 'other',
        value: over[i.name] ?? '',
        placeholder: num(storageRateFor({ ...s, storageOverrides: {} }, i.name)),
      })),
    };
  }),
);

// The placeholders on screen: from the draft on each redraw, then kept in step with the
// group-rate fields as they are typed.
const placeholders = reactive<Record<string, string>>({});
watch(
  view,
  v => {
    for (const r of v?.rows || []) placeholders[r.name] = r.placeholder;
  },
  { immediate: true },
);
function groupRates(e: Event) {
  if (!['buildRate', 'storageRate'].includes((e.target as HTMLInputElement).name)) return;
  const form = e.currentTarget as HTMLFormElement;
  const read = (name: string) => {
    const value = form.querySelector<HTMLInputElement>('[name=' + name + ']')?.value;
    return value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  };
  const general = read('storageRate'),
    build = read('buildRate') ?? general;
  for (const r of view.value?.rows || []) {
    const rate = r.group === 'delivered' ? 0 : r.group === 'build' ? build : general;
    if (rate !== null) placeholders[r.name] = num(rate);
  }
}
// The group-rate fields sit elsewhere on the step, so listen on the step's form.
// The component's root is the details, or its placeholder comment when there is none.
// Called during setup, so there is an instance with a proxy.
const self = getCurrentInstance()!;
let form: HTMLFormElement | null | undefined = null;
onMounted(() => {
  form = (self.proxy!.$el as Element | null)?.parentElement?.closest('form');
  form?.addEventListener('input', groupRates);
});
onBeforeUnmount(() => form?.removeEventListener('input', groupRates));

const filter = ref('');
const shown = (r: { name: string }) =>
  filter.value.trim() === '' || r.name.toLowerCase().includes(filter.value.trim().toLowerCase());
</script>

<template>
  <details v-if="view" class="panel rate-picker" :open="view.set > 0">
    <summary>
      Per-item storage rates{{ view.set > 0 ? ' · ' + num(view.set) + ' set' : '' }}
      <HelpTip name="storageOverrides" />
    </summary>
    <p class="small muted">
      Leave a box blank to use the rate for its group. Enter <b>0</b> to keep an item’s container
      and address without reserving any production for it. Space Elevator parts start at 0:
      deliveries and later project parts already consume them, so a standing buffer would be
      production nobody draws from. {{ num(view.rows.length) }} items are in your selected storage
      supply.
    </p>
    <input
      id="rate-filter"
      v-model="filter"
      type="search"
      placeholder="Filter by item…"
      aria-label="Filter storage items"
    />
    <div class="rate-list">
      <label
        v-for="r in view.rows"
        :key="r.name"
        class="rate-row field"
        :data-rate-text="r.name.toLowerCase()"
        :data-rate-group="r.group"
        :hidden="!shown(r)"
        ><span
          >{{ r.name
          }}<template v-if="r.group === 'build'"
            >{{ ' ' }}<small class="muted">· construction</small></template
          ><template v-else-if="r.group === 'delivered'"
            >{{ ' ' }}<small class="muted">· delivered</small></template
          ></span
        ><input
          :name="'rate:' + r.name"
          type="number"
          min="0"
          max="300"
          step="0.1"
          v-value="r.value"
          :placeholder="placeholders[r.name]"
          :aria-label="`Storage refill for ${r.name} per minute`"
      /></label>
    </div>
  </details>
</template>
