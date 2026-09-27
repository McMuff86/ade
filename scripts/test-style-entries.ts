/**
 * Focused checks for the split renderer stylesheets.
 *
 * graph.css and rightpanel.css are entries: they hold only ordered `@import`s
 * of one stylesheet per surface, and that order is the cascade order. The
 * checks keep it that way: no rules in an entry, every part imported exactly
 * once and by the entry only (a component importing a part would load it a
 * second time at a different cascade position), no orphaned part, and no
 * selector defined twice in one context, which is how the former override
 * blocks grew.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPOSITORY, 'src');
const ENTRIES = ['src/renderer/graph/graph.css', 'src/renderer/rightpanel/rightpanel.css'];

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule selector with its at-rule context; keyframe bodies are skipped. */
function ruleSelectors(css: string): { context: string; selector: string }[] {
  const text = withoutComments(css);
  const found: { context: string; selector: string }[] = [];
  const contexts: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '{') {
      const prelude = text.slice(start, index).trim().replace(/\s+/g, ' ');
      if (/^@(media|container|supports)\b/.test(prelude)) {
        contexts.push(prelude);
        start = index + 1;
      } else {
        let depth = 1;
        let end = index + 1;
        while (end < text.length && depth > 0) {
          if (text[end] === '{') depth += 1;
          if (text[end] === '}') depth -= 1;
          end += 1;
        }
        if (!prelude.startsWith('@')) {
          found.push({ context: contexts.join(' '), selector: prelude.replace(/\s*,\s*/g, ', ') });
        }
        index = end;
        start = end;
        continue;
      }
    } else if (char === '}') {
      contexts.pop();
      start = index + 1;
    } else if (char === ';' && text.slice(start, index).trim().startsWith('@')) {
      start = index + 1;
    }
    index += 1;
  }
  return found;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'test-results' && entry.name !== 'node_modules') files.push(...sourceFiles(path));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const sources = sourceFiles(SOURCE);
const scriptImports = sources
  .filter((path) => /\.tsx?$/.test(path))
  .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
    .map((match) => ({ from: path, target: resolve(dirname(path), match[1]!) })));

for (const entryPath of ENTRIES) {
  const entry = join(REPOSITORY, entryPath);
  const name = basename(entryPath);
  const folder = dirname(entry);
  const text = withoutComments(readFileSync(entry, 'utf8'));
  const statements = text.split(';').map((statement) => statement.trim()).filter(Boolean);
  const imports = statements.map((statement) => /^@import\s+'\.\/([\w-]+\.css)'$/.exec(statement)?.[1]);

  check(`${name} holds only @import statements`, imports.every(Boolean) && !text.includes('{'), statements);
  const parts = imports.filter((part): part is string => Boolean(part));
  check(`${name} imports every part once`, new Set(parts).size === parts.length && parts.length >= 5, parts);
  check(`${name} parts all exist`, parts.every((part) => existsSync(join(folder, part))),
    parts.filter((part) => !existsSync(join(folder, part))));

  const partPaths = parts.map((part) => join(folder, part));
  check(`${name} parts contain no nested @import`,
    partPaths.every((path) => !/@import\b/.test(withoutComments(readFileSync(path, 'utf8')))));
  const directImports = scriptImports.filter((item) => partPaths.includes(item.target));
  check(`${name} parts are imported by the entry only`, directImports.length === 0,
    directImports.map((item) => `${relative(REPOSITORY, item.from)} → ${basename(item.target)}`));
  check(`${name} entry is imported by a component`, scriptImports.some((item) => item.target === entry));

  const siblings = readdirSync(folder).filter((file) => file.endsWith('.css') && file !== name);
  const orphans = siblings.filter((file) => !parts.includes(file)
    && !scriptImports.some((item) => item.target === join(folder, file)));
  check(`${name} leaves no orphaned stylesheet in its folder`, orphans.length === 0, orphans);

  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const path of partPaths) {
    for (const rule of ruleSelectors(readFileSync(path, 'utf8'))) {
      const key = `${rule.context} ${rule.selector}`;
      const first = seen.get(key);
      if (first) duplicates.push(`${rule.context ? `${rule.context} ` : ''}${rule.selector} (${first}, ${basename(path)})`);
      else seen.set(key, basename(path));
    }
  }
  check(`${name} defines no selector twice in one context`, duplicates.length === 0, duplicates);
  check(`${name} parts define rules`, seen.size > 50, seen.size);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
