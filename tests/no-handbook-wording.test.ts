// "Handbook" is gone from what users see (decision 8 on #387, #802). This replaces the old Vitest
// check that rendered every page, dialog, wizard step and ADA remark of a migrated and a
// calculated profile and searched the drawn text (20 s, #1274): that text can only come from the
// strings and template text the sources contain, so this reads the sources instead and fails on
// any string literal, template text or attribute value that says "handbook".
//
// Not read: comments, import and export paths, identifiers, and the literals in `allowed` below,
// which are data keys, not text a user sees, each in the files named with it only. A new use of
// the word in text a user could see fails here and gets another word (the profile's "original
// plan"); a new internal key goes in `allowed` with its reason and its files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';

const root = fileURLToPath(new URL('..', import.meta.url));
const HANDBOOK = /handbook/i;

// Where text can reach a user: the frontend, and the planner and server that send it text.
const SHOWN = /^(?:public\/|planner\/|server\/|[^/]+\.ts$)/;
// The scripts that never ship: the build, the browser check and the config.
const NOT_SHIPPED = new Set(['browser-check.ts', 'build.ts', 'vite.config.ts']);

// Literals that hold the word and are never drawn, each with the files it may appear in: the same
// literal in another file fails too. Everything else fails.
const allowed: Record<string, { reason: string; files: string[] }> = {
  'handbook-': {
    reason:
      "the migrated plan's engine id prefix ('handbook-…', #486, #487), matched with startsWith",
    files: [
      'public/handbook-migration.ts',
      'public/app/views/storage.ts',
      'public/app/ui/pages/StoragePage.vue',
    ],
  },
  'pre-handbook': {
    reason: 'the stored record kept as it was before the handbook migration (#497), a key',
    files: ['public/browser-store.ts'],
  },
  '.pre-handbook': {
    reason: 'the same record as a file beside the profile store on the server',
    files: ['server/persistence.ts'],
  },
  '../migrations/handbook-2026-09-13.json': {
    reason: 'the frozen migration data the server reads (never sent to a user)',
    files: ['server/persistence.ts'],
  },
  handbook: {
    reason: 'the legacy profile kind in handbook-migration.ts, a type literal and a comparison',
    files: ['public/handbook-migration.ts'],
  },
};
const allowedIn = (file: string, text: string) =>
  Object.hasOwn(allowed, text) && allowed[text]!.files.includes(file);

// The files git tracks, or would track, with the word in them (a cheap filter: parsing every
// file would take seconds).
function candidates(): string[] {
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '*.ts',
      '*.vue',
      '*.html',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return listed
    .split('\0')
    .filter(f => f && SHOWN.test(f) && !NOT_SHIPPED.has(f) && !f.endsWith('.d.ts'))
    .filter(f => HANDBOOK.test(readFileSync(root + f, 'utf8')));
}

// Every string, and every piece of a template string, of some TypeScript that says the word.
function scriptHits(code: string): string[] {
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return; // module paths
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      if (HANDBOOK.test(node.text)) hits.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return hits;
}

type TemplateNode = {
  type: number;
  content?: string | { content: string };
  props?: { type: number; value?: { content: string }; exp?: { content: string } }[];
  children?: unknown[];
};

// The text of a Vue file that says the word: its script, and its template's text, attribute
// values and expressions (an HTML comment is not drawn).
function vueHits(code: string): string[] {
  const { descriptor } = parse(code);
  const hits: string[] = [];
  for (const block of [descriptor.script, descriptor.scriptSetup])
    if (block) hits.push(...scriptHits(block.content));
  const visit = (node: TemplateNode) => {
    if (node.type === 2 && typeof node.content === 'string' && HANDBOOK.test(node.content))
      hits.push(node.content.trim());
    if (node.type === 5 && typeof node.content === 'object')
      hits.push(...scriptHits('(' + node.content.content + ')'));
    for (const prop of node.props ?? []) {
      if (prop.type === 6 && prop.value && HANDBOOK.test(prop.value.content))
        hits.push(prop.value.content);
      if (prop.type === 7 && prop.exp) hits.push(...scriptHits('(' + prop.exp.content + ')'));
    }
    for (const child of node.children ?? [])
      if (typeof child === 'object') visit(child as TemplateNode);
  };
  if (descriptor.template?.ast) visit(descriptor.template.ast);
  return hits;
}

function hitsIn(file: string): string[] {
  const code = readFileSync(root + file, 'utf8');
  if (file.endsWith('.vue')) return vueHits(code);
  if (file.endsWith('.html'))
    return HANDBOOK.test(code.replace(/<!--[\s\S]*?-->/g, '')) ? [code] : [];
  return scriptHits(code);
}

test('the check finds the word in every place a user could read it', () => {
  assert.deepEqual(scriptHits('const a = "the Handbook says"; // handbook'), ['the Handbook says']);
  assert.deepEqual(scriptHits('const a = `x ${y} handbook ${z}`'), [' handbook ']);
  assert.deepEqual(scriptHits('import a from "./handbook.ts"; const handbook = 1;'), []);
  const sfc = (template: string, script = '') =>
    `<template>${template}</template><script setup lang="ts">${script}</script>`;
  assert.deepEqual(vueHits(sfc('<p>The handbook</p>')), ['The handbook']);
  assert.deepEqual(vueHits(sfc('<p title="Handbook">x</p>')), ['Handbook']);
  assert.deepEqual(vueHits(sfc('<p :title="`a handbook`">x</p>')), ['a handbook']);
  assert.deepEqual(vueHits(sfc('<p>{{ "handbook" }}</p>')), ['handbook']);
  assert.deepEqual(vueHits(sfc('<p>x</p>', 'const a = "handbook"')), ['handbook']);
  assert.deepEqual(vueHits(sfc('<!-- handbook --><p>x</p>', '// handbook')), []);
});

test('no string, template text or attribute in the sources says "handbook" (decision 8, #802)', () => {
  const files = candidates();
  assert.ok(files.length > 5, 'the files that still mention the migration were found');
  const found: string[] = [];
  for (const file of files)
    for (const text of hitsIn(file))
      if (!allowedIn(file, text))
        found.push(`${file}: "${text.replace(/\s+/g, ' ').slice(0, 100)}"`);
  assert.deepEqual(found, [], 'text a user could read says "handbook"; use "original plan"');
});

test('every allowed literal is still used, in each of its files', () => {
  const files = candidates();
  for (const [text, { files: its }] of Object.entries(allowed))
    for (const file of its)
      assert.ok(files.includes(file) && hitsIn(file).includes(text), `"${text}" is in ${file}`);
});

test('an allowed literal in a file not named with it still fails', () => {
  assert.equal(allowedIn('public/handbook-migration.ts', 'handbook'), true);
  assert.equal(allowedIn('public/app/ui/pages/HomePage.vue', 'handbook'), false);
  assert.equal(allowedIn('server/persistence.ts', 'pre-handbook'), false);
  assert.equal(allowedIn('public/browser-store.ts', 'constructor'), false);
});
