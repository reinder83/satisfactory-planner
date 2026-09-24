// A single record lets each IndexedDB transaction atomically change selection and progress.
// Opens the browser edition's database; browserRequest in browser-api.js is the caller (tests
// hand createBrowserApi a stand-in store instead). The name, store `workspace` and key `main`
// hold existing users' saves: renaming any of them makes those saves disappear from the UI.
export function openBrowserStore(indexedDB, name = 'satisfactory-planner-browser-v1') {
  const opened = new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    // Schema version 1 is the only one so far: a brand-new database just gets the empty store.
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onsuccess = () => {
      // Close when another tab asks to upgrade the schema, so a future upgrade is not blocked by
      // tabs left open. Such a tab then rejects its later transactions until it is reloaded.
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('Close other planner tabs to upgrade browser storage.'));
  });
  return {
    // Without `change`, a readonly read of the whole workspace record. With it, one readwrite
    // transaction: read `main` (or a blank workspace), let `change` mutate it in place and return
    // the response, then put it back. IndexedDB serializes readwrite transactions on a store, so
    // concurrent tabs cannot interleave a read-modify-write. `change` must be synchronous: the
    // transaction commits once no request is pending.
    async transaction(change) {
      const db = await opened;
      return new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', change ? 'readwrite' : 'readonly'),
          store = tx.objectStore('workspace');
        let answer, failure;
        const r = store.get('main');
        r.onsuccess = () => {
          try {
            const data = r.result || { version: 1, activeSave: null, saves: [], lastBackup: null };
            answer = change ? change(data) : data;
            if (change) store.put(data, 'main');
          } catch (e) {
            failure = e;
            tx.abort();
          }
        };
        // Resolve only after the commit is durable. If `change` throws, the abort discards its
        // edits and the promise rejects with that error.
        tx.oncomplete = () => resolve(answer);
        tx.onabort = () =>
          reject(failure || tx.error || Error('Browser storage could not be saved.'));
        // Request errors also abort the transaction, so onabort reports them.
        tx.onerror = () => {};
      });
    },
  };
}
