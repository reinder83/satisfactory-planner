<!--
  "Flow at Phase N" in a factory dialog, from a flow model (flow.ts): the recipe panel, the
  input tiles with their belts or pipes, the machine bar, and one row per destination. Draws
  nothing when the model has neither inputs nor outputs. Links open other factory dialogs
  through factoryLink() in ui/actions.ts.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { phaseLabel } from '../../session.ts';
import ItemIcon from '../ItemIcon.vue';
import RecipePanel from './RecipePanel.vue';
import { factoryLink } from '../actions.ts';
import type { FlowModel, FlowOutput } from '../../flow.ts';

const props = withDefaults(defineProps<{ model?: FlowModel | null }>(), { model: null });

// A destination row's caption by kind: consumer (another factory), store (protected storage),
// ship (elevator, power fleet, augmenters…), drone (fuel contract), sink (surplus to the
// AWESOME Sink) or more (the rows capFlowOutputs folded together).
const caption = (output: FlowOutput) =>
  (
    ({
      consumer: `consumer${output.beltTxt ? ' · ' + output.beltTxt : ''}`,
      store: 'protected module',
      ship: output.shipSub || 'delivery',
      drone: 'protected supply contract',
      sink: output.subTxt || 'whole-machine rounding surplus',
      more: 'combined smaller destinations',
    }) as Record<FlowOutput['kind'], string>
  )[output.kind] || '';

// A unit as a rate writes it after its number: " m³/min" for a fluid, "/min" otherwise. The
// fluid unit's leading space becomes a no-break space, as itemRate() in flow.ts writes it, so a
// long fluid rate keeps its unit beside the number (#364); .rail-rate is nowrap as well.
const unitText = (unit: string | undefined) => (unit || '/min').replace(/^ /, '\u00a0');

const flow = computed(() => {
  const model = props.model;
  if (!model || (!model.inputs.length && !model.outputs.length)) return null;
  return {
    // The model itself, for the template (non-null inside v-if="flow").
    model,
    phase: phaseLabel(model.stage),
    // An input tile: lane count and mark, and how full those lanes are. 70% load or more is
    // highlighted as a line with little headroom.
    inputs: model.inputs.map(input => {
      const plan = input.plan,
        load = Math.round((input.rate / (plan.count * plan.lane.cap)) * 100);
      return {
        name: input.name,
        link: input.link,
        lanes: `${plan.count} × ${plan.lane.mark} ${plan.word}${plan.count > 1 ? 's' : ''} · ${load}% load`,
        hot: load >= 70,
        rate: num(input.rate),
        unit: unitText(plan.lane.unit),
      };
    }),
    // A destination row. `mach` is how many machines' worth of output it takes, rounded up
    // per destination (under half a machine reads "<1"); absent where it cannot be split.
    outputs: model.outputs.map(output => ({
      ...output,
      caption: (output.pre ? output.pre + ' · ' : '') + caption(output),
      machines:
        output.mach === undefined
          ? null
          : {
              round: output.mach < 0.5 ? '<1' : num(Math.ceil(output.mach - 1e-9)),
              exact:
                num(output.mach) + ' at 100% · ' + (model.local ? 'build beside it' : 'round up'),
            },
      rateText: output.rateTxt ?? null,
      rateValue: output.rateTxt == null && output.rate !== undefined ? num(output.rate) : null,
    })),
    perDelivery: model.outputs.some(o => o.mach !== undefined),
  };
});
</script>

<template>
  <template v-if="flow">
    <h3>Flow at {{ flow.phase }}</h3>
    <RecipePanel
      v-if="flow.model.recipe"
      :recipe="flow.model.recipe"
      :machines="flow.model.machineCount"
    />
    <template v-if="flow.inputs.length"
      ><div class="rail-cap">
        Inputs · {{ flow.inputs.length }} line{{ flow.inputs.length > 1 ? 's' : '' }} in
      </div>
      <div class="rail-grid">
        <component
          :is="input.link ? 'button' : 'div'"
          v-for="input in flow.inputs"
          :key="input.name"
          class="rail-tile"
          v-bind="factoryLink(input.link)"
          ><ItemIcon :name="input.name" /><span class="rail-main"
            ><b>{{ input.name }}</b
            ><small :class="input.hot ? 'hot' : null">{{ input.lanes }}</small></span
          ><span class="rail-rate"
            >{{ input.rate }}<small>{{ input.unit }}</small></span
          ></component
        >
      </div></template
    >
    <template v-if="flow.model.bar"
      ><div v-if="flow.inputs.length" class="rail-arrow">↓</div>
      <div class="rail-machine">
        <div class="rail-machine-main">
          <b>{{ num(flow.model.machineCount) }} × {{ flow.model.machineName }}</b
          ><small>{{ flow.model.bar.sub }}</small>
        </div>
        <div class="rail-machine-out">
          <b
            ><template v-if="flow.model.bar.out.text">{{ flow.model.bar.out.text }}</template
            ><template v-else
              >{{ flow.model.bar.out.rate
              }}<small>{{ unitText(flow.model.bar.out.unit) }}</small></template
            ></b
          ><small>{{ flow.model.bar.outSub }}</small>
        </div>
      </div>
      <div v-if="flow.outputs.length" class="rail-arrow">↓</div></template
    >
    <template v-if="flow.outputs.length"
      ><div class="rail-caps">
        <span class="rail-cap">Delivers · {{ flow.phase }}</span
        ><span v-if="flow.perDelivery" class="rail-cap"
          >Machines per delivery · {{ num(flow.model.machineCount) }} total</span
        >
      </div>
      <div class="rail-rows">
        <div v-for="(output, i) in flow.outputs" :key="i" :class="['rail-row', output.kind]">
          <ItemIcon v-if="output.icon" :name="output.icon" /><span v-else class="rail-noicon"></span
          ><span class="rail-main"
            ><button v-if="output.link" class="rail-link" v-bind="factoryLink(output.link)">
              {{ output.label }} ↗</button
            ><b v-else :class="output.kind === 'sink' || output.kind === 'more' ? 'dim' : ''">{{
              output.label
            }}</b
            ><small>{{ output.caption }}</small></span
          ><span v-if="output.machines" class="rail-mach"
            ><b>≈ {{ output.machines.round }}</b> × {{ flow.model.machineName
            }}<small>{{ output.machines.exact }}</small></span
          ><span v-else class="rail-mach"></span
          ><span class="rail-rate"
            ><template v-if="output.rateText !== null">{{ output.rateText }}</template
            ><template v-else-if="output.rateValue !== null"
              >{{ output.rateValue }}<small>{{ unitText(output.unit) }}</small></template
            ></span
          >
        </div>
      </div>
      <p v-if="flow.model.bankNote" class="small muted">
        Demand for the item across this phase's whole plan{{
          flow.model.bankNote.shared
            ? ', supplied together with the other recipes producing it'
            : ''
        }}.
      </p></template
    >
  </template>
</template>
