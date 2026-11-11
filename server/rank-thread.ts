// The worker thread a hard-drive payoff ranking runs on (#1156, started by rankOffThread in
// ranking.ts): it ranks the job in workerData with planner.ts's rankAlternatesSteps and posts back
// { result }, or { error, status } with the status of a refusal (400 for a phase without a plan).
// Between two trials it posts { progress: { done, total } } and hands control back to its event
// loop for a moment, which is when the 'cancel' message of rankOffThread's handle (#1332) arrives;
// the ranking then stops before its next trial and replies with the alternates checked so far.
import { parentPort, workerData } from 'node:worker_threads';
import { rankAlternatesSteps } from '../planner.ts';
import type { RankJob } from './ranking.ts';

const { settings, options } = workerData as RankJob;
let cancelled = false;
parentPort!.on('message', message => {
  if (message === 'cancel') cancelled = true;
});
try {
  const steps = rankAlternatesSteps(settings, { ...options, shouldStop: () => cancelled });
  for (;;) {
    const step = steps.next();
    if (step.done) {
      parentPort!.postMessage({ result: step.value });
      break;
    }
    parentPort!.postMessage({ progress: step.value });
    await new Promise<void>(resolve => setImmediate(resolve));
  }
} catch (error) {
  parentPort!.postMessage({
    error: (error as Error).message,
    status: (error as { status?: number }).status,
  });
}
// The thread has nothing else to do; without this the message listener would keep it alive.
parentPort!.close();
