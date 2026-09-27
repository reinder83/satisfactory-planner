// A power figure for display: MW, or GW above 1000 MW. Shared by the wizard, the flow
// diagrams (flow.ts), the calculated pages (views/calculated.ts) and ada-panel.ts. The
// wizard's form controls are components (ui/form/).
import { num } from '../format.ts';

// A missing figure (a field older plans lack) shows as 0 MW, as it always has. powerParts
// keeps the number and its unit apart, for a headline that draws the unit smaller (SP-14).
export const powerParts = (mw: number | null | undefined): { value: string; unit: string } => {
  const v = mw ?? 0;
  return { value: num(v > 1000 ? v / 1000 : v), unit: v > 1000 ? 'GW' : 'MW' };
};
export const power = (mw: number | null | undefined): string => {
  const p = powerParts(mw);
  return p.value + ' ' + p.unit;
};
