#!/usr/bin/env node
// Stages the deployable app shell into a directory that Cloudflare Pages can
// serve as-is. Only files listed here are published: notes, tests and internal
// task documents stay out of the public site.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'dist');

const APP_FILES = ['index.html', 'manifest.json', 'sw.js', '_headers'];
const APP_DIRS = ['css', 'js', 'icons'];

function parseOutputDir(argv) {
  const index = argv.findIndex((arg) => arg === '--out' || arg.startsWith('--out='));
  if (index === -1) return DEFAULT_OUT;
  const arg = argv[index];
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1];
  if (!value) throw new Error('--out requires a directory');
  return path.resolve(ROOT, value);
}

async function countFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await countFiles(full) : 1;
  }
  return total;
}

async function build() {
  const out = parseOutputDir(process.argv.slice(2));
  if (out === ROOT) throw new Error('refusing to build into the repository root');

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const file of APP_FILES) {
    await cp(path.join(ROOT, file), path.join(out, file));
  }
  for (const dir of APP_DIRS) {
    await cp(path.join(ROOT, dir), path.join(out, dir), { recursive: true });
  }

  const files = await countFiles(out);
  console.log(`built ${files} files into ${path.relative(ROOT, out) || out}`);
}

build().catch((error) => {
  console.error(`build failed: ${error.message}`);
  process.exitCode = 1;
});
