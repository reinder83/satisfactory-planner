<!--
  The sign-in screen, shown in place of the whole app when boot() finds no signed-in user
  (also how sign-out lands here). "Create an account" / "Back to sign in" switches the form,
  offered only when the server allows registration.
-->
<script setup>
import { ref } from 'vue';
import { authMode, setAuthMode, workspace } from '../session.js';
import AuthForm from './AuthForm.vue';

const mode = ref(authMode);
function toggle() {
  mode.value = mode.value === 'login' ? 'register' : 'login';
  setAuthMode(mode.value);
}
</script>

<template>
  <main class="signin">
    <div class="brand"><img src="./favicon.svg" alt="" />Project Assembly</div>
    <h1>Your factory notebook</h1>
    <AuthForm :key="mode" :mode="mode" />
    <button
      v-if="workspace.registration"
      class="btn quiet"
      :data-auth-mode="mode === 'login' ? 'register' : 'login'"
      @click="toggle"
    >
      {{ mode === 'login' ? 'Create an account' : 'Back to sign in' }}
    </button>
  </main>
</template>
