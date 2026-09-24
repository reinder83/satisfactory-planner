<!-- A summary tile (stat() in format.js for the legacy pages). The value slot takes markup
     such as a "/ total" fraction; otherwise `value` is shown as text. -->
<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '' },
  caption: { type: String, default: '' },
});
</script>

<template>
  <div class="stat">
    <span class="eyebrow">{{ label }}</span
    ><strong
      ><slot>{{ value }}</slot></strong
    ><small>{{ caption }}</small>
  </div>
</template>
