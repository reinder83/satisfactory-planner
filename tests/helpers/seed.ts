// A brand-new Docker server starts with no saves (#496), so a test that needs the default save
// seeds its data folder the way an upgraded install has it: the single-profile progress.json of
// early releases, holding the handbook's starting progress. The server migrates it into the
// calculated profile 'original' of the save 'original-save' (#495). A folder that already has a
// workspace.json or progress.json is left as it is.
import fs from 'node:fs/promises';
import path from 'node:path';
import { initialState } from '../../server.ts';

export async function seedLegacy(dir: string) {
  const has = (name: string) =>
    fs.stat(path.join(dir, name)).then(
      () => true,
      () => false,
    );
  if ((await has('workspace.json')) || (await has('progress.json'))) return;
  await fs.writeFile(path.join(dir, 'progress.json'), JSON.stringify(initialState()));
}
