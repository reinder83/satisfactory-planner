// The hard-drive payoff ranking off the server's main thread (#1156). A ranking recalculates the
// plan once per candidate recipe, for up to its time limit; run on the main thread it held up
// every other request of every user meanwhile. Each ranking runs planner.ts's rankAlternates on a
// worker thread of its own (rank-thread.ts), which exits when it is done, so the event loop keeps
// serving requests and nothing stays loaded between rankings. At most RANK_THREADS run at once;
// a ranking past that waits for one to finish (its time limit starts when it runs).
// A ranking can be watched and cancelled while it runs (#1332): the caller passes a RankHandle,
// which fills in how far the thread is and carries a cancel() that makes it stop before its next
// trial and reply with the alternates checked so far (`stopped`).
import { Worker } from 'node:worker_threads';
import type { AlternateRanking, RankScope, StageKey } from '../public/types/index.ts';

// What a ranking thread is given: the plan's settings and rankAlternates' options.
export interface RankJob {
  settings: unknown;
  options: { phase: StageKey; budgetMs: number } & RankScope;
}
type Reply =
  | { result: AlternateRanking }
  | { progress: { done: number; total: number } }
  | { error: string; status?: number };

// Where a ranking is: `queued` until a thread starts it, then how many trials are done of the
// total; `cancel` stops it (before it starts, as soon as the thread does). Never stored.
export interface RankHandle {
  queued: boolean;
  done: number;
  total: number;
  cancelled: boolean;
  cancel(): void;
  // Set by rankOffThread while a thread runs the ranking.
  stop?: () => void;
}
export function rankHandle(): RankHandle {
  const handle: RankHandle = {
    queued: true,
    done: 0,
    total: 0,
    cancelled: false,
    cancel() {
      handle.cancelled = true;
      handle.stop?.();
    },
  };
  return handle;
}

const RANK_THREADS = 2;
let running = 0;
const waiting: (() => void)[] = [];

// Ranks `job` on a worker thread and resolves with the ranking. A refusal (a phase without a plan)
// rejects with its message and status, as rankAlternates throws it; a thread that fails any other
// way rejects without one, which the server answers with its generic error.
export async function rankOffThread(
  job: RankJob,
  handle: RankHandle = rankHandle(),
): Promise<AlternateRanking> {
  // A free place, or the one a finished ranking hands over (release below).
  if (running < RANK_THREADS) running++;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await new Promise<AlternateRanking>((resolve, reject) => {
      const worker = new Worker(new URL('./rank-thread.ts', import.meta.url), { workerData: job });
      let replied = false;
      handle.queued = false;
      handle.stop = () => worker.postMessage('cancel');
      // A cancel made while this ranking waited for a thread reaches the thread once it runs.
      if (handle.cancelled) worker.postMessage('cancel');
      worker.on('message', (reply: Reply) => {
        if ('progress' in reply) {
          handle.done = reply.progress.done;
          handle.total = reply.progress.total;
          return;
        }
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
