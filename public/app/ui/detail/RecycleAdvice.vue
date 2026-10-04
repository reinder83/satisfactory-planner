<!--
  The byproduct advice in a calculated factory's dialog (#1022), under the flow: one paragraph
  per byproduct of the line (where to send it) and per input of the line a byproduct covers
  (where it comes from), from rowAdvice (views/calculated.ts, worded by recycle.ts) for the phase
  shown. A paragraph for extracted Water ends with the Water Extractors for it on a line of its
  own (#1024), and the heading says Water when the notice has any: "Water" when that is all it
  has, else "Byproducts and water". Each other line it names is a link to that line's dialog (factoryLink), kept on one line
  with the punctuation right after it, since a button wraps as a whole. Group and line names are
  user text, rendered as text. Draws nothing for a line without either.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage } from '../../session.ts';
import { rowAdvice } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';
import { NO_COVER } from '../../recycle.ts';
import type { AdvicePart } from '../../recycle.ts';

const props = defineProps<{ id: string }>();

// A paragraph's pieces: text, or a link with the punctuation that follows it (`tail`).
type Piece = { text: string } | { row: string; name: string; tail: string };

const pieces = (parts: AdvicePart[]): Piece[] =>
  parts.flatMap((part, i): Piece[] => {
    const before = parts[i - 1];
    if (typeof part !== 'string') {
      const next = parts[i + 1];
      const tail = typeof next === 'string' ? (/^[,.;]/.exec(next)?.[0] ?? '') : '';
      return [{ row: part.row, name: part.text, tail }];
    }
    const text = typeof before === 'object' ? part.replace(/^[,.;]/, '') : part;
    return text ? [{ text }] : [];
  });

const lines = computed(() =>
  legacy(() => {
    const row = calcStage()?.rows?.find(candidate => candidate.id === props.id);
    return (row ? rowAdvice(row) : []).map(line => ({ ...line, pieces: pieces(line.parts) }));
  }),
);
// Only extracted Water no byproduct covers: "Water". Extractors with anything else: "Byproducts
// and water". Otherwise "Byproducts".
const heading = computed(() => {
  const water = lines.value.some(line => line.extractors);
  const recycled = lines.value.some(line => line.parts[0] !== NO_COVER);
  return water ? (recycled ? 'Byproducts and water' : 'Water') : 'Byproducts';
});
</script>

<template>
  <template v-if="lines.length"
    ><h3>{{ heading }}</h3>
    <div class="notice info recycle-advice" data-recycle-advice>
      <p v-for="line in lines" :key="line.kind + '|' + line.item" :data-advice="line.kind">
        <b>{{ line.kind === 'byproduct' ? 'Byproduct' : 'Input' }} · {{ line.lead }}</b
        ><br /><template v-for="(piece, i) in line.pieces" :key="i"
          ><template v-if="'text' in piece">{{ piece.text }}</template
          ><span v-else class="recycle-name"
            ><button
              type="button"
              class="recycle-link"
              v-bind="factoryLink({ calcFactory: piece.row })"
              v-text="piece.name + ' ↗'"
            ></button
            >{{ piece.tail }}</span
          ></template
        ><template v-if="line.extractors"
          ><br /><span data-extractors>{{ line.extractors }}</span></template
        >
      </p>
    </div></template
  >
</template>
