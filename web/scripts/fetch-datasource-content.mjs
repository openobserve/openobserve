#!/usr/bin/env node
// Fetch AI data-source UI markdown from the content repo into a generated dir
// that Vite bundles via import.meta.glob. See ~/designs/ai-datasource-cards/.
//
// Behavior:
//   - shallow-clones DS_CONTENT_REPO @ DS_CONTENT_REF (with retries + a per-clone
//     timeout), then copies <slug>/data-source-ui.md AND the repo's manifest.json
//     into src/assets/ai-datasource-content/generated/, and writes .fetch.json
//     (our own metadata: resolved SHA + slug list; distinct from manifest.json).
//   - skips the fetch when generated/ already exists, unless DS_CONTENT_FORCE=1.
//   - DS_CONTENT_STRICT=1 (set for builds / CI): a failed fetch (or missing
//     manifest) exits non-zero so the build fails loudly instead of shipping
//     stale or missing content. Without strict (dev server) it keeps any cached
//     generated/ and otherwise continues — the UI falls back to the basic snippet.
//   - Env knobs: DS_CONTENT_REPO / _REF / _SUBDIR / _FORCE / _STRICT / _TIMEOUT_MS.
//   - Runnable standalone: `DS_CONTENT_FORCE=1 node scripts/fetch-datasource-content.mjs`.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  cpSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
// AI data-source markdown lives under src/assets (data), separate from the
// rendering code under src/components/ingestion/ai/content.
const CONTENT_DIR = resolve(WEB_ROOT, "src/assets/ai-datasource-content");
const GENERATED = join(CONTENT_DIR, "generated");

const REPO =
  process.env.DS_CONTENT_REPO ||
  "https://github.com/openobserve/o2-datasource.git";
const REF = process.env.DS_CONTENT_REF || "main";
const SUBDIR = process.env.DS_CONTENT_SUBDIR || "datasource-ui-content";
const FORCE = process.env.DS_CONTENT_FORCE === "1";
const STRICT = process.env.DS_CONTENT_STRICT === "1";
// Retry harder for builds/CI (freshness matters); fail fast for the dev server.
const ATTEMPTS = STRICT ? 3 : 1;
// Cap each git clone so an unresponsive network can't stall startup/CI.
const TIMEOUT_MS =
  Number(process.env.DS_CONTENT_TIMEOUT_MS) || (STRICT ? 60_000 : 30_000);
const GIT_OPTS = { stdio: "inherit", timeout: TIMEOUT_MS };

// Validate the git inputs before they reach `git`. execFileSync already prevents
// shell injection (no shell is spawned), but an attacker who can set these env
// vars could otherwise pass a value that git reads as a flag (e.g. a REF like
// `--upload-pack=…`). Restrict to an https(s) URL and to ref/path characters
// that can't begin with a dash.
const isSafeRepoUrl = (s) => /^https?:\/\/[\w.@:/\-~%]+$/.test(s);
const isSafeRefOrPath = (s) => /^[\w][\w.\-/]*$/.test(s);
for (const [name, val, ok] of [
  ["DS_CONTENT_REPO", REPO, isSafeRepoUrl(REPO)],
  ["DS_CONTENT_REF", REF, isSafeRefOrPath(REF)],
  ["DS_CONTENT_SUBDIR", SUBDIR, isSafeRefOrPath(SUBDIR)],
]) {
  if (!ok) {
    console.error(`[ds-content] refusing unsafe ${name}: ${JSON.stringify(val)}`);
    process.exit(1);
  }
}

const log = (m) => console.log(`[ds-content] ${m}`);
// `.fetch.json` is our own fetch metadata (sha/time); `manifest.json` is the
// placement manifest copied verbatim from the content repo and consumed by the UI.
const hasContent = (dir) => existsSync(join(dir, ".fetch.json"));

function cloneOnce() {
  const tmp = mkdtempSync(join(tmpdir(), "ds-content-"));
  try {
    // fast path: works for a branch or a tag
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--branch", REF, REPO, tmp],
      GIT_OPTS,
    );
  } catch {
    // REF is probably a commit SHA — full clone then checkout
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    execFileSync("git", ["clone", REPO, tmp], GIT_OPTS);
    execFileSync("git", ["-C", tmp, "checkout", REF], GIT_OPTS);
  }
  const sha = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"])
    .toString()
    .trim();
  return { tmp, sha };
}

function cloneRepo() {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return cloneOnce();
    } catch (e) {
      lastErr = e;
      log(`clone attempt ${attempt}/${ATTEMPTS} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

function writeCards(srcRoot, sha, destDir) {
  const root = resolve(srcRoot, SUBDIR);
  if (!existsSync(root)) throw new Error(`subdir not found in repo: ${SUBDIR}`);
  const slugs = readdirSync(root, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(join(root, d.name, "data-source-ui.md")),
    )
    .map((d) => d.name)
    .sort();
  if (slugs.length === 0)
    throw new Error(`no <slug>/data-source-ui.md found under ${SUBDIR}`);

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  // Logo image formats co-located in a slug folder that we bundle alongside the
  // card (e.g. logo.svg / logo-dark.png). The UI resolves the frontmatter/manifest
  // `logo` filename to these bundled assets.
  const LOGO_EXT = /\.(svg|png|webp|jpe?g)$/i;
  for (const slug of slugs) {
    mkdirSync(join(destDir, slug), { recursive: true });
    cpSync(
      join(root, slug, "data-source-ui.md"),
      join(destDir, slug, "data-source-ui.md"),
    );
    // Copy any logo image files present in the slug folder.
    for (const f of readdirSync(join(root, slug))) {
      if (LOGO_EXT.test(f)) {
        cpSync(join(root, slug, f), join(destDir, slug, f));
      }
    }
  }

  // Placement manifest (tab/category + order) comes from the content repo and
  // is copied verbatim for the UI to consume.
  const manifestSrc = join(root, "manifest.json");
  if (existsSync(manifestSrc)) {
    cpSync(manifestSrc, join(destDir, "manifest.json"));
  } else if (STRICT) {
    throw new Error(`manifest.json not found under ${SUBDIR}`);
  } else {
    log("WARN no manifest.json in content repo; Popular tab will be empty");
  }

  // Our own fetch metadata (separate from the placement manifest).
  writeFileSync(
    join(destDir, ".fetch.json"),
    JSON.stringify(
      {
        repo: REPO,
        ref: REF,
        sha,
        fetchedAt: new Date().toISOString(),
        count: slugs.length,
        slugs,
      },
      null,
      2,
    ) + "\n",
  );
  return slugs;
}

function main() {
  // Fast local dev: reuse cache unless explicitly forced.
  if (hasContent(GENERATED) && !FORCE) {
    log("generated/ present and DS_CONTENT_FORCE!=1 — using cache (skip fetch)");
    return;
  }

  try {
    const { tmp, sha } = cloneRepo();
    const slugs = writeCards(tmp, sha, GENERATED);
    rmSync(tmp, { recursive: true, force: true });
    log(`fetched ${slugs.length} cards @ ${sha.slice(0, 7)} from ${REF}`);
  } catch (e) {
    if (STRICT) {
      // Builds / CI: fail loudly rather than ship stale or missing content.
      log(`ERROR failed to fetch latest content from ${REPO}@${REF}: ${e.message}`);
      process.exit(1);
    }
    if (hasContent(GENERATED)) {
      log(`WARN fetch failed (${e.message}); using existing cached generated/`);
      return;
    }
    log(
      `WARN fetch failed (${e.message}) and no cached content; AI cards will show the basic snippet`,
    );
  }
}

main();
