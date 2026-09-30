<!--
  An item field that suggests item names as you type, each with its bundled icon in front (#295).
  "Production you already run" (wizard/SupplyRows.vue) and a storage bay's "Add container" field
  (storage/StorageBay.vue) both use it. The list is drawn in the page rather than by a native
  <datalist>, which is browser chrome: it cannot be themed or read back, and Chrome suppresses it on
  an input with autocomplete off. It works from the keyboard: ↓ opens or walks the suggestions, ↑
  walks back, Enter picks the highlighted one (else the item the text already names, else the
  first), Escape closes it, and leaving the field closes it. Picking fills the field and emits
  `pick`; the input keeps its `name`, so its form reads it as before. The value comes from `value`
  through v-value (form/value.ts), so a redraw for the open list never puts anything back over
  typing that has not been read yet. The icon inside the field follows the text as typed.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { itemMatches, knownItem } from '../../format.ts';
import ItemIcon from '../ItemIcon.vue';
import { vValue } from './value.ts';

const props = withDefaults(
  defineProps<{
    // The names offered, as the list spells them.
    items: readonly string[];
    name: string;
    // The listbox's id, unique on the page.
    listId: string;
    value?: string;
    // Visible text before the field; without it the field is named by ariaLabel only.
    label?: string;
    inputId?: string;
    placeholder?: string;
    ariaLabel?: string;
    maxlength?: number;
    required?: boolean;
    invalid?: boolean;
    describedby?: string;
    limit?: number;
  }>(),
  { value: '', maxlength: 80, limit: 8 },
);
const emit = defineEmits<{
  // A suggestion was chosen; the field already holds it.
  pick: [name: string, input: HTMLInputElement];
  // Typing, with the text as it now is.
  typing: [value: string];
  // The field's own change event (the text committed by leaving it).
  commit: [event: Event];
}>();

const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);

// What is typed since `value` last changed, so the icon follows the typing. A form reset puts
// the field back to empty, and the icon with it.
const typed = ref<string | null>(null);
watch(
  () => props.value,
  () => (typed.value = null),
);
const onReset = () => {
  typed.value = null;
  hide();
};
onMounted(() => input.value?.form?.addEventListener('reset', onReset));
onBeforeUnmount(() => input.value?.form?.removeEventListener('reset', onReset));
const icon = computed(() => {
  const name = String(typed.value ?? props.value).trim();
  return props.items.includes(name) ? name : '';
});

// The open list: the items offered and the highlighted one.
const open = ref(false);
const matches = ref<string[]>([]);
const active = ref(-1);

function show(value: string) {
  const found = itemMatches(props.items, value, props.limit).filter(
    match => match.toLowerCase() !== value.trim().toLowerCase(),
  );
  if (!found.length) return hide();
  open.value = true;
  matches.value = found;
  active.value = -1;
}
function hide() {
  open.value = false;
  matches.value = [];
  active.value = -1;
}

function typing(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  typed.value = value;
  show(value);
  emit('typing', value);
}

function key(event: KeyboardEvent) {
  const shown = open.value && matches.value.length > 0,
    value = (event.target as HTMLInputElement).value;
  if (event.key === 'Escape') {
    if (shown) {
      event.preventDefault();
      hide();
    }
    return;
  }
  if (event.key === 'ArrowDown' && !shown) {
    show(value);
    event.preventDefault();
    return;
  }
  if (!shown) return;
  const count = matches.value.length,
    at = active.value;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    active.value = event.key === 'ArrowDown' ? (at + 1) % count : at <= 0 ? count - 1 : at - 1;
    nextTick(() =>
      root.value
        ?.querySelectorAll('.supply-option')
        [active.value]?.scrollIntoView({ block: 'nearest' }),
    );
  } else if (event.key === 'Enter') {
    // Enter picks rather than submitting the form. With nothing highlighted, text that already
    // names an item keeps that item: the list leaves it out, so its first suggestion is another
    // one ("Iron Plate" would otherwise become "Reinforced Iron Plate").
    event.preventDefault();
    // shown means the list has at least one suggestion.
    pick(at >= 0 ? matches.value[at]! : (knownItem(props.items, value) ?? matches.value[0]!));
  }
}

// Leaving the field closes its list; moving inside it (field to suggestion) does not.
function left(event: FocusEvent) {
  if (open.value && !root.value?.contains(event.relatedTarget as Node | null)) hide();
}

function committed(event: Event) {
  hide();
  emit('commit', event);
}

// A click on a suggestion took focus to it, so focus goes back to the field first.
function pick(name: string) {
  const field = input.value;
  if (!field) return;
  field.value = name;
  typed.value = name;
  hide();
  if (document.activeElement !== field) field.focus();
  emit('pick', name, field);
}
</script>

<template>
  <div ref="root" class="supply-field">
    <label :class="label ? 'field' : undefined"
      >{{ label
      }}<span :class="['supply-input', icon ? 'has-icon' : '']" :data-icon="icon"
        ><ItemIcon v-if="icon" :name="icon" /><input
          ref="input"
          :id="inputId"
          :name="name"
          v-value="value"
          :maxlength="maxlength"
          :required="required || undefined"
          autocomplete="off"
          spellcheck="false"
          :placeholder="placeholder"
          role="combobox"
          :aria-expanded="open ? 'true' : 'false'"
          aria-autocomplete="list"
          :aria-controls="listId"
          :aria-activedescendant="open && active >= 0 ? listId + '-' + active : undefined"
          :aria-label="ariaLabel"
          :aria-invalid="invalid ? 'true' : undefined"
          :aria-describedby="describedby"
          @input="typing"
          @keydown="key"
          @focusout="left"
          @change="committed" /></span
    ></label>
    <div :id="listId" class="supply-options" role="listbox" :hidden="!open">
      <template v-if="open"
        ><button
          v-for="(match, i) in matches"
          :id="listId + '-' + i"
          :key="match"
          type="button"
          tabindex="-1"
          role="option"
          :aria-selected="i === active ? 'true' : 'false'"
          class="supply-option"
          :data-item-pick="match"
          @click="pick(match)"
        >
          <ItemIcon :name="match" /><span>{{ match }}</span>
        </button></template
      >
    </div>
  </div>
</template>
