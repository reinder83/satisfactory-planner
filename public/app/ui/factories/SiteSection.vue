<!-- A shared site on a factories page (the handbook's oil campus and nuclear site, and a plan
     guide's, #468): a collapsible section of the cards built together there. The page works out
     the site (siteEntry in views/factories.ts) and draws its cards in the slot. -->
<script setup lang="ts">
import CollapseToggle from './CollapseToggle.vue';
import type { SiteEntry } from '../../views/factories.ts';

defineProps<{ site: SiteEntry }>();
</script>

<template>
  <section :id="'section-' + site.key" :class="['site-group', site.collapsed ? 'collapsed' : '']">
    <header class="site-head">
      <div class="site-title">
        <CollapseToggle :section-key="site.key" :label="'Outputs of ' + site.label" />
        <div>
          <span class="eyebrow">SHARED SITE · {{ site.count }} OUTPUTS</span>
          <h2 tabindex="-1" data-section-heading>{{ site.label }}</h2>
        </div>
      </div>
      <p class="small muted">{{ site.sub }}</p>
    </header>
    <div v-show="!site.collapsed" :id="'cards-' + site.key" class="cards"><slot /></div>
  </section>
</template>
