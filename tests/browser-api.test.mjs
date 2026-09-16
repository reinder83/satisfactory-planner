import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserApi} from '../public/browser-api.js';
import {calculate} from '../planner.mjs';
test('browser imports reject invalid data atomically and deletion preserves other profiles',async()=>{
 let data={version:1,activeSave:null,saves:[]};
 const store={async transaction(change){const copy=structuredClone(data);if(!change)return copy;const result=change(copy);data=copy;return structuredClone(result);}};
 const api=createBrowserApi(store,calculate,{}),post=(route,body)=>api(route,{body:JSON.stringify(body)});
 const first=await post('/api/profiles',{saveName:'Test save',name:'First',settings:{phase:'1',goal:'minimal'}});
 await post('/api/update',{type:'check',key:'remember',value:true});
 const second=await post('/api/profiles',{saveId:first.saveId,name:'Second',settings:{phase:'1',goal:'minimal'}});
 const before=structuredClone(data);
 await assert.rejects(post('/api/import-saves',{format:'satisfactory-planner-saves',version:1,saves:[{}]}));
 assert.deepEqual(data,before);
 await assert.rejects(post('/api/remove-profile',{saveId:first.saveId,profileId:first.profileId}));
 assert.deepEqual(data,before);
 await post('/api/remove-profile',{saveId:first.saveId,profileId:second.profileId,confirmed:true});
 assert.equal((await api('/api/state')).checks.remember,true);
 const exported=await api('/api/export-saves');await post('/api/import-saves',exported);
 const workspace=await api('/api/workspace');assert.equal(workspace.saves.length,2);
 assert.notEqual(workspace.saves[0].id,workspace.saves[1].id);
 assert.notEqual(workspace.saves[0].profiles[0].id,workspace.saves[1].profiles[0].id);
 assert.equal((await api('/api/state')).checks.remember,true);
});

test('preview and profile calculation forward the progress callback to the calculator',async()=>{
 let data={version:1,activeSave:null,saves:[]};
 const store={async transaction(change){const copy=structuredClone(data);if(!change)return copy;const result=change(copy);data=copy;return structuredClone(result);}};
 const api=createBrowserApi(store,(settings,onProgress)=>{onProgress?.(4);return calculate(settings);},{});
 const phases=[];
 await api('/api/preview',{body:JSON.stringify({settings:{phase:'1',goal:'minimal'}}),onProgress:p=>phases.push(p)});
 await api('/api/profiles',{body:JSON.stringify({saveName:'Progress save',name:'Progress',settings:{phase:'1',goal:'minimal'}}),onProgress:p=>phases.push(p)});
 assert.deepEqual(phases,[4,4],'both calculating endpoints report solver progress');
});
