// A power figure for display: MW, or GW above 1000 MW. Shared by the wizard, the flow
// diagrams (flow.ts), the calculated pages (views/calculated.ts) and ada-panel.ts. The
// wizard's form controls are components (ui/form/).
import { num } from '../format.ts';

export const power = (mw: number): string =>
  num(mw > 1000 ? mw / 1000 : mw) + (mw > 1000 ? ' GW' : ' MW');
