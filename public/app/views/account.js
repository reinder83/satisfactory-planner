// Account setup, sign-in and sign-out (Docker edition).
import { browserMode } from '../../browser-api.js';
import { $, esc } from '../format.js';
import { authMode, setState, workspace } from '../session.js';
import { header } from '../shell.js';
import { renderBrowserBackup } from './backup.js';
import { field } from '../wizard/fields.js';

// HTML for the #auth-form (submitted in events/profiles.js). `mode` is 'setup' (turn
// accounts on for the existing workspace, which needs the server's setup token),
// 'register' or 'login'.
function authForm(mode) {
  return `<form id="auth-form" class="panel auth-panel"><h2>${mode === 'setup' ? 'Secure your existing save' : mode === 'register' ? 'Create your account' : 'Sign in'}</h2>${mode === 'setup' ? '<p>Your existing save and progress will belong to this account. Once enabled, visitors must sign in.</p><label class="field">Server setup token<input name="setupToken" required autocomplete="off"></label><p class="small muted">Read account-setup-token.txt in the server data folder. With Docker: docker compose exec planner cat /data/account-setup-token.txt</p>' : ''}${field('Username', 'username', '', 'text', 'required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" autocomplete="username"')}${field('Password (12–128 characters)', 'password', '', 'password', 'required minlength="12" maxlength="128" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '"')}${mode === 'setup' ? '<label class="check-row"><input type="checkbox" name="registration">Allow other people to register their own accounts</label>' : ''}<button class="btn primary">${mode === 'setup' ? 'Enable accounts' : mode === 'register' ? 'Create account' : 'Sign in'}</button><p id="auth-error" class="form-error" role="alert"></p></form>`;
}

// HTML for #account. The browser edition has no accounts, so it shows the backup page.
// On the server: the signed-in user and a `data-logout` button (events/views.js), or the
// setup form while accounts are still off.
export function renderAccount() {
  if (browserMode) return renderBrowserBackup();
  return (
    header(
      'YOUR ACCOUNT',
      workspace.accountsEnabled ? esc(workspace.user.username) : 'User accounts',
      workspace.accountsEnabled
        ? 'Your saves are visible only to your account.'
        : 'Local mode currently shares one workspace. Enable accounts before sharing this server.',
    ) +
    (workspace.accountsEnabled
      ? '<section class="panel"><p>Each account has its own named saves, profiles and progress.</p><button class="btn" data-logout>Sign out</button><p class="small muted">Use HTTPS when serving this app beyond localhost. Your host manages account access and backups.</p></section>'
      : authForm('setup'))
  );
}

// Replaces the whole app with the sign-in screen, bypassing the shell's render(). Called when
// boot() in session.js finds no signed-in user (also how sign-out lands here), and again
// when `data-auth-mode` (events/views.js) toggles between sign-in and registration, which
// is offered only when the server allows registration. Clears the open profile's state.
export function renderSignedOut() {
  setState(null);
  $('#app').innerHTML =
    `<main class="signin"><div class="brand"><img src="./favicon.svg" alt="">Project Assembly</div><h1>Your factory notebook</h1>${authForm(authMode)}${workspace.registration ? `<button class="btn quiet" data-auth-mode="${authMode === 'login' ? 'register' : 'login'}">${authMode === 'login' ? 'Create an account' : 'Back to sign in'}</button>` : ''}</main>`;
}
