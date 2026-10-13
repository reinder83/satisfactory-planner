// The glossary (#1076, public/preferences/glossary.ts): every term a new player asked about has a
// definition and where to get it, a text splits at the first occurrence of each term without
// changing a character, and a screen of texts marks each term once. docs/USER-GUIDE.md lists the
// same terms under "Glossary".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { firstTerms, glossary, termParts } from '../public/preferences.ts';

// The terms the playtest asked for (N6, N13): MAM, SAM, slugs, shards, hard drives, AWESOME Sink
// and underclock.
const ASKED = ['mam', 'sam', 'slugs', 'shards', 'drives', 'sink', 'underclock'];

test('every asked-for term has a definition and where to get it', () => {
  for (const key of ASKED) {
    const entry = glossary[key];
    assert.ok(entry, key);
    assert.ok(entry.definition.length > 20, key + ' definition');
    assert.ok(entry.where.length > 20, key + ' where');
  }
  for (const [key, entry] of Object.entries(glossary)) {
    assert.match(entry.label, entry.match, key + ' matches its own label');
    assert.equal(entry.match.flags.includes('g'), false, key + ' is not a global pattern');
  }
});

test('the asked-for words are recognized as written in the planner', () => {
  const found = (text: string) =>
    termParts(text)
      .filter(part => part.term)
      .map(part => [part.term, part.text]);
  assert.deepEqual(found('Analyse the hard drives in the MAM.'), [
    ['drives', 'hard drives'],
    ['mam', 'MAM'],
  ]);
  assert.deepEqual(found('Slugs into Power Shards, then the AWESOME Sink.'), [
    ['slugs', 'Slugs'],
    ['shards', 'Power Shards'],
    ['sink', 'AWESOME Sink'],
  ]);
  assert.deepEqual(found('The last machine underclocked; SAM Fluctuators.'), [
    ['underclock', 'underclocked'],
    ['sam', 'SAM'],
  ]);
  // Not inside other words.
  assert.deepEqual(found('Samples, sinkholes, overclocking-free.'), [
    ['overclock', 'overclocking'],
  ]);
});

test('a text splits at the first occurrence of each term and joins back unchanged', () => {
  const text = 'The MAM researches Power Shards; the MAM again, and Power Shards again.';
  const parts = termParts(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(
    parts.filter(part => part.term).map(part => part.term),
    ['mam', 'shards'],
  );
  assert.deepEqual(termParts('Nothing to explain.'), [{ text: 'Nothing to explain.' }]);
  assert.deepEqual(termParts(''), [{ text: '' }]);
  // Only the terms asked for.
  assert.deepEqual(
    termParts(text, ['shards'])
      .filter(part => part.term)
      .map(part => part.term),
    ['shards'],
  );
});

test('a screen marks each term once, in the first text that has it', () => {
  assert.deepEqual(
    firstTerms(['Build the MAM.', 'Feed the MAM a hard drive.', 'Plain words.', 'A hard drive.']),
    [['mam'], ['drives'], [], []],
  );
});

test('the user guide lists every glossary term', () => {
  const guide = fs.readFileSync(new URL('../docs/USER-GUIDE.md', import.meta.url), 'utf8');
  const section = guide.slice(guide.indexOf('## Glossary'));
  assert.ok(guide.includes('## Glossary'));
  for (const entry of Object.values(glossary))
    assert.ok(section.includes(`**${entry.label}**`), entry.label);
});
