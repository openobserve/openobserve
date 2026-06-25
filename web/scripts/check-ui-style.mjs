#!/usr/bin/env node
/**
 * OpenObserve UI house-style check (changed-files only).
 *
 * Enforces two rules on the .vue files passed as args:
 *   1. NO emojis anywhere.
 *   2. NO raw user-facing text in templates — visible strings must go through i18n
 *      (`{{ t('key') }}` / `{{ $t('key') }}`), with the key in locales/languages/en.json.
 *
 * Intentionally dependency-free (no new eslint plugin) and scoped to the files it's given, so it
 * NEVER touches the existing backlog — CI passes only the PR's changed files. A line may opt out
 * with a trailing `<!-- codegen-style-exempt: reason -->` or `// codegen-style-exempt: reason`.
 *
 * Usage: node web/scripts/check-ui-style.mjs <file1.vue> <file2.vue> ...
 * Exits 1 (with a report) if any file violates; 0 if clean / no files.
 */
import fs from "fs";

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/u;
// Visible text node between tags: >Some Words< that isn't a {{ ... }} interpolation.
const RAW_TEXT = />\s*[A-Za-z][A-Za-z ,.'’\-!?]{2,}\s*</;
const EXEMPT = /codegen-style-exempt/;

const files = process.argv.slice(2).filter((f) => f.endsWith(".vue"));
let violations = 0;

for (const file of files) {
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    continue; // deleted/renamed file in the diff — skip
  }
  // Only scan the <template> block for raw text; scan the whole file for emojis.
  const lines = src.split("\n");
  let inTemplate = false;
  lines.forEach((line, i) => {
    if (/<template[\s>]/.test(line)) inTemplate = true;
    if (/<\/template>/.test(line)) inTemplate = false;
    if (EXEMPT.test(line)) return;

    // Strip a same-line comment (HTML <!-- --> or JS // …) before checking — comments aren't
    // user-facing, so a stray glyph there isn't a violation.
    const code = line.replace(/<!--.*?-->/g, "").replace(/\/\/.*$/, "");

    if (EMOJI.test(code)) {
      console.error(`${file}:${i + 1}  emoji not allowed — use a q-icon/SVG if an icon is needed`);
      console.error(`    ${line.trim()}`);
      violations++;
    }
    if (inTemplate && RAW_TEXT.test(code) && !/\{\{[^}]*\}\}/.test(code)) {
      console.error(`${file}:${i + 1}  raw user-facing text — use t('key') + add the key to en.json`);
      console.error(`    ${line.trim()}`);
      violations++;
    }
  });
}

if (violations > 0) {
  console.error(`\n✗ UI house-style check: ${violations} violation(s) in changed files.`);
  console.error(
    "  Rules: no emojis; user-facing strings via i18n t('key') with the key in locales/languages/en.json.",
  );
  console.error("  (False positive? add `codegen-style-exempt: <reason>` to the line.)");
  process.exit(1);
}
console.log(`UI house-style check: clean (${files.length} changed .vue file(s)).`);
