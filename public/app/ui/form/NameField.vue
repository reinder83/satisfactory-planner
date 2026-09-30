<!-- A save's name box and, under it, why Continue stopped: shared by the guided start
     (GuidedPage.vue, #505) and All settings step 1 (SettingsStep.vue, #578).
     With `check`, the name is required and must hold more than spaces (the server and the
     browser store refuse those). Continue, Enter or a later step is then refused by the form's
     own validation, which fires `invalid` on the box: instead of the browser's bubble alone,
     the box is marked invalid, the message under it (`errorId`, empty and taking no space
     until then) says why and focus goes to the box. Typing a name clears it. v-value keeps
     what was typed when this redraws for that. Any other attribute (maxlength, placeholder,
     readonly) goes on the input; a readonly box is never validated. -->
<script setup lang="ts">
import { ref } from 'vue';
import HelpTip from './HelpTip.vue';
import { vValue } from './value.ts';

defineOptions({ inheritAttrs: false });
defineProps<{ label: string; name: string; value: string; errorId: string; check?: boolean }>();

const missing = ref(false);
function refused(event: Event) {
  missing.value = true;
  (event.target as HTMLInputElement).focus();
}
function typed(event: Event) {
  if (missing.value && (event.target as HTMLInputElement).value.trim()) missing.value = false;
}
</script>

<template>
  <label class="field"
    >{{ label }} <HelpTip :name="name" /><input
      :name="name"
      type="text"
      v-value="value"
      :required="check"
      :pattern="check ? '.*\\S.*' : undefined"
      :aria-invalid="missing ? 'true' : undefined"
      :aria-describedby="missing ? errorId : undefined"
      v-bind="$attrs"
      @invalid.prevent="refused"
      @input="typed"
  /></label>
  <p
    :id="errorId"
    class="form-error"
    role="alert"
    v-text="missing ? 'Give the save a name to continue.' : ''"
  ></p>
</template>
