<!--
  #session, "Today's session" (#1073): the next 3 to 5 open builds of the build plan for the phase
  shown, in the order the build plan lists its unfinished steps (sessionView in
  views/session-builds.ts). Each build says what it takes to build (its machines still to build,
  Water Extractors, belts and pipes by mark, and the parts they cost), its power, the raw
  resources it draws and whether the lines feeding it already run; then the builds together, and a
  short note that fits the game's To-Do list (256 characters, todo-note.ts) with a Copy button.
  How many builds it lists is a view preference remembered in this browser (sessionSize in
  session.ts, `planner-session-size`), never saved with the profile. Print prints the page: the
  controls stay off paper (style.css). It reads the stored plan and ticks only: nothing is ticked,
  stored or recalculated here. A milestone-only phase, which plans no lines, says so.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { toast } from '../../api.ts';
import {
  calculated,
  currentProfile,
  phase,
  phaseLabel,
  SESSION_SIZES,
  sessionSize,
  setSessionSize,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { noteLength, TODO_LIMIT } from '../../todo-note.ts';
import { sessionView } from '../../views/session-builds.ts';
import { legacy } from '../bridge.ts';
import PageHeader from '../PageHeader.vue';

const page = computed(() =>
  legacy(() =>
    calculated
      ? {
          title: phaseLabel(phase()),
          profileName: currentProfile.name,
          size: sessionSize,
          view: sessionView(sessionSize),
        }
      : null,
  ),
);

function chooseSize(event: Event) {
  setSessionSize(Number((event.target as HTMLSelectElement).value));
  render();
}

const noteBox = ref<HTMLTextAreaElement | null>(null);
// Copy the To-Do note. Where the browser refuses the clipboard, the note is selected instead so
// Ctrl+C or ⌘C copies it.
async function copyNote() {
  const note = page.value?.view?.note ?? '';
  try {
    await navigator.clipboard.writeText(note);
    toast('To-Do note copied.');
  } catch {
    noteBox.value?.focus();
    noteBox.value?.select();
    toast('The browser did not allow copying: the note is selected, so press Ctrl+C or ⌘C.', true);
  }
}

const print = () => window.print();
</script>

<template>
  <template v-if="page">
    <PageHeader eyebrow="TODAY'S SESSION" :title="page.title" :subtitle="page.profileName" />
    <div class="toolbar session-toolbar">
      <a class="btn quiet" href="#plan" data-session-back>← Build plan</a>
      <label class="session-size"
        >Builds
        <select data-session-size :value="String(page.size)" @change="chooseSize">
          <option v-for="size in SESSION_SIZES" :key="size" :value="String(size)">
            {{ size }}
          </option>
        </select></label
      >
      <button type="button" class="btn" data-session-print @click="print">Print</button>
    </div>
    <p v-if="!page.view" class="notice info" data-session-none>
      {{ page.title }} plans no production lines: its build plan lists the milestones to unlock.
    </p>
    <template v-else>
      <p class="small muted session-intro">
        The next open builds of the build plan, in its order. Tick them there as you build.
      </p>
      <section class="panel session-note">
        <h2>To-Do note</h2>
        <p class="small muted" data-session-note-length>
          For the game's To-Do list: {{ noteLength(page.view.note) }} of {{ TODO_LIMIT }}
          characters.
        </p>
        <textarea
          ref="noteBox"
          class="session-note-text"
          readonly
          rows="6"
          aria-label="To-Do note for the game"
          data-session-note
          :value="page.view.note"
        ></textarea>
        <button type="button" class="btn primary" data-session-copy @click="copyNote">
          Copy note
        </button>
      </section>
      <p v-if="!page.view.builds.length" class="notice info" data-session-empty>
        No open builds left in {{ page.title }}: every production line's step is ticked.
      </p>
      <ol v-else class="session-builds" data-session-builds>
        <li
          v-for="build in page.view.builds"
          :key="build.id"
          class="panel session-build"
          :data-session-build="build.id"
          :data-session-ready="build.readiness"
        >
          <h2>
            <span class="session-no">{{ build.number }}</span> {{ build.title }}
          </h2>
          <p v-if="build.factory" class="small muted">Factory: {{ build.factory }}</p>
          <dl class="session-facts">
            <dt>To build</dt>
            <dd data-session-to-build>{{ build.build }}</dd>
            <dt>Materials</dt>
            <dd data-session-parts>{{ build.parts || 'None in the cost table' }}</dd>
            <dt>Power</dt>
            <dd data-session-power>{{ build.power }}</dd>
            <template v-if="build.raw">
              <dt>Raw resources</dt>
              <dd data-session-raw>{{ build.raw }}</dd>
            </template>
            <dt>Inputs</dt>
            <dd :class="'session-ready ' + build.readiness" data-session-inputs>
              {{ build.ready }}
            </dd>
          </dl>
        </li>
      </ol>
      <section v-if="page.view.builds.length" class="panel" data-session-total>
        <h2>All together</h2>
        <dl class="session-facts">
          <dt>To build</dt>
          <dd>{{ page.view.total.build }}</dd>
          <dt>Materials</dt>
          <dd>{{ page.view.total.parts }}</dd>
          <template v-if="page.view.total.power">
            <dt>Power</dt>
            <dd>{{ page.view.total.power }}</dd>
          </template>
        </dl>
      </section>
      <p v-if="page.view.later" class="small muted" data-session-later>
        {{ page.view.later }} more {{ page.view.later === 1 ? 'build' : 'builds' }} after these in
        the build plan.
      </p>
    </template>
  </template>
</template>
