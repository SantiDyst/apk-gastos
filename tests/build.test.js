import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('the build stages only the deployable app shell', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'apk-build-'));
  try {
    const result = runBuild(['--out', out]);
    assert.equal(result.status, 0, result.stderr);
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
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the build refuses to write into the repository root', async () => {
  const result = runBuild(['--out', '.']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to build into the repository root/);
  assert.ok(existsSync(path.join(ROOT, 'index.html')), 'the repository must stay intact');
});
