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
import { FLUIDS, lanePlan, OIL_RECIPES } from '../../flow.ts';
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
    const st = props.phase,
      p = plan.plans[st]!;
    // Each stage with its per-machine recipe; an unknown recipe name gets empty in/out.
    const stages = p.oil.map(x => ({ ...x, rc: OIL_RECIPES[x.recipe] || { in: {}, out: {} } }));
    const pipes = (q: number) => {
      const pl = lanePlan(q, true, st);
      return `${pl.count} × ${pl.lane.mark} pipe${pl.count > 1 ? 's' : ''}`;
    };
    // The first factory other than the polymers that takes Fuel, linked from exported fuel.
    const fuelConsumer = plan.factories.find(
      ff => !['plastic', 'rubber'].includes(ff.id) && ff.stages[st]?.inputs?.Fuel,
    );
    return {
      label: phaseLabel(st),
      first: st === '3',
      // Raw campus inputs (crude oil and water), skipping any the phase does not use.
      inputs: (
        [
          ['Crude Oil', p.oilTotals.crude],
          ['Water', p.oilTotals.water],
        ] as [string, number][]
      )
        .filter(([, q]) => q > 0.01)
        .map(([name, q]) => ({ name, pipes: pipes(q), rate: num(q) })),
      stages: stages.map(x => {
        // Whole-stage flow: per-machine recipe rate × machine equivalents.
        const total = (side: 'in' | 'out') =>
          Object.entries(x.rc[side])
            .map(([n, q]) => `${num(q * x.equivalent)}${FLUIDS.has(n) ? ' m³' : ''} ${n}`)
            .join(' + ');
        // Full-speed machines plus the underclocked last one; the epsilon keeps an exact
        // whole equivalent from reading as one machine short.
        const whole = Math.floor(x.equivalent + 1e-7),
          frac = x.equivalent - whole;
        const clock =
          frac > 1e-7 ? `${num(whole)} at 100% + 1 at ≈ ${num(frac * 100)}%` : `all at 100%`;
        // Where each output goes: other campus stages that consume it, the polymer export,
        // and Fuel either burned in generators (Phase 3) or exported.
        const dest = Object.keys(x.rc.out)
          .map(n => {
            const parts: { text: string; to?: HandbookFactory }[] = stages
              .filter(o => o !== x && o.rc.in[n])
              .map(o => ({
                text: `the ${o.recipe.replace('Alternate: ', '')} ${o.machine.replace(/y$/, 'ie')}s`,
              }));
            if (n === 'Plastic' || n === 'Rubber') parts.push({ text: 'campus export' });
            if (n === 'Fuel') {
              if (Number(p.oilTotals.generators) > 0)
                parts.push({
                  text: `${num(p.oilTotals.generators)} Fuel Generators (${num(p.oilTotals.grossGW)} GW gross)`,
                });
              else if (p.oilTotals.fuel > 0.01)
                parts.push({ text: `export ${num(p.oilTotals.fuel)}/min`, to: fuelConsumer });
            }
            return parts.length ? { item: n, parts } : null;
          })
          .filter(d => d !== null);
        return {
          key: x.recipe,
          head: `${num(x.machines)} × ${x.machine}`,
          sub: `${x.recipe} · ${clock} · in ${total('in') || '—'} · out ${total('out')}`,
          recipe: {
            name: x.recipe.replace('Alternate: ', ''),
            machine: x.machine,
            ins: Object.entries(x.rc.in),
            outs: Object.entries(x.rc.out),
          },
          machines: x.machines,
          dest,
        };
      }),
      fuel: num(p.oilTotals.fuel),
      generators: p.oilTotals.generators,
      grossGW: num(p.oilTotals.grossGW),
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
    <div v-for="i in campus.inputs" :key="i.name" class="rail-tile">
      <ItemIcon :name="i.name" /><span class="rail-main"
        ><b>{{ i.name }}</b
        ><small>{{ i.pipes }}</small></span
      ><span class="rail-rate">{{ i.rate }}<small> m³/min</small></span>
    </div>
  </div>
  <template v-for="x in campus.stages" :key="x.key"
    ><div class="rail-arrow">↓</div>
    <div class="rail-machine">
      <div class="rail-machine-main">
        <b>{{ x.head }}</b
        ><small>{{ x.sub }}</small>
      </div>
    </div>
    <RecipePanel :recipe="x.recipe" :machines="x.machines" />
    <p v-if="x.dest.length" class="small muted">
      <template v-for="(d, n) in x.dest" :key="d.item"
        ><br v-if="n" />{{ d.item }} →
        <template v-for="(part, k) in d.parts" :key="k"
          >{{ k ? ' + ' : '' }}{{ part.text
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
