// The delivery counters edited in quick succession (#627), shared by the server edition's test
// (delivery-counter.test.ts) and the browser edition's (delivery-counter-browser.test.ts). Saving
// a counter redraws every counter, twice: when the Saving indicator comes on and after the save.
// Bound to the saved count, a redraw put it back over a number typed in another counter but not
// yet committed, and the change event that followed saved the old count.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, go, open, page } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// `stub(held)` makes the edition's saves reply; each save awaits held() first, which holds the
// first save until the second counter has been typed in and lets every later one through.
export async function typedDuringSave(stub: (held: () => Promise<void>) => void) {
  page();
  go('plan');
  open({ state: { deliveries: { '3-modular-engine': 0, '3-versatile-framework': 0 } } });
  render();
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let first = true;
  stub(() => {
    if (!first) return Promise.resolve();
    first = false;
    return gate;
  });
  const engine = $<HTMLInputElement>('#delivery-3-modular-engine')!,
    framework = $<HTMLInputElement>('#delivery-3-versatile-framework')!;
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  // Typing starts in the second counter before the first is committed, and goes on while the
  // first one saves: the Saving indicator and the redraw after the save both leave it alone.
  type(framework, '12');
  type(engine, '5');
  engine.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal(framework.value, '12', 'kept while the Saving indicator comes on');
  type(framework, '124');
  release();
  await settle();
  assert.equal(state.deliveries['3-modular-engine'], 5);
  assert.equal(framework.value, '124', 'kept after the other counter saved');
  framework.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(state.deliveries['3-versatile-framework'], 124, 'the typed count is saved');
  assert.equal(framework.value, '124');
  assert.equal(engine.value, '5');
}
