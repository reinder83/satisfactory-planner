<!--
  "Flow at Phase N" in a factory dialog, from a flow model (flow.ts): the recipe panel, the
  input tiles with their belts or pipes, the machine bar, and one row per destination. Draws
  nothing when the model has neither inputs nor outputs. Links open other factory dialogs
  through factoryLink() in ui/actions.ts. A destination without an icon draws an empty icon
  frame, except the power grid (noItem), whose icon cell stays blank but keeps the rows'
  columns lined up (#560): the blank cell is icon-wide, also in the flex rows at 640px and
  below (#599).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { phaseLabel } from '../../session.ts';
import ItemIcon from '../ItemIcon.vue';
import RecipePanel from './RecipePanel.vue';
import { factoryLink } from '../actions.ts';
import { listNames } from '../../../wording.ts';
import type { BankNote, FlowModel, FlowOutput, SupplyNote } from '../../flow.ts';

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

// The bank note's ", less what factory groups make on site" (flow.ts SupplyNote), naming the
// lines made on site whose leftover since a group edit takes a part of the demand too (#1002):
// the rates above leave it out.
function lessOnSite(note: SupplyNote): string {
  const leftover = note.leftover;
  if (!note.lessOnSite) return '';
  return (
    ', less what factory groups make on site' +
    (leftover
      ? `, including what is left over from the line${leftover.lines > 1 ? 's' : ''} made on site for ${listNames(leftover.groups)}`
      : '')
  );
}

// The bank note's ", supplied together with ..." (flow.ts SupplyNote): "the other recipes
// producing it", or "the other lines making it" when one of them follows this line's recipe (a
// group's copy of it, #1002). `many`: the note speaks of several items.
function suppliedWith(note: SupplyNote, many = false): string {
  if (!note.shared) return '';
  const it = many ? 'them' : 'it';
  return note.sameRecipe
    ? `, supplied together with the other lines making ${it}`
    : `, supplied together with the other recipes producing ${it}`;
}

// An own line's sentence for its outputs its group does not mark, such as a byproduct (#1001):
// they go to the demand for them across the whole plan, as any other line's do. It goes before
// the note's last full stop, with the full stop of the sentence before it, so the template's text
// after it still ends the paragraph as before (Vue drops a last text node of whitespace alone).
// Empty without such outputs.
function planWideText(note: BankNote): string {
  const planWide = note.planWide;
  if (!planWide) return '';
  const many = planWide.items.length > 1;
  return `. ${listNames(planWide.items)} ${many ? 'go' : 'goes'} to the demand for ${many ? 'them' : 'it'} across this phase's whole plan${lessOnSite(planWide)}${suppliedWith(planWide, many)}`;
}

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
              exact: num(output.mach) + ' at 100% · round up',
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
          <ItemIcon v-if="output.icon" :name="output.icon" /><span
            v-else-if="output.noItem"
            class="rail-noframe"
          ></span
          ><span v-else class="rail-noicon"></span
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
      <p v-if="flow.model.bankNote?.ownLine && flow.model.bankNote.offers" class="small muted">
        Made on site for {{ flow.model.bankNote.ownLine }}'s lines{{
          flow.model.bankNote.shared ? ', together with the group’s other lines making it' : ''
        }}, which now ask for less than it makes: the AWESOME Sink takes what the plan sinks, and
        the rest goes to the other places that ask for it{{ planWideText(flow.model.bankNote) }}.
      </p>
      <p
        v-else-if="flow.model.bankNote?.ownLine && flow.model.bankNote.asksNone"
        class="small muted"
      >
        Made on site for {{ flow.model.bankNote.ownLine }}'s lines, which now ask for none of it:
        all of it goes to the AWESOME Sink{{ planWideText(flow.model.bankNote) }}.
      </p>
      <p v-else-if="flow.model.bankNote?.ownLine" class="small muted">
        Demand of {{ flow.model.bankNote.ownLine }}'s lines, which this line makes the item for on
        site{{
          flow.model.bankNote.shared ? ' together with the group’s other lines making it' : ''
        }}; what it makes beyond that goes to the AWESOME Sink{{
          planWideText(flow.model.bankNote)
        }}.
      </p>
      <p v-else-if="flow.model.bankNote" class="small muted">
        Demand for the item across this phase's whole plan{{ lessOnSite(flow.model.bankNote)
        }}{{ suppliedWith(flow.model.bankNote) }}.
      </p></template
    >
  </template>
</template>
