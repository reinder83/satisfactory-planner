<!--
  The "Comes in" row at the top of a factory's build order page (BO-3, #1346): one chip per input
  the factory takes from outside, with its item, rate, where it comes from and the belts or pipes
  it takes ("Iron Ore 2,865/min · Raw resource · 5 belts"). An input a running line is short of
  (heldBack, the factories page's "Running at 0%: short of Plastic", #1342) takes the problem
  colour and says so in words, with what arrives of the rate: "Plastic 0 of 105/min · not
  arriving". It is shown on the phase on screen only; another phase's tab has no running lines to
  hold back (ComesIn in views/group-flow-page.ts).
-->
<script setup lang="ts">
import { itemRate } from '../../flow.ts';
import { num } from '../../format.ts';
import { placeWords, type ComesIn } from '../../views/group-flow-page.ts';
import ItemIcon from '../ItemIcon.vue';

defineProps<{ items: ComesIn[] }>();

const rateText = (entry: ComesIn) =>
  entry.arriving === null
    ? itemRate(entry.port.item, entry.port.rate)
    : `${num(entry.arriving)} of ${itemRate(entry.port.item, entry.port.rate)}`;
</script>

<template>
  <section v-if="items.length" class="gf-band gf-comes" aria-labelledby="gf-in-h" data-gf-comes-in>
    <h2 id="gf-in-h" class="gf-colcap">Comes in</h2>
    <ul class="gf-comes-list">
      <li
        v-for="entry in items"
        :key="entry.port.place + entry.port.item"
        :class="['gf-comes-item', entry.state === 'ok' ? '' : 'problem']"
        :data-comes-in="entry.port.item"
        :data-arriving="entry.state"
      >
        <ItemIcon :name="entry.port.item" />
        <span class="gf-comes-text"
          ><b>{{ entry.port.item }}</b>
          <span class="gf-comes-rate">{{ rateText(entry) }}</span>
          <span v-if="entry.state !== 'ok'" class="gf-comes-flag"
            ><span aria-hidden="true">⚠ </span
            >{{ entry.state === 'none' ? 'not arriving' : 'short' }}</span
          >
          <small class="muted"
            >{{ placeWords(entry.port)
            }}<template v-if="entry.port.belts"> · {{ entry.port.belts }}</template></small
          ></span
        >
      </li>
    </ul>
  </section>
</template>
