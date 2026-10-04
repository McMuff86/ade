/**
 * Runtime import graph of TypeScript sources, for boundary checks.
 *
 * Follows static imports, side-effect imports, value re-exports, `require()`
 * and dynamic `import()` with string literals, resolving them the way
 * tsconfig.node.json does. Type-only imports and exports (`import type`,
 * `export type`, `import { type X }` when every binding is a type, and
 * `typeof import('x')` in type positions) are erased at build time and do not
 * count. An unmarked import that happens to be used only as a type does count:
 * the check stays on the safe side instead of predicting elision.
 *
 * Packages are recorded but not followed; only repository sources are walked.
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ImportGraph {
  /** Repository source files reached from the entries, relative to the root. */
  modules: string[];
  /** Package specifiers reached, mapped to the shortest chain that reaches them. */
  packages: Map<string, string[]>;
  /** Shortest chain from an entry to each reached source file. */
  chains: Map<string, string[]>;
}

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** TypeScript reports resolved files with forward slashes on every platform; keep one spelling. */
const slashes = (path: string): string => path.replace(/\\/g, '/');
const relativeTo = (root: string, file: string): string => slashes(relative(root, file));

function compilerOptions(): ts.CompilerOptions {
  const configPath = resolve(REPOSITORY, 'tsconfig.node.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options;
}

function allTypeOnly(clause: ts.ImportClause): boolean {
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return Boolean(bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
    && bindings.elements.every((element) => element.isTypeOnly));
}

/** Runtime module specifiers of one source file. */
export function runtimeSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true);
  const found: string[] = [];
  const literal = (node: ts.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : null);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier && !(node.importClause && allTypeOnly(node.importClause))) found.push(specifier);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      const typeOnly = node.isTypeOnly || Boolean(node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly));
      if (specifier && !typeOnly) found.push(specifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literal(node.moduleReference.expression);
      if (specifier) found.push(specifier);
      return;
    }
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const specifier = literal(node.arguments[0]);
      if ((isRequire || isDynamicImport) && specifier) found.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Package name of a bare specifier (`electron/main` → `electron`, `@a/b/c` → `@a/b`). */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

export function importGraph(entries: string[], root: string = REPOSITORY): ImportGraph {
  const options = compilerOptions();
  const chains = new Map<string, string[]>();
  const packages = new Map<string, string[]>();
  const queue: string[] = [];
  for (const entry of entries) {
    const absolute = slashes(resolve(root, entry));
    chains.set(absolute, [relativeTo(root, absolute)]);
    queue.push(absolute);
  }
  while (queue.length > 0) {
    const file = queue.shift()!;
    const chain = chains.get(file)!;
    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier.startsWith('node:')) continue;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      const target = resolved && slashes(resolved.resolvedFileName);
      const local = target && !resolved.isExternalLibraryImport && !target.includes('/node_modules/')
        && !target.endsWith('.d.ts');
      if (local) {
        if (!chains.has(target)) { chains.set(target, [...chain, relativeTo(root, target)]); queue.push(target); }
        continue;
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        const name = packageName(specifier);
        if (!packages.has(name)) packages.set(name, [...chain, specifier]);
      }
    }
  }
  return {
    modules: [...chains.keys()].map((file) => relativeTo(root, file)).sort(),
    packages,
    chains: new Map([...chains].map(([file, value]) => [relativeTo(root, file), value])),
  };
}
