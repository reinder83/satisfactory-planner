// The delivery counters edited in quick succession in the browser edition (#627): saves go to
// browser-api.ts's browserRequest instead of fetch, and the first one is held until the second
// counter has been typed in (delivery-race.ts). The store behind it is checked in
// browser-store.test.ts; here it answers as the server does, from mutate().
import { test, vi } from 'vitest';
import type { UpdateOp } from '../../public/types/index.ts';

const edition = vi.hoisted(() => ({
  reply: (async () => {
    throw Error('No browser reply stubbed.');
  }) as (path: string, options: RequestInit) => Promise<unknown>,
}));
vi.mock('../../public/browser-api.ts', async original => ({
  ...(await original<typeof import('../../public/browser-api.ts')>()),
  browserMode: true,
  browserRequest: (path: string, options: RequestInit) => edition.reply(path, options),
}));

import { applyUpdate } from './setup.ts';
import { typedDuringSave } from './delivery-race.ts';

test('a count typed while another counter saves is kept and saved in the browser (#627)', async () => {
  await typedDuringSave(held => {
    edition.reply = async (path, options) => {
      if (path !== '/api/update') throw Error('unexpected ' + path);
      await held();
      return applyUpdate(JSON.parse(String(options.body)) as UpdateOp);
    };
  });
});
