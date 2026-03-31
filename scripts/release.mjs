#!/usr/bin/env node
/**
 * Build a release package ready for distribution.
 * Output: release/loopy/
 *
 * Usage:
 *   node scripts/release.mjs [version]
 *   e.g. node scripts/release.mjs 0.3.0
 *
 * If version is provided, CHANGELOG.md is auto-updated from git commits.
 */

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'release/loopy')

const isWin = process.platform === 'win32'
const guiExe = isWin
  ? resolve(root, 'src-tauri/target/release/loopy.exe')
  : resolve(root, 'src-tauri/target/release/loopy')
const bundle = resolve(root, 'mcp-server/dist/bundle.mjs')

const version = process.argv[2]

// ── Auto-generate CHANGELOG ──────────────────────────────────────────
if (version) {
  console.log(`📝 Generating changelog for v${version}...\n`)
  const changelogPath = resolve(root, 'CHANGELOG.md')

  let lastTag = ''
  try {
    lastTag = execSync('git describe --tags --abbrev=0', { cwd: root, encoding: 'utf-8' }).trim()
  } catch { /* no previous tag */ }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const log = execSync(`git log ${range} --pretty=format:"- %s" --no-merges`, {
    cwd: root, encoding: 'utf-8',
  }).trim()

  if (log) {
    const date = new Date().toISOString().slice(0, 10)
    const section = `## v${version} (${date})\n\n${log}\n`
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf-8') : ''
    const header = '# Changelog\n\n'
    const body = existing.startsWith(header) ? existing.slice(header.length) : existing
    writeFileSync(changelogPath, `${header}${section}\n${body}`, 'utf-8')
    console.log(`   Added ${log.split('\n').length} entries to CHANGELOG.md\n`)
  } else {
    console.log('   No new commits since last tag.\n')
  }
}

// ── Build ────────────────────────────────────────────────────────────
console.log('📦 Building release package...\n')

console.log('1/3  Bundling MCP server...')
execSync('npm run bundle', { cwd: resolve(root, 'mcp-server'), stdio: 'inherit' })

if (!existsSync(guiExe)) {
  console.log('2/3  Building GUI (this takes a minute)...')
  execSync('npx tauri build', { cwd: root, stdio: 'inherit' })
} else {
  console.log('2/3  GUI binary exists, skipping build.')
}

console.log('3/3  Packaging...')
if (existsSync(outDir)) rmSync(outDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

cpSync(bundle, resolve(outDir, 'server.mjs'))
cpSync(guiExe, resolve(outDir, isWin ? 'loopy.exe' : 'loopy'))
cpSync(resolve(root, 'setup.mjs'), resolve(outDir, 'setup.mjs'))
cpSync(resolve(root, 'README.md'), resolve(outDir, 'README.md'))
cpSync(resolve(root, 'pua-rules.md'), resolve(outDir, 'pua-rules.md'))
const changelogSrc = resolve(root, 'CHANGELOG.md')
if (existsSync(changelogSrc)) cpSync(changelogSrc, resolve(outDir, 'CHANGELOG.md'))

console.log(`\n✅ Release package ready: ${outDir}`)
console.log('   Files:')
console.log('     server.mjs')
console.log(`     loopy${isWin ? '.exe' : ''}`)
console.log('     setup.mjs')
console.log('     README.md')
console.log('     pua-rules.md')
console.log('     CHANGELOG.md')
