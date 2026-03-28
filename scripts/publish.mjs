#!/usr/bin/env node
/**
 * One-command release: bump version → commit → tag → push → trigger CI.
 *
 * Usage:
 *   node scripts/publish.mjs          # interactive version select
 *   node scripts/publish.mjs patch    # auto bump patch
 *   node scripts/publish.mjs minor    # auto bump minor
 *   node scripts/publish.mjs 1.0.0   # explicit version
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
}

function getVersion() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
  return pkg.version
}

// Step 1: Check working tree is clean
try {
  execSync('git diff --quiet && git diff --cached --quiet', { cwd: root })
} catch {
  console.error('❌ Working tree is not clean. Commit or stash changes first.')
  process.exit(1)
}

// Step 2: Bump version
const versionArg = process.argv[2] || ''
const bumppFiles = 'package.json mcp-server/package.json src-tauri/tauri.conf.json'
const bumppCmd = versionArg
  ? `npx bumpp ${versionArg} --all --no-push --no-tag --files ${bumppFiles}`
  : `npx bumpp --all --no-push --no-tag --files ${bumppFiles}`

console.log('📦 Bumping version...')
run(bumppCmd)

const newVersion = getVersion()
console.log(`\n✅ Version bumped to ${newVersion}`)

// Step 3: Tag and push
const tag = `v${newVersion}`
console.log(`\n🏷️  Creating tag ${tag}...`)
run(`git tag ${tag}`)
run(`git push && git push origin ${tag}`)

console.log(`
✅ Release ${tag} published!

GitHub Actions will now:
  1. Build the MCP server bundle
  2. Build the Tauri desktop app (Windows)
  3. Create a draft release with all assets

👉 Go to https://github.com/tianzexiang/loopy/releases to review and publish.
`)
