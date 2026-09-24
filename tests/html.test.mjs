import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Html, html, raw } from '../public/app/html.js';

test('html`` escapes interpolated text and keeps nested markup', () => {
  const name = `<b>"Tom" & 'Jerry'</b>`;
  assert.equal(
    String(html`<h2 title="${name}">${name}</h2>`),
    '<h2 title="&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;">&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;</h2>',
  );
  assert.equal(String(html`<p>${html`<b>${name}</b>`}</p>`), `<p><b>${html`${name}`}</b></p>`);
  assert.equal(String(html`${raw('<br>')}`), '<br>');
  // A plain string of markup is text: it must be wrapped, never concatenated in.
  assert.equal(String(html`${'<br>'}`), '&lt;br&gt;');
});

test('html`` joins arrays and renders nothing for null, undefined and false', () => {
  const items = ['a', '<b>'];
  assert.equal(
    String(
      html`<ul>
        ${items.map(i => html`<li>${i}</li>`)}
      </ul>`,
    ),
    '<ul> <li>a</li><li>&lt;b&gt;</li> </ul>',
  );
  assert.equal(String(html`[${null}${undefined}${false}${''}]`), '[]');
  // 0 is a value, as in a plain template literal.
  assert.equal(String(html`${0}`), '0');
  assert.equal(String(html`${[['x', html`<i></i>`], '&']}`), 'x<i></i>&amp;');
});

test('html`` is a String, so it concatenates and searches like one', () => {
  const h = html`<b>x</b>`;
  assert.ok(h instanceof Html && h instanceof String);
  assert.equal('a' + h, 'a<b>x</b>');
  assert.equal(`${h}`, '<b>x</b>');
  assert.ok(h.includes('<b>'));
  assert.equal(raw(h), h);
  assert.equal(String(raw(null)), '');
});

// These templates are written the way Prettier lays out longer ones, so they are kept
// out of its reach.
test('html`` collapses the line breaks of a formatted template to single spaces', () => {
  // prettier-ignore
  const t = html`
    <div class="a">
      <span>one</span>
      two
    </div>
  `;
  assert.equal(String(t), '<div class="a"> <span>one</span> two </div>');
  // Text that wraps keeps its word gap.
  // prettier-ignore
  const p = html`<p>long
    text</p>`;
  assert.equal(String(p), '<p>long text</p>');
});

test('html`` drops the break after <textarea> and <pre> but keeps interpolated line breaks', () => {
  const note = 'line 1\nline 2';
  // prettier-ignore
  const plain = html`<textarea id="n">
${note}</textarea
    >`;
  assert.equal(String(plain), '<textarea id="n">line 1\nline 2</textarea>');
  // Also when the tag's attributes are interpolated.
  const id = 'n';
  // prettier-ignore
  const attrs = html`<textarea id="${id}" class="notes">
${note}</textarea>`;
  assert.equal(String(attrs), '<textarea id="n" class="notes">line 1\nline 2</textarea>');
  // prettier-ignore
  const pre = html`<pre>
${note}</pre>`;
  assert.equal(String(pre), '<pre>line 1\nline 2</pre>');
});

test('html`` keeps a deliberate space at either end of a nested template', () => {
  const warn = true;
  assert.equal(
    String(html`available.${warn && html` <span class="warn">Too many.</span>`}`),
    'available. <span class="warn">Too many.</span>',
  );
  assert.equal(String(html`${'a'}${html`b `}${'c'}`), 'ab c');
});
