import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runBuild(args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

async function withBuildOutput(run) {
  const out = await mkdtemp(path.join(tmpdir(), 'apk-build-'));
  try {
    const result = runBuild(['--out', out]);
    assert.equal(result.status, 0, result.stderr);
    return await run(out, result);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

test('the build stages only the deployable app shell', async () => {
  await withBuildOutput(async (out, result) => {
    assert.match(result.stdout, /^built \d+ files/);

    for (const file of [
      'index.html',
      'manifest.json',
      'sw.js',
      '_headers',
      'css/styles.css',
      'js/app.js',
      'js/config.js',
      'js/drive-sync.js',
      'icons/icon-192.png'
    ]) {
      assert.ok(existsSync(path.join(out, file)), `${file} should be published`);
    }

    for (const hidden of ['notas', 'tests', 'odd', 'scripts', 'package.json', 'README.md', '.git']) {
      assert.ok(!existsSync(path.join(out, hidden)), `${hidden} must not be published`);
    }
  });
});

test('every local service worker shell entry is published', async () => {
  const swSource = await readFile(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = [...swSource.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((entry) => entry.startsWith('./'));

  await withBuildOutput(async (out) => {
    for (const entry of shell) {
      assert.ok(existsSync(path.join(out, entry.slice(2) || 'index.html')), `${entry} is missing from the build`);
    }
  });
});

test('the published service worker gets a content based cache name', async () => {
  const source = await readFile(path.join(ROOT, 'sw.js'), 'utf8');
  const sourceName = source.match(/const CACHE_NAME = '([^']+)';/)[1];

  const first = await withBuildOutput(async (out) => {
    const published = await readFile(path.join(out, 'sw.js'), 'utf8');
    return published.match(/const CACHE_NAME = '([^']+)';/)[1];
  });

  assert.match(first, new RegExp(`^${sourceName}-[0-9a-f]{8}$`));

  const second = await withBuildOutput(async (out) => {
    const published = await readFile(path.join(out, 'sw.js'), 'utf8');
    return published.match(/const CACHE_NAME = '([^']+)';/)[1];
  });

  assert.equal(second, first, 'the same assets must produce the same cache name');
});

test('the build refuses to write into the repository root', async () => {
  const result = runBuild(['--out', '.']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to build into the repository root/);
  assert.ok(existsSync(path.join(ROOT, 'index.html')), 'the repository must stay intact');
});
