#!/usr/bin/env node
/**
 * component-audit.mjs
 * Audit and analyze O2 component usage and migration progress.
 *
 * Usage:
 *   node scripts/component-audit.mjs find   --pattern "OTabs|OTab" [--dir src] [--output file.txt]
 *   node scripts/component-audit.mjs diff   --from "q-tabs|q-tab" --to "OTabs|OTab" [--format markdown]
 *   node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs"
 *
 * Run from the web/ directory.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname, extname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── CLI arg parser ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    } else {
      args._.push(argv[i])
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0]

if (!command || command === 'help' || args.help) {
  printHelp()
  process.exit(0)
}

// ── File walker ───────────────────────────────────────────────────────────────

const VUE_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx'])

function walk(dir, fileList = []) {
  if (!existsSync(dir)) return fileList
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, fileList)
    } else if (VUE_EXTENSIONS.has(extname(entry))) {
      fileList.push(full)
    }
  }
  return fileList
}

function countMatches(content, pattern) {
  const re = new RegExp(pattern, 'g')
  return (content.match(re) || []).length
}

function resolveDir(dir) {
  if (!dir) return join(ROOT, 'src')
  if (dir.startsWith('/')) return dir
  return join(ROOT, dir)
}

function moduleKey(filePath, baseDir) {
  const rel = relative(baseDir, filePath)
  const parts = rel.split('/')
  // Group by top 2 path segments
  return parts.slice(0, 2).join('/')
}

// ── find command ──────────────────────────────────────────────────────────────

function cmdFind() {
  const pattern = args.pattern
  if (!pattern) {
    console.error('Error: --pattern is required for find command')
    process.exit(1)
  }

  const dir = resolveDir(args.dir)
  const files = walk(dir)
  const results = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const count = countMatches(content, pattern)
    if (count > 0) {
      results.push({ file, count, rel: relative(ROOT, file) })
    }
  }

  if (results.length === 0) {
    console.log(`\nNo usages found for pattern: ${pattern}\n`)
    return
  }

  // Group by module
  const modules = {}
  for (const r of results) {
    const mod = moduleKey(r.file, dir)
    if (!modules[mod]) modules[mod] = { files: 0, usages: 0 }
    modules[mod].files++
    modules[mod].usages += r.count
  }

  const totalFiles = results.length
  const totalUsages = results.reduce((s, r) => s + r.count, 0)
  const COL = 50

  console.log(`\nComponent usage: ${pattern}`)
  console.log('─'.repeat(72))
  console.log(` ${'Module'.padEnd(COL)}| Files | Usages`)
  console.log('─'.repeat(72))
  for (const [mod, stats] of Object.entries(modules).sort()) {
    console.log(` ${mod.padEnd(COL)}| ${String(stats.files).padStart(5) } | ${String(stats.usages).padStart(6)}`)
  }
  console.log('─'.repeat(72))
  console.log(` ${'TOTAL'.padEnd(COL)}| ${String(totalFiles).padStart(5)} | ${String(totalUsages).padStart(6)}`)
  console.log()
  console.log('Detailed file list:')
  for (const r of results.sort((a, b) => a.rel.localeCompare(b.rel))) {
    console.log(`  ${r.rel.padEnd(65)} (${r.count} usage${r.count !== 1 ? 's' : ''})`)
  }
  console.log()

  if (args.output) {
    const lines = [
      `Component usage: ${pattern}`,
      `Total: ${totalFiles} files, ${totalUsages} usages`,
      '',
      ...results.sort((a, b) => a.rel.localeCompare(b.rel)).map(r => `${r.rel} (${r.count})`),
    ]
    writeFileSync(args.output, lines.join('\n'))
    console.log(`Results written to: ${args.output}\n`)
  }
}

// ── diff command ──────────────────────────────────────────────────────────────

function cmdDiff() {
  const from = args.from
  const to = args.to
  const format = args.format || 'text'

  if (!from || !to) {
    console.error('Error: --from and --to are required for diff command')
    process.exit(1)
  }

  // Get current branch
  let branch = 'HEAD'
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch (_) { /* ignore */ }

  // Get default branch (main or master)
  let baseBranch = 'main'
  try {
    execSync('git show-ref --verify --quiet refs/heads/main', { cwd: ROOT })
  } catch (_) {
    try {
      execSync('git show-ref --verify --quiet refs/heads/master', { cwd: ROOT })
      baseBranch = 'master'
    } catch (_) { /* ignore */ }
  }

  // Get changed files in this branch
  let changedFiles = []
  try {
    const out = execSync(`git diff --name-only ${baseBranch}..HEAD`, { cwd: ROOT, encoding: 'utf8' })
    changedFiles = out.trim().split('\n').filter(f => VUE_EXTENSIONS.has(extname(f)) && existsSync(join(ROOT, '..', f)))
  } catch (_) {
    console.error('Error: could not run git diff. Make sure you are in a git repository.')
    process.exit(1)
  }

  // Analyze from patterns removed and to patterns added
  const fromRe = new RegExp(from, 'g')
  const toRe = new RegExp(to, 'g')

  const migratedFiles = []
  const mixedFiles = []
  const onlyOldFiles = []
  const onlyNewFiles = []

  let totalFromRemoved = 0
  let totalToAdded = 0

  for (const relFile of changedFiles) {
    const absFile = join(ROOT, '..', relFile)
    if (!existsSync(absFile)) continue

    // Get old (base) and new (HEAD) content via git
    let baseContent = ''
    let headContent = ''
    try {
      baseContent = execSync(`git show ${baseBranch}:"${relFile}" 2>/dev/null`, { cwd: join(ROOT, '..'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    } catch (_) { /* new file — no base content */ }
    try {
      headContent = readFileSync(absFile, 'utf8')
    } catch (_) { /* deleted file */ }

    const fromInBase = (baseContent.match(fromRe) || []).length
    const fromInHead = (headContent.match(fromRe) || []).length
    const toInBase = (baseContent.match(toRe) || []).length
    const toInHead = (headContent.match(toRe) || []).length

    const fromRemoved = Math.max(0, fromInBase - fromInHead)
    const toAdded = Math.max(0, toInHead - toInBase)

    if (fromRemoved === 0 && toAdded === 0) continue

    totalFromRemoved += fromRemoved
    totalToAdded += toAdded

    const hasOldNow = fromInHead > 0
    const hasNewNow = toInHead > 0

    if (fromRemoved > 0 && toAdded > 0) {
      if (hasOldNow) {
        mixedFiles.push({ file: relFile, fromRemoved, toAdded, remainingOld: fromInHead })
      } else {
        migratedFiles.push({ file: relFile, fromRemoved, toAdded })
      }
    } else if (fromRemoved > 0 && !hasOldNow && !hasNewNow) {
      // Old removed, nothing new
      onlyOldFiles.push({ file: relFile, fromRemoved, toAdded: 0 })
    } else if (toAdded > 0) {
      onlyNewFiles.push({ file: relFile, fromRemoved: 0, toAdded })
    }
  }

  if (format === 'markdown') {
    outputDiffMarkdown({ branch, baseBranch, from, to, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded })
  } else {
    outputDiffText({ branch, baseBranch, from, to, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded })
  }
}

function outputDiffText({ branch, baseBranch, from, to, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded }) {
  console.log(`\nMigration analysis: ${branch} vs ${baseBranch}`)
  console.log('─'.repeat(72))
  console.log(` OLD removed (${from})`)
  console.log(`   Files changed:  ${migratedFiles.length + mixedFiles.length + onlyOldFiles.length}`)
  console.log(`   Usages removed: ${totalFromRemoved}`)
  console.log()
  console.log(` NEW added (${to})`)
  console.log(`   Files changed:  ${migratedFiles.length + mixedFiles.length}`)
  console.log(`   Usages added:   ${totalToAdded}`)
  console.log()

  if (migratedFiles.length > 0) {
    console.log(` ✅ Modules fully migrated (old removed, new added):`)
    for (const f of migratedFiles) {
      console.log(`   ${f.file} (-${f.fromRemoved} old, +${f.toAdded} new)`)
    }
    console.log()
  }

  if (mixedFiles.length > 0) {
    console.log(` ⚠️  Modules partially migrated (still has old usages):`)
    for (const f of mixedFiles) {
      console.log(`   ${f.file} (${f.remainingOld} old remaining)`)
    }
    console.log()
  }

  const remaining = mixedFiles.length + onlyOldFiles.length
  if (remaining === 0) {
    console.log(` Files with OLD pattern still remaining:`)
    console.log(`   (none — migration complete ✅)`)
  } else {
    console.log(` ❌ Files with OLD pattern still remaining: ${remaining}`)
    for (const f of [...mixedFiles, ...onlyOldFiles]) {
      console.log(`   ${f.file}`)
    }
  }
  console.log()
}

function outputDiffMarkdown({ branch, baseBranch, from, to, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded }) {
  const lines = [
    `## Migration Report: \`${from}\` → \`${to}\``,
    ``,
    `Branch: \`${branch}\` vs \`${baseBranch}\``,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Files with old pattern removed | ${migratedFiles.length + mixedFiles.length + onlyOldFiles.length} |`,
    `| Old usages removed | ${totalFromRemoved} |`,
    `| New usages added | ${totalToAdded} |`,
    `| Fully migrated files | ${migratedFiles.length} ✅ |`,
    `| Partially migrated (mixed) | ${mixedFiles.length} ⚠️ |`,
    ``,
    `### Migrated Files`,
    ``,
    ...migratedFiles.map(f => `- ✅ \`${f.file}\``),
    migratedFiles.length === 0 ? '_None_' : '',
    ``,
    `### Partially Migrated (still contains old pattern)`,
    ``,
    ...mixedFiles.map(f => `- ⚠️ \`${f.file}\` (${f.remainingOld} old remaining)`),
    mixedFiles.length === 0 ? '_None_' : '',
  ]
  console.log(lines.join('\n'))
}

// ── status command ────────────────────────────────────────────────────────────

function cmdStatus() {
  const from = args.from
  const to = args.to

  if (!from || !to) {
    console.error('Error: --from and --to are required for status command')
    process.exit(1)
  }

  const dir = resolveDir(args.dir)
  const files = walk(dir)
  const fromRe = new RegExp(from)
  const toRe = new RegExp(to)

  const migrated = []
  const mixed = []
  const notStarted = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const hasOld = fromRe.test(content)
    const hasNew = toRe.test(content)
    const rel = relative(ROOT, file)

    if (hasOld && hasNew) mixed.push(rel)
    else if (hasOld) notStarted.push(rel)
    else if (hasNew) migrated.push(rel)
  }

  console.log(`\nMigration status: ${from} → ${to}`)
  console.log('─'.repeat(72))
  for (const f of migrated) console.log(` ✅ Migrated:              ${f}`)
  for (const f of mixed)     console.log(` ⚠️  Mixed (both old+new):  ${f}`)
  for (const f of notStarted) console.log(` ❌ Not started (old only): ${f}`)
  console.log('─'.repeat(72))
  console.log(` Summary: ${migrated.length} migrated, ${mixed.length} mixed, ${notStarted.length} not started\n`)
}

// ── help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
component-audit.mjs — O2 component usage analyzer

Commands:
  find   --pattern <regex> [--dir <path>] [--output <file>]
         Find all usages of a component pattern in the codebase.

  diff   --from <regex> --to <regex> [--format text|markdown]
         Analyze migration progress between old and new component in the current git branch.

  status --from <regex> --to <regex> [--dir <path>]
         Show migration status (migrated / mixed / not started) per file.

Examples:
  node scripts/component-audit.mjs find --pattern "OTabs|OTab" --dir src
  node scripts/component-audit.mjs find --pattern "q-tabs" --dir src --output todo.txt
  node scripts/component-audit.mjs diff --from "q-tabs|q-tab" --to "OTabs|OTab"
  node scripts/component-audit.mjs diff --from "q-tabs" --to "OTabs" --format markdown
  node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs"
`)
}

// ── dispatch ──────────────────────────────────────────────────────────────────

switch (command) {
  case 'find':   cmdFind();   break
  case 'diff':   cmdDiff();   break
  case 'status': cmdStatus(); break
  default:
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
}
