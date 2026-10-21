// The To-Do note of "Today's session" (#1073, public/app/todo-note.ts): never more than the 256
// characters the game's To-Do list takes, the builds first, then as many parts as fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteLength, TODO_LIMIT, todoNote } from '../public/app/todo-note.ts';

const parts: [string, number][] = [
  ['Copper Sheet', 60],
  ['Steel Pipe', 60],
  ['Encased Industrial Beam', 20],
  ['Motor', 20],
];

test('a short session reads in full', () => {
  assert.equal(
    todoNote(
      'Phase 3',
      [
        { title: 'Residual Plastic', buildings: '2 Refineries + 1 Water Extractor' },
        { title: 'Iron Plate', buildings: '6 Constructors' },
      ],
      parts,
    ),
    'Phase 3: 1) Residual Plastic: 2 Refineries + 1 Water Extractor; 2) Iron Plate: 6 Constructors. Parts: 60 Copper Sheet, 60 Steel Pipe, 20 Encased Industrial Beam, 20 Motor',
  );
  assert.equal(TODO_LIMIT, 256);
});

test('the note never passes 256 characters, however long the session', () => {
  const builds = Array.from({ length: 5 }, (_, i) => ({
    title: `Alternate: A Very Long Production Line Name Number ${i + 1}`,
    buildings: `${i + 10} Particle Accelerators + ${i + 3} Water Extractors`,
  }));
  const many: [string, number][] = Array.from({ length: 30 }, (_, i) => [`Part ${i}`, 1000 + i]);
  for (let count = 0; count <= builds.length; count++) {
    const note = todoNote('Post Phase 5', builds.slice(0, count), many);
    assert.ok(noteLength(note) <= TODO_LIMIT, `${count} builds: ${noteLength(note)} characters`);
    assert.ok(note.startsWith('Post Phase 5: '));
  }
  const note = todoNote('Phase 5', builds, many);
  // The builds keep their titles, without their buildings, and parts that do not fit are cut.
  assert.match(note, /^Phase 5: 1\) Alternate: A Very Long/);
  assert.ok(note.endsWith('…'));
});

test('parts are listed while they fit, then marked as cut', () => {
  const note = todoNote('Phase 1', [{ title: 'Iron Ingot', buildings: '3 Smelters' }], parts, 70);
  assert.equal(note, 'Phase 1: 1) Iron Ingot: 3 Smelters. Parts: 60 Copper Sheet, …');
  assert.ok(noteLength(note) <= 70);
});

test('a phase with nothing left to build says so', () => {
  assert.equal(todoNote('Phase 2', [], []), 'Phase 2: nothing left to build.');
});
