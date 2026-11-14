// Who wants to hear of each saved update (#1353), with the progress before and after it. save() in
// api.ts calls every hook once its write has finished; ADA registers here for her event remarks
// (ada-panel.ts). A leaf module, so that neither of them has to import the other. A hook that
// throws must not fail the save, so hooks catch their own errors.
import type { ProgressState, UpdateOp } from '../types/index.ts';

export const savedHooks: ((
  operation: UpdateOp,
  before: ProgressState,
  after: ProgressState,
) => void)[] = [];
