// Fields that save on change, edited in quick succession in the server edition (#627, #654):
// every save is a fetch, and the first is held until the second field has been typed in
// (input-race.ts).
import { test } from 'vitest';
import { applyUpdate } from './setup.ts';
import { races, typedDuringSave } from './input-race.ts';
import type { UpdateOp } from '../../public/types/index.ts';

for (const [name, race] of Object.entries(races))
  test(`a ${name} typed while another one saves is kept and saved (#627, #654)`, async () => {
    await typedDuringSave(race, held => {
      globalThis.fetch = (async (_path: RequestInfo | URL, options: RequestInit = {}) => {
        await held();
        const update = JSON.parse(String(options.body)) as UpdateOp;
        return new Response(JSON.stringify(applyUpdate(update)), { status: 200 });
      }) as typeof fetch;
    });
  });
