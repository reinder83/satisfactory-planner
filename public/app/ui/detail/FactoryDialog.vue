<!--
  The dialog for one handbook factory (plan.factories id): the "Running at Phase N target" check
  in the sticky header (#239), then stats, flow, lane advice, expansion table and the factory
  notes. It shows the
  current phase, or the factory's first phase when it has no stage in the current one.
  Plastic and Rubber come from the shared oil campus, which replaces the lane advice. The check
  key `factory-<phase>-<id>` and the note key `factory-<id>` (shared by every phase) are saved
  progress. Opened by openFactory in factory-detail.ts.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { handbookFlowModel } from '../../flow.ts';
import { checked, phase, phaseLabel, plan, stage } from '../../session.ts';
import { legacy } from '../bridge.ts';
import StatTile from '../StatTile.vue';
import DetailNote from './DetailNote.vue';
import DialogFrame from './DialogFrame.vue';
import FlowDiagram from './FlowDiagram.vue';
import LaneAdvice from './LaneAdvice.vue';
import OilCampus from './OilCampus.vue';
import { toggleCheck } from '../actions.ts';
import type { HandbookFactoryStage } from '../../../types/index.ts';

const props = defineProps<{ id: string }>();

const view = computed(() =>
  legacy(() => {
    const f = plan.factories.find(x => x.id === props.id);
    if (!f) return null;
    // Every handbook factory has at least one stage; the dialog shows the current one, or the
    // first it has.
    const r = (f.stages[stage()] || Object.values(f.stages)[0])!;
    const oil = ['Plastic', 'Rubber'].includes(f.name);
    // `st` is the phase key of `r`. Local factories (cable, wire, screws…) are built beside
    // their consumers, so an input one of them makes is shown as made on site.
    const st: string = f.stages[stage()] ? stage() : Object.keys(f.stages)[0]!;
    const localInput = (n: string) =>
      plan.factories.find(x => x.local && x.name === n && x.stages[st]);
    // Expansion table, one row per phase the factory runs in. `installed` remembers the most
    // machines of each type built so far, so "Add" is only the growth beyond that and a
    // smaller later requirement reads "Keep capacity". A different machine type starts its own
    // count. For oil the count is every building on that phase's shared campus.
    const installed: Record<string, number> = {};
    const history = (Object.entries(f.stages) as [string, HandbookFactoryStage][]).map(
      ([ph, x]) => {
        const campus = oil ? (plan.plans[ph]?.oil || []).reduce((a, c) => a + c.machines, 0) : 0;
        const machines = oil ? campus : x.machines,
          label = oil ? 'shared campus buildings' : x.machine;
        const old = installed[label] || 0;
        const added = Math.max(0, machines - old);
        installed[label] = Math.max(old, machines);
        return {
          phase: ph,
          output: num(x.output),
          storage: num(x.storage),
          required: `${num(machines)} ${label}`,
          add: added ? `+${num(added)}` : 'Keep capacity',
        };
      },
    );
    // Why nobody takes the output: nuclear parts feed the power fleet, anything else with a
    // storage allowance only refills protected storage. Post-game also lists the completion
    // modules (plan.completion) that draw on this item.
    const consumers = plan.factories.some(o => o.id !== f.id && o.stages[st]?.inputs?.[f.name]);
    const usage = consumers || r.delivery ? '' : f.nuclear ? 'nuclear' : r.storage ? 'storage' : '';
    const completion = phase() === 'post' ? plan.completion.filter(c => c.inputs?.[f.name]) : [];
    const check = 'factory-' + st + '-' + f.id;
    return {
      f,
      r,
      st,
      oil,
      subtitle: `${phaseLabel(st)} · Handbook page ${f.page}`,
      flow: handbookFlowModel(f, st, r, localInput, oil),
      localInputs: Object.keys(r.inputs).some(localInput),
      history,
      usage,
      // completion keeps only the modules with this input.
      completion: completion.map(c => c.name + ' ' + num(c.inputs[f.name]!) + '/min').join(' · '),
      check,
      done: checked(check),
    };
  }),
);
</script>

<template>
  <DialogFrame v-if="view" :title="view.f.name" :subtitle="view.subtitle" :icon="view.f.name">
    <template #actions
      ><label class="check-row"
        ><input
          type="checkbox"
          :data-check="view.check"
          @change="toggleCheck"
          :checked="view.done"
        />Running at Phase {{ view.st }} target</label
      ></template
    >
    <span class="badge orange">{{ view.r.recipe }}</span>
    <div class="stats">
      <StatTile label="Output" :value="num(view.r.output) + '/min'" caption="Total production" />
      <StatTile
        label="Storage"
        :value="num(view.r.storage) + '/min'"
        caption="Protected allowance"
      />
      <StatTile
        label="Machines"
        :value="view.oil ? 'Campus' : num(view.r.machines)"
        :caption="view.oil ? 'Shared oil processes' : view.r.machine"
      />
    </div>
    <div v-if="view.f.note" class="notice blue">{{ view.f.note }}</div>
    <div v-if="view.f.local" class="notice">
      Distributed production budget: build these machines beside the consumers listed below, plus
      the storage refill module. Independent site rounding can require additional machines.
    </div>
    <FlowDiagram :model="view.flow" />
    <p v-if="view.usage === 'nuclear'" class="small muted">
      {{ view.f.name }} is consumed by the nuclear power fleet, which is planned in
      <a href="#resources">Power &amp; resources</a> rather than as a factory target. Keep its flow
      inside the nuclear site.
    </p>
    <p v-else-if="view.usage === 'storage'" class="small muted">
      No factory in this plan consumes {{ view.f.name }} directly; this capacity only refills the
      protected storage. The refill rate is a protected maximum, not continuous consumption — the
      machines idle once the container is full and only run while you take {{ view.f.name }} out.
    </p>
    <p v-if="view.completion" class="small muted">
      Additional completion modules also use {{ view.f.name }}: {{ view.completion }}. Allocate
      their supply on top of this factory's budget.
    </p>
    <div v-if="view.f.nuclear" class="notice">
      Process buffer at the nuclear site. Keep radioactive recycling flows balanced; do not apply a
      generic storage surplus.
    </div>
    <OilCampus v-if="view.oil" :phase="view.st" />
    <template v-else
      ><LaneAdvice :model="view.flow" />
      <p class="small muted">
        <template v-if="view.r.machines === 1"
          >1 whole building at {{ num(view.r.lastClock ?? 100) }}%</template
        ><template v-else
          >{{ num(view.r.machines) }} whole buildings. All at 100%<template
            v-if="(view.r.lastClock ?? 100) < 100"
            >, except the last at {{ num(view.r.lastClock) }}%</template
          ></template
        >. Peak production load {{ num(view.r.peakMW) }} MW; upstream factories and logistics are
        separate.{{
          view.localInputs
            ? ' Local inputs are produced beside this factory; their machines are part of the shared distributed budget.'
            : ''
        }}
      </p></template
    >
    <h3>Expansion across phases</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Output/min</th>
            <th>Storage/min</th>
            <th>Required</th>
            <th>Add</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in view.history" :key="h.phase">
            <td>{{ h.phase }}</td>
            <td>{{ h.output }}</td>
            <td>{{ h.storage }}</td>
            <td>{{ h.required }}</td>
            <td>{{ h.add }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      Keep larger earlier installed capacity. Recipe changes need their new input routes. Counts are
      running requirements, not a demolition instruction.{{
        view.oil
          ? ' Campus buildings are shared with the other polymer export and produce both together; the shared oil campus stages above list machines per recipe. Phase 4 replaces the simple Phase 3 refineries with the recycled loops.'
          : ''
      }}
    </p>
    <h3>Factory notes</h3>
    <DetailNote :note-key="'factory-' + view.f.id" label="Location, transport, next expansion." />
  </DialogFrame>
</template>
