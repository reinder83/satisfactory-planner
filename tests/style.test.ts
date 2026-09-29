// Guards for the type floor and text contrast in public/style.css (SP-11, #246): no text
// smaller than 10.5px, and every text colour readable at WCAG AA (4.5:1) on the page
// backgrounds it is drawn on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FLOOR_PX = 10.5;
const ROOT_PX = 13; // :root font-size, for rem values
const MIN_CONTRAST = 4.5;

// The stylesheet without comments, split into the print block (which reverts to dark text on
// paper and has its own colours) and everything else.
function splitCss(): { screen: string; print: string } {
  const css = fs
    .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const start = css.indexOf('@media print');
  if (start < 0) return { screen: css, print: '' };
  let depth = 0,
    end = css.indexOf('{', start);
  const open = end;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  return { screen: css.slice(0, start) + css.slice(end + 1), print: css.slice(open + 1, end) };
}
const screenCss = () => splitCss().screen;

// Innermost rules: selector and declarations, with the line they start on.
function rules(css: string) {
  const out: { selector: string; body: string; line: number }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    out.push({
      selector: m[1]!.trim().replace(/\s+/g, ' '),
      body: m[2]!,
      line: css.slice(0, m.index).split('\n').length,
    });
  return out;
}

const decls = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`, 'g'))].map(m => m[1]!.trim());

// Every length in a font-size value, in px (clamp() and similar are checked argument by argument).
function sizesPx(value: string): number[] {
  return [...value.matchAll(/(\d*\.?\d+)(px|rem)\b/g)].map(m =>
    m[2] === 'rem' ? Number(m[1]) * ROOT_PX : Number(m[1]),
  );
}

test(`no font-size in style.css is below ${FLOOR_PX}px`, () => {
  const small: string[] = [];
  for (const r of rules(screenCss()))
    for (const v of decls(r.body, 'font-size')) {
      assert.ok(!/\d(em|%)\b|smaller|x-small|xx-small/.test(v), `${r.selector}: use px, not ${v}`);
      // font-size: 0 hides a text node whose label a pseudo-element draws (.navicon).
      for (const px of sizesPx(v)) if (px > 0 && px < FLOOR_PX) small.push(`${r.selector}: ${v}`);
    }
  assert.deepEqual(small, []);
});

const hex = (h: string): [number, number, number] => {
  let s = h.slice(1);
  if (s.length === 3) s = [...s].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = (h: string) => {
  const [r, g, b] = hex(h).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

function tokens(css: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!; // style.css always opens with :root
  return Object.fromEntries(
    [...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(m => [m[1]!, m[2]!]),
  );
}
// A colour value as a hex string, or null for inherit, currentColor, gradients and the like.
const resolve = (value: string, tok: Record<string, string>): string | null => {
  const v = /^var\(--([\w-]+)/.exec(value);
  const h = v ? tok[v[1]!] : value;
  return h && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h) ? h : null;
};

const TEXT_TOKENS = [
  'ink',
  'bright',
  'muted',
  'dim',
  'kicker',
  'accent',
  'accent-hi',
  'green',
  'red',
  'blue',
  'gold',
];
const BACKGROUNDS = ['bg', 'bg2', 'panel', 'panel2'];

test(`text colour tokens reach ${MIN_CONTRAST}:1 on every page background`, () => {
  const tok = tokens(screenCss());
  const low: string[] = [];
  for (const t of TEXT_TOKENS)
    for (const b of BACKGROUNDS) {
      const r = contrast(tok[t]!, tok[b]!);
      if (r < MIN_CONTRAST) low.push(`--${t} on --${b}: ${r.toFixed(2)}`);
    }
  assert.deepEqual(low, []);
});

test(`every text colour in style.css reaches ${MIN_CONTRAST}:1 on its background`, () => {
  const css = screenCss(),
    tok = tokens(css);
  const low: string[] = [];
  for (const r of rules(css)) {
    // The step icons are aria-hidden decoration beside the step's own title.
    if (/\.task-icon\b/.test(r.selector)) continue;
    for (const value of decls(r.body, 'color')) {
      const fg = resolve(value, tok);
      if (!fg) continue;
      // A rule that paints its own solid background is read against that one.
      const own = decls(r.body, 'background(?:-color)?')
        .map(v => resolve(v, tok))
        .find(Boolean);
      const backs = own ? [own] : BACKGROUNDS.map(b => tok[b]!);
      for (const bg of backs) {
        const ratio = contrast(fg, bg);
        if (ratio < MIN_CONTRAST)
          low.push(`${r.selector} (line ${r.line}): ${value} on ${bg} is ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(low, []);
});

// Print (#330). The screen rules still apply on paper, so the print block has to override
// every screen colour that would be unreadable there: it redefines the colour tokens, and names
// the selectors whose screen colour is a literal. Printing drops backgrounds by default, so
// every text colour is checked on white paper as well as on the background it prints with.
function printView() {
  const { screen, print } = splitCss();
  const tok = { ...tokens(screen), ...tokens(print) };
  const printRules = rules(print);
  const override = (selector: string, prop: string) => {
    let found: string | undefined;
    for (const r of printRules)
      if (r.selector.split(/\s*,\s*/).includes(selector))
        found = decls(r.body, prop).at(-1) ?? found;
    return found;
  };
  // Elements the print block hides, and states that never occur on paper.
  const hidden = printRules
    .filter(r => decls(r.body, 'display').includes('none'))
    .flatMap(r => r.selector.split(/\s*,\s*/));
  const skip = (selector: string) =>
    /:hover|:focus|:active|::placeholder|::selection|\.task-icon\b/.test(selector) ||
    hidden.some(h => new RegExp(`${h.replace(/[.#]/g, '\\$&')}(?![\\w-])`).test(selector));
  return { screen, tok, override, skip, printRules };
}

test(`printed text reaches ${MIN_CONTRAST}:1 on paper (#330)`, () => {
  const { screen, tok, override, skip, printRules } = printView();
  const low: string[] = [];
  const check = (
    selector: string,
    color: string,
    background: string | undefined,
    where: string,
  ) => {
    const fg = resolve(color, tok);
    if (!fg) return;
    const bg = background && resolve(background, tok);
    for (const paper of bg ? ['#ffffff', bg] : ['#ffffff']) {
      const ratio = contrast(fg, paper);
      if (ratio < MIN_CONTRAST)
        low.push(`${selector} (${where}): ${color} on ${paper} is ${ratio.toFixed(2)}`);
    }
  };
  const background = (body: string) => decls(body, 'background(?:-color)?').at(-1);
  for (const r of rules(screen))
    for (const selector of r.selector.split(/\s*,\s*/)) {
      if (skip(selector)) continue;
      const color = override(selector, 'color') ?? decls(r.body, 'color').at(-1);
      if (!color) continue;
      const bg = override(selector, 'background(?:-color)?') ?? background(r.body);
      check(selector, color, bg, `line ${r.line}`);
    }
  for (const r of printRules)
    for (const selector of r.selector.split(/\s*,\s*/))
      for (const color of decls(r.body, 'color'))
        check(selector, color, background(r.body), 'print');
  assert.deepEqual(low, []);
});

// A background the print block leaves dark would sit behind text that is now dark too (a ticked
// step kept its near-black screen background).
test('no text sits on a dark background in print (#330)', () => {
  const { screen, tok, override, skip } = printView();
  // Fills that carry no text: bars, dots and the progress squares, and the power headroom bar's
  // segments and legend swatches (SP-29).
  const fills =
    /scrollbar|^\.dot$|^\.stat::before$|^\.progress-track span$|^\.resource-bar(\.tight|\.over)? span$|^\.guided-progress \.\w+ i$|^\.seg-(peak|utility|generation|boost|spare|short)$|^\.phase-seg\.(done|current) > span$/;
  const dark: string[] = [];
  for (const r of rules(screen))
    for (const selector of r.selector.split(/\s*,\s*/)) {
      if (skip(selector) || fills.test(selector)) continue;
      const value =
        override(selector, 'background(?:-color)?') ??
        decls(r.body, 'background(?:-color)?').at(-1);
      const bg = value && resolve(value, tok);
      if (bg && contrast(bg, '#1c2328') < MIN_CONTRAST)
        dark.push(`${selector} (line ${r.line}): ${value} is ${bg}`);
    }
  assert.deepEqual(dark, []);
});

test('every notice colour has its own print colour, so bold text and links print dark (#330)', () => {
  const { screen, override } = printView();
  const missing: string[] = [];
  for (const r of rules(screen))
    if (decls(r.body, 'color').length)
      for (const selector of r.selector.split(/\s*,\s*/))
        if (
          /\.notice\b/.test(selector) &&
          !/:hover|:focus/.test(selector) &&
          !override(selector, 'color')
        )
          missing.push(selector);
  // Links in a notice take the generic accent colour on screen.
  if (!override('.notice a', 'color')) missing.push('.notice a');
  assert.deepEqual(missing, []);
});

// SP-34: the wizard's error line is a notice, and an empty one takes no space.
test('an empty wizard error notice takes no space (SP-34)', () => {
  const hidden = rules(screenCss()).find(r => r.selector === '.notice.form-error:empty');
  assert.ok(hidden, 'a rule for the empty error notice');
  assert.match(hidden.body, /display:\s*none/);
});

// SP-10 (#245): the navigation shows each page's glyph, not a 01–07 count, and the open page's
// glyph in the accent colour.
test('the navigation shows its glyphs, the open page in the accent colour (SP-10)', () => {
  const css = screenCss();
  const all = rules(css);
  assert.doesNotMatch(css, /counter\(navstep\)|counter-(reset|increment):\s*navstep/);
  const icon = all.find(r => r.selector === '.navicon');
  assert.ok(icon, 'a .navicon rule');
  assert.doesNotMatch(icon.body, /font-size:\s*0\b/, 'the glyph is not hidden');
  assert.match(icon.body, /font-size:\s*14px/);
  assert.match(icon.body, /color:\s*var\(--dim\)/);
  const active = all.find(r => r.selector === '.nav a.active .navicon');
  assert.ok(active, 'a rule for the open page');
  assert.match(active.body, /color:\s*var\(--accent\)/);
});

// SP-19 (#254): a factory card's name covers the card as its hit area, under the Running box and
// the group editor, and the card shows the name's keyboard focus.
test('a factory card opens from anywhere but its Running box (SP-19)', () => {
  const all = rules(screenCss());
  const body = (sel: string) => all.find(r => r.selector === sel)?.body ?? '';
  assert.match(body('.factory-card'), /position:\s*relative/);
  const hit = body('.factory-card .name::after');
  assert.match(hit, /position:\s*absolute/);
  assert.match(hit, /inset:\s*0/);
  const above = all.find(
    r => r.selector.split(/\s*,\s*/).includes('.factory-card .check-row') && /z-index/.test(r.body),
  );
  assert.ok(above, 'the Running box sits above the hit area');
  assert.match(above.selector, /\.factory-card \.assign-editor/, 'and so does the group editor');
  assert.match(body('.factory-card:has(.name:focus-visible)'), /outline:/);
});

test('the guided stepper is legible: 13px numbered steps, the current one in the accent (SP-35)', () => {
  const css = screenCss();
  const body = (sel: string) => rules(css).find(r => r.selector === sel)?.body ?? '';
  assert.match(body('.guided-stepper'), /font-size: 13px/);
  assert.match(body('.guided-progress .current'), /color: var\(--accent\)/);
  assert.doesNotMatch(body('.guided-progress'), /var\(--dim\)/);
  assert.match(body('.guided-progress i'), /width: 22px/);
});

test('the top bar’s hazard stripe is 7px, and 4px on a phone (SP-39)', () => {
  const css = screenCss().replace(/\r/g, '');
  const top = rules(css).find(r => r.selector === '.topbar')!.body;
  assert.match(top, /border-bottom: 7px solid/);
  assert.match(top, /border-image: var\(--hazard\) 7/);
  // The phone drawer's block (SP-37) holds the phone top bar.
  const start = css.lastIndexOf('@media (max-width: 720px)', css.indexOf('.menu-open .sidebar'));
  const at = css.indexOf('\n  .topbar {', start);
  const body = css.slice(at, css.indexOf('}', at));
  assert.match(body, /border-bottom-width: 4px/);
  assert.match(body, /border-image: var\(--hazard\) 4/);
});

test('on a phone the dialog’s sticky header keeps to one line per part (#318)', () => {
  const css = screenCss().replace(/\r/g, '');
  // The wide header is unchanged.
  assert.match(rules(css).find(r => r.selector === '.dialog-icon')!.body, /width: 62px/);
  assert.match(rules(css).find(r => r.selector === '.dialog-head h2')!.body, /font-size: 24px/);
  const at = css.indexOf(
    '\n  .dialog-head .eyebrow,\n  .dialog-head h2,\n  .dialog-head .subtitle {',
  );
  assert.ok(at > 0, 'one line each for the eyebrow, title and summary');
  const media = css.lastIndexOf('@media', at);
  assert.match(css.slice(media, css.indexOf('{', media)), /max-width: 720px/);
  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /white-space: nowrap/);
  assert.match(block, /text-overflow: ellipsis/);
  const phone = css.slice(media, css.indexOf('\n}\n', media));
  assert.match(phone, /\n  \.dialog-icon \{\n    width: 36px;\n    height: 36px;/);
});

test('the dialog’s × has a 44px touch target on a phone, and looks the same (#289)', () => {
  const css = screenCss().replace(/\r/g, '');
  const wide = rules(css).find(r => r.selector === '.dialog-head .close')!.body;
  assert.match(wide, /width: 34px/);
  assert.match(wide, /height: 34px/);
  const at = css.indexOf('\n  .dialog-head .close::after {');
  assert.ok(at > 0, 'a hit area at phone width');
  const media = css.lastIndexOf('@media', at);
  assert.match(css.slice(media, css.indexOf('{', media)), /max-width: 720px/);
  const body = css.slice(at, css.indexOf('}', at));
  assert.match(body, /width: 44px/);
  assert.match(body, /height: 44px/);
  assert.match(body, /translate\(-50%, -50%\)/, 'centred on the button');
  assert.doesNotMatch(body, /background|border/, 'nothing drawn');
});

// The resources tables scroll sideways on a phone; their resource column sticks at the left on
// a solid background, so the columns sliding under it do not show through (#358). On paper it
// is an ordinary cell.
test('the resource column sticks on a solid background, and prints as a plain cell (#358)', () => {
  const { screen, print } = splitCss();
  const cell = rules(screen).find(r => r.selector === '.resource-cell')!;
  assert.deepEqual(decls(cell.body, 'position'), ['sticky']);
  assert.deepEqual(decls(cell.body, 'left'), ['0']);
  assert.deepEqual(decls(cell.body, 'background'), ['var(--panel)']);
  const head = rules(screen).find(r => r.selector === 'th.resource-cell')!;
  assert.deepEqual(decls(head.body, 'background'), ['var(--panel2)']);
  assert.ok(
    rules(print).some(
      r =>
        r.selector
          .split(',')
          .map(x => x.trim())
          .includes('.resource-cell') && decls(r.body, 'background').includes('white'),
    ),
  );
});

// The wizard's estimate bar is fixed at the foot of a phone's screen (#412), so a focused control
// is scrolled clear of it, not under it (WCAG 2.4.11, the #449 review).
test('a focused control is scrolled clear of the estimate bar (#412)', () => {
  const css = screenCss();
  const pad = rules(css).find(r => r.selector === 'html:has(.estimate-peek)')!;
  assert.ok(pad, 'the page keeps room for the bar');
  const px = Number(/^(\d+)px$/.exec(decls(pad.body, 'scroll-padding-bottom')[0]!)![1]);
  const bar = rules(css).find(
    r => r.selector === '.estimate-peek' && /position:\s*fixed/.test(r.body),
  )!;
  assert.ok(bar, 'the bar is fixed');
  // The bar: 12px padding above and below one line of text, and its 1px top border.
  assert.ok(px >= 12 + 12 + 20 + 1, `${px}px clears the bar`);
  assert.ok(pad.line < bar.line + 20, 'in the same phone block as the bar');
});

// On a phone a dialog's title is one line, cut short (#318), except the Build order dialog's,
// the group name the user typed, which wraps in full (#435).
test('a Build order title wraps on a phone, other dialog titles stay one line (#318, #435)', () => {
  const css = screenCss();
  const phone = css.slice(css.indexOf('.dialog-head .eyebrow,'));
  const one = rules(phone).find(r => r.selector.split(', ').includes('.dialog-head h2'))!;
  assert.deepEqual(decls(one.body, 'white-space'), ['nowrap']);
  const wrap = rules(phone).find(r => r.selector === '.dialog-head.wrap-title h2')!;
  assert.deepEqual(decls(wrap.body, 'white-space'), ['normal']);
  assert.ok(wrap.line > one.line, 'the wrapping rule comes after the one-line rule');
  // Its eyebrow wraps as well, so the phase at the end of it stays readable (#454).
  const eyebrow = rules(phone).find(r => r.selector === '.dialog-head.wrap-title .eyebrow')!;
  assert.deepEqual(decls(eyebrow.body, 'white-space'), ['normal']);
  assert.ok(eyebrow.line > one.line);
});

// Saves & profiles on a phone (#452): the save's name takes the section head's first row, so it
// is not squeezed beside Try another profile, and wraps between words; the button keeps a 44px
// touch target.
test('a save name wraps between words on a phone, above its button (#452)', () => {
  const css = screenCss();
  // Only the save's heading, on its own row; a profile card's keeps anywhere, so a long
  // unbroken profile name wraps inside its card instead of pushing the page sideways (#456).
  const names = rules(css).find(r => r.selector === '.inline-name > h2, .inline-name > h3')!;
  assert.deepEqual(decls(names.body, 'overflow-wrap'), ['anywhere']);
  const name = rules(css).find(
    r => r.selector === '.save-panel .section-head > .inline-name > h2',
  )!;
  assert.deepEqual(decls(name.body, 'overflow-wrap'), ['break-word']);
  assert.ok(name.line > names.line, 'it comes after the general rule');
  const row = rules(css).find(r => r.selector === '.save-panel .section-head > .inline-name')!;
  assert.deepEqual(decls(row.body, 'flex-basis'), ['100%']);
  const button = rules(css).find(r => r.selector === '.save-panel .section-head > .btn')!;
  assert.deepEqual(decls(button.body, 'min-height'), ['44px']);
});
