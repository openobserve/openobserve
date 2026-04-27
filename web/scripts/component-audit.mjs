#!/usr/bin/env node
/**
 * component-audit.mjs
 * Audit and analyze O2 component usage and migration progress.
 *
 * Usage:
 *   node scripts/component-audit.mjs find   --pattern "OTabs|OTab" [--dir src] [--format csv] [--output file.csv]
 *   node scripts/component-audit.mjs diff   --from "q-tabs|q-tab" --to "OTabs|OTab" [--format csv|markdown] [--output file.csv]
 *   node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs" [--format csv] [--output file.csv]
 *
 * Run from the web/ directory.
 *
 * TIP — pipe straight to a CSV for Excel:
 *   node scripts/component-audit.mjs diff  --from "q-tabs|q-tab" --to "OTabs|OTab" --format csv --output migration.csv
 *   node scripts/component-audit.mjs find  --pattern "q-tabs|q-tab" --format csv --output todo.csv
 *   node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs" --format csv --output status.csv
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

const VUE_EXTENSIONS = new Set(['.vue'])

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

/**
 * Strip comments from Vue SFC content before pattern matching so that
 * commented-out usages are not counted.
 *   <!-- HTML comments -->
 *   // single-line JS/TS comments
 *   /* block JS\/TS comments *\/
 */
function stripComments(content) {
  // HTML comments (<!-- ... -->), including multiline
  content = content.replace(/<!--[\s\S]*?-->/g, '')
  // Block JS/TS comments (/* ... */)
  content = content.replace(/\/\*[\s\S]*?\*\//g, '')
  // Single-line JS/TS comments (// ...) — only outside strings (best-effort)
  content = content.replace(/\/\/[^\n]*/g, '')
  return content
}

/**
 * Strip <style> blocks from Vue SFC content so CSS class names like
 * ".q-tab", "q-tabs { }" etc. in scoped/global styles are not counted.
 * <script> is intentionally kept — component-name boundary regexes
 * already prevent spurious matches on import strings.
 */
function templateOnly(content) {
  return content.replace(/<style[\s\S]*?<\/style>/gi, '')
}

function countMatches(content, pattern) {
  const re = toComponentRe(pattern)
  return (stripComments(templateOnly(content)).match(re) || []).length
}

/**
 * Convert a raw component pattern string into a regex that only matches
 * complete component names — not substrings of longer names.
 *
 * Each |-separated part gets a negative lookahead so that e.g.
 *   "q-tab"  does NOT match inside "q-table" or "q-tabs"
 *   "q-tabs" does NOT match inside "q-tab-panels"
 *
 * Boundary rule: the match must NOT be followed by a letter or hyphen.
 */
function toComponentRe(pattern) {
  const parts = pattern.split('|').map(p => p.trim()).filter(Boolean)
  const bounded = parts.map(p => `${p}(?![a-zA-Z-])`)
  return new RegExp(bounded.join('|'), 'g')
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
  const format = args.format || 'text'

  if (format === 'csv') {
    const rows = [
      ['File', 'Module', 'Usages'],
      ...results
        .sort((a, b) => a.rel.localeCompare(b.rel))
        .map(r => [csvEscape(r.rel), csvEscape(moduleKey(r.file, dir)), r.count]),
      ['TOTAL', '', totalUsages],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    if (args.output) {
      writeFileSync(args.output, csv)
      console.error(`CSV written to: ${args.output}`)
    } else {
      console.log(csv)
    }
    return
  }

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

// ── Module name helper ──────────────────────────────────────────────────────

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/**
 * Derive a human-readable module name from a repo-relative file path.
 * web/src/components/ingestion/Custom.vue  -> Ingestion
 * web/src/views/Dashboards/DashboardSettings.vue -> Dashboards
 * web/src/enterprise/components/billings/Billing.vue -> Billings
 */
function moduleName(relFilePath) {
  const parts = relFilePath.replace(/\\/g, '/').split('/')
  const srcIdx = parts.indexOf('src')
  if (srcIdx >= 0) {
    const layer = parts[srcIdx + 1] // components, views, plugins, enterprise
    if (layer === 'enterprise') {
      return capitalize(parts[srcIdx + 3] || parts[srcIdx + 2] || layer)
    }
    return capitalize(parts[srcIdx + 2] || layer)
  }
  return parts.slice(0, 3).join('/')
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
  const fromRe = toComponentRe(from)
  const toRe = toComponentRe(to)

  // Individual component names for per-column breakdown
  const fromParts = from.split('|').map(p => p.trim())
  const toParts = to.split('|').map(p => p.trim())

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

    // Strip comments before counting so commented-out usages are ignored
    const baseStripped = stripComments(templateOnly(baseContent))
    const headStripped = stripComments(templateOnly(headContent))

    const fromInBase = (baseStripped.match(fromRe) || []).length
    const fromInHead = (headStripped.match(fromRe) || []).length
    const toInBase = (baseStripped.match(toRe) || []).length
    const toInHead = (headStripped.match(toRe) || []).length

    // Per-component counts for detailed CSV output
    const fromByPart = {}
    for (const p of fromParts) {
      const re = toComponentRe(p)
      fromByPart[p] = {
        base: (baseStripped.match(re) || []).length,
        head: (headStripped.match(re) || []).length,
      }
    }
    const toByPart = {}
    for (const p of toParts) {
      const re = toComponentRe(p)
      toByPart[p] = {
        base: (baseStripped.match(re) || []).length,
        head: (headStripped.match(re) || []).length,
      }
    }
    const components = { fromByPart, toByPart }

    const fromRemoved = Math.max(0, fromInBase - fromInHead)
    const toAdded = Math.max(0, toInHead - toInBase)

    if (fromRemoved === 0 && toAdded === 0) continue

    totalFromRemoved += fromRemoved
    totalToAdded += toAdded

    const hasOldNow = fromInHead > 0
    const hasNewNow = toInHead > 0

    if (fromRemoved > 0 && toAdded > 0) {
      if (hasOldNow) {
        mixedFiles.push({ file: relFile, fromRemoved, toAdded, remainingOld: fromInHead, components })
      } else {
        migratedFiles.push({ file: relFile, fromRemoved, toAdded, remainingOld: 0, components })
      }
    } else if (fromRemoved > 0 && !hasOldNow && !hasNewNow) {
      // Old removed, nothing new
      onlyOldFiles.push({ file: relFile, fromRemoved, toAdded: 0, remainingOld: 0, components })
    } else if (toAdded > 0) {
      onlyNewFiles.push({ file: relFile, fromRemoved: 0, toAdded, remainingOld: 0, components })
    }
  }

  if (format === 'csv') {
    outputDiffCsv({ branch, baseBranch, from, to, fromParts, toParts, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded })
  } else if (format === 'markdown') {
    outputDiffMarkdown({ branch, baseBranch, from, to, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded })
  } else {
    outputDiffText({ branch, baseBranch, from, to, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded })
  }
}

// ── CSV helper ───────────────────────────────────────────────────────────────

function csvEscape(val) {
  const s = String(val)
  // Wrap in quotes if value contains comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function writeCsv(rows, outputPath) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n')
  if (outputPath) {
    writeFileSync(outputPath, csv)
    console.error(`CSV written to: ${outputPath}`)
  } else {
    console.log(csv)
  }
}

function outputDiffCsv({ branch, baseBranch, from, to, fromParts, toParts, migratedFiles, mixedFiles, onlyOldFiles, totalFromRemoved, totalToAdded }) {
  // ── Summary block ──
  const summaryBlock = [
    ['Migration Report'],
    ['Branch', branch, 'vs', baseBranch],
    ['Old Pattern', from],
    ['New Pattern', to],
    [],
    ['Metric', 'Count'],
    ['Fully migrated files', migratedFiles.length],
    ['Partially migrated files (old still present)', mixedFiles.length],
    ['Old-only removed (no new added)', onlyOldFiles.length],
    ['Total old usages removed', totalFromRemoved],
    ['Total new usages added', totalToAdded],
    [],
  ]

  // ── File detail block ──
  // Columns: Module | File | Old Components Used | <one col per old part (before)> | New Components Added | <one col per new part (after)> | Status | Old Remaining
  const header = [
    'Module',
    'File',
    'Old Components Used',
    ...fromParts.map(p => `${p} (before)`),
    'New Components Added',
    ...toParts.map(p => `${p} (after)`),
    'Status',
    'Old Remaining',
  ]

  const allFiles = [
    ...migratedFiles.map(f => ({ ...f, status: 'Fully Migrated' })),
    ...mixedFiles.map(f => ({ ...f, status: 'Partially Migrated' })),
    ...onlyOldFiles.map(f => ({ ...f, status: 'Old Removed (no new)' })),
  ].sort((a, b) => a.file.localeCompare(b.file))

  const fileRows = allFiles.map(f => {
    const mod = moduleName(f.file)
    const shortFile = f.file.replace(/^web\/src\//, '')
    const { fromByPart = {}, toByPart = {} } = f.components || {}

    // Which old components existed in base (non-zero before)
    const oldUsed = fromParts
      .filter(p => fromByPart[p] && fromByPart[p].base > 0)
      .join(', ') || '—'

    // Which new components exist in head (non-zero after)
    const newUsed = toParts
      .filter(p => toByPart[p] && toByPart[p].head > 0)
      .join(', ') || '—'

    return [
      mod,
      shortFile,
      oldUsed,
      ...fromParts.map(p => (fromByPart[p] && fromByPart[p].base) || 0),
      newUsed,
      ...toParts.map(p => (toByPart[p] && toByPart[p].head) || 0),
      f.status,
      f.remainingOld != null ? f.remainingOld : 0,
    ]
  })

  writeCsv([...summaryBlock, header, ...fileRows], args.output)
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
  const fromRe = toComponentRe(from)
  const toRe = toComponentRe(to)

  const migrated = []
  const mixed = []
  const notStarted = []

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const content = stripComments(templateOnly(raw))
    const hasOld = fromRe.test(content)
    const hasNew = toRe.test(content)
    const rel = relative(ROOT, file)

    if (hasOld && hasNew) mixed.push(rel)
    else if (hasOld) notStarted.push(rel)
    else if (hasNew) migrated.push(rel)
  }

  const format = args.format || 'text'

  if (format === 'csv') {
    const rows = [
      ['File', 'Module', 'Status'],
      ...migrated.map(f   => [f, f.split('/').slice(0, 3).join('/'), 'Migrated']),
      ...mixed.map(f      => [f, f.split('/').slice(0, 3).join('/'), 'Mixed (old + new)']),
      ...notStarted.map(f => [f, f.split('/').slice(0, 3).join('/'), 'Not Started']),
      [],
      ['Summary', '', ''],
      ['Migrated', migrated.length, ''],
      ['Mixed', mixed.length, ''],
      ['Not Started', notStarted.length, ''],
    ]
    writeCsv(rows, args.output)
    return
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
  find   --pattern <regex> [--dir <path>] [--format text|csv] [--output file.csv]
         Find all usages of a component pattern in the codebase.

  diff   --from <regex> --to <regex> [--format text|markdown|csv] [--output file.csv]
         Analyze migration progress between old and new component in the current git branch.

  status --from <regex> --to <regex> [--dir <path>] [--format text|csv] [--output file.csv]
         Show migration status (migrated / mixed / not started) per file.

Examples:
  # Print to console
  node scripts/component-audit.mjs diff   --from "q-tabs|q-tab" --to "OTabs|OTab"
  node scripts/component-audit.mjs find   --pattern "q-tabs|q-tab" --dir src
  node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs"

  # Save CSV for Excel / team sharing
  node scripts/component-audit.mjs diff   --from "q-tabs|q-tab" --to "OTabs|OTab"   --format csv --output migration.csv
  node scripts/component-audit.mjs find   --pattern "q-tabs|q-tab"                   --format csv --output todo.csv
  node scripts/component-audit.mjs status --from "q-tabs" --to "OTabs"               --format csv --output status.csv
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
