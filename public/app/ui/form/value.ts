// v-value: sets an input's value from the draft when it is mounted and whenever the draft's
// value changes, and otherwise leaves what is typed alone. A plain :value binding does not:
// Vue writes `value` back on every redraw of the element, so a component that redraws for its
// own state (an open suggestion list, a refreshed placeholder, a filter) would put the draft
// back over typing that has not been read yet. For inputs that only redraw with the draft,
// :value is the same thing.
import type { Directive } from 'vue';

type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export const vValue: Directive<ValueElement, string | number | null | undefined> = {
  mounted(field, { value }) {
    field.value = String(value ?? '');
  },
  updated(field, { value, oldValue }) {
    if (value !== oldValue) field.value = String(value ?? '');
  },
};
