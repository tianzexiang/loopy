#!/usr/bin/env node
/**
 * Build a release package ready for distribution.
 * Output: release/loopy/
 */

import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
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

console.log(`\n✅ Release package ready: ${outDir}`)
console.log('   Files:')
console.log('     server.mjs')
console.log(`     loopy${isWin ? '.exe' : ''}`)
console.log('     setup.mjs')
console.log('     README.md')
console.log('     pua-rules.md')
