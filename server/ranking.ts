// The hard-drive payoff ranking off the server's main thread (#1156). A ranking recalculates the
// plan once per candidate recipe, for up to its time limit; run on the main thread it held up
// every other request of every user meanwhile. Each ranking runs planner.ts's rankAlternates on a
// worker thread of its own (rank-thread.ts), which exits when it is done, so the event loop keeps
// serving requests and nothing stays loaded between rankings. At most RANK_THREADS run at once;
// a ranking past that waits for one to finish (its time limit starts when it runs).
import { Worker } from 'node:worker_threads';
import type { AlternateRanking, RankScope, StageKey } from '../public/types/index.ts';

// What a ranking thread is given: the plan's settings and rankAlternates' options.
export interface RankJob {
  settings: unknown;
  options: { phase: StageKey; budgetMs: number } & RankScope;
}
type Reply = { result: AlternateRanking } | { error: string; status?: number };

const RANK_THREADS = 2;
let running = 0;
const waiting: (() => void)[] = [];

// Ranks `job` on a worker thread and resolves with the ranking. A refusal (a phase without a plan)
// rejects with its message and status, as rankAlternates throws it; a thread that fails any other
// way rejects without one, which the server answers with its generic error.
export async function rankOffThread(job: RankJob): Promise<AlternateRanking> {
  // A free place, or the one a finished ranking hands over (release below).
  if (running < RANK_THREADS) running++;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await new Promise<AlternateRanking>((resolve, reject) => {
      const worker = new Worker(new URL('./rank-thread.ts', import.meta.url), { workerData: job });
      let replied = false;
      worker.once('message', (reply: Reply) => {
        replied = true;
        if ('result' in reply) resolve(reply.result);
        else
          reject(
            Object.assign(new Error(reply.error), reply.status ? { status: reply.status } : {}),
          );
      });
      worker.once('error', reject);
      worker.once('exit', code => {
        if (!replied) reject(new Error(`The ranking thread stopped (exit code ${code}).`));
      });
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
