#!/usr/bin/env node
/**
 * analyze-waits.js
 *
 * Scans all spec files for waitForTimeout calls, classifies each by context,
 * and outputs a prioritized report with specific replacement suggestions.
 *
 * Usage:
 *   node tests/ui-testing/scripts/analyze-waits.js
 *   node tests/ui-testing/scripts/analyze-waits.js --json   # machine-readable output
 *   node tests/ui-testing/scripts/analyze-waits.js --file Traces/traceAdvancedFiltering.spec.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TESTS_ROOT = path.resolve(__dirname, '../playwright-tests');
const CONTEXT_LINES_ABOVE = 5;
const CONTEXT_LINES_BELOW = 2;

// ─── Classification rules ────────────────────────────────────────────────────
// Each rule: { pattern (regex on preceding lines), category, suggestion }
const RULES = [
  {
    pattern: /runSearch\(\)|clickApply|applyFilter|clickRun|pressEnter|clickSearch/i,
    category: 'after-search',
    suggestion: `// Set up BEFORE triggering search, then await AFTER:
const searchResponse = page.waitForResponse(
  resp => resp.url().includes('/_search') && resp.status() === 200,
  { timeout: 30000 }
);
await pm.tracesPage.runSearch(); // or whichever trigger
await searchResponse;`,
  },
  {
    pattern: /selectStream|selectOrg|selectIndex|switchStream|chooseStream/i,
    category: 'after-stream-select',
    suggestion: `// Wait for the fields/table to render instead of sleeping:
await expect(page.locator('[data-test="log-table"]')).toBeVisible({ timeout: 15000 });
// OR for schema/fields dropdown to populate:
await expect(page.locator('[data-test="field-list-item"]').first()).toBeVisible({ timeout: 15000 });`,
  },
  {
    pattern: /navigate|goto|click.*tab|switchTab|openPage/i,
    category: 'after-navigate',
    suggestion: `// Use waitForURL or wait for a landmark element instead:
await page.waitForURL('**/traces**', { timeout: 15000 });
// OR wait for a specific element that proves the page is ready:
await expect(page.locator('[data-test="traces-search-bar"]')).toBeVisible({ timeout: 15000 });`,
  },
  {
    pattern: /\.fill\(|\.type\(|\.press\(|filterBy|typeFilter|enterQuery|enterText/i,
    category: 'after-input',
    suggestion: `// Wait for the debounce to settle by watching the DOM result:
await expect(page.locator('[data-test="search-result-count"]')).not.toHaveText('Loading...', { timeout: 10000 });
// OR if it triggers an API call, intercept it:
const searchResp = page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 15000 });
await pm.page.fill(selector, value);
await searchResp;`,
  },
  {
    pattern: /\.click\(|clickButton|clickFirst|openPanel|openSidebar|expand/i,
    category: 'after-click',
    suggestion: `// Wait for a specific element that appears after the click:
await expect(page.locator('[data-test="side-panel"]')).toBeVisible({ timeout: 10000 });
// OR if click triggers an API call:
const resp = page.waitForResponse(resp => resp.url().includes('/api/'), { timeout: 15000 });
await locator.click();
await resp;`,
  },
  {
    pattern: /while\s*\(|retry|attempt|maxAttempts|loop/i,
    category: 'polling-loop',
    suggestion: `// Replace polling loop + sleep with waitForFunction or waitForSelector:
await page.waitForFunction(
  () => document.querySelector('[data-test="result-row"]') !== null,
  { timeout: 30000, polling: 1000 }
);
// OR use Playwright's built-in retry via expect():
await expect(page.locator('[data-test="result-row"]')).toBeVisible({ timeout: 30000 });`,
  },
  {
    pattern: /animation|transition|render|appear|load|spinner|loading/i,
    category: 'animation-wait',
    suggestion: `// Wait for spinner to disappear or element to stabilize:
await expect(page.locator('[data-test="loading-spinner"]')).toBeHidden({ timeout: 15000 });
// OR wait for the content element itself:
await expect(page.locator('[data-test="chart-container"]')).toBeVisible({ timeout: 15000 });`,
  },
];

const UNCATEGORIZED = {
  category: 'uncategorized',
  suggestion: `// Identify what you're waiting for and use one of:
// 1. await page.waitForResponse(urlMatcher, { timeout: N })  — after API-triggering actions
// 2. await expect(locator).toBeVisible({ timeout: N })        — after UI state changes
// 3. await page.waitForURL(pattern, { timeout: N })           — after navigation
// 4. await page.waitForFunction(fn, null, { timeout: N })     — for complex DOM conditions`,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findSpecFiles(dir, filter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'test-archives') continue;
      out.push(...findSpecFiles(full, filter));
    } else if (entry.name.endsWith('.spec.js')) {
      if (!filter || full.includes(filter)) out.push(full);
    }
  }
  return out;
}

function classify(precedingLines) {
  const ctx = precedingLines.join('\n');
  for (const rule of RULES) {
    if (rule.pattern.test(ctx)) return rule;
  }
  return UNCATEGORIZED;
}

function msWasted(ms) {
  return typeof ms === 'number' ? ms : 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const fileFilter = args.find(a => !a.startsWith('--'));

const files = findSpecFiles(TESTS_ROOT, fileFilter);

const byCategory = {};
const byFile = {};
let totalMs = 0;
let totalCount = 0;

for (const filePath of files) {
  const rel = path.relative(TESTS_ROOT, filePath);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/waitForTimeout\((\d+)/);
    if (!match) continue;

    const ms = parseInt(match[1], 10);
    const preceding = lines.slice(Math.max(0, i - CONTEXT_LINES_ABOVE), i);
    const following = lines.slice(i + 1, Math.min(lines.length, i + CONTEXT_LINES_BELOW + 1));
    const rule = classify(preceding);
    const cat = rule.category;

    const entry = {
      file: rel,
      line: i + 1,
      ms,
      context: [...preceding, `>>> ${line.trim()}`, ...following].join('\n'),
      suggestion: rule.suggestion,
    };

    byCategory[cat] = byCategory[cat] || [];
    byCategory[cat].push(entry);

    byFile[rel] = byFile[rel] || { count: 0, ms: 0, items: [] };
    byFile[rel].count++;
    byFile[rel].ms += ms;
    byFile[rel].items.push(entry);

    totalMs += ms;
    totalCount++;
  }
}

// ─── Output ──────────────────────────────────────────────────────────────────

if (jsonMode) {
  console.log(JSON.stringify({ totalCount, totalMs, byCategory, byFile }, null, 2));
  process.exit(0);
}

const hr = '─'.repeat(80);

console.log(`\n${'═'.repeat(80)}`);
console.log(`  waitForTimeout Audit Report`);
console.log(`${'═'.repeat(80)}`);
console.log(`  Total calls : ${totalCount}`);
console.log(`  Dead time   : ${(totalMs / 1000).toFixed(1)}s minimum (serial), much less in parallel`);
console.log(`  Files scanned: ${files.length}`);
console.log(`${'═'.repeat(80)}\n`);

// Summary by category
console.log('## CATEGORY BREAKDOWN\n');
const sortedCats = Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length);
for (const [cat, items] of sortedCats) {
  const catMs = items.reduce((s, i) => s + i.ms, 0);
  console.log(`  ${cat.padEnd(25)} ${String(items.length).padStart(4)} calls   ${(catMs / 1000).toFixed(1)}s wasted`);
}

// Top files
console.log('\n## TOP FILES BY waitForTimeout COUNT\n');
const sortedFiles = Object.entries(byFile).sort((a, b) => b[1].count - a[1].count).slice(0, 15);
for (const [file, data] of sortedFiles) {
  console.log(`  ${String(data.count).padStart(3)}x  ${(data.ms / 1000).toFixed(1).padStart(6)}s  ${file}`);
}

// Per-category details with suggestions
console.log('\n\n## DETAILED FINDINGS BY CATEGORY\n');

for (const [cat, items] of sortedCats) {
  const catMs = items.reduce((s, i) => s + i.ms, 0);
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  CATEGORY: ${cat.toUpperCase()}   (${items.length} calls, ${(catMs / 1000).toFixed(1)}s)`);
  console.log(`${'═'.repeat(80)}`);

  // Print suggested fix once per category
  console.log('\n  SUGGESTED REPLACEMENT:');
  for (const suggLine of items[0].suggestion.split('\n')) {
    console.log(`    ${suggLine}`);
  }

  // Show examples (up to 5)
  const examples = items.slice(0, 5);
  console.log(`\n  EXAMPLES (showing ${examples.length} of ${items.length}):`);
  for (const ex of examples) {
    console.log(`\n    ${hr.slice(0, 60)}`);
    console.log(`    File : ${ex.file}:${ex.line}`);
    console.log(`    Sleep: ${ex.ms}ms`);
    console.log(`    Context:`);
    for (const ctxLine of ex.context.split('\n')) {
      console.log(`      ${ctxLine}`);
    }
  }

  // If more, show file list
  if (items.length > 5) {
    const remaining = items.slice(5);
    const remainFiles = [...new Set(remaining.map(i => i.file))];
    console.log(`\n  ... and ${remaining.length} more in: ${remainFiles.slice(0, 8).join(', ')}${remainFiles.length > 8 ? '...' : ''}`);
  }
}

// Quick-fix targets: files with many after-search waits (easiest wins)
console.log(`\n\n${'═'.repeat(80)}`);
console.log('  QUICK WINS: Files where waitForResponse swap is straightforward');
console.log(`${'═'.repeat(80)}\n`);

const searchItems = byCategory['after-search'] || [];
const searchByFile = {};
for (const item of searchItems) {
  searchByFile[item.file] = searchByFile[item.file] || { count: 0, ms: 0 };
  searchByFile[item.file].count++;
  searchByFile[item.file].ms += item.ms;
}
const quickWins = Object.entries(searchByFile).sort((a, b) => b[1].ms - a[1].ms).slice(0, 10);
for (const [file, data] of quickWins) {
  console.log(`  ${String(data.count).padStart(3)} waits  ${(data.ms / 1000).toFixed(1).padStart(5)}s saved  →  ${file}`);
}

console.log(`\n  Pattern to apply in each file:`);
console.log(`    BEFORE: await pm.tracesPage.runSearch();`);
console.log(`            await page.waitForTimeout(2000);`);
console.log(`    AFTER:  const resp = page.waitForResponse(`);
console.log(`              resp => resp.url().includes('/_search') && resp.status() === 200,`);
console.log(`              { timeout: 30000 }`);
console.log(`            );`);
console.log(`            await pm.tracesPage.runSearch();`);
console.log(`            await resp;`);
console.log();
