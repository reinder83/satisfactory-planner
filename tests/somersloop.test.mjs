import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,settings,DATA,AMPLIFY_SLOTS} from '../planner.mjs';

const base={phase:'5',recipes:'all',nuclear:'recycle',goal:'balanced'};
const buildings=x=>(x.rows||[]).reduce((a,r)=>a+r.machines,0);
const flow=(x,name)=>{
 let made=0,used=0;
 for(const r of x.rows||[]){made+=r.outputs[name]||0;used+=r.inputs[name]||0;}
 return {made,used};
};

test('settings saved before the somersloop ledger existed are unchanged by it',()=>{
 const before=calculate({...base}).stages[5];
 const after=calculate({...base,somersloops:0,augmenters:0,fueledAugmenters:0,sloopReserved:[]}).stages[5];
 assert.equal(buildings(before),buildings(after));
 assert.equal(before.requiredMW,after.requiredMW);
 assert.equal(before.generationMW,after.generationMW);
 assert.equal(before.boost,0);
 // With no augmenters the plan still sees exactly the spare power it always did.
 assert.equal(before.availableMW,before.generationMW+0);
 const old=settings({availablePowerGW:12});
 assert.equal(old.installedPowerGW,12,'total installed generation defaults to the spare figure');
 assert.equal(old.augmenters,0);assert.deepEqual(old.sloopReserved,[]);
});

test('an unfueled augmenter adds 500 MW and a tenth of the grid’s base production',()=>{
 const x=calculate({...base,somersloops:20,augmenters:1}).stages[5];
 assert.equal(x.boost,0.1);
 assert.equal(x.augmenterMW,500);
 // (generators + 500) x 1.1, exactly as the wiki states; one augmenter alone makes 550 MW.
 assert.ok(Math.abs(x.availableMW-(x.generationMW*1.1+550))<1e-6);
});

test('the augmenter multiplier applies to installed capacity, not to the spare part of it',()=>{
 const x=calculate({...base,somersloops:20,augmenters:2,availablePowerGW:5,installedPowerGW:60}).stages[5];
 const expected=x.generationMW*1.2+(60000+1000)*1.2-60000+5000;
 assert.equal(x.boost,0.2);
 assert.ok(Math.abs(x.availableMW-expected)<1e-6,`${x.availableMW} vs ${expected}`);
});

test('augmenters are Phase 5 buildings and do not power earlier phases',()=>{
 const plan=calculate({...base,phase:'3',somersloops:40,augmenters:2});
 assert.equal(plan.stages[4].boost,0);
 assert.equal(plan.stages[4].augmenterMW,0);
 assert.equal(plan.stages[5].boost,0.2);
});

test('fuel for an augmenter is derived from the augmenter count, never entered',()=>{
 const dry=calculate({...base,somersloops:20,augmenters:1}).stages[5];
 const wet=calculate({...base,somersloops:20,augmenters:1,fueledAugmenters:1}).stages[5];
 assert.equal(dry.matrixRate,0);
 assert.equal(wet.matrixRate,5);
 assert.equal(wet.boost,0.3);
 const fuel=wet.rows.find(r=>r.id==='Recipe_AlienPowerFuel_C');
 assert.ok(fuel,'the plan builds the Alien Power Matrix line');
 assert.ok(fuel.outputs['Alien Power Matrix']>=5-1e-6,'it produces the 5/min the augmenter needs');
 const two=calculate({...base,somersloops:40,augmenters:2,fueledAugmenters:2}).stages[5];
 assert.equal(two.matrixRate,10);
});

test('Review compares the fueled plan with the same plan unfueled',()=>{
 const x=calculate({...base,somersloops:20,augmenters:1,fueledAugmenters:1}).stages[5];
 const v=x.fuelVerdict;
 assert.ok(v,'a verdict is recorded');
 assert.equal(v.unfueledFeasible,true);
 assert.equal(v.buildings,buildings(x));
 assert.ok(v.buildingsUnfueled>0);
 assert.ok(v.availableMW>v.availableMWUnfueled,'fuel raises available power');
 assert.equal(typeof v.worthIt,'boolean');
 // At a modest base production the Matrix chain costs more than the extra 20% returns.
 assert.equal(v.worthIt,v.buildings<v.buildingsUnfueled);
 assert.equal(calculate({...base,somersloops:20,augmenters:1}).stages[5].fuelVerdict,undefined);
});

test('items the sink cannot accept are balanced exactly and never offered to it',()=>{
 const x=calculate({...base,somersloops:20,augmenters:1,fueledAugmenters:1,wholeMachines:true}).stages[5];
 const shard=flow(x,'Power Shard');
 assert.ok(shard.made>0,'the fuel line needs Power Shards');
 assert.ok(Math.abs(shard.made-shard.used)<0.01,`Power Shards must balance exactly: made ${shard.made}, used ${shard.used}`);
 assert.equal(x.surplus['Power Shard'],undefined,'a shard surplus has nowhere to go');
 for(const name of Object.keys(x.surplus||{}))assert.ok(DATA.items[name]?.sink>0,name+' cannot be sunk');
 const warning=calculate({...base,somersloops:20,augmenters:1,fueledAugmenters:1,wholeMachines:true}).warnings.find(w=>w.includes('AWESOME Sink'));
 assert.match(warning,/Power Shard/);
});

test('the ledger refuses combinations it cannot mean',()=>{
 assert.throws(()=>settings({augmenters:1,fueledAugmenters:2}),/fueled/i);
 assert.throws(()=>settings({availablePowerGW:20,installedPowerGW:5}),/installed/i);
 assert.throws(()=>settings({augmenters:11}),/number from 0 to 10/);
 assert.throws(()=>settings({somersloops:200}),/number from 0 to 106/);
 assert.deepEqual(settings({sloopReserved:['shards','nonsense','shards']}).sloopReserved,['shards']);
});

test('committing more somersloops than the save holds is reported, not silently accepted',()=>{
 const plan=calculate({...base,somersloops:12,augmenters:1,sloopReserved:['shards','dna','biofuel']});
 assert.ok(plan.warnings.some(w=>/commits 13 somersloops/.test(w)));
 assert.ok(!calculate({...base,somersloops:20,augmenters:1}).warnings.some(w=>/commits/.test(w)));
});

const amplifiedRows=x=>(x.rows||[]).filter(r=>r.amplified);

test('production amplification is off until the plan asks for it',()=>{
 assert.equal(settings({}).amplifySloops,0);
 const x=calculate({...base,somersloops:106}).stages[5];
 assert.equal(amplifiedRows(x).length,0,'no somersloop machines without a budget');
 assert.equal(x.sloopsUsed,0);
 assert.throws(()=>settings({amplifySloops:200}),/number from 0 to 106/);
});

test('amplified machines are whole machines that double output for four times the power',()=>{
 const x=calculate({...base,somersloops:106,amplifySloops:24}).stages[5];
 const amp=amplifiedRows(x);
 assert.ok(amp.length,'the plan places somersloops');
 assert.ok(x.sloopsUsed<=24,`used ${x.sloopsUsed} of a 24 somersloop budget`);
 assert.equal(x.sloopsUsed,amp.reduce((a,r)=>a+r.sloops,0));
 for(const r of amp){
  assert.ok(Math.abs(r.machines-r.equivalent)<1e-6,'a somersloop cannot go in part of a machine');
  assert.ok(Math.abs(r.lastClock-100)<1e-3);
  assert.ok(AMPLIFY_SLOTS[r.machine]>0,r.machine+' has no somersloop slots');
  assert.equal(r.sloops,r.slots*r.machines);
  const plain=DATA.recipes.find(y=>y.id===r.id.slice(4));
  assert.ok(plain,'every amplified row comes from a real recipe');
  assert.equal(r.power,plain.power*4);
  for(const [n,q] of Object.entries(plain.outputs))assert.ok(Math.abs(r.outputs[n]/r.equivalent-q*2)<1e-6,n+' should double');
  for(const [n,q] of Object.entries(plain.inputs))assert.ok(Math.abs(r.inputs[n]/r.equivalent-q)<1e-6,n+' should be unchanged');
 }
});

test('amplification buys ore and buildings with power',()=>{
 const off=calculate({...base,somersloops:106}).stages[5];
 const on=calculate({...base,somersloops:106,amplifySloops:24}).stages[5];
 const raw=x=>Object.values(x.raw).reduce((a,b)=>a+b,0);
 const count=x=>(x.rows||[]).reduce((a,r)=>a+r.machines,0);
 assert.ok(raw(on)<raw(off),`raw ${raw(on)} should be under ${raw(off)}`);
 assert.ok(count(on)<count(off),`buildings ${count(on)} should be under ${count(off)}`);
});

test('machines without somersloop slots are never amplified',()=>{
 const x=calculate({...base,recipes:'all',droneFuel:'Packaged Fuel',somersloops:106,amplifySloops:40}).stages[5];
 for(const r of amplifiedRows(x))assert.ok(!['Packager','Coal Generator','Fuel Generator','Nuclear Power Plant'].includes(r.machine),r.machine+' cannot take a somersloop');
 assert.ok((x.rows||[]).some(r=>r.machine==='Packager'),'the plan does package something');
});

test('a budget the solver cannot fit never costs the user a plan',()=>{
 const x=calculate({...base,wholeMachines:true,storage:'all',storageRate:5,somersloops:106,amplifySloops:106}).stages[5];
 assert.equal(x.feasible,true,'the plan survives even if amplification has to be dropped');
 if(x.amplificationDropped)assert.equal(x.sloopsUsed,0);
});
