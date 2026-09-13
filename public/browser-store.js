// A single record lets each IndexedDB transaction atomically change selection and progress.
export function openBrowserStore(indexedDB,name='satisfactory-planner-browser-v1'){
 const opened=new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close other planner tabs to upgrade browser storage.'));});
 return {async transaction(change){
  const db=await opened;return new Promise((resolve,reject)=>{
   const tx=db.transaction('workspace',change?'readwrite':'readonly'),store=tx.objectStore('workspace');let answer,failure;
   const r=store.get('main');r.onsuccess=()=>{try{const data=r.result||{version:1,activeSave:null,saves:[],lastBackup:null};answer=change?change(data):data;if(change)store.put(data,'main');}catch(e){failure=e;tx.abort();}};
   tx.oncomplete=()=>resolve(answer);tx.onabort=()=>reject(failure||tx.error||Error('Browser storage could not be saved.'));tx.onerror=()=>{};
  });
 }};
}
