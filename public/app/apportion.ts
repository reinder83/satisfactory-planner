// Rounding that still adds up (#1067): largest-remainder rounding, so whole or rounded parts sum to
// exactly the whole they were taken from. The factory dialog splits a line's machines over its
// deliveries with it (flow.ts), and the byproduct advice rounds a pool's amounts with it
// (recycle.ts), so "split ≈ 23 / 12 / 8" always adds up to the line's 43 machines and a pool's
// parts to its total. It reads only its arguments.

// `total` whole units shared out in proportion to `weights`: each part gets the whole units of its
// exact quota, and the units left go one each to the parts with the largest remainders (the larger
// weight, then the earlier part, on a tie). The parts add up to `total` exactly whenever a weight
// is above 0; with none, every part is 0. Negative weights count as 0.
export function wholeShares(total: number, weights: readonly number[]): number[] {
  const clean = weights.map(weight => (weight > 0 ? weight : 0));
  const sum = clean.reduce((acc, weight) => acc + weight, 0);
  if (!(sum > 0) || total <= 0) return clean.map(() => 0);
  const quotas = clean.map(weight => (total * weight) / sum);
  // The 1e-9 keeps a quota within floating-point noise of a whole number from losing a unit.
  const parts = quotas.map(quota => Math.floor(quota + 1e-9));
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = quotas
    .map((quota, i) => ({ i, rest: quota - parts[i]!, weight: clean[i]! }))
    .filter(entry => entry.weight > 0)
    .sort((a, b) => b.rest - a.rest || b.weight - a.weight || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--)
    parts[order[k]!.i]! += 1;
  return parts;
}

// The amounts `values` rounded to `decimals` places so that they add up to their sum rounded the
// same way (wholeShares on units of 10^-decimals).
export function roundedParts(values: readonly number[], decimals: number): number[] {
  const unit = 10 ** decimals;
  const total = Math.round(values.reduce((acc, value) => acc + Math.max(0, value), 0) * unit);
  return wholeShares(total, values).map(units => units / unit);
}

// The places an amount out of `total` is worth writing to: whole units from 100 up, one decimal
// from 10 up, else two, so a pool of 1,650 m³ reads "1,080" and one of 4.5 m³ reads "2.25".
export const sensibleDecimals = (total: number): number => (total >= 100 ? 0 : total >= 10 ? 1 : 2);

// The simple fraction nearest to `share` (between 0 and 1) with a denominator of at most
// `maxDenominator`, as [numerator, denominator] in lowest terms; the smaller denominator on a tie.
export function nearestFraction(share: number, maxDenominator = 16): [number, number] {
  let best: [number, number] = [Math.round(share), 1],
    error = Math.abs(share - best[0]);
  for (let denominator = 2; denominator <= maxDenominator; denominator++) {
    const numerator = Math.round(share * denominator),
      off = Math.abs(share - numerator / denominator);
    if (off < error - 1e-12) [best, error] = [[numerator, denominator], off];
  }
  return best;
}
