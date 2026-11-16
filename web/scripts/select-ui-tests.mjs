#!/usr/bin/env node
// Picks the vitest specs a diff can reach through static imports; any doubt runs the full suite.
// Usage: node scripts/select-ui-tests.mjs [--base origin/main] [--head HEAD] [--out dir] [--summary file]
//        node scripts/select-ui-tests.mjs --compare <selection.json> <vitest-json-dir> [--summary file]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const posix = path.posix;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFY = path.resolve(SCRIPT_DIR, "../../.github/actions/classify-changes/classify.sh");

const SPEC = /^src\/.*\.spec\.(ts|js|vue)$/;
const PARSED = /\.(ts|tsx|js|jsx|mjs|cjs|vue|css|scss)$/;
const EXTS = [
  ".ts",
  ".js",
  ".vue",
  ".mjs",
  ".cjs",
  ".tsx",
  ".jsx",
  ".json",
  ".scss",
  ".css",
  ".svg",
];
const SRC_TYPES =
  /\.(ts|tsx|js|jsx|mjs|cjs|vue|json|css|scss|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|txt|md|snap)$/;
// Code that reads source through fs or ?raw, so the import graph cannot see what it covers.
const READS_FS = /readFileSync|readdirSync|readFile\(|fs\.promises/;
const READS_SOURCE = new RegExp(`${READS_FS.source}|\\?raw\\b`);
const LOCALE = /(?:^|\/)([a-z]{2}-[A-Z]{2})\.json$/;
const FULL = [
  /^web\/(package\.json|package-lock\.json|vite\.config\.ts|vitest[^/]*\.config\.ts|tsconfig[^/]*\.json|postcss\.config\.js|coverage\.sh)$/,
  /^web\/patches\//,
  /^web\/scripts\/(ui-shard-sequencer\.ts|select-ui-tests\.mjs|changed-lines-coverage\.mjs|fetch-datasource-content\.mjs)$/,
  /^\.github\/workflows\/unit-tests\.yml$/,
  /^\.github\/actions\/classify-changes\//,
];
// web/ paths outside src that vitest never loads, unless the graph says a spec imports them.
const NO_EFFECT =
  /^(\.gitignore|\.nvmrc|\.prettierignore|\.prettierrc\.json|\.stylelintrc\.json|[^/]*\.md|cypress\.config\.ts|eslint\.config\.js|eslint\.sh|index\.html|run_all\.sh|sbom\.json|serve\.json|env\.d\.ts)$|^(cypress|public|test-results|tests|scripts)\//;

// ---------- git ----------
const git = (repo, args, input) =>
  execFileSync("git", ["-C", repo, ...args], {
    input,
    maxBuffer: 1 << 30,
    stdio: ["pipe", "pipe", "pipe"],
  });
const gitText = (repo, args) => git(repo, args).toString("utf8");

function readTree(repo, rev) {
  const tree = new Map(); // web-relative path -> blob sha
  for (const e of gitText(repo, ["ls-tree", "-r", "-z", rev, "--", "web"]).split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+)\tweb\/(.*)$/s.exec(e);
    if (m) tree.set(m[2], m[1]);
  }
  return tree;
}

function catBlobs(repo, shas) {
  const out = new Map();
  if (!shas.length) return out;
  const buf = git(repo, ["cat-file", "--batch"], shas.join("\n") + "\n");
  let p = 0;
  while (p < buf.length) {
    const nl = buf.indexOf(10, p);
    const [sha, type, size] = buf.toString("utf8", p, nl).split(" ");
    p = nl + 1;
    if (type === "missing") continue;
    out.set(sha, buf.toString("utf8", p, p + Number(size)));
    p += Number(size) + 1;
  }
  return out;
}

function showFile(repo, rev, repoPath) {
  try {
    return gitText(repo, ["show", `${rev}:${repoPath}`]);
  } catch {
    return null;
  }
}

// ---------- graph ----------
export function globToRe(glob) {
  let re = "";
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      re += "(?:";
      depth++;
    } else if (c === "}" && depth) {
      re += ")";
      depth--;
    } else if (c === "," && depth) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export function parseAliases(configTexts) {
  // @zo/ is resolved by a vite plugin, to src/ outside cloud builds.
  const aliases = { "@zo": "src" };
  const re = /["']?(@[\w-]*)["']?\s*:\s*fileURLToPath\(\s*new URL\(\s*["']\.\/([^"']+)["']/g;
  for (const t of configTexts) for (const m of t.matchAll(re)) aliases[m[1]] = m[2];
  if (!aliases["@"]) throw new Error("no @ alias found in vite/vitest config");
  return aliases;
}

// Web-relative base path a specifier points at, or null for a package import.
function specBase(spec, from, aliases, glob = false) {
  // In a glob, "?" is a wildcard, not a query string.
  if (!glob) spec = spec.replace(/[?#].*$/, "");
  for (const [k, dir] of Object.entries(aliases))
    if (spec === k || spec.startsWith(k + "/")) return posix.join(dir, spec.slice(k.length));
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const p = posix.join(posix.dirname(from), spec);
    return p.startsWith("..") ? null : p;
  }
  if (spec.startsWith("/src/")) return spec.slice(1);
  return null;
}

function resolve(base, nodes) {
  if (nodes.has(base)) return base;
  for (const e of EXTS) if (nodes.has(base + e)) return base + e;
  for (const e of EXTS) if (nodes.has(base + "/index" + e)) return base + "/index" + e;
  return null;
}

const IMPORT_RES = [
  /\b(?:import|export)\s[^'"`;]*?\sfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\bimport\(\s*(['"`])([^'"`\n]+)\1/g,
  /\brequire\(\s*(['"])([^'"\n]+)\1/g,
  /\bvi\.(?:mock|doMock|unmock|importActual|importMock|requireActual)\(\s*(['"`])([^'"`\n]+)\1/g,
  /\bnew URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url/g,
  /<(?:script|style)[^>]*\ssrc=(['"])([^'"]+)\1/g,
  /@(?:import|use|forward)\s+(?:url\(\s*)?(['"])([^'"\n]+)\1/g,
];
const GLOB_RE =
  /import\.meta\.glob(?:Eager)?\s*(?:<[^()]*?>)?\s*\(\s*(\[[^\]]*\]|(['"`])[^'"`]*\2)/g;

// texts: Map web-relative path -> source; nodes: every web/ file at head.
export function buildGraph(texts, nodes, aliases) {
  const deps = new Map();
  const missing = new Map(); // unresolved base path -> importers (finds importers of deleted files)
  const globs = [];
  for (const [f, text] of texts) {
    const out = new Set();
    deps.set(f, out);
    const add = (spec, tpl) => {
      if (tpl && spec.includes("${")) return globs.push([f, spec.replace(/\$\{[^}]*\}/g, "**")]);
      const base = specBase(spec, f, aliases);
      if (base == null) return;
      const hit = resolve(base, nodes);
      if (hit) out.add(hit);
      else (missing.get(base) ?? missing.set(base, new Set()).get(base)).add(f);
    };
    for (const re of IMPORT_RES) for (const m of text.matchAll(re)) add(m[2], m[1] === "`");
    for (const m of text.matchAll(GLOB_RE)) {
      const pats = m[1].startsWith("[")
        ? [...m[1].matchAll(/(['"`])([^'"`]+)\1/g)].map((x) => x[2])
        : [m[1].slice(1, -1)];
      for (const p of pats) globs.push([f, p]);
    }
  }
  const nodeList = [...nodes];
  const globRes = [];
  for (const [f, pat] of globs) {
    if (pat.startsWith("!")) continue;
    const abs = specBase(pat, f, aliases, true);
    if (abs == null) continue;
    const re = globToRe(abs);
    const prefix = abs.slice(0, abs.search(/[*?{]|$/));
    globRes.push([f, prefix, re]);
    for (const n of nodeList) if (n !== f && n.startsWith(prefix) && re.test(n)) deps.get(f).add(n);
  }
  const rev = new Map();
  for (const [f, ds] of deps) for (const d of ds) (rev.get(d) ?? rev.set(d, []).get(d)).push(f);
  // Files whose glob would match p, so a deleted match still reaches the glob's consumers.
  const globOwners = (p) =>
    globRes
      .filter(([f, prefix, re]) => f !== p && p.startsWith(prefix) && re.test(p))
      .map(([f]) => f);
  return { deps, rev, missing, globOwners };
}

// From a node where stop(node) holds, only edges to nodes in keep are followed.
const reach = (edges, start, stop, keep) => {
  const seen = new Set(start);
  const q = [...start];
  while (q.length) {
    const cur = q.pop();
    for (const n of edges.get(cur) ?? [])
      if (!seen.has(n) && (!stop?.(cur) || keep.has(n))) seen.add(n) && q.push(n);
  }
  return seen;
};

// ---------- locale keys ----------
function flatten(o, pre = "", out = new Map()) {
  if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o)) flatten(v, pre ? `${pre}.${k}` : k, out);
  else out.set(pre, o);
  return out;
}

// Added, removed or value-changed keys with their old value; an added key changes a t() call that fell back to the key.
export function localeKeyChanges(oldText, newText) {
  const a = flatten(oldText == null ? {} : JSON.parse(oldText));
  const b = flatten(newText == null ? {} : JSON.parse(newText));
  const changed = [...a].filter(([k, v]) => !b.has(k) || b.get(k) !== v);
  for (const k of b.keys()) if (!a.has(k)) changed.push([k, undefined]);
  return changed;
}

// Literal text a spec could assert on: the value minus {placeholders}, " | " plurals and @:links.
const valueSegments = (v) =>
  typeof v !== "string"
    ? []
    : v
        .split(/\{[^}]*\}|\s\|\s|@:[\w.]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 4);

class TextIndex {
  constructor(texts, specs) {
    this.texts = texts;
    this.specs = [...specs];
    this.lit = null;
  }
  build() {
    if (this.lit) return;
    this.lit = new Map();
    this.dyn = new Map();
    const put = (m, k, f) => (m.get(k) ?? m.set(k, new Set()).get(k)).add(f);
    for (const [f, t] of this.texts) {
      if (!/^src\/.*\.(ts|tsx|js|jsx|mjs|cjs|vue)$/.test(f)) continue;
      // Lookahead keeps the closing quote free to open the next literal, as in :title="t('a.b')".
      for (const m of t.matchAll(/["'`]([^\s"'`\\]{1,200})(?=["'`])/g)) put(this.lit, m[1], f);
      for (const m of t.matchAll(/["'`]([^\s"'`\\$]{1,200}\.)(?=\$\{|["'`]\s*\+)/g))
        put(this.dyn, m[1], f);
    }
    this.big = this.specs.map((s) => this.texts.get(s)).join("\0");
    this.offs = [];
    let o = 0;
    for (const s of this.specs) {
      this.offs.push(o);
      o += this.texts.get(s).length + 1;
    }
  }
  // Files using the dotted key literally, or building it from one of its parent prefixes.
  keyUsers(key) {
    this.build();
    const parts = key.split(".");
    const n = parts.findIndex((p) => /^\d+$/.test(p));
    const kp = n >= 0 ? parts.slice(0, n) : parts;
    const out = new Set(this.lit.get(kp.join(".")) ?? []);
    for (let i = 1; i <= kp.length; i++)
      for (const f of this.dyn.get(kp.slice(0, i).join(".") + ".") ?? []) out.add(f);
    return out;
  }
  specsContaining(needle, out) {
    this.build();
    let p = 0;
    while ((p = this.big.indexOf(needle, p)) !== -1) {
      let lo = 0;
      let hi = this.offs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.offs[mid] <= p) lo = mid;
        else hi = mid - 1;
      }
      out.add(this.specs[lo]);
      p = lo + 1 < this.offs.length ? this.offs[lo + 1] : this.big.length;
    }
  }
}

// ---------- selection ----------
function classify(changed) {
  const out = execFileSync("bash", [CLASSIFY], { input: changed.join("\n") + "\n" }).toString();
  return Object.fromEntries(
    out
      .trim()
      .split("\n")
      .map((l) => l.split("=")),
  );
}

const full = (reason) => ({ mode: "full", reason, specs: [], reasons: [] });

export function select({ repo, base, head }) {
  const changed = gitText(repo, ["diff", "--name-only", "--no-renames", base, head])
    .split("\n")
    .filter(Boolean);
  const hit = changed.find((f) => FULL.some((re) => re.test(f)));
  if (hit) return { ...full(`run-everything file changed: ${hit}`), changed };
  const c = classify(changed);
  if (c.run_unit_ui !== "true")
    return { mode: "skip", reason: "no web/ change", specs: [], reasons: [], changed };
  if (c.unknown === "true")
    return { ...full("a changed path matches no classify-changes rule"), changed };

  const tree = readTree(repo, head);
  const nodes = new Set(tree.keys());
  const parsed = [...tree].filter(([f]) => /^(src|scripts)\//.test(f) && PARSED.test(f));
  const blobs = catBlobs(repo, [...new Set(parsed.map(([, sha]) => sha))]);
  const texts = new Map(parsed.map(([f, sha]) => [f, blobs.get(sha) ?? ""]));
  const cfg = ["vite.config.ts", "vitest.config.ts"].map(
    (f) => showFile(repo, head, "web/" + f) ?? "",
  );
  const { deps, rev, missing, globOwners } = buildGraph(texts, nodes, parseAliases(cfg));
  const specs = [...nodes].filter((f) => SPEC.test(f));
  const specSet = new Set(specs);
  const setupFiles = [
    ...(/setupFiles:\s*\[([^\]]*)\]/.exec(cfg[1])?.[1] ?? "").matchAll(/["']([^"']+)["']/g),
  ].map((m) => m[1]);
  if (!setupFiles.length) throw new Error("no setupFiles in vitest.config.ts");
  // Locale JSON keeps the key-level rule; anything else setup loads reaches every spec.
  const setup = reach(deps, setupFiles);
  const inSetup = (f) => setup.has(f) || (!nodes.has(f) && globOwners(f).some((o) => setup.has(o)));
  const setupHits = changed.filter(
    (p) => p.startsWith("web/") && inSetup(p.slice(4)) && !LOCALE.test(p),
  );
  if (setupHits.length) {
    const more = setupHits.length > 1 ? ` (+${setupHits.length - 1} more)` : "";
    return {
      ...full(`loaded by setupTests for every spec: ${setupHits[0]}${more}`),
      setupHits: setupHits.length,
      changed,
    };
  }
  const idx = new TextIndex(texts, specs);

  const reasons = [];
  const picked = new Set();
  const take = (file, starts, direct = [], stop) => {
    const got = new Set(direct);
    for (const n of reach(rev, starts, stop, specSet)) if (specSet.has(n)) got.add(n);
    for (const s of got) picked.add(s);
    reasons.push({ file, specs: got.size });
  };
  for (const repoPath of changed) {
    if (!repoPath.startsWith("web/")) continue;
    const f = repoPath.slice(4);
    const exists = nodes.has(f);
    const owners = exists ? [] : globOwners(f);
    if (SPEC.test(f)) {
      take(repoPath, [], exists ? [f] : []);
      continue;
    }
    const loc = LOCALE.exec(f);
    if (loc && f.startsWith("src/")) {
      const direct = (rev.get(f) ?? []).filter((x) => specSet.has(x));
      if (loc[1] !== "en-US") {
        // Specs load these by app code ("ko"); past setup-loaded loaders, keep only direct spec importers.
        const out = new Set(direct);
        idx.specsContaining(loc[1], out);
        take(repoPath, [f, ...owners], out, (n) => setup.has(n) && !LOCALE.test(n));
        continue;
      }
      let keys;
      try {
        keys = localeKeyChanges(showFile(repo, base, repoPath), showFile(repo, head, repoPath));
      } catch (e) {
        return { ...full(`cannot parse ${repoPath}: ${e.message}`), changed };
      }
      const users = new Set();
      const out = new Set(direct);
      // ponytail: a bulk rewrite makes the value search slow; key users are not importers, so run everything.
      if (keys.length > 200) return { ...full(`${repoPath}: over 200 keys changed`), changed };
      for (const [k, v] of keys) {
        for (const u of idx.keyUsers(k)) users.add(u);
        for (const s of valueSegments(v)) idx.specsContaining(s, out);
      }
      take(repoPath, users, out);
      continue;
    }
    if (f.startsWith("src/") && f.endsWith(".snap")) {
      const spec = f.replace(/__snapshots__\//, "").replace(/\.snap$/, "");
      take(repoPath, [], specSet.has(spec) ? [spec] : []);
      continue;
    }
    if (rev.has(f)) {
      take(repoPath, [f]);
      continue;
    }
    if (!exists) {
      const importers =
        missing.get(f.replace(/\.[^./]+$/, "")) ??
        missing.get(f) ??
        missing.get(f.replace(/\/index\.[^./]+$/, ""));
      take(repoPath, [...(importers ?? []), ...owners]);
      continue;
    }
    if (f.startsWith("src/") ? SRC_TYPES.test(f) : NO_EFFECT.test(f)) {
      take(repoPath, []);
      continue;
    }
    return { ...full(`cannot classify ${repoPath}`), changed };
  }
  if (changed.some((p) => p.startsWith("web/src/"))) {
    const fsSpecs = specs.filter((s) => READS_SOURCE.test(texts.get(s) ?? ""));
    const fsHelpers = [...texts].filter(([f, t]) => !specSet.has(f) && READS_FS.test(t));
    take(
      "specs that read source files directly or through a helper (always run)",
      fsHelpers.map(([f]) => f),
      fsSpecs,
    );
  }
  return {
    mode: "picked",
    reason: `${picked.size} of ${specs.length} specs reach the change`,
    specs: [...picked].sort(),
    reasons: reasons.sort((a, b) => b.specs - a.specs),
    total: specs.length,
    changed,
  };
}

export function summary(r) {
  const lines = [`### UI unit test selection: ${r.mode}`, "", r.reason];
  if (r.mode === "picked") {
    lines.push("", "| Changed file | Specs pulled in |", "|---|---|");
    for (const x of r.reasons.slice(0, 5)) lines.push(`| \`${x.file}\` | ${x.specs} |`);
  }
  return lines.join("\n") + "\n";
}

// Shadow check: which failing specs the picked set would have missed.
export function compare(selection, resultsDir) {
  const failed = new Set();
  for (const f of fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir) : []) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf8"));
    for (const t of j.testResults ?? [])
      if (t.status === "failed") failed.add(/(?:^|\/)web\/(src\/.*)$/.exec(t.name)?.[1] ?? t.name);
  }
  const pickedSet = new Set(selection.specs);
  const outside = selection.mode === "picked" ? [...failed].filter((s) => !pickedSet.has(s)) : [];
  const head =
    selection.mode === "picked"
      ? `picked ${selection.specs.length} of ${selection.total}`
      : `selector chose ${selection.mode} (${selection.reason})`;
  const setupNote = selection.setupHits
    ? `; ${selection.setupHits} changed files loaded by setupTests`
    : "";
  return `### UI test selection (shadow)\n\n${head}${setupNote}; ${failed.size} failing specs; failures outside picked set: ${outside.length ? outside.map((s) => `\`${s}\``).join(", ") : "none"}\n`;
}

function main(argv) {
  const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
  const summaryFile = opt("--summary", process.env.GITHUB_STEP_SUMMARY);
  const emit = (md) =>
    summaryFile ? fs.appendFileSync(summaryFile, md) : process.stdout.write(md);
  if (argv.includes("--compare")) {
    const i = argv.indexOf("--compare");
    return emit(compare(JSON.parse(fs.readFileSync(argv[i + 1], "utf8")), argv[i + 2]));
  }
  const repo = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const head = opt("--head", "HEAD");
  const out = opt("--out");
  const t0 = Date.now();
  let r;
  let base;
  try {
    base = gitText(repo, ["merge-base", opt("--base", "origin/main"), head]).trim();
    r = select({ repo, base, head });
  } catch (e) {
    r = full(`selector error: ${e.message.split("\n")[0]}`);
  }
  r.ms = Date.now() - t0;
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "selection.json"), JSON.stringify(r, null, 1));
    fs.writeFileSync(path.join(out, "picked.txt"), r.specs.map((s) => s + "\n").join(""));
    if (base)
      fs.writeFileSync(
        path.join(out, "changed.diff"),
        git(repo, ["diff", "-U0", "--no-renames", base, head, "--", "web/src"]),
      );
  }
  emit(summary(r));
  console.error(`select-ui-tests: ${r.mode}, ${r.specs.length} specs, ${r.ms} ms`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
