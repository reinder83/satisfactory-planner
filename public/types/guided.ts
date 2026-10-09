// The guided start's questions (guidedQuestions, guidedStandingQuestion and guidedHaveQuestion in
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
  // 'phase', 'goal', 'recipes', 'stock', 'exact', 'power', 'tutorial', 'supply' or 'have'.
  id: string;
  // The All settings step that owns the same settings.
  step: number;
  short: string;
  title: string;
  lead: string;
  // The existing-production question has rows instead of options, and "What you already have"
  // (#1068) its own controls.
  options?: GuidedOption[];
  kind?: 'supply' | 'have';
  // The question as a profile starting in `phase` is asked it (guidedFlow), where its wording
  // depends on the phase (#1072).
  phased?: (this: GuidedQuestion, phase: string) => GuidedQuestion;
}
