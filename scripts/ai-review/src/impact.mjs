import { execFileSync } from "node:child_process";

// Where the code a PR changes is used outside the diff. Most missed bugs live in a caller, a consumer or a
// parallel implementation the diff does not touch, so every reviewer gets this map up front.

const MAX_SYMBOLS = 30;
const MAX_HITS_PER_SYMBOL = 8;
const MAX_LINES = 220;
const SOURCE_RE = /\.(rs|ts|tsx|js|mjs|vue|py|go|sql)$/;
const MAX_USES = 60; // a name used more widely than this is too generic for the map to help
const SKIP_PATH_RE = /(^|\/)(node_modules|target|dist|vendor|\.o2-review-context|\.claude|\.github)\/|\.(lock|min\.js|snap)$|(^|\/)locales?\/|\/i18n\//;
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|e2e|ui-testing|api-testing)\/|\.(spec|test)\.[jt]sx?$|_test\.rs$|(^|\/)test_[^/]*\.py$/;
const lang = f => (/\.rs$/.test(f) ? "rs" : /\.(ts|tsx|js|mjs|vue)$/.test(f) ? "js" : f.split(".").pop());
// Names too common to say anything about a change.
const STOP = new Set(["new", "default", "from", "into", "clone", "fmt", "drop", "main", "test", "setup", "data", "props",
  "emit", "render", "init", "get", "set", "run", "handle", "update", "create", "delete", "list", "build", "parse", "value",
  "values", "result", "error", "config", "options", "index", "name", "type", "state", "query", "request", "response"]);

const DEF_PATTERNS = [
  /\bfn\s+([A-Za-z_]\w*)/g,
  /\b(?:struct|enum|trait|type|union)\s+([A-Z]\w*)/g,
  /\b(?:const|static)\s+([A-Z][A-Z0-9_]{3,})\b/g,
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /\b(?:export\s+)?(?:const|let)\s+([A-Z][A-Z0-9_]{3,})\s*=/g,
  /^\s*(?:async\s+)?([a-z][A-Za-z0-9_]{3,})\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/g,
];
// Enclosing item named in the hunk header: `@@ -1,2 +1,3 @@ pub async fn foo(`.
const HUNK_FN_RE = /^@@[^@]*@@\s*(.*)$/;

// Symbols a diff defines, edits, or edits inside, with the files that changed them.
export function changedSymbols(diff) {
  const out = new Map();
  let file = null;
  const add = (name, f) => {
    if (!name || name.length < 4 || STOP.has(name) || /^_+$/.test(name)) return;
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(f);
  };
  const scan = (text, f) => {
    for (const re of DEF_PATTERNS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) add(m[1], f);
    }
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/ b\/(.+)$/);
      file = m && SOURCE_RE.test(m[1]) && !SKIP_PATH_RE.test(m[1]) && !TEST_PATH_RE.test(m[1]) ? m[1] : null;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("@@")) {
      const m = line.match(HUNK_FN_RE);
      if (m && m[1]) scan(m[1], file);
    } else if ((line[0] === "+" || line[0] === "-") && !line.startsWith("+++") && !line.startsWith("---")) {
      scan(line.slice(1), file);
    }
  }
  return out;
}

function gitGrep(prDir, name, run) {
  try {
    return run("git", ["-C", prDir, "grep", "-n", "-w", "-F", "-I", "-e", name, "--", "."], {
      encoding: "utf-8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return ""; // exit 1 = no match
  }
}

// Hunk line ranges on the new side, per file, so hits inside the diff itself are not repeated.
function changedRanges(diff) {
  const ranges = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { const m = line.match(/ b\/(.+)$/); file = m ? m[1] : null; continue; }
    const m = file && line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      const start = Number(m[1]);
      if (!ranges.has(file)) ranges.set(file, []);
      ranges.get(file).push([start, start + Number(m[2] ?? 1)]);
    }
  }
  return ranges;
}

const isDefinition = (text, name) =>
  new RegExp(`\\b(fn|struct|enum|trait|type|function|class|interface)\\s+${name}\\b|\\b(const|let|var)\\s+${name}\\s*=`).test(text);

export function buildImpactContext(diff, prDir, { run = execFileSync } = {}) {
  if (!prDir || !diff) return "";
  const symbols = [...changedSymbols(diff)].slice(0, MAX_SYMBOLS * 2);
  const ranges = changedRanges(diff);
  const inDiff = (f, n) => (ranges.get(f) || []).some(([a, b]) => n >= a && n < b);
  const blocks = [];
  for (const [name, files] of symbols) {
    const hits = gitGrep(prDir, name, run).split("\n").filter(Boolean).map(l => {
      const m = l.match(/^(.+?):(\d+):(.*)$/);
      return m && { file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160) };
    }).filter(h => h && !/^(\/\/|\/\*|\*|#(?!\[)|<!--)/.test(h.text) && SOURCE_RE.test(h.file) && !SKIP_PATH_RE.test(h.file) && !inDiff(h.file, h.line));
    if (hits.length === 0 || hits.length > MAX_USES) continue;
    const langs = new Set([...files].map(lang));
    // Other definitions of the same name, in the same language, are parallel implementations that may need the same change.
    const defs = hits.filter(h => !files.has(h.file) && langs.has(lang(h.file)) && !TEST_PATH_RE.test(h.file) && isDefinition(h.text, name));
    const uses = hits.filter(h => !defs.includes(h) && !TEST_PATH_RE.test(h.file));
    const tests = hits.length - defs.length - uses.length;
    if (defs.length + uses.length === 0) continue;
    const shown = [...defs, ...uses].slice(0, MAX_HITS_PER_SYMBOL);
    const more = defs.length + uses.length - shown.length;
    blocks.push({
      score: defs.length * 3 + Math.min(uses.length, 10),
      text: [`${name} (changed in ${[...files].join(", ")}): ${uses.length} use(s) outside the diff${defs.length ? `, ${defs.length} other definition(s) of the same name` : ""}${tests ? `, ${tests} in tests` : ""}`,
        ...shown.map(h => `  ${defs.includes(h) ? "DEF " : ""}${h.file}:${h.line}: ${h.text}`),
        ...(more > 0 ? [`  … ${more} more (grep for it)`] : [])].join("\n"),
    });
  }
  blocks.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const b of blocks.slice(0, MAX_SYMBOLS)) {
    const l = b.text.split("\n");
    if (lines.length + l.length > MAX_LINES) break;
    lines.push(...l);
  }
  return lines.join("\n");
}
