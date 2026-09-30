// node:assert/strict for the component tests (#287). vite.config.ts points every
// `import assert from 'node:assert/strict'` under tests/ui/ here, so the tests keep writing
// plain node:assert.
//
// A failed equal() on a page element used to hang the test and then crash the Vitest worker:
// node:assert prints both sides for its message at depth 1000, and a happy-dom element
// reaches the whole document and window. Here a failed identity check with an element (or
// any other DOM node) on either side reports the nodes by a short name instead, such as
// `<button#save.primary>`. Every other check, and every check that passes, is node:assert's.
import { strict } from 'node:assert';

const isNode = (value: unknown): value is Node =>
  typeof Node !== 'undefined' && value instanceof Node;

// A short printable name for a node: its tag, id, classes and name/data-* attributes for an
// element, `#text "…"` for text and the node name for anything else. Other values are
// printed as node:assert would print a short value.
export function nodeName(value: unknown): string {
  if (!isNode(value)) return value === undefined ? 'undefined' : (JSON.stringify(value) ?? '?');
  if (!(value instanceof Element)) {
    const text = value.textContent?.trim().slice(0, 40);
    return text ? `${value.nodeName} ${JSON.stringify(text)}` : value.nodeName;
  }
  let name = value.tagName.toLowerCase();
  if (value.id) name += '#' + value.id;
  for (const className of value.classList) name += '.' + className;
  for (const { name: attr, value: attrValue } of value.attributes)
    if (attr === 'name' || attr.startsWith('data-'))
      name += attrValue ? `[${attr}="${attrValue}"]` : `[${attr}]`;
  return `<${name}>${value.isConnected ? '' : ' (not in the page)'}`;
}

function fail(
  actual: unknown,
  expected: unknown,
  operator: 'strictEqual' | 'notStrictEqual',
  message: string | Error | undefined,
  stackStartFn: Function,
): never {
  if (message instanceof Error) throw message;
  const actualName = nodeName(actual);
  const expectedName = nodeName(expected);
  // Without a message node:assert writes its usual one from the two short names; two
  // different nodes can print alike, so that case says so.
  const alike = operator === 'strictEqual' && actualName === expectedName;
  throw new strict.AssertionError({
    message: alike
      ? `${message ?? 'Expected the same node'}: two different ${actualName} nodes`
      : message,
    actual: actualName,
    expected: expectedName,
    operator,
    stackStartFn,
  });
}

function strictEqual<T>(
  actual: unknown,
  expected: T,
  message?: string | Error,
): asserts actual is T {
  if (!Object.is(actual, expected) && (isNode(actual) || isNode(expected)))
    fail(actual, expected, 'strictEqual', message, strictEqual);
  strict.strictEqual(actual, expected, message);
}

function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (Object.is(actual, expected) && isNode(actual))
    fail(actual, expected, 'notStrictEqual', message, notStrictEqual);
  strict.notStrictEqual(actual, expected, message);
}

function ok(value: unknown, message?: string | Error): asserts value {
  strict(value, message);
}

// The strict assert, callable as assert(value), with the identity checks replaced.
const assert: typeof strict = Object.assign(ok, strict, {
  equal: strictEqual,
  strictEqual,
  notEqual: notStrictEqual,
  notStrictEqual,
});
export default assert;
