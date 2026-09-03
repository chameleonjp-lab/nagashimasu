import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('domain boundaries', () => {
  it('does not depend on browser state, wall-clock time, or nondeterministic randomness', () => {
    const domainDirectory = new URL('../../src/domain/', import.meta.url);
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\blocalStorage\b/,
      /\brequestAnimationFrame\b/,
      /\bperformance\.now\b/,
      /\bDate\.now\b/,
      /\bMath\.random\b/,
      /\bCanvasRenderingContext2D\b/
    ];

    for (const file of listTypeScriptFiles(domainDirectory.pathname)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(source, `${file} must not contain ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('does not import Three.js from the domain or application layers', () => {
    const sourceDirectories = [
      new URL('../../src/domain/', import.meta.url),
      new URL('../../src/application/', import.meta.url)
    ];
    const forbidden = [
      /from\s+['"][^'"]*three(?:\.js)?['"]/u,
      /import\s*\([^)]*three(?:\.js)?/u,
      /require\s*\([^)]*three(?:\.js)?/u
    ];

    for (const directory of sourceDirectories) {
      for (const file of listTypeScriptFiles(directory.pathname)) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of forbidden) {
          expect(source, `${file} must not contain ${String(pattern)}`).not.toMatch(pattern);
        }
      }
    }
  });
});
