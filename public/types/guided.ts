// The guided start's questions (guidedQuestions and guidedStandingQuestion in
// public/preferences.ts), which app/wizard/guided.js sequences and ui/guided/ draws.
import type { CurrentSettings } from './calculated.ts';

export interface GuidedOption {
  value: string;
  label: string;
  detail: string;
  // The card's artwork: a glyph from GUIDED_GLYPHS, or item icons.
  glyph?: string;
  items?: string[];
  // Merged into the draft's settings when chosen.
  set: Partial<CurrentSettings>;
  // The All settings step the flow hands over to after this answer.
  handoff?: number;
}

export interface GuidedQuestion {
  // 'phase', 'goal', 'recipes', 'stock', 'exact', 'tutorial' or 'supply'.
  id: string;
  // The All settings step that owns the same settings.
  step: number;
  short: string;
  title: string;
  lead: string;
  // The existing-production question has rows instead of options.
  options?: GuidedOption[];
  kind?: 'supply';
}
