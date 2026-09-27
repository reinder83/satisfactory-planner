<!--
  #account. On the server: the signed-in user and "Sign out" (signOut in ui/actions.ts, which the
  sidebar's profile switcher uses too), or the setup form while
  accounts are still off. The browser edition has no accounts, so it shows the backup page.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { workspace } from '../../session.ts';
import { signOut } from '../actions.ts';
import AuthForm from '../AuthForm.vue';
import { legacy } from '../bridge.ts';
import PageHeader from '../PageHeader.vue';
import BackupPage from './BackupPage.vue';

const account = computed(() =>
  legacy(() => ({
    enabled: workspace.accountsEnabled,
    username: workspace.user?.username ?? '',
  })),
);
</script>

<template>
  <BackupPage v-if="browserMode" />
  <template v-else>
    <PageHeader
      eyebrow="YOUR ACCOUNT"
      :title="account.enabled ? account.username : 'User accounts'"
      :subtitle="
        account.enabled
          ? 'Your saves are visible only to your account.'
          : 'Local mode currently shares one workspace. Enable accounts before sharing this server.'
      "
    />
    <section v-if="account.enabled" class="panel">
      <p>Each account has its own named saves, profiles and progress.</p>
      <button class="btn" data-logout @click="signOut">Sign out</button>
      <p class="small muted">
        Use HTTPS when serving this app beyond localhost. Your host manages account access and
        backups.
      </p>
    </section>
    <AuthForm v-else mode="setup" />
  </template>
</template>
