// The help text of the wizard and the guided start: tooltip text, keyed by settings field name,
// which app/ui/form/HelpTip.vue looks up for each field. After the wizard's settings come the
// fields of the other modules of this folder, one group each.
export const helpText: Record<string, string> = {
  worldSeed:
    'Record the signed world seed from your game. Seed simulation is not built in: use the linked seed lookup and transfer extraction totals in Resources.',
  collectables:
    'Adds the collectables bays without promising automated replenishment of gathered items.',
  purity:
    'Purity changes extraction per node. Mostly Pure shifts each purity up one level; Mostly Impure shifts down. Average makes all nodes normal.',
  distribution:
    'Changes resource types at fixed locations. Resource-rich distributions and well totals depend on the world seed; the terrain does not move.',
  multiplier: 'Space Elevator item requirements only. 50 means fifty times the normal delivery.',
  powerFactor:
    'Machine consumption multiplier: 0.5 means half consumption. Generator output is unchanged.',
  availablePowerMW:
    'Enter unused capacity after existing consumption. Reserve existing generator fuel separately in Resources.',
  recipes:
    'Allowing alternates adds hard-drive unlock steps; it does not mean they are already unlocked in your save.',
  pureIngots:
    'Require pure ingot alternatives once available. They need research and usually water/refineries.',
  sam: 'Controls converting raw resources with SAM. Required SAM ingredients for late-game parts remain enabled.',
  nuclear:
    'Sink means processing uranium waste into plutonium rods for the AWESOME Sink. Full recycling burns plutonium and processes its waste into Ficsonium in Phase 5.',
  mainPower:
    'Sets the fuel used for new generation. Earlier phases use biomass and coal; rocket fuel plans use turbofuel as a bridge. Existing spare generation stays usable.',
  storage:
    'Reserves a refill rate for the selected items and filters the storage layout. Nuclear items and unpackaged fluids are excluded.',
  storageRate:
    'Reserved for every selected item that is not a construction material, in addition to elevator production. Extra sinkable output fills storage then goes to the sink, so a low rate still leaves containers filling from surplus.',
  buildRate:
    'Reserved for the construction materials you take out by hand: plates, rods, concrete, wire, cable, beams, pipes, frames, plastic and rubber. Set it higher than the general rate to keep building stock available.',
  storageOverrides:
    'Optional per-item rates. An item listed here ignores both general rates. Use 0 to keep an item’s container and address without reserving any production for it. Space Elevator parts default to 0 because deliveries and later project parts already consume them; enter a rate here if you want a buffer anyway.',
  installedPowerMW:
    'Total generation already installed, spare or not. An Alien Power Augmenter multiplies the whole grid’s base production, and the spare figure above is only part of that, so the multiplier is calculated from this number. Leave it equal to the spare figure if you would rather understate the boost.',
  somersloops:
    'How many Somersloops you have available to spend on this save, after MAM research. The world holds 106; one goes to Alien Technology analysis and one to unlocking the Augmenter.',
  augmenters:
    'Alien Power Augmenters to include in Phase 5. Each costs 10 Somersloops permanently, generates 500 MW and adds a multiplier to the grid’s base production: 10% unfueled, 30% fueled.',
  fueledAugmenters:
    'How many of those augmenters you will supply with Alien Power Matrix. The planner derives the 5/min each needs and builds that chain, so there is no separate rate to keep in step. Review compares the fueled and unfueled plan for you.',
  amplifySloops:
    'Optional. How many somersloops you are willing to put in this plan’s own production machines. An amplified machine keeps its inputs, doubles its output and draws four times the power, so it saves ore and buildings and costs power. Leave it at 0 to plan without amplification — collecting every somersloop is a hunt, and the plan is calculated exactly as it was before. The budget applies per phase, not as a running total.',
  sloopReserved:
    'Somersloops parked in hand-fed Constructors. They double a finite gathered input — slugs into Power Shards, remains into Alien DNA, biomass into Solid Biofuel — and only reserve a sloop and add a checklist step, because those lines are never belted.',
  cellsPerMinute:
    'Each Main Portal consumes 2 cells/min while connected. 10 cells/min supports five maintained connections. Reserve portal electrical power separately.',
  goal: 'Choose a construction-light plan, a delivery-time target, or maximum output within verified budgets.',
  phaseTime:
    'Every phase gives each phase the same target time. The final phase applies it to Phase 5 only: earlier phases then run their lines as hard as the machines a later phase already builds allow, so they finish sooner without adding a building the plan later drops. Their delivery rates are not rounded. Ignored for maximum output.',
  wholeMachines:
    'Use whole production machines at 100%, sending extra solids to storage or the sink. Every machine then runs at full speed, so the lines that feed it do too: more buildings, power and raw resources than exact clocks. Fluid, generator and nuclear lines always run at exact clocks, and a single production line can be set to exact clocks in its dialog.',
  roundRates: 'Rounds elevator target rates; completion time may be slightly longer or shorter.',
  // The power allowance and drone fuel (fuels.ts).
  utilityPercent:
    'Extra power above the production lines for trains, stations, drone ports and pumps. Miners and extractors are counted on their own. Default 20%. This is a percentage, not a fixed 20 GW; check actual peak load as transport expands.',
  droneFuel:
    'Dedicated fuel supply begins in Phase 4 after Tier 8 Aeronautical Engineering. Ionized fuel uses a battery bridge until Phase 5. Fuel rods stay outside general storage; plutonium needs a nuclear waste-processing chain.',
  droneFuelRate:
    'Total fuel items per minute reserved for your entire drone network, in addition to storage and other production. Consumption varies with routes and fuel: this is a supply target, not an estimate of how many drones it supports.',
  droneBridgeRate:
    'Battery supply per minute in Phase 4 while waiting for Phase 5 ionized fuel. Size this separately because different fuels have different energy values.',
  // The guided start (guided.ts).
  existingSupply:
    'Production that already runs in your world, as items per minute. The plan credits it and builds only the remainder, skipping the chain behind it. Enter what your factory actually makes — the recipe and machine count do not have to match anything this plan would have chosen. Its ore and its power are already spent, so enter your resource budgets and spare power net of it, exactly as for any other existing factory.',
  guidedTopup:
    'A guaranteed refill for the materials you carry out by hand. Storage takes the plan’s surplus of the item first, and a small storage-only line, optional and built last, tops up the rest: twenty a minute of one item costs 1 to 4 more buildings on a default plan. Raising the general construction rate to reach the same number costs far more, because it applies to every construction material at once.',
  guidedHours: 'Hours per phase. The planner sizes the factory to deliver each phase in this long.',
  // The node survey (extraction.ts).
  extractionMark:
    'The miner you will have running on these nodes. A Mk.1 gives 60 a minute on a normal node, a Mk.2 gives 120 and a Mk.3 gives 240, before overclocking. Plan for the miner the phase can build, not the one you have today. With budgets per phase, each phase uses the best miner it can build, up to this one.',
  extractionClock:
    'Overclocking multiplies extraction. 250% needs three Power Shards per miner and is what the planner’s default budgets assume. With budgets per phase, miners run at 100% in Phases 1–3 and up to 250% from Phase 4, with Power Shards from Power Slugs, and never faster than this.',
  extractionNodes:
    'How many nodes of each purity your world has for this resource. A count, not a budget: zero means your world has none of that purity, so an all-pure world leaves the first two boxes at zero. The interactive map linked above will count them for you if you upload your save.',
  extractionWells:
    'Resource wells are a pressurizer plus its satellite nodes; count the satellites, not the pressurizers. A normal satellite gives 60 a minute before overclocking.',
  extractionUsed:
    'Extraction already committed to factories that are not part of this plan. It is taken off the pool, because the planner’s budgets mean what is free for this plan to use.',
  // The node presets (presets.ts).
  nodePresets:
    'The two World Randomization settings you chose when you created the save. Node counts are known for the default distribution, and for Random too — Random shuffles which resource sits where, not how many of each there are — so picking a purity fills the counts in. Random does shuffle the purities as well, so under Random only the uniform purities (All Pure, Average, All Impure) are complete. A resource-rich distribution changes how many nodes each resource has, by an amount that depends on your seed, so there is no table for those. Nitrogen wells are filled only on the default distribution: well randomization applies to a whole well, and the map’s wells hold different numbers of satellites, so a shuffle can still leave you more or less nitrogen than the default map.',
};
