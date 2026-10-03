<!--
  One section per user group on a factories page, holding the entries of `items` assigned to
  it; `keyOf` gives an entry's assignment key and the `card` slot draws its card for a group.
  An empty group is hidden unless groups are being edited. While editing, a group can be
  renamed (saved when the field is committed, then redrawn with the saved name either way) or
  removed; otherwise a group with more than one factory offers its build order. Each group can be
  folded (CollapseToggle.vue, SP-17): its header stays, its cards go. The section's id
  (`section-<group>`) and its heading (`data-section-heading`) are where the jump bar leads.
-->
<script setup lang="ts" generic="T">
import { computed } from 'vue';
import { save } from '../../api.ts';
import { openGroupChain, openGroupFlow } from '../../factory-detail.ts';
import { factoryEditing, sectionCollapsed } from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { leaveDraft, resetDraft, useDrafts } from '../draft.ts';
import { whileBusy } from '../../busy.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import CollapseToggle from './CollapseToggle.vue';

// The factories to sort into groups (calculated rows), and the key
// their memberships are saved under.
const props = defineProps<{ items: T[]; keyOf: (item: T) => string }>();

const sections = computed(() =>
  legacy(() =>
    factoryGroupsState()
      .groups.map(group => ({
        ...group,
        members: props.items.filter(item =>
          membershipsOf(props.keyOf(item)).some(m => m.group === group.id),
        ),
        collapsed: sectionCollapsed(group.id),
      }))
      .filter(section => section.members.length || factoryEditing),
  ),
);
const editing = computed(() => legacy(() => factoryEditing));

// The groups' name fields show the saved names, then what the user types, so a redraw while
// another control saves keeps a name typed but not yet committed (#654, ui/draft.ts).
const savedNames = () =>
  Object.fromEntries(sections.value.map(section => [section.id, section.name]));
// Left without a commit, a field shows the saved name again (#687).
const names = useDrafts(savedNames);

// A group's name field, read-only while it saves (app/busy.ts, #299), then redrawn with the saved
// name whether or not the save worked.
function rename(event: Event, id: string) {
  const input = event.target as HTMLInputElement;
  return whileBusy(input, async () => {
    try {
      await save({ type: 'factoryGroupRename', id, name: input.value });
    } catch {
    } finally {
      render();
      const name = savedNames()[id];
      if (name !== undefined) resetDraft(names, id, name);
    }
  });
}

// "Remove group", after a confirmation: only the group goes; its factories and their
// progress stay. Focus then goes to the next group's Remove, else the previous one's, else the
// new group field (ui/refocus.ts, #286).
async function remove(event: Event, id: string) {
  const refocus = refocusAfterRemoval(event.currentTarget, {
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
  <section
    v-for="section in sections"
    :id="'section-' + section.id"
    :key="section.id"
    :class="['site-group', 'user-group', section.collapsed ? 'collapsed' : '']"
  >
    <header class="site-head">
      <div class="site-title">
        <CollapseToggle :section-key="section.id" :label="'Factories in ' + section.name" />
        <div>
          <span class="eyebrow"
            >FACTORY GROUP · {{ section.members.length }}
            {{ section.members.length === 1 ? 'FACTORY' : 'FACTORIES' }}</span
          ><input
            v-if="editing"
            class="bay-rename"
            :data-group-rename="section.id"
            data-section-heading
            :value="names[section.id]"
            maxlength="80"
            :aria-label="'Rename group ' + section.name"
            @input="names[section.id] = ($event.target as HTMLInputElement).value"
            @change="rename($event, section.id)"
            @blur="leaveDraft(names, section.id, $event)"
          />
          <h2 v-else tabindex="-1" data-section-heading>{{ section.name }}</h2>
        </div>
      </div>
      <button
        v-if="editing"
        class="btn danger"
        :data-remove-group="section.id"
        @click="remove($event, section.id)"
      >
        Remove group
      </button>
      <button
        v-else-if="section.members.length > 1"
        class="btn"
        :data-group-chain="section.id"
        @click="openGroupChain(section.id)"
      >
        Build order ↗
      </button>
      <button
        v-if="!editing && section.members.length > 1"
        class="btn"
        :data-group-flow="section.id"
        @click="openGroupFlow(section.id)"
      >
        Flow diagram ↗
      </button>
    </header>
    <div v-show="!section.collapsed" :id="'cards-' + section.id" class="cards">
      <template v-if="section.members.length"
        ><template v-for="item in section.members" :key="keyOf(item)"
          ><slot name="card" :item="item" :group="section.id" /></template
      ></template>
      <div v-else class="empty-state">
        Empty group. Add factories with the group selector on their cards.
      </div>
    </div>
  </section>
</template>
