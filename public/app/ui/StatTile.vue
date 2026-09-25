<!-- A summary tile. The value slot takes markup
     such as a "/ total" fraction; otherwise `value` is shown as text. -->
<script setup lang="ts">
withDefaults(defineProps<{ label: string; value?: string | number; caption?: string }>(), {
  value: '',
  caption: '',
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
