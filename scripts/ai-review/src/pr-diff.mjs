import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const MAX_BUFFER = 200 * 1024 * 1024;
const TOO_LARGE_RE = /exceeded the maximum number of lines|too_large|HTTP 406|HTTP 422/i;
export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

export function runFile(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

// What a git child of a dry run may see: no model key, no trace or API credential, nothing else of the process's environment.
export function safeGitEnv(env = process.env) {
  return { PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: env.HOME ?? "", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" };
}

// Outside a dry run git keeps inheriting the environment, as it always did.
export function gitEnvForRun(env = process.env) {
  return env.REVIEW_DRY_RUN === "true" ? safeGitEnv(env) : undefined;
}

// The flags stop a PR's .gitattributes (diff drivers, textconv, binary) from hiding content from the review.
export function localDiff(prDir, mergeBase, head, run = runFile, env = undefined) {
  return run("git", [
    "-C", prDir,
    "-c", "core.attributesFile=/dev/null",
    "diff", "--no-ext-diff", "--no-textconv", "--text", "-M",
    mergeBase, head,
  ], ...(env ? [{ env }] : []));
}

export function fetchDiff({ repo, prNumber, prDir, mergeBase, head, env = process.env, run = runFile, log = () => {} }) {
  try {
    return run("gh", ["pr", "diff", String(prNumber), "--repo", repo], {
      env: { ...env, NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    });
  } catch (err) {
    const detail = [err?.message, err?.stderr?.toString()].filter(Boolean).join(" ");
    const canUseLocal = Boolean(prDir && mergeBase && head);
    if (!TOO_LARGE_RE.test(detail) && !canUseLocal) throw err;
    if (!canUseLocal) throw new Error(`diff for ${repo}#${prNumber} is too large for the API and no merge base was fetched: ${detail}`);
    log(`API diff for ${repo}#${prNumber} unavailable (${detail.slice(0, 200)}); diffing the merge base locally`);
    return localDiff(prDir, mergeBase, head, run);
  }
}

// The API serves the branch as it is now, so only a local diff of the two SHAs can be tied to the commit a review or an approval names.
export function pinDiff({ diff, prDir, mergeBase, head, run = runFile, log = () => {} }) {
  if (!prDir || !mergeBase || !head) {
    log("no merge base or checkout to diff locally; the API diff is not pinned");
    return { diff, pinned: false };
  }
  try {
    return { diff: localDiff(prDir, mergeBase, head, run), pinned: true };
  } catch (err) {
    log(`could not diff ${mergeBase}..${head} locally; the API diff is not pinned: ${String(err?.message).slice(0, 200)}`);
    return { diff, pinned: false };
  }
}

// A dry run reads no live PR state: the diff is the two named commits in the checkout, or the run stops. `dryRun` is the only way to get here.
export function fetchDryRunDiff({ prDir, mergeBase, head, run = runFile }) {
  if (!prDir || !FULL_SHA_RE.test(mergeBase ?? "") || !FULL_SHA_RE.test(head ?? "")) {
    throw new Error("a dry run diffs two pinned commits: it needs the PR checkout and both full commit SHAs");
  }
  return { diff: localDiff(prDir, mergeBase, head, run, safeGitEnv()), pinned: true };
}

export function fetchPinnedDiff(params) {
  if (params.dryRun) return fetchDryRunDiff(params);
  return pinDiff({ ...params, diff: fetchDiff(params) });
}

// Blob ids and hunk line numbers move with the base, so a rebase keeps the fingerprint; the function context after `@@` stays, as the same lines in another function are another change.
export function diffFingerprint(diff) {
  const text = String(diff ?? "");
  // A binary file has no hunks, so its blob ids are the only record of its content.
  const keepBlobIds = /^(Binary files .* differ|GIT binary patch)$/m.test(text);
  const normalized = text
    .split("\n")
    .map(line => (keepBlobIds ? line : line.replace(/^index [0-9a-f]+\.\.[0-9a-f]+/, "index")))
    .map(line => line.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, "@@"))
    .join("\n")
    .replace(/\n+$/, "");
  return createHash("sha256").update(normalized).digest("hex");
}

// Equal text names one change only where each hunk's old lines sit once in the base, so an edit to one of two identical blocks cannot pass for the other.
export function hunksLocatable(diff, readBase) {
  for (const section of String(diff ?? "").split(/^diff --git /m).slice(1)) {
    const firstHunk = section.search(/^@@ /m);
    if (firstHunk === -1) continue;
    const header = section.slice(0, firstHunk);
    if (/^--- \/dev\/null$/m.test(header)) continue;
    const path = header.match(/^--- a\/(.*?)\t?$/m)?.[1];
    const base = path ? readBase(path) : null;
    if (typeof base !== "string") return false;
    const baseLines = base.split("\n");
    for (const hunk of section.slice(firstHunk).split(/^@@ [^\n]*(?:\n|$)/m).slice(1)) {
      const old = hunk.split("\n").filter(line => line.startsWith(" ") || line.startsWith("-")).map(line => line.slice(1));
      if (old.length === 0 ? base !== "" : occurrences(baseLines, old) !== 1) return false;
    }
  }
  return true;
}

// `unfocused` keeps the whole diff for a gate candidate, whose approval must rest on reviewers that saw every file; requiresFocus agents still opt out.
// `focusFiles` are the new paths (as the headers show them) a narrowed diff keeps; empty whenever the reviewer sees the whole diff.
export function reviewerDiff(diff, { fileFocus, requiresFocus }, { unfocused = false, pathOf = path => path } = {}) {
  if (!fileFocus) return { diff, skipped: false, fullDiff: true, focusFiles: [] };
  const sections = diff.split(/^diff --git /gm).filter(Boolean);
  const relevant = sections.filter(s => {
    const m = s.match(/^a\/(.*?) b\/(.*?)\n/);
    return m && fileFocus(pathOf(m[2]));
  });
  if (relevant.length === 0) return { diff, skipped: Boolean(requiresFocus), fullDiff: !requiresFocus, focusFiles: [] };
  if (unfocused) return { diff, skipped: false, fullDiff: true, focusFiles: [] };
  const narrowed = relevant.map(s => `diff --git ${s}`).join("");
  const whole = narrowed === diff;
  return { diff: narrowed, skipped: false, fullDiff: whole, focusFiles: whole ? [] : relevant.map(s => s.match(/^a\/(.*?) b\/(.*?)\n/)[2]) };
}

// Rewrites only header lines (before the first hunk of each file), so a removed line like "-- a/b" is never touched.
export function prefixDiffPaths(diff, prefix) {
  if (!prefix) return diff;
  const p = prefix.replace(/^\/+|\/+$/g, "");
  let inHeader = false;
  return diff
    .split("\n")
    .map(line => {
      if (line.startsWith("diff --git ")) {
        inHeader = true;
        return prefixGitHeader(line, p);
      }
      if (!inHeader) return line;
      if (line.startsWith("@@") || line.startsWith("Binary files ")) {
        inHeader = false;
        return line.startsWith("Binary files ") ? prefixBinaryLine(line, p) : line;
      }
      let match = /^(---|\+\+\+) ("?)([ab])\/(.*)$/.exec(line);
      if (match) return `${match[1]} ${match[2]}${match[3]}/${p}/${match[4]}`;
      match = /^(rename from|rename to|copy from|copy to) ("?)(.*)$/.exec(line);
      if (match) return `${match[1]} ${match[2]}${p}/${match[3]}`;
      return line;
    })
    .join("\n");
}

function prefixGitHeader(line, p) {
  const rest = line.slice("diff --git ".length);
  const split = Math.max(rest.lastIndexOf(" b/"), rest.lastIndexOf(' "b/'));
  if (split === -1) return line;
  const left = rest.slice(0, split).replace(/^("?)a\//, `$1a/${p}/`);
  const right = rest.slice(split + 1).replace(/^("?)b\//, `$1b/${p}/`);
  return `diff --git ${left} ${right}`;
}

function prefixBinaryLine(line, p) {
  return line.replace(/(^Binary files |and )("?)([ab])\//g, `$1$2$3/${p}/`);
}

// Stops at two: the caller only needs to know whether a block is unique.
function occurrences(lines, block) {
  let found = 0;
  for (let i = 0; i + block.length <= lines.length && found < 2; i += 1) {
    if (lines[i] === block[0] && block.every((line, j) => lines[i + j] === line)) found += 1;
  }
  return found;
}
