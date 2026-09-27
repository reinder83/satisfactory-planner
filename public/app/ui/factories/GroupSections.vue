<!--
  One section per user group on a factories page, holding the entries of `items` assigned to
  it; `keyOf` gives an entry's assignment key and the `card` slot draws its card for a group.
  An empty group is hidden unless groups are being edited. While editing, a group can be
  renamed (saved when the field is committed, then redrawn with the saved name either way) or
  removed; otherwise a group with more than one factory offers its build order.
-->
<script setup lang="ts" generic="T">
import { computed } from 'vue';
import { save } from '../../api.ts';
import { openGroupChain } from '../../factory-detail.ts';
import { factoryEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval } from '../refocus.ts';

// The factories to sort into groups (handbook factories or calculated rows), and the key
// their memberships are saved under.
const props = defineProps<{ items: T[]; keyOf: (item: T) => string }>();

const sections = computed(() =>
  legacy(() =>
    factoryGroupsState()
      .groups.map(gr => ({
        ...gr,
        members: props.items.filter(x =>
          membershipsOf(props.keyOf(x)).some(m => m.group === gr.id),
        ),
      }))
      .filter(gr => gr.members.length || factoryEditing),
  ),
);
const editing = computed(() => legacy(() => factoryEditing));

async function rename(e: Event, id: string) {
  const el = e.target as HTMLInputElement;
  el.disabled = true;
  try {
    await save({ type: 'factoryGroupRename', id, name: el.value });
  } catch {
  } finally {
    el.disabled = false;
    render();
  }
}

// "Remove group", after a confirmation: only the group goes; its factories and their
// progress stay. Focus then goes to the next group's Remove, else the previous one's, else the
// new group field (ui/refocus.ts, #286).
async function remove(e: Event, id: string) {
  const refocus = refocusAfterRemoval(e.currentTarget, {
    row: '#main .user-group',
    control: '[data-remove-group]',
    fallback: ['#new-group-name'],
  });
  if (
    !(await confirmAction({
      title: 'Remove this group?',
      body: 'Remove this group? The factories stay in the list and keep their progress.',
      confirmLabel: 'Remove group',
      danger: true,
    }))
  )
    return;
  try {
    await save({ type: 'factoryGroupRemove', id });
    render();
    await refocus();
  } catch {}
}
</script>

<template>
  <section v-for="gr in sections" :key="gr.id" class="site-group user-group">
    <header class="site-head">
      <div>
        <span class="eyebrow"
          >FACTORY GROUP · {{ gr.members.length }}
          {{ gr.members.length === 1 ? 'FACTORY' : 'FACTORIES' }}</span
        ><input
          v-if="editing"
          class="bay-rename"
          :data-group-rename="gr.id"
          :value="gr.name"
          maxlength="80"
          :aria-label="'Rename group ' + gr.name"
          @change="rename($event, gr.id)"
        />
        <h2 v-else>{{ gr.name }}</h2>
      </div>
      <button
        v-if="editing"
        class="btn danger"
        :data-remove-group="gr.id"
        @click="remove($event, gr.id)"
      >
        Remove group
      </button>
      <button
        v-else-if="gr.members.length > 1"
        class="btn"
        :data-group-chain="gr.id"
        @click="openGroupChain(gr.id)"
      >
        Build order ↗
      </button>
    </header>
    <div class="cards">
      <template v-if="gr.members.length"
        ><template v-for="x in gr.members" :key="keyOf(x)"
          ><slot name="card" :item="x" :group="gr.id" /></template
      ></template>
      <div v-else class="empty-state">
        Empty group. Add factories with the group selector on their cards.
      </div>
    </div>
  </section>
</template>
