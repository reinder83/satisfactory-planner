// Per-address rate limits, held in memory only. At most 20 sign-in attempts or calculations
// per client address per minute; each map is pruned of expired entries once it passes 2000
// addresses. A payoff ranking counts as `cost` of them, since it runs a calculation per
// candidate. The wizard's live estimates (SP-33) have their own allowance, so estimating while
// editing never uses up the calculations Calculate plan and Create profile need: 120 a minute,
// and at most estimateBudgetMs of solving a minute (#413; 20 s by default). Any client can mark
// a preview as an estimate, so it is the solving time that bounds what they cost the server: a
// third of it per address, however heavy the plan. Typing with the debounced estimates stays
// well inside.
import { fail } from './errors.ts';
import type { IncomingMessage } from 'node:http';

type Throttles = Map<string | undefined, { count: number; until: number }>;
export type Limits = ReturnType<typeof createLimits>;

// The address's entry in bucket for this minute, a new one once the last has expired.
function entryFor(bucket: Throttles, req: IncomingMessage, now: number) {
  const key = req.socket.remoteAddress;
  let entry = bucket.get(key);
  if (!entry || entry.until < now) {
    entry = { count: 0, until: now + 60000 };
    bucket.set(key, entry);
  }
  return entry;
}
// Drops the expired entries once bucket holds more than 2000 addresses.
function prune(bucket: Throttles, now: number) {
  if (bucket.size > 2000)
    for (const [address, { until }] of bucket) if (until < now) bucket.delete(address);
}

export function createLimits(estimateBudgetMs = 20000) {
  const throttles: Throttles = new Map(),
    estimates: Throttles = new Map(),
    estimateTime: Throttles = new Map();
  // Counts cost against the address's allowance in bucket, refused past limit.
  function count(req: IncomingMessage, cost: number, bucket: Throttles, limit: number) {
    const now = Date.now();
    const entry = entryFor(bucket, req, now);
    if ((entry.count += cost) > limit) fail('Too many attempts. Wait a minute and try again.', 429);
    prune(bucket, now);
  }
  return {
    // A sign-in attempt or calculation, or cost of them.
    throttle: (req: IncomingMessage, cost = 1) => count(req, cost, throttles, 20),
    // A live estimate, against its own allowance of 120 a minute.
    throttleEstimate: (req: IncomingMessage) => count(req, 1, estimates, 120),
    // The address's estimate-time entry for this minute, refused once it is used up. The
    // caller adds the milliseconds the estimate took to its count.
    estimateBudget(req: IncomingMessage) {
      const now = Date.now();
      const entry = entryFor(estimateTime, req, now);
      if (entry.count >= estimateBudgetMs)
        fail('Live estimates are paused for a minute. Calculate plan still works.', 429);
      prune(estimateTime, now);
      return entry;
    },
  };
}
