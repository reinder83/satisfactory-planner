// A power figure for display: MW, or GW above 1000 MW. Shared by the wizard, the flow
// diagrams (flow.ts), the calculated pages (views/calculated.ts) and ada-panel.ts. The
// wizard's form controls are components (ui/form/).
import { powerAmount } from '../../wording.ts';

// A missing figure (a field older plans lack) shows as 0 MW, as it always has.
// The figure with its unit, as the build plan's power step words it (powerAmount).
export const power = (mw: number | null | undefined): string => powerAmount(mw ?? 0);
