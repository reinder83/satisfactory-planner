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
const caption = (o: FlowOutput) =>
  (
    ({
      consumer: `consumer${o.beltTxt ? ' · ' + o.beltTxt : ''}`,
      store: 'protected module',
      ship: o.shipSub || 'delivery',
      drone: 'protected supply contract',
      sink: o.subTxt || 'whole-machine rounding surplus',
      more: 'combined smaller destinations',
    }) as Record<FlowOutput['kind'], string>
  )[o.kind] || '';

// A unit as a rate writes it after its number: " m³/min" for a fluid, "/min" otherwise. The
// fluid unit's leading space becomes a no-break space, as itemRate() in flow.ts writes it, so a
// long fluid rate keeps its unit beside the number (#364); .rail-rate is nowrap as well.
const unitText = (unit: string | undefined) => (unit || '/min').replace(/^ /, '\u00a0');

const flow = computed(() => {
  const m = props.model;
  if (!m || (!m.inputs.length && !m.outputs.length)) return null;
  return {
    // The model itself, for the template (non-null inside v-if="flow").
    model: m,
    phase: phaseLabel(m.stage),
    // An input tile: lane count and mark, and how full those lanes are. 70% load or more is
    // highlighted as a line with little headroom.
    inputs: m.inputs.map(i => {
      const p = i.plan,
        load = Math.round((i.rate / (p.count * p.lane.cap)) * 100);
      return {
        name: i.name,
        link: i.link,
        lanes: `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''} · ${load}% load`,
        hot: load >= 70,
        rate: num(i.rate),
        unit: unitText(p.lane.unit),
      };
    }),
    // A destination row. `mach` is how many machines' worth of output it takes, rounded up
    // per destination (under half a machine reads "<1"); absent where it cannot be split.
    outputs: m.outputs.map(o => ({
      ...o,
      caption: (o.pre ? o.pre + ' · ' : '') + caption(o),
      machines:
        o.mach === undefined
          ? null
          : {
              round: o.mach < 0.5 ? '<1' : num(Math.ceil(o.mach - 1e-9)),
              exact: num(o.mach) + ' at 100% · ' + (m.local ? 'build beside it' : 'round up'),
            },
      rateText: o.rateTxt ?? null,
      rateValue: o.rateTxt == null && o.rate !== undefined ? num(o.rate) : null,
    })),
    perDelivery: m.outputs.some(o => o.mach !== undefined),
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
          :is="i.link ? 'button' : 'div'"
          v-for="i in flow.inputs"
          :key="i.name"
          class="rail-tile"
          v-bind="factoryLink(i.link)"
          ><ItemIcon :name="i.name" /><span class="rail-main"
            ><b>{{ i.name }}</b
            ><small :class="i.hot ? 'hot' : null">{{ i.lanes }}</small></span
          ><span class="rail-rate"
            >{{ i.rate }}<small>{{ i.unit }}</small></span
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
        <div v-for="(o, n) in flow.outputs" :key="n" :class="['rail-row', o.kind]">
          <ItemIcon v-if="o.icon" :name="o.icon" /><span v-else class="rail-noicon"></span
          ><span class="rail-main"
            ><button v-if="o.link" class="rail-link" v-bind="factoryLink(o.link)">
              {{ o.label }} ↗</button
            ><b v-else :class="o.kind === 'sink' || o.kind === 'more' ? 'dim' : ''">{{ o.label }}</b
            ><small>{{ o.caption }}</small></span
          ><span v-if="o.machines" class="rail-mach"
            ><b>≈ {{ o.machines.round }}</b> × {{ flow.model.machineName
            }}<small>{{ o.machines.exact }}</small></span
          ><span v-else class="rail-mach"></span
          ><span class="rail-rate"
            ><template v-if="o.rateText !== null">{{ o.rateText }}</template
            ><template v-else-if="o.rateValue !== null"
              >{{ o.rateValue }}<small>{{ unitText(o.unit) }}</small></template
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
