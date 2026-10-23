<!--
  All settings step 3's caps per phase (#1221, settings.phaseCaps): at most this many buildings and
  at most this many MW per phase, under what the plan keeps lowest (ObjectiveChoice.vue). Two
  number boxes ("phaseCap:buildings", "phaseCap:mw"), blank for no cap, which readPhaseCaps in
  wizard/wizard.ts reads; a box holding anything but a whole number from 1 to its most stops
  Continue, as settings() would refuse it. Nothing is read until the step is left.
-->
<script setup lang="ts">
import { PHASE_CAP_LIMITS } from '../../../preferences.ts';
import type { PhaseCaps } from '../../../types/index.ts';
import HelpTip from '../form/HelpTip.vue';
import InputField from '../form/InputField.vue';

defineProps<{ caps: PhaseCaps | undefined }>();
</script>

<template>
  <fieldset class="phase-caps" data-phase-caps>
    <legend>Caps per phase <HelpTip name="phaseCaps" /></legend>
    <p class="small muted" data-explain>
      Leave a box blank for no cap. With a cap the plan stays within it, or the phase's draft says
      how much it needs.
    </p>
    <div class="form-grid">
      <InputField
        label="At most this many buildings per phase"
        name="phaseCap:buildings"
        :value="caps?.buildings ?? ''"
        min="1"
        :max="PHASE_CAP_LIMITS.buildings"
        step="1"
        placeholder="No cap"
      />
      <InputField
        label="At most this many MW per phase"
        name="phaseCap:mw"
        :value="caps?.mw ?? ''"
        min="1"
        :max="PHASE_CAP_LIMITS.mw"
        step="1"
        placeholder="No cap"
      />
    </div>
  </fieldset>
</template>
