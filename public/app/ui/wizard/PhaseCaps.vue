<!--
  All settings step 3's caps (#1221, settings.phaseCaps): at most this many buildings and at most
  this many MW per phase, under what the plan keeps lowest (ObjectiveChoice.vue). Two number boxes
  ("phaseCap:buildings", "phaseCap:mw"), blank for no cap, which readPhaseCaps in wizard/wizard.ts
  reads; a box holding anything but a whole number from 1 to its most stops Continue, as
  settings() would refuse it. Nothing is read until the step is left.

  The belt cap (#1232, settings.beltCap): the best belt the plan may use, a select ("beltCap",
  data-belt-cap) of "No cap" and Mk.2 to Mk.5 belts with what one carries. It lowers every phase's
  belt to it (phaseBelt in preferences/mining.ts), an owned belt's too.
-->
<script setup lang="ts">
import { BELT_CAP_MARKS, PHASE_CAP_LIMITS, beltCapMark } from '../../../preferences.ts';
import type { PhaseCaps } from '../../../types/index.ts';
import { num } from '../../format.ts';
import HelpTip from '../form/HelpTip.vue';
import InputField from '../form/InputField.vue';

defineProps<{ caps: PhaseCaps | undefined; beltCap?: number }>();

// "No cap", then each mark a cap may name with what one belt carries: "Mk.4 belts (480/min)".
const BELT_CAPS = [
  ['', 'No cap'],
  ...BELT_CAP_MARKS.map(mark => {
    const belt = beltCapMark(mark)!;
    return [String(mark), `${belt.mark} belts (${num(belt.cap)}/min)`];
  }),
] as const;
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
      <label class="field belt-cap"
        >Best belt the plan may use <HelpTip name="beltCap" /><select
          name="beltCap"
          data-belt-cap
          :value="beltCap ? String(beltCap) : ''"
        >
          <option v-for="[value, label] in BELT_CAPS" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      >
    </div>
  </fieldset>
</template>
