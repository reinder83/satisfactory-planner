// A new bay letter typed while another layout save runs is kept and added in the browser edition
// (#670): saves go to browser-api.ts's browserRequest instead of fetch, and the first one is held
// until the letter has been typed (bay-letter-race.ts). The store behind it is checked in
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
import {
  letterKeptOrRefilled,
  letterTypedDuringSave,
  letterTypedWhileSuggestionMoves,
} from './bay-letter-race.ts';

test('a bay letter typed while another save runs is kept and used in the browser (#670)', async () => {
  await letterTypedDuringSave(held => {
    edition.reply = async (path, options) => {
      if (path !== '/api/update') throw Error('unexpected ' + path);
      await held();
      return applyUpdate(JSON.parse(String(options.body)) as UpdateOp);
    };
  });
});

test('a typed bay letter stays when a save moves the suggested letter in the browser (#677)', async () => {
  await letterTypedWhileSuggestionMoves(answer => {
    edition.reply = async (path, options) => {
      if (path !== '/api/update') throw Error('unexpected ' + path);
      return answer(JSON.parse(String(options.body)) as UpdateOp);
    };
  });
});

test('a typed bay letter is kept, and an emptied one takes the suggestion on blur in the browser (#681)', async () => {
  await letterKeptOrRefilled(answer => {
    edition.reply = async (path, options) => {
      if (path !== '/api/update') throw Error('unexpected ' + path);
      return answer(JSON.parse(String(options.body)) as UpdateOp);
    };
  });
});
