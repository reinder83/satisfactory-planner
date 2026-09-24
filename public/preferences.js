// Shared by the planner and wizard. Unknown seed totals must never masquerade as verified budgets.
export const storageOptions=[['none','No dedicated storage'],['construction','Construction materials'],['electronics','Construction + electronics'],['supplies','Construction + ammunition and filters'],['packaged','Packaged fluids only'],['all','All automatable solids and packaged fluids']];
export const constructionItems=['Iron Plate','Iron Rod','Reinforced Iron Plate','Concrete','Wire','Cable','Copper Sheet','Steel Beam','Steel Pipe','Modular Frame','Encased Industrial Beam','Heavy Modular Frame','Motor','Computer','Plastic','Rubber','Alclad Aluminum Sheet','Aluminum Casing'];
export function wantsStorage(name,mode){
 if(mode==='none')return false;
 if(mode==='all')return true;
 if(mode==='packaged')return name.startsWith('Packaged ');
 return constructionItems.includes(name)||mode==='electronics'&&/Circuit Board|[Cc]omputer|AI Limiter|High-Speed Connector|Radio Control Unit|Crystal Oscillator|Superposition Oscillator|Neural-Quantum Processor/.test(name)||mode==='supplies'&&/Cartridge|Rebar|Nobelisk|Filter|Inhaler/.test(name);
}
// Space Elevator parts go up the elevator or straight into the next project
// part; the plan already produces what those deliveries and recipes consume, so
// a standing storage buffer on top of that is production nobody draws from.
// They keep their container and address at a zero rate, and a per-item rate
// still buys a buffer for anyone who wants one. Kept in step with the planner's
// DELIVERIES table by a test.
export const elevatorParts=['Smart Plating','Versatile Framework','Automated Wiring','Modular Engine','Adaptive Control Unit','Assembly Director System','Magnetic Field Generator','Thermal Propulsion Rocket','Nuclear Pasta','Biochemical Sculptor','AI Expansion Server','Ballistic Warp Drive'];
// The parts you carry out of storage by hand — foundations, belts, pipes — are
// worth a faster guaranteed refill than items you never take out. A per-item
// rate wins over everything; 0 keeps the container and its address without
// reserving any production for it.
export const storageRateFor=(s,name)=>{
 const override=s.storageOverrides?.[name];
 if(override!==undefined)return override;
 if(elevatorParts.includes(name))return 0;
 return constructionItems.includes(name)?(s.buildRate??s.storageRate):s.storageRate;
};
export const distributions=[['original','Default'],['randomized','Random'],['basic','Basic Resource Rich'],['advanced','Advanced Resource Rich'],['fossil','Fossil Fuel Rich']];
export const purities=[['vanilla','Default'],['pure','All Pure'],['mostly-pure','Mostly Pure'],['normal','Average (all normal)'],['mostly-impure','Mostly Impure'],['impure','All Impure'],['random','Random'],['custom','Custom / manual']];
export const powerOptions=[['auto','Let the planner choose'],['coal','Coal'],['nuclear','Nuclear (turbofuel bridge)'],['fuel','Fuel'],['turbofuel','Turbofuel'],['rocket','Rocket fuel'],['turbofuel-nuclear','Turbofuel + nuclear'],['rocket-nuclear','Rocket fuel + nuclear']];
// Original map: impure / normal / pure, from the official resource-node and well tables.
export const nodeCounts={'Iron Ore':[39,42,46],'Copper Ore':[13,29,13],Limestone:[15,50,29],Coal:[15,31,16],'Caterium Ore':[0,9,8],'Raw Quartz':[3,7,7],Sulfur:[6,5,5],Bauxite:[5,6,6],Uranium:[3,2,0],SAM:[10,6,3],'Crude Oil':[10,12,8],'Nitrogen Gas':[2,7,36]};
export function resourceDefaults(purity='vanilla',distribution='original'){
 const uncertain=distribution!=='original'||['random','custom'].includes(purity);
 const limits={Water:1000000};
 for(const [name,counts] of Object.entries(nodeCounts)){
  // Rich presets have seed-dependent counts; zero is an unallocated budget, not a claim that the map lacks this resource.
  if(['basic','advanced','fossil'].includes(distribution)){limits[name]=0;continue;}
  const rate=name==='Crude Oil'?150:name==='Nitrogen Gas'?75:300;
  const weights=purity==='pure'?[4,4,4]:purity==='normal'?[2,2,2]:purity==='impure'?[1,1,1]:purity==='mostly-pure'?[2,4,4]:purity==='mostly-impure'?[1,1,2]:[1,2,4];
  // With remapped/default or random purity use the guaranteed all-impure floor until the actual totals are entered.
  limits[name]=counts.reduce((sum,n,i)=>sum+n*rate*(uncertain&&!['pure','normal','impure'].includes(purity)?1:weights[i]),0);
  if(name==='Nitrogen Gas'&&distribution!=='original')limits[name]=0;
 }
 return {limits,uncertain,description:uncertain?'Seed-dependent: verify totals with your seed or save. Zero means unallocated, not absent. Random uses known ordinary-node counts; mixed/random purity uses a conservative impure floor. Enter nitrogen wells separately.':'Original map totals at Mk.3 / 250% extraction. Oil excludes resource wells; water is a planning allowance, not a finite map total.'};
}
export const helpText={worldSeed:'Record the signed world seed from your game. Seed simulation is not built in: use the linked seed lookup and transfer extraction totals in Resources.',collectables:'Adds the collectables bays without promising automated replenishment of gathered items.',purity:'Purity changes extraction per node. Mostly Pure shifts each purity up one level; Mostly Impure shifts down. Average makes all nodes normal.',distribution:'Changes resource types at fixed locations. Resource-rich distributions and well totals depend on the world seed; the terrain does not move.',multiplier:'Space Elevator item requirements only. 50 means fifty times the normal delivery.',powerFactor:'Machine consumption multiplier: 0.5 means half consumption. Generator output is unchanged.',availablePowerMW:'Enter unused capacity after existing consumption. Reserve existing generator fuel separately in Resources.',recipes:'Allowing alternates adds hard-drive unlock steps; it does not mean they are already unlocked in your save.',pureIngots:'Require pure ingot alternatives once available. They need research and usually water/refineries.',sam:'Controls converting raw resources with SAM. Required SAM ingredients for late-game parts remain enabled.',nuclear:'Sink means processing uranium waste into plutonium rods for the AWESOME Sink. Full recycling burns plutonium and processes its waste into Ficsonium in Phase 5.',mainPower:'Sets the fuel used for new generation. Earlier phases use biomass and coal; rocket fuel plans use turbofuel as a bridge. Existing spare generation stays usable.',storage:'Reserves a refill rate for the selected items and filters the storage layout. Nuclear items and unpackaged fluids are excluded.',storageRate:'Reserved for every selected item that is not a construction material, in addition to elevator production. Extra sinkable output fills storage then goes to the sink, so a low rate still leaves containers filling from surplus.',buildRate:'Reserved for the construction materials you take out by hand: plates, rods, concrete, wire, cable, beams, pipes, frames, plastic and rubber. Set it higher than the general rate to keep building stock available.',storageOverrides:'Optional per-item rates. An item listed here ignores both general rates. Use 0 to keep an item’s container and address without reserving any production for it. Space Elevator parts default to 0 because deliveries and later project parts already consume them; enter a rate here if you want a buffer anyway.',installedPowerMW:'Total generation already installed, spare or not. An Alien Power Augmenter multiplies the whole grid’s base production, and the spare figure above is only part of that, so the multiplier is calculated from this number. Leave it equal to the spare figure if you would rather understate the boost.',somersloops:'How many Somersloops you have available to spend on this save, after MAM research. The world holds 106; one goes to Alien Technology analysis and one to unlocking the Augmenter.',augmenters:'Alien Power Augmenters to include in Phase 5. Each costs 10 Somersloops permanently, generates 500 MW and adds a multiplier to the grid’s base production: 10% unfueled, 30% fueled.',fueledAugmenters:'How many of those augmenters you will supply with Alien Power Matrix. The planner derives the 5/min each needs and builds that chain, so there is no separate rate to keep in step. Review compares the fueled and unfueled plan for you.',amplifySloops:'Optional. How many somersloops you are willing to put in this plan’s own production machines. An amplified machine keeps its inputs, doubles its output and draws four times the power, so it saves ore and buildings and costs power. Leave it at 0 to plan without amplification — collecting every somersloop is a hunt, and the plan is calculated exactly as it was before. The budget applies per phase, not as a running total.',sloopReserved:'Somersloops parked in hand-fed Constructors. They double a finite gathered input — slugs into Power Shards, remains into Alien DNA, biomass into Solid Biofuel — and only reserve a sloop and add a checklist step, because those lines are never belted.',cellsPerMinute:'Each Main Portal consumes 2 cells/min while connected. 10 cells/min supports five maintained connections. Reserve portal electrical power separately.',goal:'Choose a construction-light plan, a delivery-time target, or maximum output within verified budgets.',phaseTime:'Every phase gives each phase the same target time. The final phase applies it to Phase 5 only: earlier phases then run their lines as hard as the machines a later phase already builds allow, so they finish sooner without adding a building the plan later drops. Their delivery rates are not rounded. Ignored for maximum output.',wholeMachines:'Use whole production machines at 100%, sending extra solids to storage or the sink. Liquid and nuclear loops can still need balancing.',roundRates:'Rounds elevator target rates; completion time may be slightly longer or shorter.'};

export const droneFuels=['none','Battery','Packaged Fuel','Packaged Turbofuel','Packaged Rocket Fuel','Packaged Ionized Fuel','Uranium Fuel Rod','Plutonium Fuel Rod'];
export function droneSupply(s,phase){if(phase<4||!s.droneFuel||s.droneFuel==='none')return {};const bridge=phase===4&&s.droneFuel==='Packaged Ionized Fuel';return {[bridge?'Battery':s.droneFuel]:bridge?(s.droneBridgeRate??10):(s.droneFuelRate??10)};}
Object.assign(helpText,{utilityPercent:'Extra power above production demand for trains, stations, drone ports, miners and pumps. Default 20%. This is a percentage, not a fixed 20 GW; check actual peak load as transport expands.',droneFuel:'Dedicated fuel supply begins in Phase 4 after Tier 8 Aeronautical Engineering. Ionized fuel uses a battery bridge until Phase 5. Fuel rods stay outside general storage; plutonium needs a nuclear waste-processing chain.',droneFuelRate:'Total fuel items per minute reserved for your entire drone network, in addition to storage and other production. Consumption varies with routes and fuel: this is a supply target, not an estimate of how many drones it supports.',droneBridgeRate:'Battery supply per minute in Phase 4 while waiting for Phase 5 ionized fuel. Size this separately because different fuels have different energy values.'});

// ---------------------------------------------------------------------------
// The guided start.
//
// A short sequence of plain-language questions that produces the same settings
// object the five-step wizard produces. Nothing here is a new kind of setting:
// every answer writes fields `settings()` already validates, so a profile made
// this way is indistinguishable from one built by hand, and every existing
// profile keeps calculating exactly as before.
//
// Which questions exist was decided by measurement rather than taste. Against
// the default Phase 3/4/5 plan (229/844/1879 buildings), moving one setting off
// its default changes the plan by:
//
//   storage refill rates   +425%   (buildRate 1 -> 20)
//   goal / hours           +4600%  (maximum output) .. -22% (minimal)
//   elevator multiplier    +1102%  (50x)
//   recipe access           -57%   (all alternates), and on a heavy plan it
//                                  decides whether Phase 5 fits at all
//   whole machines          -64%   (precise balancing instead)
//   storage supply          +56%   (everything, rather than construction)
//
// while eleven of the wizard's controls — world seed, mod notes, SAM
// conversion, collectables, somersloops held, unfueled augmenters, sloops
// parked in hand-fed lines, the budget confirmation, resource purity, and both
// halving and doubling all thirteen resource budgets — changed a default plan
// by exactly nothing. Those keep their defaults until someone goes looking in
// All settings, which is always one click away.
export const GUIDED_TOPUP_RATE=20;
// The construction materials you carry out of a container by the hundred.
// A per-item floor for these costs 1-2% more buildings; raising the general
// construction rate to reach the same number costs 81-425%, because it applies
// to all eighteen construction materials at once. Concrete leads the list
// because it is the one the plan leaves least surplus for: at a floor of 1/min
// a default Phase 3 plan already spills 29 Wire/min and 19 Iron Plate/min into
// storage, and 2 Concrete/min.
export const guidedTopupItems=['Concrete','Iron Plate','Iron Rod','Steel Beam','Steel Pipe','Cable'];
// The Space Elevator parts each phase delivers, for the phase cards' artwork.
// Kept in step with the planner's DELIVERIES by a test; the icons are already
// bundled and attributed in icons/sources.json, so the guided start adds no new
// imagery and no new attribution.
export const phaseParts={
 1:['Smart Plating'],
 2:['Smart Plating','Versatile Framework','Automated Wiring'],
 3:['Versatile Framework','Modular Engine','Adaptive Control Unit'],
 4:['Assembly Director System','Magnetic Field Generator','Thermal Propulsion Rocket','Nuclear Pasta'],
 5:['Nuclear Pasta','Biochemical Sculptor','AI Expansion Server','Ballistic Warp Drive']
};
// Each question names the advanced step that owns the same settings, so
// "All settings" lands where you already were instead of at the top.
export const guidedQuestions=[
 {id:'phase',step:1,short:'Your phase',title:'Where are you in the game right now?',
  lead:'A plan is built for one phase. Earlier phases are behind you, so the build steps start where you are.',
  options:[1,2,3,4,5].map(n=>({value:String(n),label:'Phase '+n,
   detail:n===1?'The first Space Elevator delivery. Starting out.':'Delivering '+phaseParts[n].slice(0,2).join(' and ')+(phaseParts[n].length>2?', and more':'.'),
   items:phaseParts[n],set:{phase:String(n)}}))},
 {id:'goal',step:3,short:'Your goal',title:'What should this plan do for you?',
  lead:'The biggest single choice: it decides how much you build and how long a phase takes.',
  options:[
   {value:'minimal',label:'Build as little as possible',detail:'Deliveries take about 24 hours a phase. The fewest machines that still finish.',glyph:'minimal',set:{goal:'minimal'}},
   {value:'balanced',label:'Steady progress',detail:'About 8 hours a phase. A practical middle, and the usual starting point.',glyph:'balanced',set:{goal:'balanced'}},
   {value:'timed',label:'Finish by a deadline',detail:'You choose the hours per phase; the planner sizes the factory to hit it.',glyph:'timed',set:{goal:'timed'},ask:'hours'},
   {value:'maximum',label:'As fast as the map allows',detail:'Fastest delivery inside your resource budgets. You confirm those budgets first.',glyph:'maximum',set:{goal:'maximum'},handoff:4}]},
 {id:'recipes',step:2,short:'Recipes',title:'Which recipes can the plan use?',
  lead:'Alternate recipes come from hard drives. Allowing them typically halves the factory, and on a heavy plan it can decide whether the plan fits your resources at all.',
  options:[
   {value:'standard',label:'Standard recipes only',detail:'Nothing that needs a hard drive. The simplest factory to follow, and the largest.',glyph:'standard',set:{recipes:'standard',pureIngots:false}},
   {value:'all',label:'Whatever works best',detail:'The planner picks from every alternate and adds the hard-drive hunts you need as build steps.',glyph:'alternates',set:{recipes:'all',pureIngots:false}},
   {value:'custom',label:'I will choose them myself',detail:'Pick recipe by recipe in All settings. Useful when you know which drives you have unlocked.',glyph:'custom',set:{recipes:'custom'},handoff:2}]},
 {id:'stock',step:2,short:'Stocked for you',title:'What should the factory keep stocked for you?',
  lead:'Beyond the Space Elevator, the plan can reserve production to keep containers filled for your own building.',
  options:[
   {value:'none',label:'Nothing — just the elevator',detail:'Every part goes to deliveries. You gather and handcraft your own building materials.',glyph:'stock-none',set:{storage:'none',collectables:false}},
   {value:'construction',label:'My building materials',detail:'Plates, rods, concrete, wire, cable, beams, pipes, frames, plastic and rubber each get a container and a guaranteed refill.',glyph:'stock-build',set:{storage:'construction',collectables:false}},
   {value:'all',label:'Everything it can automate',detail:'A container and a reserved trickle for every automatable solid. The biggest storage room, and the biggest factory.',glyph:'stock-all',set:{storage:'all',collectables:true}}]},
 {id:'exact',step:3,short:'Exactness',title:'How exact should the build be?',
  lead:'Both fit your resource budgets. This is about what you would rather do in game.',
  options:[
   {value:'whole',label:'Whole machines at 100%',detail:'Nothing to underclock. Extra output fills storage and then goes to the sink.',glyph:'whole',set:{wholeMachines:true}},
   {value:'precise',label:'Exact ratios',detail:'Fewer machines, but some run at an odd clock speed you set by hand.',glyph:'precise',set:{wholeMachines:false}}]}
];
// Asked only where it means something: the tutorial question belongs to a
// Phase 1 save, the already-built question to any later one. Neither changes a
// setting — both record what is already standing in the world.
export const guidedStandingQuestion=phase=>phase==='1'
 ?{id:'tutorial',step:1,short:'Tutorial',title:'Have you finished the HUB tutorial?',
   lead:'HUB Upgrades 1 to 6, before the first Space Elevator delivery.',
   options:[
    {value:'doing',label:'Still working through it',detail:'The HUB steps stay at the top of your build plan as your next jobs.',glyph:'tutorial',set:{}},
    {value:'done',label:'Finished it — skip those steps',detail:'The HUB steps start ticked. You can untick any of them later.',glyph:'tutorial-done',set:{}}]}
 :{id:'supply',step:1,short:'Already running',kind:'supply',title:'What are you already producing?',
   lead:'If a line already runs in your world, say what it makes and how fast. The plan builds only the remainder, and it does not build the chain behind what you already make. Leave this empty if you are starting from scratch here.'};
// Ticked when someone says the HUB tutorial is behind them. Both keys already
// exist: the Phase 1 build step, and HUB Upgrade 6 in the unlock data.
export const tutorialKeys=['early-base-hub','unlock-Schematic_Tutorial5_C'];
Object.assign(helpText,{
 existingSupply:'Production that already runs in your world, as items per minute. The plan credits it and builds only the remainder, skipping the chain behind it. Enter what your factory actually makes — the recipe and machine count do not have to match anything this plan would have chosen. Its ore and its power are already spent, so enter your resource budgets and spare power net of it, exactly as for any other existing factory.',
 guidedTopup:'A guaranteed refill for the materials you carry out by hand. Twenty a minute of one item costs about one percent more buildings, because the plan already spills far more than that into storage as surplus. Raising the general construction rate to reach the same number costs far more, because it applies to every construction material at once.',
 guidedHours:'Hours per phase. The planner sizes the factory to deliver each phase in this long.'
});

// ---------------------------------------------------------------------------
// Working out resource budgets from the nodes you actually have.
//
// The thirteen budget boxes ask for a rate per minute, which nobody knows off
// the top of their head. What a player can read off the interactive map is how
// many impure, normal and pure nodes their world gives them, so that is what
// this asks for and this is the arithmetic that turns it into a rate.
//
// Yields are the in-game extraction rates for a normal-purity node at 100%
// clock; impure is half and pure is double. A test pins the whole table by
// rebuilding the shipped DEFAULT_LIMITS from the known node counts, so a wrong
// number here cannot pass unnoticed.
export const MINER_BASE={1:60,2:120,3:240};        // Miner Mk.1 / Mk.2 / Mk.3
export const OIL_BASE=120;                          // Oil Extractor, crude oil node
export const WELL_BASE=60;                          // Resource Well Extractor, per satellite
export const purityFactor={impure:0.5,normal:1,pure:2};
export const purities3=[['impure','Impure'],['normal','Normal'],['pure','Pure']];
export const minerMarks=[[1,'Mk.1 — Tier 0'],[2,'Mk.2 — Tier 4'],[3,'Mk.3 — Tier 7']];
// 250% is the usual endgame assumption and what the shipped default budgets use.
export const clockChoices=[[1,'100% — no shards'],[1.5,'150% — one shard'],[2,'200% — two shards'],[2.5,'250% — three shards']];
// Extracted by Oil Extractor rather than a miner.
export const oilNodeResources=['Crude Oil'];
// Come out of resource wells: a pressurizer plus its satellite nodes.
export const wellResources=['Crude Oil','Nitrogen Gas','Water'];
// Ordinary mineable nodes, in the order the node-count screen lists them.
export const minedResources=['Iron Ore','Copper Ore','Limestone','Coal','Caterium Ore','Raw Quartz','Sulfur','Bauxite','Uranium','SAM'];
// Water is deliberately not counted. Extractors sit on any lake or ocean and
// the map has more coastline than any factory can use, so a node count would be
// a fiction; the planner keeps its large water allowance instead, editable in
// All settings like any other budget.
export const uncountedResources=['Water'];

export const blankCounts=()=>({impure:0,normal:0,pure:0});
export const blankExtraction=()=>({mark:3,clock:2.5,nodes:{},wells:{},used:{}});

// One node's output per minute, at the chosen miner mark and clock.
export function nodeYield(resource,purity,{mark=3,clock=2.5}={}){
 const p=purityFactor[purity];if(!p)return 0;
 if(oilNodeResources.includes(resource))return OIL_BASE*p*clock;
 return (MINER_BASE[mark]||MINER_BASE[3])*p*clock;
}
// One resource-well satellite's output per minute. Wells have no marks; the
// pressurizer's clock drives every satellite it feeds.
export function wellYield(purity,{clock=2.5}={}){
 const p=purityFactor[purity];return p?WELL_BASE*p*clock:0;
}
const countsOf=(map,name)=>({...blankCounts(),...(map?.[name]||{})});
// What a resource yields in total, before anything is deducted.
export function resourcePool(extraction,resource){
 const e={...blankExtraction(),...(extraction||{})};
 const opts={mark:e.mark,clock:e.clock};
 const nodes=countsOf(e.nodes,resource),wells=countsOf(e.wells,resource);
 let total=0;
 for(const [key] of purities3){
  total+=(Number(nodes[key])||0)*nodeYield(resource,key,opts);
  if(wellResources.includes(resource))total+=(Number(wells[key])||0)*wellYield(key,opts);
 }
 return total;
}
// The pool less whatever is already committed to factories this plan does not
// include, which is what the planner's budgets are supposed to mean.
export function resourceAvailable(extraction,resource){
 const used=Number(extraction?.used?.[resource])||0;
 return Math.max(0,resourcePool(extraction,resource)-used);
}
// Every counted resource as a budget, rounded to whole items per minute.
// Water and anything else uncounted keeps whatever the profile already had.
export function extractionLimits(extraction,current={}){
 const limits={...current};
 for(const name of [...minedResources,...wellResources]){
  if(uncountedResources.includes(name))continue;
  limits[name]=Math.round(resourceAvailable(extraction,name));
 }
 return limits;
}
Object.assign(helpText,{
 extractionMark:'The miner you will have running on these nodes. A Mk.1 gives 60 a minute on a normal node, a Mk.2 gives 120 and a Mk.3 gives 240, before overclocking. Plan for the miner the phase can build, not the one you have today.',
 extractionClock:'Overclocking multiplies extraction. 250% needs three Power Shards per miner and is what the planner’s default budgets assume.',
 extractionNodes:'How many nodes of each purity your world has for this resource. A count, not a budget: zero means your world has none of that purity, so an all-pure world leaves the first two boxes at zero. The interactive map linked above will count them for you if you upload your save.',
 extractionWells:'Resource wells are a pressurizer plus its satellite nodes; count the satellites, not the pressurizers. A normal satellite gives 60 a minute before overclocking.',
 extractionUsed:'Extraction already committed to factories that are not part of this plan. It is taken off the pool, because the planner’s budgets mean what is free for this plan to use.'
});

// Prefilling the node counts for the default world.
//
// The purity world settings do not move a node or add one: they shift every
// node up or down the purity scale, which is exactly what `resourceDefaults`
// encodes as per-purity weights. So the counts for each setting fall straight
// out of the known node table, and a test checks that each preset reproduces
// that setting's shipped budget to the item.
//
// The resource-rich distributions are deliberately absent. They change how many
// nodes each resource has, per seed, and no authoritative per-purity table for
// them exists — only approximate community observations. Inventing one would be
// worse than asking, so for those the survey points at the map upload instead.
// The purity settings the known node table can be rearranged into. Random and
// Custom are not among them: there is no fixed layout to rearrange.
export const presetPurities=['vanilla','pure','mostly-pure','normal','mostly-impure','impure'];
// Purity settings that give every node the same purity. Under these the purity
// split stops mattering: only the total node count does.
export const uniformPurities=['pure','normal','impure'];
// Whether the node counts for a world are actually knowable.
//
// Random node randomization is a shuffle: it moves which resource sits at which
// location, and the purity with it, but the number of nodes each resource has
// is unchanged — nineteen SAM nodes are still nineteen SAM nodes, somewhere
// else. So under a uniform purity the counts are exactly the default map's; it
// is only the split across impure, normal and pure that the shuffle destroys.
//
// The resource-rich distributions do change how many nodes each resource has,
// by amounts that depend on the seed, so nothing is knowable there.
export const knownWorld=(purity,distribution='original')=>
 distribution==='original'?presetPurities.includes(purity)
 :distribution==='randomized'?uniformPurities.includes(purity)
 :false;
// What a resource-rich distribution does to the map, in the only terms that
// have held up. Players who have generated these worlds report per-resource
// counts that swing by a third or more between seeds, so there is no table
// here and there never should be one — but every count published so far pushes
// each resource the same way, and that much is worth telling someone who is
// about to count their own map.
export const richShape={
 basic:'Basic Resource Rich trades the late-game ores for the early ones: expect more limestone, iron, copper and coal, and less caterium, sulfur, bauxite, quartz, uranium and SAM.',
 advanced:'Advanced Resource Rich does the reverse: expect far more caterium, sulfur, bauxite, quartz, uranium and SAM, and roughly half the limestone, iron, copper, coal and oil.',
 fossil:'Fossil Fuel Rich concentrates on what burns: expect much more coal, crude oil and sulfur, and less of nearly everything else.'};
export const nodePresets=presetPurities.map(id=>[id,(purities.find(([v])=>v===id)||[,id])[1]]);
// One resource's [impure, normal, pure] counts redistributed by a purity
// setting. Mostly Pure shifts each node up one level, Mostly Impure down one.
export function presetCounts(purity,[impure,normal,pure]){
 const all=impure+normal+pure;
 if(purity==='pure')return {impure:0,normal:0,pure:all};
 if(purity==='normal')return {impure:0,normal:all,pure:0};
 if(purity==='impure')return {impure:all,normal:0,pure:0};
 if(purity==='mostly-pure')return {impure:0,normal:impure,pure:normal+pure};
 if(purity==='mostly-impure')return {impure:impure+normal,normal:pure,pure:0};
 return {impure,normal,pure};
}
// The whole default world at one purity setting. Resource wells other than
// nitrogen are left alone: the known table does not cover oil wells, and
// whatever was entered for them is the user's own count.
//
// Nitrogen is filled only on the default distribution. Well randomization is
// applied to a whole well rather than to each satellite, and the map's wells
// hold different numbers of satellites, so a shuffle that leaves every ordinary
// node count intact still moves nitrogen onto a bigger or smaller well than it
// had. Under Random its satellites are the user's to count.
export function presetSurvey(purity,base,distribution='original'){
 const e={...blankExtraction(),...(base||{})};
 e.nodes={...e.nodes};e.wells={...e.wells};
 for(const [name,counts] of Object.entries(nodeCounts)){
  const row=presetCounts(purity,counts);
  if(name!=='Nitrogen Gas')e.nodes[name]=row;
  else if(distribution==='original')e.wells[name]=row;
 }
 return e;
}
Object.assign(helpText,{
 nodePresets:'The two World Randomization settings you chose when you created the save. Node counts are known for the default distribution, and for Random too — Random shuffles which resource sits where, not how many of each there are — so picking a purity fills the counts in. Random does shuffle the purities as well, so under Random only the uniform purities (All Pure, Average, All Impure) are complete. A resource-rich distribution changes how many nodes each resource has, by an amount that depends on your seed, so there is no table for those. Nitrogen wells are filled only on the default distribution: well randomization applies to a whole well, and the map’s wells hold different numbers of satellites, so a shuffle can still leave you more or less nitrogen than the default map.'
});

// Which preset, if any, the counts in a survey currently are. Used to show the
// active preset and to say where untouched numbers came from.
export function matchingPreset(extraction){
 const e={...blankExtraction(),...(extraction||{})};
 for(const [id] of nodePresets){
  const p=presetSurvey(id);
  const same=Object.keys(nodeCounts).filter(name=>name!=='Nitrogen Gas').every(name=>{
   const a={...blankCounts(),...(e.nodes||{})[name]};
   const b=p.nodes[name];
   return a.impure===b.impure&&a.normal===b.normal&&a.pure===b.pure;
  });
  if(same)return id;
 }
 return '';
}
// Where a survey starts when one has not been made yet: the world settings
// already entered on Game settings. Only where those counts are known — a
// resource-rich or randomised distribution, or a random or hand-set purity, has
// no table to start from, so it starts empty and asks.
export function startingSurvey(settings={}){
 const distribution=settings.distribution||'original';
 return knownWorld(settings.purity,distribution)?presetSurvey(settings.purity,null,distribution):blankExtraction();
}
