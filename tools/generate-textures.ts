#!/usr/bin/env node
/**
 * Writes the demo's textures to disk.
 *
 *   node tools/generate-textures.ts [--out <dir>]
 *
 * The PNGs are committed, so this only needs running after a change to the
 * generators. `tests/render/textures.test.ts` compares the committed files
 * against freshly generated pixels, so they cannot silently drift.
 *
 * Run with Node's native TypeScript stripping (Node >= 22.18), which is why the
 * code here avoids non-erasable syntax.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './textures/png.ts';
import { TEXTURES } from './textures/index.ts';

const DEFAULT_OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/textures');

export interface WriteResult {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export function writeTextures(outDir: string): WriteResult[] {
  mkdirSync(outDir, { recursive: true });

  return TEXTURES.map((definition) => {
    const image = definition.generate();
    const png = encodePng(image);
    const path = resolve(outDir, definition.name);
    writeFileSync(path, png);

    return {
      name: definition.name,
      path,
      bytes: png.byteLength,
      width: image.width,
      height: image.height,
    };
  });
}

function parseOutDir(argv: readonly string[]): string {
  const index = argv.indexOf('--out');
  if (index === -1) return DEFAULT_OUT;
  const value = argv[index + 1];
  if (!value) throw new Error('--out needs a directory');
  return resolve(value);
}

function main(): void {
  const outDir = parseOutDir(process.argv.slice(2));
  const cwd = process.cwd();

  console.log(`generating textures into ${relative(cwd, outDir) || '.'}`);
  let total = 0;
  for (const result of writeTextures(outDir)) {
    total += result.bytes;
    console.log(
      `  ${result.name.padEnd(24)} ${String(result.width).padStart(5)}x${String(result.height).padEnd(5)} ${(result.bytes / 1024).toFixed(1).padStart(7)} KiB`,
    );
  }
  console.log(`  ${String(TEXTURES.length).padStart(2)} files, ${(total / 1024).toFixed(1)} KiB total`);
}

// Only run when invoked directly, so tests can import `writeTextures`.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  main();
}
