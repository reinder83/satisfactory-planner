<!--
  The live estimate beside All settings steps 3 and 4 (SP-33, #268), from wizard/estimate.ts:
  the buildings and power at the plan's last phase, and the tightest raw resource over every
  phase it plans, as a share of its budget. A resource over its budget, a phase that does not
  fit or too little power shows a warning. The status line is a polite live region, so a screen
  reader hears when an estimate is ready without every figure being read out. Leaving the step
  cancels the estimate and forgets it; arriving estimates the draft's settings straight away.
  At 720px and below the panel sits under the form, off screen while a budget near the top is
  edited (#412), so a one-line bar at the foot of the screen carries the tightest resource and a
  ⚠ when there is a warning; tapping it brings the panel into view. It hides while the panel is
  on screen, which an IntersectionObserver reports; the stylesheet hides it on wider screens.
  It is a touch shortcut: it comes after the panel and hides once the panel is on screen, so the
  keyboard reaches the panel itself. The stylesheet keeps a focused control clear of it.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { num } from '../../format.ts';
import {
  cancelEstimate,
  estimate,
  scheduleEstimate,
  setEstimatePaused,
} from '../../wizard/estimate.ts';
import { power } from '../../wizard/fields.ts';
import { resourceUse } from '../../views/resources.ts';
import { legacy } from '../bridge.ts';

const form = () => document.querySelector<HTMLFormElement>('#wizard-form');

const view = computed(() =>
  legacy(() => {
    const p = estimate.plan;
    // The quick pass (exact ratios, wizard/estimate.ts) is shown while the whole-machine one
    // runs; a phase it says fits may still not fit once rounded.
    const quick = estimate.status === 'running' && estimate.quick;
    const status = estimate.paused
      ? 'Paused. Resume to estimate these settings.'
      : quick
        ? 'Quick estimate with exact ratios; checking whole machines…'
        : estimate.status === 'running'
          ? 'Estimating…'
          : estimate.status === 'error'
            ? estimate.error
            : p
              ? 'Estimate for the settings on screen.'
              : 'An estimate appears as you change these settings.';
    if (!p)
      return { status, error: estimate.status === 'error', paused: estimate.paused, figures: null };
    const from = Number(p.settings.phase || 1);
    const stages = Object.entries(p.stages).filter(([ph]) => Number(ph) >= from);
    const [lastPhase, last] = stages.at(-1)!;
    // The tightest raw resource over every phase the plan covers.
    let tightest: { name: string; phase: string; use: ReturnType<typeof resourceUse> } | null =
      null;
    for (const [ph, x] of stages)
      for (const [name, q] of Object.entries(x.raw || {})) {
        const use = resourceUse(q, p.settings.limits[name] ?? 0);
        if (!use.idle && (!tightest || use.fraction > tightest.use.fraction))
          tightest = { name, phase: ph, use };
      }
    const short = (last.requiredMW ?? 0) - (last.availableMW ?? 0) > 0.01;
    const unfit = stages.filter(([, x]) => !x.feasible).map(([ph]) => ph);
    const warnings = [
      ...(tightest?.use.over
        ? [`${tightest.name} is over its budget: ${tightest.use.use} in Phase ${tightest.phase}.`]
        : []),
      ...(unfit.length
        ? [
            `Phase${unfit.length > 1 ? 's' : ''} ${unfit.join(', ')} ${unfit.length > 1 ? 'do' : 'does'} not fit these settings. Calculate plan lists the options.`,
          ]
        : []),
      ...(short
        ? [
            `Phase ${lastPhase} needs ${power(last.requiredMW)} of power; ${power(last.availableMW)} is available.`,
          ]
        : []),
    ];
    return {
      status,
      error: estimate.status === 'error',
      paused: estimate.paused,
      stale: estimate.status === 'running' && !quick,
      figures: {
        phase: lastPhase,
        buildings: last.rows ? num(last.rows.reduce((a, r) => a + r.machines, 0)) : '—',
        power: `${power(last.requiredMW)} of ${power(last.availableMW)}`,
        short,
        tightest,
      },
      warnings,
    };
  }),
);

// The phone bar's one line: the tightest resource once there is one, else the status.
const peek = computed(() => {
  const t = view.value.figures?.tightest;
  return {
    label: t ? 'Tightest' : 'Live estimate',
    text: t ? `${t.name} ${t.use.use}` : view.value.status,
    warn: !!(view.value.figures && view.value.warnings?.length),
  };
});

// Whether the panel is on screen, where the bar would only repeat it.
const panel = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const panelShown = ref(false);
let seen: IntersectionObserver | null = null;

// The bar's tap: the panel comes into view and its heading takes focus, so a screen reader
// continues from the estimate.
async function showPanel() {
  panel.value?.scrollIntoView({ block: 'start' });
  await nextTick();
  heading.value?.focus({ preventScroll: true });
}

onMounted(() => {
  const f = form();
  if (f) scheduleEstimate(f, 0);
  if (typeof IntersectionObserver === 'function' && panel.value) {
    seen = new IntersectionObserver(([e]) => (panelShown.value = !!e?.isIntersecting));
    seen.observe(panel.value);
  }
});
onBeforeUnmount(() => {
  seen?.disconnect();
  cancelEstimate(true);
});
</script>

<template>
  <aside
    ref="panel"
    class="panel wizard-estimate"
    aria-labelledby="wizard-estimate-title"
    data-estimate
  >
    <h2 id="wizard-estimate-title" ref="heading" tabindex="-1">Live estimate</h2>
    <p
      :class="['small', view.error ? 'form-error' : 'muted']"
      role="status"
      aria-live="polite"
      data-estimate-status
    >
      {{ view.status }}
    </p>
    <dl v-if="view.figures" :class="['estimate-figures', view.stale ? 'stale' : '']">
      <div>
        <dt class="eyebrow">Buildings by Phase {{ view.figures.phase }}</dt>
        <dd data-estimate-buildings>{{ view.figures.buildings }}</dd>
      </div>
      <div>
        <dt class="eyebrow">Power needed at Phase {{ view.figures.phase }}</dt>
        <dd data-estimate-power :class="view.figures.short ? 'warn' : undefined">
          {{ view.figures.power }}
        </dd>
      </div>
      <div v-if="view.figures.tightest">
        <dt class="eyebrow">Tightest resource</dt>
        <dd data-estimate-tightest :class="view.figures.tightest.use.over ? 'warn' : undefined">
          {{ view.figures.tightest.name }} {{ view.figures.tightest.use.use }}
          <small>Phase {{ view.figures.tightest.phase }}</small>
          <div
            :class="[
              'resource-bar',
              view.figures.tightest.use.over
                ? 'over'
                : view.figures.tightest.use.tight
                  ? 'tight'
                  : '',
            ]"
            aria-hidden="true"
          >
            <span :style="{ width: view.figures.tightest.use.bar + '%' }"></span>
          </div>
        </dd>
      </div>
    </dl>
    <div v-if="view.figures && view.warnings.length" class="notice warn" data-estimate-warning>
      <p v-for="w in view.warnings" :key="w"><span aria-hidden="true">⚠ </span>{{ w }}</p>
    </div>
    <button
      type="button"
      class="btn"
      :aria-pressed="view.paused"
      data-estimate-pause
      @click="setEstimatePaused(!view.paused, form())"
    >
      {{ view.paused ? 'Resume live estimate' : 'Pause live estimate' }}
    </button>
    <p class="small muted">
      Calculated from the settings on screen, as Review will be. Review has every phase.
    </p>
  </aside>
  <button
    v-if="!panelShown"
    type="button"
    :class="['estimate-peek', peek.warn ? 'warn' : '']"
    data-estimate-peek
    @click="showPanel"
  >
    <span v-if="peek.label !== 'Live estimate'" class="visually-hidden">Live estimate: </span
    ><span class="eyebrow">{{ peek.label }}</span
    ><span class="estimate-peek-text" data-estimate-peek-text>{{ peek.text }}</span
    ><template v-if="peek.warn"
      ><span class="estimate-peek-warn" aria-hidden="true">⚠</span
      ><span class="visually-hidden">, with a warning</span></template
    ><span aria-hidden="true">↓</span>
  </button>
</template>
