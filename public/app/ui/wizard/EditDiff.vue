<!--
  Review of Edit settings (#1071): what recalculating the profile in place changes, read from its
  plan when the edit started and the preview just calculated (profile-edit.ts), grouped: the
  settings that changed (old → new, then how many others), and per phase from the new start phase
  on its production lines (how many, how many new and gone), buildings and the power it needs.
  Nothing here is stored or sent.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num, plural } from '../../format.ts';
import { phaseChanges, settingsChanges } from '../../profile-edit.ts';
import { draft, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      edit = wizardDraft.edit,
      preview = wizardDraft.preview;
    if (!edit || !preview) return null;
    const settings = settingsChanges(edit.plan.settings, preview.settings, workspace.catalog.goals);
    return {
      settings: settings.changes,
      others: settings.others ? plural(settings.others, 'other setting') + ' changed' : '',
      phases: phaseChanges(edit.plan, preview).map(change => ({
        phase: change.phase,
        lines:
          change.lines.before === change.lines.after && !change.lines.added
            ? num(change.lines.after)
            : `${num(change.lines.before)} → ${num(change.lines.after)}`,
        linesDetail: [
          change.lines.added ? `${num(change.lines.added)} new` : '',
          change.lines.removed ? `${num(change.lines.removed)} gone` : '',
        ]
          .filter(Boolean)
          .join(', '),
        buildings:
          change.buildings.before === change.buildings.after
            ? num(change.buildings.after)
            : `${num(change.buildings.before)} → ${num(change.buildings.after)}`,
        power: change.power.same
          ? change.power.after
          : `${change.power.before} → ${change.power.after}`,
      })),
    };
  }),
);
</script>

<template>
  <section v-if="view" class="panel edit-diff" data-edit-diff aria-labelledby="edit-diff-title">
    <h3 id="edit-diff-title">What changes</h3>
    <h4>Settings</h4>
    <ul v-if="view.settings.length || view.others" class="edit-diff-settings">
      <li v-for="change in view.settings" :key="change.label" data-edit-setting>
        <b>{{ change.label }}:</b> {{ change.before }} → {{ change.after }}
      </li>
      <li v-if="view.others" data-edit-others>{{ view.others }}</li>
    </ul>
    <p v-else class="muted" data-edit-no-settings>
      No settings changed: the plan is calculated again with the same settings.
    </p>
    <h4>Per phase</h4>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Production lines</th>
            <th>Buildings</th>
            <th>Power needed</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.phases" :key="row.phase" :data-edit-phase="row.phase">
            <td>{{ row.phase }}</td>
            <td>
              {{ row.lines
              }}<template v-if="row.linesDetail"
                >{{ ' ' }}<span class="badge">{{ row.linesDetail }}</span></template
              >
            </td>
            <td>{{ row.buildings }}</td>
            <td>{{ row.power }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
