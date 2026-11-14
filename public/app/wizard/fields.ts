// A power figure for display: MW, or GW above 1000 MW. Shared by the wizard, the flow
// diagrams (flow.ts), the calculated pages (views/calculated.ts) and ada-panel.ts. The
// wizard's form controls are components (ui/form/).
import { powerAmount } from '../../wording.ts';

// A missing figure (a field older plans lack) shows as 0 MW, as it always has.
// The figure with its unit, rounded by numbers.ts's one display rule (X-2, #1335): the build
// plan, Review, ADA and the Resources page show the same power the same way.
export const power = (mw: number | null | undefined): string => powerAmount(mw ?? 0);
