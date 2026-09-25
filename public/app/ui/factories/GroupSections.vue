<!--
  One section per user group on a factories page, holding the entries of `items` assigned to
  it; `keyOf` gives an entry's assignment key and the `card` slot draws its card for a group.
  An empty group is hidden unless groups are being edited. While editing, a group can be
  renamed (saved when the field is committed, then redrawn with the saved name either way) or
  removed; otherwise a group with more than one factory offers its build order.
-->
<script setup>
import { computed } from 'vue';
import { save } from '../../api.ts';
import { openGroupChain } from '../../factory-detail.ts';
import { factoryEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';

const props = defineProps({
  items: { type: Array, required: true },
  keyOf: { type: Function, required: true },
});

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

async function rename(e, id) {
  const el = e.target;
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
// progress stay.
async function remove(id) {
  if (!confirm('Remove this group? The factories stay in the list and keep their progress.'))
    return;
  try {
    await save({ type: 'factoryGroupRemove', id });
    render();
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
      <button v-if="editing" class="btn danger" :data-remove-group="gr.id" @click="remove(gr.id)">
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
