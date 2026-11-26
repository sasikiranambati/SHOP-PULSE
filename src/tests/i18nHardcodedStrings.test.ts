/**
 * Hardcoded user-facing text ratchet.
 *
 * Scans application source (not tests, not translation dictionaries) for literal English text in
 * JSX, in UI attributes (placeholder, title, aria-label, alt) and in alert/confirm/toast calls.
 *
 * - The total must not exceed HARDCODED_BASELINE. Lower the baseline when strings are migrated;
 *   never raise it to make a test pass.
 * - Files listed in MIGRATED_FILES must contain no hardcoded strings at all.
 */
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

/** Current count of hardcoded strings. Only ever lowered as strings are migrated. */
export const HARDCODED_BASELINE = 703;

/** Surfaces already fully migrated to translation keys. Must stay at zero. */
export const MIGRATED_FILES = ['pages/Insights.tsx'];

const UI_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'helperText', 'emptyMessage']);
const UI_CALLS = new Set(['alert', 'confirm', 'toast', 'showToast', 'success', 'error', 'info', 'warning']);
const HAS_LETTERS = /[A-Za-zऀ-෿]{2,}/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (/^(tests?|locales|scripts|__.*)$/.test(entry) || full.endsWith(path.join('src', 'i18n'))) continue;
      sourceFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Finding {
  file: string;
  kind: string;
  text: string;
}

export function findHardcodedStrings(): Finding[] {
  const findings: Finding[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const t = node.getText().trim();
        if (t && HAS_LETTERS.test(t)) findings.push({ file: rel, kind: 'jsx-text', text: t });
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const name = node.name.getText();
        if (UI_ATTRS.has(name) && HAS_LETTERS.test(node.initializer.text)) {
          findings.push({ file: rel, kind: `attr:${name}`, text: node.initializer.text });
        }
      }
      if (ts.isCallExpression(node)) {
        const last = node.expression.getText().split('.').pop() ?? '';
        const first = node.arguments[0];
        if (UI_CALLS.has(last) && first && ts.isStringLiteral(first) && HAS_LETTERS.test(first.text)) {
          findings.push({ file: rel, kind: `call:${last}`, text: first.text });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

describe('hardcoded user-facing text', () => {
  const findings = findHardcodedStrings();

  it('does not grow beyond the recorded baseline', () => {
    expect(findings.length).toBeLessThanOrEqual(HARDCODED_BASELINE);
  });

  for (const file of MIGRATED_FILES) {
    it(`${file} has no hardcoded strings`, () => {
      const left = findings.filter((f) => f.file === file).map((f) => `${f.kind}: ${f.text.slice(0, 60)}`);
      expect(left).toEqual([]);
    });
  }
});
