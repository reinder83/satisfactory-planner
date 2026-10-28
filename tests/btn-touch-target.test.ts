// Buttons (.btn) are 44px touch targets on a phone (#765), and unchanged on wider screens.
// Quiet buttons have their own phone rules: the text links keep their underline on the text
// (#832). Tabs and the wizard's step tabs grow to 44px too, the storage slot ⠿/✕ to 24px (#838).
// The storage "Move to…" select grows to 44px and a factory's ✕ per group to 24px wide (#842).
// The "Move to…" select is drawn like the bay buttons beside it (#852).
// A factory link ("Copper Ingot ↗") is drawn as a link wherever it is, and on a group's flow
// page (its build order, #895) and in a factory dialog's flow rows (#891) it is a 44px target on a
// phone (#886).
// Every control is at least a 24×24px target on every screen (#1256, WCAG 2.5.8): the step tools,
// ADA's tools, a factory's ✕, a step's tick (its label), fields and summaries; on a phone the
// fields, ticks, check box rows and links on a line of their own are 44px.
// Layout is not measurable in happy-dom, so this checks the rule in style.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const style = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The phone breakpoint style.css uses for its own 44px targets.
const PHONE = 720;

// Every top-level @media block of style.css with its condition and body.
function mediaBlocks(css: string) {
  const blocks: { query: string; body: string }[] = [];
  const at = /@media([^{]*)\{/g;
  for (let m; (m = at.exec(css));) {
    let depth = 1;
    let i = at.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    blocks.push({ query: m[1]!.trim(), body: css.slice(at.lastIndex, i - 1) });
    at.lastIndex = i;
  }
  return blocks;
}

// The rules (selectors and declarations) in a stretch of CSS.
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1]!.split(',').map(s => s.trim()),
    body: m[2]!,
  }));

test('every button but a quiet one is 44px tall at phone widths (#765)', () => {
  const phone = mediaBlocks(style).filter(b => b.query === `(max-width: ${PHONE}px)`);
  const target = phone
    .flatMap(b => rules(b.body))
    .find(r => r.selectors.includes('.btn:not(.quiet)'));
  assert.ok(target, `a max-width: ${PHONE}px block has a .btn:not(.quiet) rule`);
  assert.deepEqual(target.selectors, ['.btn:not(.quiet)']);
  assert.match(target.body, /(^|[;\s])min-height:\s*44px\s*;/);
  // Height only; a min-width shrank buttons elsewhere (#750).
  assert.doesNotMatch(target.body, /min-width/);
});

test('wider screens are unchanged: no min-height on plain .btn outside the media blocks', () => {
  const outside = mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style);
  for (const rule of rules(outside))
    if (rule.selectors.some(s => /^\.btn(:not\(\.quiet\))?$/.test(s)))
      assert.doesNotMatch(rule.body, /min-height/);
});

// The phone blocks' rules, and the rules outside any media block.
const phoneRules = () =>
  mediaBlocks(style)
    .filter(b => b.query === `(max-width: ${PHONE}px)`)
    .flatMap(b => rules(b.body));
const outsideRules = () =>
  rules(mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style));
const phoneRule = (selector: string) => {
  const found = phoneRules().filter(r => r.selectors.includes(selector));
  assert.ok(found.length, `a max-width: ${PHONE}px block has a rule for ${selector}`);
  return found.map(r => r.body).join('\n');
};
// The declarations for a selector outside any media block, on every screen.
const outsideRule = (selector: string) => {
  const found = outsideRules().filter(r => r.selectors.includes(selector));
  assert.ok(found.length, `style.css has a rule for ${selector} outside a media block`);
  return found.map(r => r.body).join('\n');
};

// The quiet buttons of #832 that are underlined text links.
const quietLinks = [
  '.guided-escape .btn.quiet',
  '.assign-row .btn.quiet',
  '.ada-tools .btn.quiet',
  '.ada.is-muted .btn.quiet',
  '.alt-tools .btn.quiet',
  // A notice's (Round up production…) and the somersloop ranking's, 34-35px before (#1256).
  '.notice .btn.quiet',
  '.sloop-payoff .btn.quiet',
];
// The other controls of #832 and #838 that grow to 44px on a phone.
const otherTargets = ['.bay-actions .btn.quiet', '.tab', '.wizard-progress button'];

test('quiet buttons and tabs are 44px tall at phone widths, height only (#832, #838)', () => {
  for (const selector of [...quietLinks, ...otherTargets]) {
    const body = phoneRule(selector);
    assert.match(body, /(^|[;\s])min-height:\s*44px\s*;/, selector);
    assert.doesNotMatch(body, /min-width/, selector);
  }
});

test('a quiet link keeps its underline on the text in the taller box (#832)', () => {
  for (const selector of quietLinks) {
    const body = phoneRule(selector);
    assert.match(body, /border-bottom:\s*0\s*;/, selector);
    assert.match(body, /text-decoration:\s*underline\b/, selector);
  }
  // The red ✕ keeps a red underline.
  assert.match(phoneRule('.assign-row .btn.quiet.danger'), /text-decoration-color:/);
});

test('the storage slot ⠿ and ✕ are 24px targets with space between them on a phone (#838)', () => {
  const both = phoneRules().find(
    r => r.selectors.includes('.slot-remove') && r.selectors.includes('.slot-drag'),
  );
  assert.ok(both, 'one phone rule sizes both');
  assert.match(both.body, /width:\s*24px/);
  assert.match(both.body, /height:\s*24px/);
  // ✕ sits at right: a, ⠿ at right: b; b - a - 24 is the gap between them.
  const right = (selector: string) => Number(/right:\s*(\d+)px/.exec(phoneRule(selector))?.[1]);
  assert.ok(right('.slot-drag') - right('.slot-remove') - 24 >= 4, 'at least 4px apart');
});

test('wider screens are unchanged: none of these controls has a min-height outside a media block', () => {
  for (const rule of outsideRules())
    if (rule.selectors.some(s => [...quietLinks, ...otherTargets].includes(s)))
      assert.doesNotMatch(rule.body, /min-height/, rule.selectors.join(', '));
});

test('the storage "Move to…" select is 44px tall on a phone, height only (#842)', () => {
  const body = phoneRule('.bay-actions .move-bay');
  assert.match(body, /(^|[;\s])min-height:\s*44px\s*;/);
  assert.doesNotMatch(body, /min-width/);
  for (const rule of outsideRules())
    if (rule.selectors.includes('.bay-actions .move-bay'))
      assert.doesNotMatch(rule.body, /min-height/);
});

test("a factory's ✕ per group is at least 24px wide on a phone (#842) and on wider screens (#1256)", () => {
  const body = phoneRule('.assign-row .btn.quiet.danger');
  const width = Number(/(?:^|[;\s])min-width:\s*(\d+)px\s*;/.exec(body)?.[1]);
  assert.ok(width >= 24, `min-width ${width}px is at least WCAG 2.5.8's 24px`);
  // 12px wide before #1256; 24px, not 44px, beside the group's rate field.
  assert.match(outsideRule('.assign-row .btn.quiet.danger'), /(^|[;\s])min-width:\s*24px\s*;/);
});

test('the storage "Move to…" select is drawn like the bay buttons beside it (#852)', () => {
  const declarations = (selector: string) =>
    outsideRules()
      .filter(r => r.selectors.includes(selector))
      .map(r => r.body)
      .join('\n');
  const look = (body: string) => ({
    border: /(?:^|[;\s])border:\s*([^;]+);/.exec(body)?.[1]?.trim(),
    background: /(?:^|[;\s])background:\s*([^;]+);/.exec(body)?.[1]?.trim(),
    color: /(?:^|[;\s])color:\s*([^;]+);/.exec(body)?.[1]?.trim(),
  });
  const select = look(declarations('.bay-actions .move-bay'));
  // Without its own border and background the browser draws a light grey control, and its
  // option list must not end up dark text on the dark background.
  assert.ok(select.border && select.background && select.color, JSON.stringify(select));
  assert.deepEqual(select, look(declarations('.bay-actions .btn.quiet')));
});

test('a factory link is drawn as an accent link everywhere, not only in a flow row (#886)', () => {
  // Without a rule of its own the build order's link was the browser's grey button.
  const body = outsideRules()
    .filter(r => r.selectors.includes('.rail-link'))
    .map(r => r.body)
    .join('\n');
  assert.ok(body, 'style.css has a rule for .rail-link on its own');
  assert.match(body, /(?:^|[;\s])background:\s*none\s*;/);
  assert.match(body, /(?:^|[;\s])border:\s*0\s*;/);
  assert.match(body, /(?:^|[;\s])color:\s*var\(--accent\)\s*;/);
  assert.match(body, /(?:^|[;\s])border-bottom:\s*1px solid/);
  // One look in both places: no rule draws the flow row's link apart from the others.
  for (const rule of outsideRules())
    assert.ok(!rule.selectors.includes('.rail-row .rail-link'), rule.selectors.join(', '));
});

test('the factory links are 44px tall on a phone, height only (#886, #895, #891)', () => {
  // The build-order dialog's links (.chain-title) went with the dialog; the flow page replaced it.
  assert.throws(() => phoneRule('.chain-title .rail-link'));
  // The flow page's links and those in a factory dialog's flow rows (#891), 23px tall before.
  for (const selector of ['.gf-head .rail-link', '.rail-row .rail-link']) {
    const body = phoneRule(selector);
    assert.match(body, /(^|[;\s])min-height:\s*44px\s*;/, selector);
    assert.doesNotMatch(body, /min-width/, selector);
    // The underline stays on the text in the taller box, as for the quiet links (#832).
    assert.match(body, /border-bottom:\s*0\s*;/, selector);
    assert.match(body, /text-decoration:\s*underline\b/, selector);
  }
  // One rule for both, so the two links keep one look on a phone too.
  assert.ok(
    phoneRules().some(
      r =>
        r.selectors.includes('.gf-head .rail-link') && r.selectors.includes('.rail-row .rail-link'),
    ),
  );
  // Wider screens keep the 24px floor of #1256 (WCAG 2.5.8), not the phone's 44px.
  for (const rule of outsideRules())
    if (rule.selectors.some(s => s.endsWith('.rail-link')))
      assert.doesNotMatch(rule.body, /min-height:(?!\s*24px\s*;)/, rule.selectors.join(', '));
  assert.match(outsideRule('.rail-link'), /(^|[;\s])min-height:\s*24px\s*;/);
});

// A min-height or min-width declaration's px value in a rule body.
const px = (body: string, property: string) =>
  Number(new RegExp(String.raw`(?:^|[;\s])${property}:\s*(\d+)px\s*;`).exec(body)?.[1]);

test('quiet buttons, the step tools and the factory links reach 24px on every screen (#1256)', () => {
  // ADA's tools and the step tools were 21-22px tall, ↑ and ↓ 14px wide.
  assert.equal(px(outsideRule(':where(.btn.quiet)'), 'min-height'), 24);
  assert.equal(px(outsideRule('.task-tools .btn.quiet'), 'min-width'), 24);
  assert.equal(px(outsideRule('.rail-link'), 'min-height'), 24);
  assert.equal(px(outsideRule('summary'), 'min-height'), 24);
});

// The :where() rule that sets a floor for every text field and select, outside or inside a phone
// block. Its selector holds commas inside :where(), so it is found by its text.
const fieldFloor = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    m =>
      m[1]!.trim().startsWith(':where(') &&
      /input:not\(\[type='checkbox'\], \[type='radio'\], \[type='file'\]/.test(
        m[1]!.replace(/\s+/g, ' '),
      ) &&
      /\bselect\s*\)\s*$/.test(m[1]!),
  )?.[2];

test('a field and a select are 24px tall on every screen and 44px on a phone, at no specificity (#1256)', () => {
  const outside = mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style);
  assert.equal(px(fieldFloor(outside) ?? '', 'min-height'), 24);
  const phone = mediaBlocks(style)
    .filter(b => b.query === `(max-width: ${PHONE}px)`)
    .map(b => fieldFloor(b.body))
    .find(Boolean);
  assert.equal(px(phone ?? '', 'min-height'), 44);
});

test("a step's tick has a 24px label around its 18px box, 44px on a phone, in the same place (#1256)", () => {
  const plain = outsideRule('.task-check');
  assert.equal(px(plain, 'width'), 24);
  assert.equal(px(plain, 'height'), 24);
  // The label's margin box is the 18 by 24px the box took, so the step's grid does not move.
  assert.match(plain, /(?:^|[;\s])margin:\s*0 -3px\s*;/);
  const phone = phoneRule('.task-check');
  assert.equal(px(phone, 'width'), 44);
  assert.equal(px(phone, 'height'), 44);
  assert.match(phone, /(?:^|[;\s])margin:\s*-10px -13px\s*;/);
  // The label wraps the tick in the step's template; the box keeps its own name.
  const template = fs
    .readFileSync(new URL('../public/app/ui/plan/PlanStep.vue', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  assert.match(template, /<label class="task-check"\s*><input\s+type="checkbox"\s+:data-check=/);
  assert.match(template, /:aria-label="'Complete: ' \+ step\.title"/);
});

test('check box rows, a slot tick and the links on a line of their own are 44px on a phone (#1256)', () => {
  assert.equal(px(phoneRule('.check-row'), 'min-height'), 44);
  assert.equal(px(phoneRule('.slot-complete'), 'min-height'), 44);
  for (const selector of ['.plan-summary a', '[data-session-link]', '[data-phase-notes-link]']) {
    // A 24px box around the text on wider screens, the text and its underline unmoved.
    const after = outsideRule(selector + '::after');
    assert.equal(px(after, 'height'), 24, selector);
    assert.match(after, /position:\s*absolute/, selector);
    assert.match(outsideRule(selector), /position:\s*relative/, selector);
    // A 44px row on a phone, its underline on the text as for the quiet links (#832).
    const phone = phoneRule(selector);
    assert.equal(px(phone, 'min-height'), 44, selector);
    assert.match(phone, /border-bottom:\s*0\s*;/, selector);
    assert.match(phone, /text-decoration:\s*underline\b/, selector);
    assert.match(phoneRule(selector + '::after'), /content:\s*none/, selector);
  }
});

test("the build sequence draft notice's Open Overview is a notice's quiet button, 44px on a phone (#1256)", () => {
  // 34px tall at 390px before (#1262): it takes the notices' 44px phone rule.
  const page = fs
    .readFileSync(new URL('../public/app/ui/pages/CalculatedPlanPage.vue', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  const notice =
    /<div v-if="draftNotice" class="notice[^"]*" data-draft-steps>([\s\S]*?)<\/div>/.exec(page);
  assert.ok(notice, 'the draft notice of the build sequence');
  assert.match(notice[1]!, /<button type="button" class="btn quiet" data-draft-overview/);
  assert.match(phoneRule('.notice .btn.quiet'), /(^|[;\s])min-height:\s*44px\s*;/);
});
