import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {progression} from '../public/progression.js';
import {calculate} from '../planner.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../public/progression.json',import.meta.url)));
test('Phase 1 has construction stock and biomass guidance, without later power instructions',()=>{
 const plan=calculate({recipes:'all'}),g=progression(plan,{checks:{}},data,1);
 const power=g.powerTasks.map(t=>t.body).join(' ');
 assert.doesNotMatch(power,/nuclear|aluminum|packaging|rocket fuel/i);
 assert.match(power,/120 Leaves\/min/);assert.match(power,/60 Wood\/min/);assert.match(power,/120 Biomass\/min/);
 const base=g.baseTasks.map(t=>t.body).join(' ');for(const name of ['Iron Plates','Iron Rods','Concrete','Wire','Cable'])assert.ok(base.includes(name));
 assert.ok(g.milestoneTasks.some(t=>t.title.includes('Obstacle Clearing')));assert.ok(g.milestoneTasks.some(t=>t.title.includes('Overclock Production')));
 assert.ok(g.hardDrives.some(t=>t.body.includes('Choices are random')));
});
test('milestone material advice uses actual running checkmarks and unlocks change power advice',()=>{
 const plan=calculate({}),rows=plan.stages[1].rows;const iron=rows.find(r=>r.outputs['Iron Plate']);const checks={['calc-1-'+iron.id]:true};
 let g=progression(plan,{checks},data,2);assert.ok(g.milestoneTasks.some(t=>t.body.includes('Iron Plate: already producing')));
 assert.match(g.powerTasks[0].body,/Biomass/);
 checks['unlock-'+data.entries.find(s=>s.name==='Coal Power').id]=true;
 g=progression(plan,{checks},data,2);assert.match(g.powerTasks[0].body,/Coal Power is marked unlocked/);assert.ok(!g.powerTasks.some(t=>t.id==='startup-biomass'));
});
