<!--
  One section per user group on a factories page, holding the entries of `items` assigned to
  it; `keyOf` gives an entry's assignment key and the `card` slot draws its card for a group.
  An empty group is hidden unless groups are being edited. While editing, a group can be
  renamed (saved when the field is committed, then redrawn with the saved name either way) or
  removed; otherwise a group with more than one factory links to its build order, the group's flow
  page (#factories/<group>/flow, GroupFlowPage.vue, #895). It is a link, not a button: it goes to
  another page, so it can open in a new tab and the address can be shared. Before it, "Mark all
  running" marks every line of the group running at once, or its reverse (GroupRunning.vue,
  #1163), and "Flow graph ↗", on any group with a line, opens the group's flow graph in the
  #detail dialog (FlowGraphDialog.vue, #1192), and "Export to Satisfactory Tools" writes its lines
  in the phase shown as a .sft file for satisfactorytools.com (app/sft-download.ts, #1209). Each
  group can be
  folded (CollapseToggle.vue, SP-17): its header stays, its cards go. Unfolded, a group shows its
  "Made on site" picker above its cards while editing (OnSitePicker.vue, #877), and otherwise what
  the open plan makes on site for it in this phase, its own lines, then the items it marks that give
  it no line, each with why, the ones that share a reason under one note (onSiteSummaries and
  onSiteEntriesText in app/on-site-picker.ts, #931, #955), and its part of the handover from the
  phase before (FactoryHandover.vue, #1069). A factory's owner (#1199) is a line under its name,
  "Owner: Anna", with "(you)" when it is the name this device goes by (app/mine.ts); while editing it
  is a field under the name field, saved as the `factoryGroupOwner` update when committed, a blank
  one meaning nobody. Outside edit mode, a muted line under it gives the factory's machines in the
  phase shown and each later phase of the plan, with a rough footprint in foundations, labelled
  as an estimate from machine footprints only (groupGrowth in app/later-phases.ts, #1299), so
  room can be left for what it grows to. Above it, the machines built of the phase shown, "312 /
  641 machines built" (`data-group-built`, #1300): each line's built-machines counter, a line split
  over several factories by its share in this one. The section's id
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
  stage,
} from '../../session.ts';
import { FOOTPRINT_NOTE } from '../../footprints.ts';
import { groupGrowth, groupGrowthText } from '../../later-phases.ts';
import { groupCountText } from '../../built-lines.ts';
import { rowPlaces } from '../../group-order.ts';
import type { FactoryGroups } from '../../../types/index.ts';
import { render } from '../../shell.ts';
import { factoryGroupsState, membershipsOf } from '../../views/factories.ts';
import { groupBuiltCount } from '../../views/calculated.ts';
import { openFlowGraph } from '../../factory-detail.ts';
import { exportGroupToSft } from '../../sft-download.ts';
import { legacy } from '../bridge.ts';
import { leaveDraft, resetDraft, useDrafts } from '../draft.ts';
import { whileBusy } from '../../busy.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import CollapseToggle from './CollapseToggle.vue';
import FactoryHandover from './FactoryHandover.vue';
import GroupRunning from './GroupRunning.vue';
import OnSitePicker from './OnSitePicker.vue';
import { onSiteEntriesText, onSiteSummaries } from '../../on-site-picker.ts';
import { meName, sameOwner } from '../../mine.ts';
import { OWNER_MAX } from '../../../state.ts';

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
        // Its machines in the phase shown and each later one, with a rough footprint (#1299):
        // "Phase 3: 41 machines, ≈ 60 foundations · Phase 4: 97, ≈ 140". The whole factory,
        // whatever the search and chips show; outside edit mode only.
        growth: growthOf(group.id, groups),
        // Its machines built in the phase shown (#1300): "312 / 641 machines built".
        built: builtOf(group.id, groups),
        // Its owner (#1199), and whether that is the name this device goes by.
        owner: group.owner || '',
        mine: sameOwner(group.owner, meName()),
      }))
      .filter(section => section.members.length || factoryEditing);
  }),
);
const editing = computed(() => legacy(() => factoryEditing));

// A factory's size now and in the later phases of the plan (groupGrowth in later-phases.ts,
// #1299), '' while editing or when it has no machine in any of them.
function growthOf(groupId: string, groups: FactoryGroups): string {
  if (!calculated || factoryEditing) return '';
  return groupGrowthText(groupGrowth(calculated, stage(), groupId, groups));
}

// A factory's machines built and needed in the phase shown (#1300, groupBuiltCount), '' while
// editing or when it has no machine in it.
function builtOf(groupId: string, groups: FactoryGroups): string {
  if (!calculated || factoryEditing) return '';
  const count = groupBuiltCount(groupId, row => rowPlaces(row, groups).get(groupId) ?? 0);
  return count.needed >= 0.5 ? groupCountText(count) : '';
}

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

// "Export to Satisfactory Tools" (#1209): the group's .sft file in the phase shown, the button
// busy while the browser packs it (app/busy.ts, #299).
function exportSft(event: Event, id: string) {
  return whileBusy(event.currentTarget as HTMLButtonElement, () => exportGroupToSft(id));
}

// The groups' owner fields (#1199) keep what is typed across redraws the same way.
const savedOwners = () =>
  Object.fromEntries(sections.value.map(section => [section.id, section.owner]));
const owners = useDrafts(savedOwners);

// A group's owner field: saved when committed, a blank one meaning nobody, then redrawn with the
// saved owner whether or not the save worked.
function setOwner(event: Event, id: string) {
  const input = event.target as HTMLInputElement;
  return whileBusy(input, async () => {
    try {
      await save({ type: 'factoryGroupOwner', id, owner: input.value });
    } catch {
    } finally {
      render();
      const owner = savedOwners()[id];
      if (owner !== undefined) resetDraft(owners, id, owner);
    }
  });
}

// "Remove group", after a confirmation: only the group goes; its factories and their
// progress stay. Focus then goes to the next group's name field, else the previous one's, else
// the new group field (ui/refocus.ts, #286); never to a Remove factory (#1255).
async function remove(event: Event, id: string) {
  const refocus = refocusAfterRemoval(event.currentTarget, {
    row: '#main .user-group',
    control: '[data-section-heading]',
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
          <label v-if="editing" class="group-owner-field small"
            >Owner<input
              :data-group-owner-input="section.id"
              :value="owners[section.id]"
              :maxlength="OWNER_MAX"
              placeholder="Nobody"
              :aria-label="'Owner of ' + section.name"
              @input="owners[section.id] = ($event.target as HTMLInputElement).value"
              @change="setOwner($event, section.id)"
              @blur="leaveDraft(owners, section.id, $event)"
          /></label>
          <p v-else-if="section.owner" class="small muted group-owner" data-group-owner>
            Owner: {{ section.owner }}<template v-if="section.mine"> (you)</template>
          </p>
          <p v-if="section.built" class="small group-built" data-group-built>
            {{ section.built }}
          </p>
          <p v-if="section.growth" class="small muted group-growth" data-group-growth>
            <span data-group-growth-phases>{{ section.growth }}</span>
            <span class="group-growth-note">{{ FOOTPRINT_NOTE }}</span>
          </p>
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
      <div v-else class="site-actions">
        <GroupRunning :group-id="section.id" :group-name="section.name" /><button
          v-if="section.members.length"
          type="button"
          class="btn"
          :data-group-graph="section.id"
          :aria-label="'Flow graph of ' + section.name"
          @click="openFlowGraph(section.id)"
        >
          Flow graph ↗</button
        ><button
          v-if="section.members.length"
          type="button"
          class="btn"
          :data-group-sft="section.id"
          :aria-label="'Export ' + section.name + ' to Satisfactory Tools'"
          @click="exportSft($event, section.id)"
        >
          Export to Satisfactory Tools</button
        ><a
          v-if="section.members.length > 1"
          class="btn"
          :href="'#' + flowRoute(section.id)"
          :data-group-flow="section.id"
        >
          Build order →
        </a>
      </div>
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
