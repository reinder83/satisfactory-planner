// Fields that save on change, edited in quick succession in the browser edition (#627, #654):
// saves go to browser-api.ts's browserRequest instead of fetch, and the first one is held until
// the second field has been typed in (input-race.ts). The store behind it is checked in
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
import { races, typedDuringOwnSave, typedDuringSave } from './input-race.ts';

const stub = (held: () => Promise<void>) => {
  edition.reply = async (path, options) => {
    if (path !== '/api/update') throw Error('unexpected ' + path);
    await held();
    return applyUpdate(JSON.parse(String(options.body)) as UpdateOp);
  };
};

for (const [name, race] of Object.entries(races))
  test(`a ${name} typed while another one saves is kept and saved in the browser (#627, #654)`, async () => {
    await typedDuringSave(race, stub);
  });

test('a delivery count typed while the same counter saves is kept and saved in the browser (#664)', async () => {
  await typedDuringOwnSave(stub);
});

test('the count saved before, typed back while the same counter saves, is kept and saved in the browser (#678)', async () => {
  await typedDuringOwnSave(stub, '0');
});
