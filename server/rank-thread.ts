// The worker thread a hard-drive payoff ranking runs on (#1156, started by rankOffThread in
// ranking.ts): it ranks the job in workerData with planner.ts's rankAlternates and posts back
// { result }, or { error, status } with the status of a refusal (400 for a phase without a plan).
import { parentPort, workerData } from 'node:worker_threads';
import { rankAlternates } from '../planner.ts';
import type { RankJob } from './ranking.ts';

const { settings, options } = workerData as RankJob;
try {
  parentPort!.postMessage({ result: rankAlternates(settings, options) });
} catch (error) {
  parentPort!.postMessage({
    error: (error as Error).message,
    status: (error as { status?: number }).status,
  });
}
