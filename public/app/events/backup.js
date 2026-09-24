// Delegated DOM event handlers for exporting and importing full saves.
import { navigate, post, toast, writeQueue } from '../api.js';
import { boot } from '../session.js';

document.addEventListener('change', async e => {
  if (e.target.id !== 'import-saves' || !e.target.files[0]) return;
  const file = e.target.files[0];
  try {
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
    e.target.value = '';
  }
});
