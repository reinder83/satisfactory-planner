<!--
  One section per user group on a factories page, holding the entries of `items` assigned to
  it; `keyOf` gives an entry's assignment key and the `card` slot draws its card for a group.
  An empty group is hidden unless groups are being edited. While editing, a group can be
  renamed (saved when the field is committed, then redrawn with the saved name either way) or
  removed; otherwise a group with more than one factory links to its build order, the group's flow
  page (#factories/<group>/flow, GroupFlowPage.vue, #895). It is a link, not a button: it goes to
  another page, so it can open in a new tab and the address can be shared. Each group can be
  folded (CollapseToggle.vue, SP-17): its header stays, its cards go. Unfolded, a group shows its
  "Made on site" picker above its cards while editing (OnSitePicker.vue, #877), and otherwise what
  the open plan makes on site for it in this phase, its own lines, then the items it marks that give
  it no line, each with why, the ones that share a reason under one note (onSiteSummaries and
  onSiteEntriesText in app/on-site-picker.ts, #931, #955), and its part of the handover from the
  phase before (FactoryHandover.vue, #1069). The section's id
  (`section-<group>`) and its heading (`data-section-heading`) are where the jump bar leads.
-->
<script setup lang="ts" generic="T">
import { computed } from 'vue';
import { save } from '../../api.ts';
import {
  calcStage,
  calculated,
  factoryEditing,
  flowRoute,
  sectionCollapsed,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { leaveDraft, resetDraft, useDrafts } from '../draft.ts';
import { whileBusy } from '../../busy.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import CollapseToggle from './CollapseToggle.vue';
import FactoryHandover from './FactoryHandover.vue';
import OnSitePicker from './OnSitePicker.vue';
import { onSiteEntriesText, onSiteSummaries } from '../../on-site-picker.ts';

// The factories to sort into groups (calculated rows), and the key
// their memberships are saved under.
const props = defineProps<{ items: T[]; keyOf: (item: T) => string }>();

const sections = computed(() =>
  legacy(() => {
    const groups = factoryGroupsState();
    // Only drawn outside edit mode, where the picker is not.
    const onSite =
      calculated && !factoryEditing ? onSiteSummaries(calculated, groups, calcStage()) : {};
    return groups.groups
      .map(group => ({
        ...group,
        members: props.items.filter(item =>
          membershipsOf(props.keyOf(item)).some(m => m.group === group.id),
        ),
        collapsed: sectionCollapsed(group.id),
        // What it makes on site (#877) and the marks that give it no line (#931), under its heading,
        // the items that share a note under it once (#955): "Iron Rod and Steel Pipe (needs a
        // recalculation); Water (can't be made on site)".
        made: onSiteEntriesText(onSite[group.id]?.made || []),
        marked: onSiteEntriesText(onSite[group.id]?.marked || []),
      }))
      .filter(section => section.members.length || factoryEditing);
  }),
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
      title: 'Remove this factory?',
      body: 'Remove this factory? Its production lines stay in the list and keep their progress.',
      confirmLabel: 'Remove factory',
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
        <CollapseToggle :section-key="section.id" :label="'Production lines in ' + section.name" />
        <div>
          <span class="eyebrow"
            >FACTORY · {{ section.members.length }}
            {{ section.members.length === 1 ? 'LINE' : 'LINES' }}</span
          ><input
            v-if="editing"
            class="bay-rename"
            :data-group-rename="section.id"
            data-section-heading
            :value="names[section.id]"
            maxlength="80"
            :aria-label="'Rename factory ' + section.name"
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
        Remove factory
      </button>
      <a
        v-else-if="section.members.length > 1"
        class="btn"
        :href="'#' + flowRoute(section.id)"
        :data-group-flow="section.id"
      >
        Build order →
      </a>
    </header>
    <template v-if="!section.collapsed">
      <OnSitePicker v-if="editing" :group-id="section.id" :group-name="section.name" />
      <p
        v-else-if="section.made || section.marked"
        class="small muted on-site-summary"
        data-on-site-items
      >
        <span v-if="section.made" data-on-site-made>Made on site: {{ section.made }}</span>
        <span v-if="section.marked" data-on-site-marked
          >Marked, not made on site: {{ section.marked }}</span
        >
      </p>
      <FactoryHandover :place="section.id" />
    </template>
    <div v-show="!section.collapsed" :id="'cards-' + section.id" class="cards">
      <template v-if="section.members.length"
        ><template v-for="item in section.members" :key="keyOf(item)"
          ><slot name="card" :item="item" :group="section.id" /></template
      ></template>
      <div v-else class="empty-state">
        Empty factory. Add production lines with the factory selector on their cards.
      </div>
    </div>
  </section>
</template>
