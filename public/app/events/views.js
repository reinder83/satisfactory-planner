// Delegated DOM event handlers for the planner views: checklist, factories,
// storage, dialogs and navigation.
import { knownWorld, nodePresets, presetSurvey } from '../../preferences.js';
import { bayCapacity } from '../../state.js';
import {
  adaClearFault,
  adaCurrent,
  adaFault,
  adaIndex,
  adaMuted,
  adaPoke,
  adaStore,
  setAdaIndex,
  setAdaMuted,
} from '../ada-panel.js';
import {
  allowSwitch,
  downloadJson,
  navigate,
  pending,
  post,
  request,
  save,
  scopeHeaders,
  toast,
  writeQueue,
} from '../api.js';
import { openFactory, openGroupChain } from '../factory-detail.js';
import { $, num, slug } from '../format.js';
import {
  boot,
  calculated,
  currentProfile,
  factoryEditing,
  floor,
  layoutEditing,
  loadContext,
  phase,
  plan,
  planEditing,
  setActiveDetail,
  setAuthMode,
  setEditingTask,
  setFactoryEditing,
  setFactoryFilter,
  setFloor,
  setHideDone,
  setLayoutEditing,
  setPlanEditing,
  setQuery,
  setState,
  setView,
  setWizard,
  setWorkspace,
  state,
  wizard,
  workspace,
} from '../session.js';
import { render } from '../shell.js';
import { autoTaskLink, basePlanTasks, planTasks } from '../tasks.js';
import { renderSignedOut } from '../views/account.js';
import { calculatedDelivery, openCalculatedFactory } from '../views/calculated.js';
import { membershipsOf } from '../views/factories.js';
import { nextBayLetter, openSlot, slotKeys, storageBays } from '../views/storage.js';
import {
  extractionOf,
  leaveExtraction,
  moveExtraction,
  openExtraction,
  readExtraction,
  resetExtraction,
  undoExtractionReset,
} from '../wizard/extraction.js';
import { moveGuided, readGuidedForm, toAdvanced, toGuided } from '../wizard/guided.js';
import { alternatesUsed, openAltRecipe } from '../wizard/recipes.js';
import {
  hideSupplyOptions,
  pickSupplyOption,
  showSupplyOptions,
  supplyRows,
  syncSupplyIcon,
} from '../wizard/supply.js';
import {
  calcProgress,
  moveWizard,
  readWizard,
  startWizard,
  wizardError,
} from '../wizard/wizard.js';

// The badge is decoration, not a control: it is hidden from assistive software
// and nothing is only reachable through it.
document.addEventListener('click', e => {
  if (e.target.closest('.ada-mark') && !adaMuted) adaPoke();
});

document.addEventListener('click', async e => {
  const target = e.target.closest('button,a');
  if (!target) return;
  if (target.hasAttribute('data-close')) {
    $('#detail').close();
    setActiveDetail(null);
  }
  if (target.dataset.factory) openFactory(target.dataset.factory);
  if (target.dataset.slot) openSlot(target.dataset.slot);
  if (target.dataset.completeBay) {
    const bay = storageBays().find(b => b.id === target.dataset.completeBay);
    if (bay) {
      target.disabled = true;
      try {
        await save({
          type: 'checks',
          keys: bay.items.filter(x => x.name).flatMap(x => slotKeys(x.id)),
          value: true,
        });
        render();
        toast('Room ' + bay.id + ' completed. You can uncheck individual containers if needed.');
      } catch {
      } finally {
        target.disabled = false;
      }
    }
  }
  if (target.dataset.floor) {
    setFloor(target.dataset.floor);
    setQuery('');
    render();
  }
  if (target.hasAttribute('data-ada-next')) {
    // A fault redraws the whole panel, since the name above the line changes too.
    if (adaFault) {
      adaClearFault();
      render();
    } else {
      setAdaIndex(adaIndex + 1);
      const r = adaCurrent(),
        line = $('#ada-line');
      if (r && line) {
        line.textContent = r.text;
        const host = line.closest('.ada');
        if (host) host.dataset.tone = r.tone;
      }
    }
  }
  if (target.dataset.adaMute) {
    setAdaMuted(target.dataset.adaMute === 'on');
    adaStore();
    adaClearFault();
    render();
  }
  if (target.hasAttribute('data-toggle-layout')) {
    setLayoutEditing(!layoutEditing);
    render();
  }
  if (target.hasAttribute('data-toggle-plan-edit')) {
    setPlanEditing(!planEditing);
    setEditingTask(null);
    render();
  }
  if (target.hasAttribute('data-toggle-factory-edit')) {
    setFactoryEditing(!factoryEditing);
    render();
  }
  if (target.dataset.moveTask) {
    const ids = planTasks().map(t => t.id),
      i = ids.indexOf(target.dataset.moveTask),
      j = i + Number(target.dataset.dir);
    if (i >= 0 && j >= 0 && j < ids.length) {
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try {
        await save({ type: 'taskOrder', phase: phase(), ids });
        render();
      } catch {}
    }
  }
  if (target.dataset.editTask) {
    setEditingTask(target.dataset.editTask);
    render();
  }
  if (target.hasAttribute('data-cancel-task-edit')) {
    setEditingTask(null);
    render();
  }
  if (target.dataset.removeStep) {
    const id = target.dataset.removeStep;
    if (id.startsWith('custom-')) {
      if (confirm('Delete this personal task?')) {
        try {
          await save({ type: 'removeTask', id });
          render();
        } catch {}
      }
    } else if (
      confirm(
        'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.',
      )
    ) {
      try {
        await save({ type: 'taskRemove', id });
        render();
      } catch {}
    }
  }
  if (target.dataset.restoreTask) {
    try {
      await save({ type: 'taskRestore', id: target.dataset.restoreTask });
      render();
    } catch {}
  }
  if (
    target.dataset.removeGroup &&
    confirm('Remove this group? The factories stay in the list and keep their progress.')
  ) {
    try {
      await save({ type: 'factoryGroupRemove', id: target.dataset.removeGroup });
      render();
    } catch {}
  }
  if (target.dataset.unassign) {
    const key = target.dataset.unassign,
      groups = membershipsOf(key)
        .filter(m => m.group !== target.dataset.group)
        .map(m => ({ group: m.group, rate: m.rate }));
    try {
      await save({ type: 'factoryAssign', key, groups });
      render();
    } catch {}
  }
  if (target.dataset.clearSlot) {
    target.disabled = true;
    try {
      await save({ type: 'storageSlotClear', key: target.dataset.clearSlot });
      render();
      toast('Container cleared. Its saved checkmarks are kept with the address.');
    } catch {
      target.disabled = false;
    }
  }
  if (
    target.dataset.removeBay &&
    confirm('Remove this added bay? Saved checkmarks for its addresses are kept.')
  ) {
    target.disabled = true;
    try {
      await save({ type: 'storageBayRemove', id: target.dataset.removeBay });
      render();
    } catch {
      target.disabled = false;
    }
  }
  if (target.dataset.removeFloor && confirm('Remove this added floor?')) {
    target.disabled = true;
    try {
      await save({ type: 'storageFloorRemove', id: target.dataset.removeFloor });
      setFloor('ground');
      render();
    } catch {
      target.disabled = false;
    }
  }
  if (target.dataset.saveNote) {
    const noteDialog = target.closest('dialog');
    target.disabled = true;
    try {
      await save({
        type: 'note',
        key: target.dataset.saveNote,
        value: document.getElementById(target.dataset.input).value,
      });
      if (noteDialog?.open && noteDialog.contains(target)) {
        noteDialog.close();
        setActiveDetail(null);
      }
      toast('Notes saved.');
    } catch {
    } finally {
      target.disabled = false;
    }
  }
  if (target.dataset.remove && confirm('Delete this personal task?')) {
    try {
      await save({ type: 'removeTask', id: target.dataset.remove });
      render();
    } catch {}
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.completeSlot) {
    const value = el.checked;
    el.disabled = true;
    try {
      await save({ type: 'checks', keys: slotKeys(el.dataset.completeSlot), value });
      render();
    } catch {
      el.checked = !value;
    } finally {
      el.disabled = false;
    }
  }
  if (el.dataset.check) {
    const value = el.checked;
    el.disabled = true;
    try {
      await save({ type: 'check', key: el.dataset.check, value });
      render();
    } catch {
      el.checked = !value;
    } finally {
      el.disabled = false;
    }
  }
  if (el.id === 'phase-picker') {
    el.disabled = true;
    try {
      await save({ type: 'phase', value: el.value });
      setQuery('');
      render();
    } catch {
      el.value = phase();
    } finally {
      el.disabled = false;
    }
  }
  if (el.id === 'factory-filter') {
    setFactoryFilter(el.value);
    render();
  }
  if (el.id === 'hide-done') {
    setHideDone(el.checked);
    render();
  }
  if (['recipes', 'mainPower', 'pureIngots'].includes(el.name) && wizard && $('#wizard-form')) {
    readWizard($('#wizard-form'));
    render();
  }
  if (
    wizard?.mode === 'guided' &&
    $('#wizard-form') &&
    (String(el.name).startsWith('guided:') || el.name === 'topup' || el.name === 'topic')
  ) {
    readGuidedForm($('#wizard-form'));
    render();
  }
  if (
    wizard?.mode === 'extraction' &&
    $('#wizard-form') &&
    /^(mark|clock|purity|distribution|node:|well:|used:)/.test(String(el.name))
  ) {
    readExtraction($('#wizard-form'));
    if (['purity', 'distribution'].includes(el.name)) {
      const s = wizard.settings;
      if (knownWorld(s.purity, s.distribution))
        wizard.extraction = presetSurvey(s.purity, extractionOf(wizard), s.distribution);
    }
    render();
  }
  if (['supplyItem', 'supplyRate'].includes(el.name) && wizard && $('#wizard-form')) {
    hideSupplyOptions(el);
    wizard.mode === 'guided' ? readGuidedForm($('#wizard-form')) : readWizard($('#wizard-form'));
    render();
  }
  if (el.name === 'alt') {
    const p = el.closest('.alt-picker');
    const head = p?.querySelector('.alt-picker-head b');
    if (head)
      head.textContent = `Alternate recipes · ${p.querySelectorAll('input[name=alt]:checked').length} selected`;
    const star = el.closest('.alt-row')?.querySelector('input[name=altpref]');
    if (star) {
      star.disabled = !el.checked;
      if (!el.checked) star.checked = false;
    }
  }
  if (el.dataset.bayRename) {
    el.disabled = true;
    try {
      await save({ type: 'storageBayRename', id: el.dataset.bayRename, name: el.value });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  if (el.dataset.groupRename) {
    el.disabled = true;
    try {
      await save({ type: 'factoryGroupRename', id: el.dataset.groupRename, name: el.value });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  if (el.dataset.assignAdd && el.value) {
    const key = el.dataset.assignAdd,
      groups = [
        ...membershipsOf(key).map(m => ({ group: m.group, rate: m.rate })),
        { group: el.value, rate: null },
      ];
    el.disabled = true;
    try {
      await save({ type: 'factoryAssign', key, groups });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  if (el.dataset.assignRate) {
    const key = el.dataset.assignRate,
      raw = el.value.trim();
    let rate = null;
    if (raw !== '') {
      rate = Number(raw);
      if (!Number.isFinite(rate) || rate <= 0) {
        toast(
          'Enter a rate above 0, or leave the field empty for the whole output or the remainder.',
          true,
        );
        render();
        return;
      }
    }
    const groups = membershipsOf(key).map(m =>
      m.group === el.dataset.group ? { group: m.group, rate } : { group: m.group, rate: m.rate },
    );
    el.disabled = true;
    try {
      await save({ type: 'factoryAssign', key, groups });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  if (el.dataset.delivery) {
    const d = calculated
        ? calculatedDelivery(el.dataset.delivery)
        : plan.deliveries.find(x => x.id === el.dataset.delivery),
      v = Number(el.value);
    if (!Number.isInteger(v) || v < 0 || v > d.target) {
      toast('Enter a whole number between 0 and ' + num(d.target) + '.', true);
      el.value = state.deliveries[d.id] ?? (currentProfile.id === 'original' ? d.initial : 0);
      return;
    }
    try {
      await save({ type: 'delivery', key: d.id, value: v });
      render();
    } catch {
      el.value = state.deliveries[d.id] ?? (currentProfile.id === 'original' ? d.initial : 0);
    }
  }
  if (el.id === 'import-file' && el.files[0]) {
    const file = el.files[0];
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a backup smaller than 2 MB.');
      const data = JSON.parse(await file.text());
      if (!confirm('Replace current progress with this backup?')) {
        el.value = '';
        return;
      }
      await writeQueue;
      setState(
        await request('/api/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Planner-Request': '1',
            ...scopeHeaders(),
          },
          body: JSON.stringify(data),
        }),
      );
      render();
      toast('Backup restored.');
    } catch (err) {
      toast(err.message || 'Could not restore backup.', true);
      el.value = '';
    }
  }
});

document.addEventListener('input', e => {
  if (['factory-search', 'storage-search', 'plan-search'].includes(e.target.id)) {
    setQuery(e.target.value);
    render();
  }
  if (e.target.id === 'alt-filter') {
    const q = e.target.value.trim().toLowerCase();
    for (const row of document.querySelectorAll('.alt-row'))
      row.hidden = q !== '' && !row.dataset.altText.includes(q);
  }
  if (e.target.id === 'rate-filter') {
    const q = e.target.value.trim().toLowerCase();
    for (const row of document.querySelectorAll('.rate-row'))
      row.hidden = q !== '' && !row.dataset.rateText.includes(q);
  }
  // Each per-item box shows the rate its group would give it, so editing either
  // group rate has to refresh the placeholders the list is already showing.
  if (['buildRate', 'storageRate'].includes(e.target.name)) refreshRatePlaceholders();
});

function refreshRatePlaceholders() {
  const rows = document.querySelectorAll('.rate-row');
  if (!rows.length) return;
  const read = name => {
    const value = document.querySelector('[name=' + name + ']')?.value;
    return value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  };
  const general = read('storageRate'),
    build = read('buildRate') ?? general;
  for (const row of rows) {
    const rate =
      row.dataset.rateGroup === 'delivered'
        ? 0
        : row.dataset.rateGroup === 'build'
          ? build
          : general;
    const input = row.querySelector('input');
    if (input && rate !== null) input.placeholder = num(rate);
  }
}

// The item search: suggestions as you type, with the keyboard alone if you like.
document.addEventListener('input', e => {
  if (e.target?.name === 'supplyItem' && wizard) {
    syncSupplyIcon(e.target);
    showSupplyOptions(e.target);
  }
});

document.addEventListener('keydown', e => {
  const input = e.target;
  if (input?.name !== 'supplyItem' || !wizard) return;
  const box = input.closest('.supply-field')?.querySelector('.supply-options');
  const options = box && !box.hidden ? [...box.querySelectorAll('.supply-option')] : [];
  if (e.key === 'Escape') {
    if (options.length) {
      e.preventDefault();
      hideSupplyOptions(input);
    }
    return;
  }
  if (e.key === 'ArrowDown' && !options.length) {
    showSupplyOptions(input);
    e.preventDefault();
    return;
  }
  if (!options.length) return;
  const at = options.findIndex(o => o.getAttribute('aria-selected') === 'true');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next =
      e.key === 'ArrowDown' ? (at + 1) % options.length : at <= 0 ? options.length - 1 : at - 1;
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    options[next].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    // Enter picks the highlighted suggestion rather than submitting the step.
    e.preventDefault();
    pickSupplyOption(options[at >= 0 ? at : 0]);
  }
});

// Leaving the row closes its list; moving inside it (input to suggestion) does not.
document.addEventListener('focusout', e => {
  const input = e.target;
  if (input?.name !== 'supplyItem') return;
  const field = input.closest('.supply-field');
  if (field && !field.contains(e.relatedTarget)) hideSupplyOptions(input);
});

document.addEventListener('submit', async e => {
  if (e.target.id === 'add-task') {
    e.preventDefault();
    const title = new FormData(e.target).get('title').trim();
    if (!title) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await save({
        type: 'addTask',
        id:
          'custom-' +
          Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        phase: phase(),
        title,
      });
      render();
    } catch {
      btn.disabled = false;
    }
  }
});

document.addEventListener('submit', async e => {
  const f = e.target,
    read = () => String(new FormData(f).get('name') || '').trim();
  if (f.id === 'add-floor') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    try {
      await save({
        type: 'storageFloorAdd',
        id:
          'cf-' +
          Array.from(crypto.getRandomValues(new Uint8Array(6)), b =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        label: name,
      });
      render();
    } catch {}
  }
  if (f.id === 'rename-floor') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    try {
      await save({ type: 'storageFloorRename', id: floor, label: name });
      render();
    } catch {}
  }
  if (f.id === 'add-bay') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    const letter = nextBayLetter();
    if (!letter) {
      toast('No free bay letters left.', true);
      return;
    }
    try {
      await save({ type: 'storageBayAdd', id: letter, name, floor });
      render();
    } catch {}
  }
  if (f.classList.contains('add-container')) {
    e.preventDefault();
    const name = read();
    if (!name) return;
    const bay = storageBays().find(b => b.id === f.dataset.bay);
    if (!bay) return;
    // Fill a free position first; a bay with none gets the next address after its last.
    const free =
      bay.items.find(x => !x.name)?.id ||
      (bay.items.length < bayCapacity
        ? bay.id + String(bay.items.length + 1).padStart(2, '0')
        : null);
    if (!free) {
      toast('This bay holds the most addresses it can. Add another bay.', true);
      return;
    }
    try {
      await save({ type: 'storageSlotAssign', key: free, name });
      render();
    } catch {}
  }
  if (f.id === 'add-group') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    try {
      await save({
        type: 'factoryGroupAdd',
        id:
          'fg-' +
          Array.from(crypto.getRandomValues(new Uint8Array(6)), b =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        name,
      });
      render();
    } catch {}
  }
  if (f.dataset.taskEdit) {
    e.preventDefault();
    const id = f.dataset.taskEdit,
      fd = new FormData(f);
    const base = basePlanTasks().find(t => t.id === id);
    const title = String(fd.get('title') || '').trim(),
      body = String(fd.get('body') || '').trim(),
      link = String(fd.get('link') || '');
    if (!title) return;
    try {
      await save({
        type: 'taskEdit',
        id,
        title: base && title === base.title ? '' : title,
        body: base && body === String(base.body || '').trim() ? '' : body,
        link: link === autoTaskLink(id) ? '' : link,
      });
      setEditingTask(null);
      render();
    } catch {}
  }
});

// Custom container names may have no bundled artwork; keep the tile without a broken-image glyph.
document.addEventListener(
  'error',
  e => {
    const t = e.target;
    if (t?.tagName === 'IMG' && t.classList?.contains('item-icon')) t.style.visibility = 'hidden';
  },
  true,
);

window.addEventListener('hashchange', () => {
  setView(
    [
      'plan',
      'factories',
      'storage',
      'resources',
      'backup',
      'profiles',
      'wizard',
      'account',
    ].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : 'plan',
  );
  setQuery('');
  if (state) render();
  window.scrollTo(0, 0);
});

$('#detail').addEventListener('click', e => {
  if (e.target === $('#detail')) {
    $('#detail').close();
    setActiveDetail(null);
  }
});

window.addEventListener('beforeunload', e => {
  if (pending) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-new-save')) startWizard();
  if (b.dataset.newProfile) startWizard(b.dataset.newProfile);
  if (b.dataset.calcFactory) openCalculatedFactory(b.dataset.calcFactory);
  if (b.dataset.groupChain) openGroupChain(b.dataset.groupChain);
  if (b.dataset.altInfo) openAltRecipe(b.dataset.altInfo);
  if (b.hasAttribute('data-alt-all') || b.hasAttribute('data-alt-none')) {
    const on = b.hasAttribute('data-alt-all'),
      p = b.closest('.alt-picker');
    for (const box of p.querySelectorAll('.alt-row:not([hidden]) input[name=alt]')) {
      box.checked = on;
      const star = box.closest('.alt-row').querySelector('input[name=altpref]');
      if (star) {
        star.disabled = !on;
        if (!on) star.checked = false;
      }
    }
    p.querySelector('.alt-picker-head b').textContent =
      `Alternate recipes · ${p.querySelectorAll('input[name=alt]:checked').length} selected`;
  }
  if (b.hasAttribute('data-alt-best') && wizard && !b.disabled) {
    b.disabled = true;
    const label = b.textContent;
    try {
      readWizard($('#wizard-form'));
      const preview = await post(
        '/api/preview',
        { settings: { ...wizard.settings, recipes: 'all' } },
        true,
        calcProgress(b, 'Calculating…'),
      );
      wizard.settings.alternateRecipes = alternatesUsed(preview);
      render();
      toast(
        `Selected ${wizard.settings.alternateRecipes.length} alternate recipes the planner uses with your current settings.`,
      );
    } catch (err) {
      wizardError($('#wizard-form'), err);
      b.disabled = false;
      b.textContent = label;
    }
  }
  if (b.hasAttribute('data-round-up')) {
    if (!allowSwitch()) return;
    b.disabled = true;
    try {
      await writeQueue;
      const r = await post('/api/round-up', {}, true, calcProgress(b, 'Recalculating…'));
      setWorkspace(r.workspace);
      await loadContext(r.saveId, r.profileId);
      render();
      toast(
        'Created rounded profile. ' +
          r.reviewCount +
          ' completed factory checks need review; previous progress is preserved.',
      );
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
      b.textContent = 'Round up production';
    }
  }
  if (b.dataset.duplicateProfile) {
    if (!allowSwitch()) return;
    b.disabled = true;
    b.textContent = 'Copying…';
    try {
      await writeQueue;
      const r = await post('/api/duplicate-profile', {
        saveId: b.dataset.duplicateSave,
        profileId: b.dataset.duplicateProfile,
      });
      setWorkspace(r.workspace);
      await loadContext(r.saveId, r.profileId);
      navigate('plan');
      toast('Copy created and opened. Changes here leave the original profile untouched.');
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
      b.textContent = 'Duplicate';
    }
  }
  if (b.dataset.shareProfile) {
    b.disabled = true;
    try {
      await writeQueue;
      const sv = workspace.saves.find(s => s.id === b.dataset.shareSave),
        pr = sv?.profiles.find(p => p.id === b.dataset.shareProfile);
      const data = await request(
        '/api/export-saves?save=' +
          encodeURIComponent(b.dataset.shareSave) +
          '&profile=' +
          encodeURIComponent(b.dataset.shareProfile) +
          '&share=1',
      );
      downloadJson(data, (slug(pr?.name || 'profile') || 'profile') + '-share.json');
      toast(
        'Share file downloaded: the plan without your progress. Others import it under Backup → Import saves.',
      );
    } catch (err) {
      toast(err.message, true);
    } finally {
      b.disabled = false;
    }
  }
  if (b.dataset.removeProfile) {
    if (!allowSwitch()) return;
    const sv = workspace.saves.find(s => s.id === b.dataset.removeSave),
      pr = sv?.profiles.find(p => p.id === b.dataset.removeProfile);
    if (!pr) return;
    if (
      !confirm(
        'Are you sure? Remove "' +
          pr.name +
          '" and its progress and notes?' +
          (sv.profiles.length === 1
            ? ' This also removes the empty save.'
            : ' Other profiles keep their progress.'),
      )
    )
      return;
    b.disabled = true;
    try {
      await writeQueue;
      await post('/api/remove-profile', { saveId: sv.id, profileId: pr.id, confirmed: true });
      await boot();
      if (workspace.saves.length) navigate('profiles');
      toast('Profile removed.');
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
    }
  }
  if (b.dataset.openSave) {
    if (!allowSwitch()) return;
    b.disabled = true;
    try {
      await writeQueue;
      setWorkspace(
        await post('/api/select', {
          saveId: b.dataset.openSave,
          profileId: b.dataset.openProfile,
        }),
      );
      await loadContext(b.dataset.openSave, b.dataset.openProfile);
      navigate('plan');
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
    }
  }
  if (b.dataset.wizardStep) await moveWizard(Number(b.dataset.wizardStep));
  if (b.hasAttribute('data-wizard-back')) await moveWizard(wizard.step - 1);
  if (b.hasAttribute('data-guided-back')) await moveGuided(wizard.guidedStep - 1);
  if (b.dataset.guidedAdvanced) toAdvanced(Number(b.dataset.guidedAdvanced));
  if (b.hasAttribute('data-guided-start')) toGuided();
  if (b.hasAttribute('data-open-extraction')) openExtraction();
  if (b.dataset.nodePreset && wizard) {
    const form = $('#wizard-form');
    if (form) readExtraction(form);
    wizard.extraction = presetSurvey(
      b.dataset.nodePreset,
      extractionOf(wizard),
      wizard.settings.distribution,
    );
    wizard.extractionUndo = null;
    // Keep the profile's recorded purity in step with the counts it now holds.
    wizard.settings.purity = b.dataset.nodePreset;
    render();
    toast(
      'Filled in the default world at ' +
        (nodePresets.find(([v]) => v === b.dataset.nodePreset)?.[1] || 'that purity') +
        '. Change any count that does not match your save.',
    );
  }
  if (b.hasAttribute('data-node-reset') && wizard) {
    const form = $('#wizard-form');
    if (form) readExtraction(form);
    resetExtraction();
    render();
    toast(
      'Cleared. Every count is zero, your miner mark and clock are kept — and Undo reset puts it all back.',
    );
  }
  if (b.hasAttribute('data-node-undo') && wizard) {
    undoExtractionReset();
    render();
    toast('Put back the counts you had before the reset.');
  }
  if (b.dataset.extractionStep) await moveExtraction(Number(b.dataset.extractionStep));
  if (b.hasAttribute('data-extraction-back')) await moveExtraction(wizard.extractionStep - 1);
  if (b.hasAttribute('data-extraction-cancel')) leaveExtraction();
  if (b.dataset.supplyPick) {
    pickSupplyOption(b);
    return;
  }
  if (b.dataset.supplyRemove && wizard) {
    const form = $('#wizard-form');
    if (form) wizard.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
    const rows = supplyRows(wizard);
    rows.splice(Number(b.dataset.supplyRemove), 1);
    wizard.settings.existingSupply = Object.fromEntries(
      rows
        .filter(r => Number(r.rate) > 0)
        .map(r => [r.name.trim(), Number(r.rate)])
        .filter(([n]) => (workspace.catalog.supplyItems || []).includes(n)),
    );
    wizard.preview = null;
    render();
  }
  if (b.hasAttribute('data-cancel-wizard')) {
    setWizard(null);
    navigate('profiles');
  }
  if (b.dataset.authMode) {
    setAuthMode(b.dataset.authMode);
    renderSignedOut();
  }
  if (b.hasAttribute('data-logout')) {
    if (!allowSwitch()) return;
    await writeQueue;
    await post('/api/logout', {});
    setAuthMode('login');
    await boot();
  }
});
