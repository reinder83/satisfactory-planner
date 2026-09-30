// A new bay letter typed while another layout save runs is kept and added (#670), in the server
// edition: every save is a fetch, and the first is held until the letter has been typed
// (bay-letter-race.ts).
import { test } from 'vitest';
import { applyUpdate } from './setup.ts';
import { letterTypedDuringSave } from './bay-letter-race.ts';
import type { UpdateOp } from '../../public/types/index.ts';

test('a bay letter typed while another save runs is kept and used (#670)', async () => {
  await letterTypedDuringSave(held => {
    globalThis.fetch = (async (_path: RequestInfo | URL, options: RequestInit = {}) => {
      await held();
      const update = JSON.parse(String(options.body)) as UpdateOp;
      return new Response(JSON.stringify(applyUpdate(update)), { status: 200 });
    }) as typeof fetch;
  });
});
