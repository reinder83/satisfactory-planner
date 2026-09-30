// Fields that save on change, edited in quick succession in the server edition (#627, #654):
// every save is a fetch, and the first is held until the second field has been typed in
// (input-race.ts).
import { test } from 'vitest';
import { applyUpdate } from './setup.ts';
import {
  races,
  typedBackWhileAnotherTabSaves,
  typedDuringOwnSave,
  typedDuringSave,
} from './input-race.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const stub = (held: () => Promise<void>) => {
  globalThis.fetch = (async (_path: RequestInfo | URL, options: RequestInit = {}) => {
    await held();
    const update = JSON.parse(String(options.body)) as UpdateOp;
    return new Response(JSON.stringify(applyUpdate(update)), { status: 200 });
  }) as typeof fetch;
};

for (const [name, race] of Object.entries(races))
  test(`a ${name} typed while another one saves is kept and saved (#627, #654)`, async () => {
    await typedDuringSave(race, stub);
  });

const answer = (reply: (update: UpdateOp) => unknown) => {
  globalThis.fetch = (async (_path: RequestInfo | URL, options: RequestInit = {}) =>
    new Response(JSON.stringify(reply(JSON.parse(String(options.body)) as UpdateOp)), {
      status: 200,
    })) as typeof fetch;
};

for (const [name, race] of Object.entries(races))
  if (race.elsewhere)
    test(`a ${name} typed back to its saved value keeps it when another tab saves one (#683)`, async () => {
      await typedBackWhileAnotherTabSaves(race, answer);
    });

test('a delivery count typed while the same counter saves is kept and saved (#664)', async () => {
  await typedDuringOwnSave(stub);
});

test('the count saved before, typed back while the same counter saves, is kept and saved (#678)', async () => {
  await typedDuringOwnSave(stub, '0');
});
