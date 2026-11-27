#!/usr/bin/env node
// Stages the deployable app shell into a directory that Cloudflare Pages can
// serve as-is. Only files listed here are published: notes, tests and internal
// task documents stay out of the public site.
//
// After staging, the build:
//   1. checks that every local entry precached by sw.js really exists, so a
//      missing file cannot break the offline shell in production;
//   2. stamps a content hash into the CACHE_NAME of the published sw.js, so a
//      new deploy always invalidates the previous service worker cache.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'dist');

const APP_FILES = ['index.html', 'manifest.json', 'sw.js', '_headers'];
const APP_DIRS = ['css', 'js', 'icons'];
const SERVICE_WORKER = 'sw.js';

function parseOutputDir(argv) {
  const index = argv.findIndex((arg) => arg === '--out' || arg.startsWith('--out='));
  if (index === -1) return DEFAULT_OUT;
  const arg = argv[index];
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1];
  if (!value) throw new Error('--out requires a directory');
  return path.resolve(ROOT, value);
}

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, base)));
    } else {
      files.push(path.relative(base, full));
    }
  }
  return files;
}

function serviceWorkerShell(swSource) {
  const block = swSource.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  if (!block) throw new Error('sw.js does not declare an APP_SHELL array');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

async function assertShellIsComplete(out, swSource) {
  const missing = [];
  for (const entry of serviceWorkerShell(swSource)) {
    if (!entry.startsWith('./')) continue; // third-party CDN entries
    const target = path.join(out, entry.slice(2) || 'index.html');
    try {
      await stat(target);
    } catch {
      missing.push(entry);
    }
  }
  if (missing.length > 0) {
    throw new Error(`sw.js precaches files the build did not publish: ${missing.join(', ')}`);
  }
}

async function stampCacheName(out, swSource) {
  const assigned = swSource.match(/const CACHE_NAME = '([^']+)';/);
  if (!assigned) throw new Error('sw.js does not declare CACHE_NAME');

  const files = (await listFiles(out)).filter((file) => file !== SERVICE_WORKER).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(path.join(out, file)));
  }
  const cacheName = `${assigned[1]}-${hash.digest('hex').slice(0, 8)}`;

  const stamped = swSource.replace(assigned[0], `const CACHE_NAME = '${cacheName}';`);
  await writeFile(path.join(out, SERVICE_WORKER), stamped);
  return cacheName;
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

  const swSource = await readFile(path.join(ROOT, SERVICE_WORKER), 'utf8');
  await assertShellIsComplete(out, swSource);
  const cacheName = await stampCacheName(out, swSource);

  const files = await listFiles(out);
  console.log(`built ${files.length} files into ${path.relative(ROOT, out) || out}`);
  console.log(`service worker cache: ${cacheName}`);
}

build().catch((error) => {
  console.error(`build failed: ${error.message}`);
  process.exitCode = 1;
});
