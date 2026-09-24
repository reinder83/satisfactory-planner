// A power figure for display: MW, or GW above 1000 MW. Shared by the wizard, the flow
// diagrams (flow.js), the calculated pages (views/calculated.js) and ada-panel.js. The
// wizard's form controls are components (ui/form/).
import { num } from '../format.js';

export const power = mw => num(mw > 1000 ? mw / 1000 : mw) + (mw > 1000 ? ' GW' : ' MW');
