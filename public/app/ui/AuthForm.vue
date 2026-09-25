<!--
  The account form (#auth-form). `mode` is 'setup' (turn accounts on for the existing
  workspace, which needs the server's setup token), 'register' or 'login'. Until accounts
  are enabled it posts to /api/setup, otherwise to /api/login or /api/register; boot() then
  reloads the workspace, which shows the planner or the sign-in screen again.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { post } from '../api.ts';
import { authMode, boot, workspace } from '../session.ts';

const props = defineProps<{ mode: 'login' | 'register' | 'setup' }>();
const busy = ref(false);
const error = ref('');

async function submit(e: Event) {
  const form = e.target as HTMLFormElement;
  const data: Record<string, unknown> = Object.fromEntries(new FormData(form));
  data.registration = new FormData(form).has('registration');
  busy.value = true;
  error.value = '';
  try {
    await post('/api/' + (workspace.accountsEnabled ? authMode : 'setup'), data, false);
    await boot();
  } catch (err) {
    error.value = (err as Error).message;
    busy.value = false;
  }
}
</script>

<template>
  <form id="auth-form" class="panel auth-panel" @submit.prevent="submit">
    <h2>
      {{
        props.mode === 'setup'
          ? 'Secure your existing save'
          : props.mode === 'register'
            ? 'Create your account'
            : 'Sign in'
      }}
    </h2>
    <template v-if="props.mode === 'setup'">
      <p>
        Your existing save and progress will belong to this account. Once enabled, visitors must
        sign in.
      </p>
      <label class="field"
        >Server setup token<input name="setupToken" required autocomplete="off"
      /></label>
      <p class="small muted">
        Read account-setup-token.txt in the server data folder. With Docker: docker compose exec
        planner cat /data/account-setup-token.txt
      </p>
    </template>
    <label class="field"
      >Username
      <input
        name="username"
        type="text"
        value=""
        required
        minlength="3"
        maxlength="32"
        pattern="[a-zA-Z0-9_-]+"
        autocomplete="username"
    /></label>
    <label class="field"
      >Password (12–128 characters)
      <input
        name="password"
        type="password"
        value=""
        required
        minlength="12"
        maxlength="128"
        :autocomplete="props.mode === 'login' ? 'current-password' : 'new-password'"
    /></label>
    <label v-if="props.mode === 'setup'" class="check-row"
      ><input type="checkbox" name="registration" />Allow other people to register their own
      accounts</label
    >
    <button class="btn primary" :disabled="busy">
      {{
        props.mode === 'setup'
          ? 'Enable accounts'
          : props.mode === 'register'
            ? 'Create account'
            : 'Sign in'
      }}
    </button>
    <p id="auth-error" class="form-error" role="alert">{{ error }}</p>
  </form>
</template>
