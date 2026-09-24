<!-- The workshop floor's panel: a fixed checklist with the saved keys `workshop-<id>`. -->
<script setup>
import StorageChecklist from './StorageChecklist.vue';

const STEPS = [
  ['bench', 'Craft Bench and Equipment Workshop', 'Side by side near the entrance.'],
  ['tools', 'Tools and mobility equipment', 'Personal boxes on the left wall.'],
  [
    'weapons',
    'Weapons and spare wearables',
    'Personal boxes on the right wall. Ammo and filters stay in G/H.',
  ],
  [
    'mam',
    'MAM and inventory drop',
    'Rear wall, with collected items routed to Q/R. Finish the sorter at a recovery chest.',
  ],
].map(([id, title, body]) => ({ id: 'workshop-' + id, title, body }));
</script>

<template>
  <div class="panel">
    <span class="eyebrow">GROUND-FLOOR REAR EXTENSION</span>
    <h2 style="margin-top: 10px">Workshop beneath Q/R</h2>
    <p>
      The upper floor gets the new storage bays; the space underneath becomes your crafting area. No
      existing production-container addresses change.
    </p>
    <StorageChecklist :steps="STEPS" />
  </div>
</template>
