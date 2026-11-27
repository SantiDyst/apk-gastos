#!/usr/bin/env node
// Publishes the staged build to Cloudflare Pages as a *production* deployment.
//
// Why the temp directory: `wrangler pages deploy` infers the deployment branch
// from the current Git checkout. Running it inside the repository therefore
// publishes a preview for that branch (for example
// `feat-google-drive-sync.<project>.pages.dev`), never production. Uploading
// from a directory outside any Git worktree makes wrangler publish to the
// project's production URL instead.
import { execFileSync, execSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_NAME = 'apk-gastos';

async function main() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  const staging = await mkdtemp(path.join(tmpdir(), 'apk-deploy-'));
  try {
    await cp(path.join(ROOT, 'dist'), staging, { recursive: true });
    // A shell is required on Windows: npx is a .cmd shim, and Node refuses to
    // spawn it directly. The command is a fixed string with no user input.
    execSync(`npx wrangler pages deploy . --project-name ${PROJECT_NAME}`, {
      cwd: staging,
      stdio: 'inherit',
      env: { ...process.env, CI: process.env.CI ?? '1' }
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`deploy failed: ${error.message}`);
  process.exitCode = 1;
});
