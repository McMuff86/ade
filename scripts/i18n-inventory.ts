/** Source inventory for the localization migration; never reads user/profile data. */
import ts from 'typescript';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { messagesDe } from '../src/shared/i18n/messages.de';
import { messagesEn } from '../src/shared/i18n/messages.en';

interface Entry { file: string; start: number; end: number; line: number; kind: string; parent: string; text: string; context: string }
const root = resolve('src'); const entries: Entry[] = [];
const words = (text: string) => text.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
const englishWords = new Set(Object.values(messagesEn).flatMap(words));
const germanWords = new Set(Object.values(messagesDe).flatMap(words).filter(word => !englishWords.has(word)));
const germanCopy = (text: string) => words(text).some(word => germanWords.has(word));
const attributes = new Set(['title', 'subtitle', 'label', 'placeholder', 'alt', 'aria-label', 'aria-description', 'description', 'hint', 'emptyMessage', 'message', 'tooltip', 'text', 'unavailableReason', 'confirmLabel', 'cancelLabel', 'submitLabel', 'emptyText', 'loadingText']);
function walk(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'i18n') walk(path); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    // These contain executable shell source and model instructions, not interface copy.
    if (['CoordinatorCodexPolicy.ts', 'CoordinatorConversation.ts'].includes(entry.name)) continue;
    const source = readFileSync(path, 'utf8'); const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
      if (ts.isCallExpression(node) && ['translate', 't', 'localizeAppMessage'].includes(node.expression.getText(file))) {
        for (const argument of node.arguments.slice(1)) visit(argument);
        return;
      }
      let text: string | undefined;
      if (ts.isJsxText(node)) text = node.text.trim().replace(/\s+/g, ' ');
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent;
        if (ts.isPropertyAssignment(parent) && parent.name === node || ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return;
        if (ts.isJsxAttribute(parent) && !attributes.has(parent.name.getText(file))) return;
        const labelProperty = ts.isPropertyAssignment(parent) && attributes.has(parent.name.getText(file).replace(/^['"]|['"]$/g, ''));
        const uiLabel = /[\\/](renderer|mobile|shared)[\\/]/.test(path) && /^[A-ZÄÖÜ][a-zäöüß][\p{L}\p{N} .,!?…:;()[\]–—·+%/'"„“→-]*$/u.test(node.text)
          && !ts.isBinaryExpression(parent) && !ts.isCaseClause(parent) && !ts.isCallExpression(parent);
        if (ts.isJsxAttribute(parent) || labelProperty || uiLabel || germanCopy(node.text) || /[äöüß]|\b(?:nicht|keine?|wird|werden|wurde|wieder|bitte|mit|und|oder|erst|öffnen|anzeigen|erstellen|speichern|löschen|laden|ist|sind|fehlt|fehlen|zulässig|Zugriff|Datei|Dateien|Projekt|Aufgabe|Auftrag|Verbindung|Ausgabe|Auswahl|Abbrechen|Schliessen|Hinweis|Einrichtung|Einstellungen|bereit|offen|beendet|aktiv|pausiert|fehlgeschlagen|gespeichert|ausstehend|unbekannte?|starten|neu|entfernen|bestätigt|Zurück|Weiter|arbeitet|ungültige?|gesperrt|Abbruch|abgebrochen|abgeschlossen|bereits|ohne|alle?|von|nach)\b/iu.test(node.text)) text = node.text;
      } else if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
        const combined = parts.join(' ');
        const parent = node.parent;
        const jsxCopy = ts.isJsxExpression(parent) && (!ts.isJsxAttribute(parent.parent) || attributes.has(parent.parent.name.getText(file)));
        if (jsxCopy || germanCopy(combined) || /[äöüß]|\b(?:nicht|keine?|wird|werden|mit|und|oder|ist|sind|fehlt|Projekt|Aufgabe|Auftrag|Datei|Dateien|fehlgeschlagen|unbekannt|bereit|geladen|geprüft|erkannt|gespeichert|Sitzung|Sek|Std|Zeichen)\b/iu.test(combined)) text = parts.map((part, index) => index ? `{{value${index}}}${part}` : part).join('');
      }
      if (text && /\p{L}/u.test(text)) {
        const start = node.getStart(file); const location = file.getLineAndCharacterOfPosition(start);
        entries.push({ file: relative(resolve('.'), path).replaceAll('\\', '/'), start, end: node.end, line: location.line + 1,
          kind: ts.SyntaxKind[node.kind]!, parent: ts.SyntaxKind[node.parent.kind]!, text,
          context: node.parent.getText(file).slice(0, 300) });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
}
walk(root);
mkdirSync('test-results/i18n', { recursive: true });
writeFileSync('test-results/i18n/inventory.json', JSON.stringify(entries, null, 2) + '\n');
const areas: Record<string, number> = {}; for (const entry of entries) { const area = entry.file.split('/')[1]!; areas[area] = (areas[area] ?? 0) + 1; }
console.log(JSON.stringify({ occurrences: entries.length, unique: new Set(entries.map(entry => entry.text)).size, areas }, null, 2));
