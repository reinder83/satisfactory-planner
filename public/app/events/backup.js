// Delegated DOM event handlers for exporting and importing full saves.
import { navigate, post, toast, writeQueue } from '../api.js';
import { boot } from '../session.js';

// Change on the hidden #import-saves file input ("Import saves" in the Backup page's
// "Full saves & transfer" panel, both editions). Registered last (see public/app.js);
// the progress-only restore picker, #import-file, is handled in events/views.js.
// Imports every save in the file as new copies with new ids, after a confirmation, so
// existing saves are never replaced. It waits for queued saves, then reloads the whole
// workspace with boot() and shows the profiles page. The success toast only follows a
// successful import; any failure (too large, not JSON, refused by the server) is a toast.
document.addEventListener('change', async e => {
  if (e.target.id !== 'import-saves' || !e.target.files[0]) return;
  const file = e.target.files[0];
  try {
    // Checked before reading, so a huge file is never parsed.
    if (file.size > 50 * 1024 * 1024) throw Error('Choose a save export smaller than 50 MB.');
    const data = JSON.parse(await file.text());
    if (!confirm('Import these saves as new copies? Existing saves will be kept.')) return;
    await writeQueue;
    await post('/api/import-saves', data, false);
    await boot();
    navigate('profiles');
    toast('Imported saves. Existing progress was kept.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    // Clear the picker either way so choosing the same file again fires change again.
    e.target.value = '';
  }
});
