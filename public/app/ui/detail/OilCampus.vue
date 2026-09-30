<!--
  The handbook's shared oil campus at phase `phase`, in the Plastic and Rubber dialogs, from
  plan.plans[phase]: `oil` lists the campus stages in build order ({ recipe, machines,
  equivalent, machine }) and `oilTotals` the campus totals (crude, water, fuel, generators,
  grossGW…). Phase 3 runs standard refineries whose Heavy Oil Residue becomes generator fuel;
  later phases run the fuel-driven recycled polymer loops.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { FLUIDS, itemRate, lanePlan, OIL_RECIPES } from '../../flow.ts';
import { phaseLabel, plan } from '../../session.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';
import RecipePanel from './RecipePanel.vue';
import { factoryLink } from '../actions.ts';
import type { HandbookFactory } from '../../../types/index.ts';

const props = defineProps<{ phase: string }>();

const campus = computed(() =>
  legacy(() => {
    // Drawn only for the oil products, whose phases all have a campus plan.
    const phaseKey = props.phase,
      phasePlan = plan.plans[phaseKey]!;
    // Each stage with its per-machine recipe; an unknown recipe name gets empty in/out.
    const stages = phasePlan.oil.map(stage => ({
      ...stage,
      rates: OIL_RECIPES[stage.recipe] || { in: {}, out: {} },
    }));
    const pipes = (rate: number) => {
      const lanes = lanePlan(rate, true, phaseKey);
      return `${lanes.count} × ${lanes.lane.mark} pipe${lanes.count > 1 ? 's' : ''}`;
    };
    // The first factory other than the polymers that takes Fuel, linked from exported fuel.
    const fuelConsumer = plan.factories.find(
      factory =>
        !['plastic', 'rubber'].includes(factory.id) && factory.stages[phaseKey]?.inputs?.Fuel,
    );
    return {
      label: phaseLabel(phaseKey),
      first: phaseKey === '3',
      // Raw campus inputs (crude oil and water), skipping any the phase does not use.
      inputs: (
        [
          ['Crude Oil', phasePlan.oilTotals.crude],
          ['Water', phasePlan.oilTotals.water],
        ] as [string, number][]
      )
        .filter(([, rate]) => rate > 0.01)
        .map(([name, rate]) => ({ name, pipes: pipes(rate), rate: num(rate) })),
      stages: stages.map(stage => {
        // Whole-stage flow: per-machine recipe rate × machine equivalents.
        const total = (side: 'in' | 'out') =>
          Object.entries(stage.rates[side])
            .map(
              ([item, rate]) =>
                `${num(rate * stage.equivalent)}${FLUIDS.has(item) ? ' m³' : ''} ${item}`,
            )
            .join(' + ');
        // Full-speed machines plus the underclocked last one; the epsilon keeps an exact
        // whole equivalent from reading as one machine short.
        const whole = Math.floor(stage.equivalent + 1e-7),
          fraction = stage.equivalent - whole;
        const clock =
          fraction > 1e-7
            ? `${num(whole)} at 100% + 1 at ≈ ${num(fraction * 100)}%`
            : `all at 100%`;
        // Where each output goes: other campus stages that consume it, the polymer export,
        // and Fuel either burned in generators (Phase 3) or exported.
        const destinations = Object.keys(stage.rates.out)
          .map(item => {
            const parts: { text: string; to?: HandbookFactory }[] = stages
              .filter(other => other !== stage && other.rates.in[item])
              .map(other => ({
                text: `the ${other.recipe.replace('Alternate: ', '')} ${other.machine.replace(/y$/, 'ie')}s`,
              }));
            if (item === 'Plastic' || item === 'Rubber') parts.push({ text: 'campus export' });
            if (item === 'Fuel') {
              if (Number(phasePlan.oilTotals.generators) > 0)
                parts.push({
                  text: `${num(phasePlan.oilTotals.generators)} Fuel Generators (${num(phasePlan.oilTotals.grossGW)} GW gross)`,
                });
              else if (phasePlan.oilTotals.fuel > 0.01)
                parts.push({
                  text: `export ${itemRate(item, phasePlan.oilTotals.fuel)}`,
                  to: fuelConsumer,
                });
            }
            return parts.length ? { item, parts } : null;
          })
          .filter(d => d !== null);
        return {
          key: stage.recipe,
          head: `${num(stage.machines)} × ${stage.machine}`,
          sub: `${stage.recipe} · ${clock} · in ${total('in') || '—'} · out ${total('out')}`,
          recipe: {
            name: stage.recipe.replace('Alternate: ', ''),
            machine: stage.machine,
            ins: Object.entries(stage.rates.in),
            outs: Object.entries(stage.rates.out),
          },
          machines: stage.machines,
          destinations,
        };
      }),
      fuel: num(phasePlan.oilTotals.fuel),
      generators: phasePlan.oilTotals.generators,
      grossGW: num(phasePlan.oilTotals.grossGW),
    };
  }),
);
</script>

<template>
  <h3>Shared oil campus · {{ campus.label }}</h3>
  <p>
    One campus makes Plastic and Rubber together. Crude never feeds the polymer machines directly{{
      campus.first
        ? ': the standard refineries turn it into the polymers plus Heavy Oil Residue, which becomes generator fuel.'
        : ': it becomes Heavy Oil Residue and Polymer Resin first, and the polymers come out of the fuel-driven recycled loops.'
    }}
    Build the stages in this order; recipe cells are per machine at 100%, per minute.
  </p>
  <p class="small muted">
    Flow rates here stay exactly balanced instead of rounded up: unpackaged fluids cannot overflow
    to the AWESOME Sink, and the loops feed themselves, so surplus fluid would back the chain up.
    Machine counts are whole — only each stage's last machine runs underclocked.
  </p>
  <div class="rail-cap">Campus inputs</div>
  <div class="rail-grid">
    <div v-for="input in campus.inputs" :key="input.name" class="rail-tile">
      <ItemIcon :name="input.name" /><span class="rail-main"
        ><b>{{ input.name }}</b
        ><small>{{ input.pipes }}</small></span
      ><span class="rail-rate">{{ input.rate }}<small> m³/min</small></span>
    </div>
  </div>
  <template v-for="stage in campus.stages" :key="stage.key"
    ><div class="rail-arrow">↓</div>
    <div class="rail-machine">
      <div class="rail-machine-main">
        <b>{{ stage.head }}</b
        ><small>{{ stage.sub }}</small>
      </div>
    </div>
    <RecipePanel :recipe="stage.recipe" :machines="stage.machines" />
    <p v-if="stage.destinations.length" class="small muted">
      <template v-for="(destination, i) in stage.destinations" :key="destination.item"
        ><br v-if="i" />{{ destination.item }} →
        <template v-for="(part, j) in destination.parts" :key="j"
          >{{ j ? ' + ' : '' }}{{ part.text
          }}<template v-if="part.to">
            to
            <button class="btn quiet" v-bind="factoryLink({ factory: part.to.id })">
              {{ part.to.name }} ↗
            </button></template
          ></template
        ></template
      >
    </p></template
  >
  <p v-if="campus.first">
    Burn all {{ campus.fuel }} Fuel/min in {{ campus.generators }} generators (last underclocked),
    giving {{ campus.grossGW }} GW gross. This additional Phase 3 byproduct power is not counted in
    later capacity totals.
  </p>
  <p v-else>
    Export {{ campus.fuel }} Fuel/min; remaining fuel and recycled polymers are internal flows.
    <b>Seeding the loops:</b> run the Residual Rubber Refineries from resin first, feed that rubber
    with fuel into Recycled Plastic, then bring Recycled Rubber online — open the campus exports
    only once both loops are saturated.
  </p>
</template>
