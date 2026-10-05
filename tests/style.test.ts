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
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    out.push({
      selector: match[1]!.trim().replace(/\s+/g, ' '),
      body: match[2]!,
      line: css.slice(0, match.index).split('\n').length,
    });
  return out;
}

const decls = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`, 'g'))].map(m => m[1]!.trim());

// Every length in a font-size value, in px (clamp() and similar are checked argument by argument).
function sizesPx(value: string): number[] {
  return [...value.matchAll(/(\d*\.?\d+)(px|rem)\b/g)].map(match =>
    match[2] === 'rem' ? Number(match[1]) * ROOT_PX : Number(match[1]),
  );
}

test(`no font-size in style.css is below ${FLOOR_PX}px`, () => {
  const small: string[] = [];
  for (const rule of rules(screenCss()))
    for (const value of decls(rule.body, 'font-size')) {
      assert.ok(
        !/\d(em|%)\b|smaller|x-small|xx-small/.test(value),
        `${rule.selector}: use px, not ${value}`,
      );
      // font-size: 0 hides a text node whose label a pseudo-element draws (.navicon).
      for (const px of sizesPx(value))
        if (px > 0 && px < FLOOR_PX) small.push(`${rule.selector}: ${value}`);
    }
  assert.deepEqual(small, []);
});

const hex = (color: string): [number, number, number] => {
  let digits = color.slice(1);
  if (digits.length === 3) digits = [...digits].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = (color: string) => {
  const [red, green, blue] = hex(color).map(channel => {
    const linear = channel / 255;
    return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrast = (colorA: string, colorB: string) => {
  const [lighter, darker] = [luminance(colorA), luminance(colorB)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
};

function tokens(css: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!; // style.css always opens with :root
  return Object.fromEntries(
    [...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(m => [m[1]!, m[2]!]),
  );
}
// A colour value as a hex string, or null for inherit, currentColor, gradients and the like.
const resolve = (value: string, palette: Record<string, string>): string | null => {
  const reference = /^var\(--([\w-]+)/.exec(value);
  const color = reference ? palette[reference[1]!] : value;
  return color && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : null;
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
  const palette = tokens(screenCss());
  const low: string[] = [];
  for (const token of TEXT_TOKENS)
    for (const background of BACKGROUNDS) {
      const ratio = contrast(palette[token]!, palette[background]!);
      if (ratio < MIN_CONTRAST) low.push(`--${token} on --${background}: ${ratio.toFixed(2)}`);
    }
  assert.deepEqual(low, []);
});

test(`every text colour in style.css reaches ${MIN_CONTRAST}:1 on its background`, () => {
  const css = screenCss(),
    palette = tokens(css);
  const low: string[] = [];
  for (const rule of rules(css)) {
    // The step icons are aria-hidden decoration beside the step's own title.
    if (/\.task-icon\b/.test(rule.selector)) continue;
    for (const value of decls(rule.body, 'color')) {
      const textHex = resolve(value, palette);
      if (!textHex) continue;
      // A rule that paints its own solid background is read against that one.
      const own = decls(rule.body, 'background(?:-color)?')
        .map(v => resolve(v, palette))
        .find(Boolean);
      const backs = own ? [own] : BACKGROUNDS.map(b => palette[b]!);
      for (const backgroundHex of backs) {
        const ratio = contrast(textHex, backgroundHex);
        if (ratio < MIN_CONTRAST)
          low.push(
            `${rule.selector} (line ${rule.line}): ${value} on ${backgroundHex} is ${ratio.toFixed(2)}`,
          );
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
  const palette = { ...tokens(screen), ...tokens(print) };
  const printRules = rules(print);
  const override = (selector: string, prop: string) => {
    let found: string | undefined;
    for (const rule of printRules)
      if (rule.selector.split(/\s*,\s*/).includes(selector))
        found = decls(rule.body, prop).at(-1) ?? found;
    return found;
  };
  // Elements the print block hides, and states that never occur on paper.
  const hidden = printRules
    .filter(r => decls(r.body, 'display').includes('none'))
    .flatMap(r => r.selector.split(/\s*,\s*/));
  const skip = (selector: string) =>
    /:hover|:focus|:active|::placeholder|::selection|\.task-icon\b/.test(selector) ||
    hidden.some(h => new RegExp(`${h.replace(/[.#]/g, '\\$&')}(?![\\w-])`).test(selector));
  return { screen, palette, override, skip, printRules };
}

test(`printed text reaches ${MIN_CONTRAST}:1 on paper (#330)`, () => {
  const { screen, palette, override, skip, printRules } = printView();
  const low: string[] = [];
  const check = (
    selector: string,
    color: string,
    background: string | undefined,
    where: string,
  ) => {
    const textHex = resolve(color, palette);
    if (!textHex) return;
    const backgroundHex = background && resolve(background, palette);
    for (const paper of backgroundHex ? ['#ffffff', backgroundHex] : ['#ffffff']) {
      const ratio = contrast(textHex, paper);
      if (ratio < MIN_CONTRAST)
        low.push(`${selector} (${where}): ${color} on ${paper} is ${ratio.toFixed(2)}`);
    }
  };
  const background = (body: string) => decls(body, 'background(?:-color)?').at(-1);
  for (const rule of rules(screen))
    for (const selector of rule.selector.split(/\s*,\s*/)) {
      if (skip(selector)) continue;
      const color = override(selector, 'color') ?? decls(rule.body, 'color').at(-1);
      if (!color) continue;
      const backgroundValue = override(selector, 'background(?:-color)?') ?? background(rule.body);
      check(selector, color, backgroundValue, `line ${rule.line}`);
    }
  for (const rule of printRules)
    for (const selector of rule.selector.split(/\s*,\s*/))
      for (const color of decls(rule.body, 'color'))
        check(selector, color, background(rule.body), 'print');
  assert.deepEqual(low, []);
});

// A background the print block leaves dark would sit behind text that is now dark too (a ticked
// step kept its near-black screen background).
test('no text sits on a dark background in print (#330)', () => {
  const { screen, palette, override, skip } = printView();
  // Fills that carry no text: bars, dots and the progress squares, and the power headroom bar's
  // segments and legend swatches (SP-29).
  const fills =
    /scrollbar|^\.dot$|^\.stat::before$|^\.progress-track span$|^\.resource-bar(\.tight|\.over)? span$|^\.guided-progress \.\w+ i$|^\.seg-(peak|load|extraction|utility|generation|boost|spare|short)$|^\.phase-seg\.(done|current) > span$/;
  const dark: string[] = [];
  for (const rule of rules(screen))
    for (const selector of rule.selector.split(/\s*,\s*/)) {
      if (skip(selector) || fills.test(selector)) continue;
      const value =
        override(selector, 'background(?:-color)?') ??
        decls(rule.body, 'background(?:-color)?').at(-1);
      const backgroundHex = value && resolve(value, palette);
      if (backgroundHex && contrast(backgroundHex, '#1c2328') < MIN_CONTRAST)
        dark.push(`${selector} (line ${rule.line}): ${value} is ${backgroundHex}`);
    }
  assert.deepEqual(dark, []);
});

test('every notice colour has its own print colour, so bold text and links print dark (#330)', () => {
  const { screen, override } = printView();
  const missing: string[] = [];
  for (const rule of rules(screen))
    if (decls(rule.body, 'color').length)
      for (const selector of rule.selector.split(/\s*,\s*/))
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
  const body = (selector: string) => all.find(r => r.selector === selector)?.body ?? '';
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
  const body = (selector: string) => rules(css).find(r => r.selector === selector)?.body ?? '';
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
      rule =>
        rule.selector
          .split(',')
          .map(x => x.trim())
          .includes('.resource-cell') && decls(rule.body, 'background').includes('white'),
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

// On a phone a dialog's title is one line, cut short (#318). The one dialog whose title wrapped,
// a group's Build order (#435, #454), became the group's flow page (#895), headed like any page.
test('dialog titles stay one line on a phone (#318)', () => {
  const css = screenCss();
  const phone = css.slice(css.indexOf('.dialog-head .eyebrow,'));
  const one = rules(phone).find(r => r.selector.split(', ').includes('.dialog-head h2'))!;
  assert.deepEqual(decls(one.body, 'white-space'), ['nowrap']);
});

// The build-order dialog (GroupChainDialog.vue) went when the flow page replaced it (#895): no
// rule is left for its classes, and nothing in public/ draws them. Its line number and loop
// marker (.chain-no, .chain-loop) and the factory link (.rail-link) stay: the flow page uses them.
test('no CSS is left for the build-order dialog (#895)', () => {
  const sources = fs
    .readdirSync(new URL('../public/', import.meta.url), { recursive: true, encoding: 'utf8' })
    .filter(file => /\.(ts|vue|html)$/.test(file))
    .map(file => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'))
    .join('\n');
  const selectors = rules(splitCss().screen + splitCss().print).map(r => r.selector);
  for (const name of ['chain', 'chain-stage', 'chain-body', 'chain-title', 'wrap-title']) {
    const used = new RegExp(`\\.${name}(?![\\w-])`);
    assert.ok(!selectors.some(s => used.test(s)), `style.css has no rule for .${name}`);
    // In a class attribute, a :class string or a selector a script looks for.
    const drawn = new RegExp(
      `class="(?:[^"]* )?${name}(?: [^"]*)?"|'${name}'|\\.${name}(?![\\w-])`,
    );
    assert.doesNotMatch(sources, drawn, `nothing draws .${name}`);
  }
  for (const name of ['chain-no', 'chain-loop', 'rail-link']) {
    assert.ok(
      selectors.some(s => s.includes('.' + name)),
      `.${name} keeps its rule`,
    );
    assert.match(sources, new RegExp(`class="${name}"`), `.${name} is still drawn`);
  }
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

// A name with no bundled icon gets an empty dashed square in the line colour (#463).
test('the missing-icon placeholder is a dashed square in the line colour (#463)', () => {
  const placeholder = rules(screenCss()).find(x => x.selector === '.item-icon-missing')!;
  assert.deepEqual(decls(placeholder.body, 'stroke'), ['var(--line)']);
  assert.equal(decls(placeholder.body, 'stroke-dasharray').length, 1);
  assert.deepEqual(decls(placeholder.body, 'fill'), ['none']);
});

// A long word in the open profile's name breaks inside the sidebar's profile switcher and its
// menu, rather than running past the sidebar's edge (#713).
test('a long profile name breaks inside the sidebar’s profile switcher and its menu (#713)', () => {
  const css = rules(screenCss());
  for (const selector of ['.profile-switcher', '.sidebar-foot .action-menu-list .btn']) {
    const rule = css.find(r => r.selector === selector)!;
    assert.deepEqual(decls(rule.body, 'overflow-wrap'), ['anywhere'], selector);
  }
  // The open profile's Open mark keeps its width beside a name that breaks anywhere.
  const mark = css.find(r => r.selector === '.action-menu-mark')!;
  assert.deepEqual(decls(mark.body, 'flex'), ['none']);
});
