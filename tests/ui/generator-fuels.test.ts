// A Coal Generator line burning a fuel other lines make (#1055): its step and its dialog say to
// give that fuel's belt an overflow to the AWESOME Sink, because the generators burn only for the
// power drawn and the rest would back up the lines making it (for Petroleum Coke, the Plastic and
// Rubber lines whose Heavy Oil Residue it uses up). A line burning Coal or a fluid says nothing new.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { machineSetup } from '../../public/app/views/calculated.ts';
import type { CalcRow } from '../../public/types/index.ts';

// A generator line of `machines` Coal Generators burning `rate` of `fuel` per minute.
const generator = (
  id: string,
  fuel: string,
  rate: number,
  machine = 'Coal Generator',
): CalcRow => ({
  id,
  name: fuel + ' power',
  phase: 2,
  machine,
  power: machine === 'Coal Generator' ? -75 : -250,
  inputs: { [fuel]: rate, ...(machine === 'Coal Generator' ? { Water: 45 } : {}) },
  outputs: {},
  equivalent: 3.5,
  machines: 4,
  lastClock: 100,
  peakMW: 0,
  generationMW: 262.5,
});

test('a Coal Generator line burning Petroleum Coke or Compacted Coal asks for an overflow to the sink', () => {
  assert.equal(
    machineSetup(generator('power-petroleum-coke', 'Petroleum Coke', 87.5)).summary,
    '4 Coal Generator total: all at 100%; they burn fuel only for the power drawn. Give the Petroleum Coke belt an overflow to the AWESOME Sink, so the lines making it never back up.',
  );
  assert.match(
    machineSetup(generator('power-compacted-coal', 'Compacted Coal', 25)).summary,
    / Give the Compacted Coal belt an overflow to the AWESOME Sink, so the lines making it never back up\.$/,
  );
  for (const row of [
    generator('power-coal', 'Coal', 52.5),
    generator('power-ionized-fuel', 'Ionized Fuel', 10.5, 'Fuel Generator'),
  ])
    assert.equal(
      machineSetup(row).summary,
      `4 ${row.machine} total: all at 100%; they burn fuel only for the power drawn.`,
      row.id,
    );
});
