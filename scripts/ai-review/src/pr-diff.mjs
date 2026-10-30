import { execFileSync } from "node:child_process";

const MAX_BUFFER = 200 * 1024 * 1024;
const TOO_LARGE_RE = /exceeded the maximum number of lines|too_large|HTTP 406|HTTP 422/i;

export function runFile(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

// The flags stop a PR's .gitattributes (diff drivers, textconv, binary) from hiding content from the review.
export function localDiff(prDir, mergeBase, head, run = runFile) {
  return run("git", [
    "-C", prDir,
    "-c", "core.attributesFile=/dev/null",
    "diff", "--no-ext-diff", "--no-textconv", "--text", "-M",
    mergeBase, head,
  ]);
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

// The API serves the branch as it is now, so only a local diff of the two SHAs can be tied to the commit an approval names.
export function pinDiff({ diff, candidate, prDir, mergeBase, head, run = runFile, log = () => {} }) {
  if (!candidate) return { diff, pinned: false };
  if (!prDir || !mergeBase || !head) {
    log("no merge base or checkout to diff locally; the API diff is not pinned");
    return { diff, pinned: false };
  }
  try {
    const local = localDiff(prDir, mergeBase, head, run);
    return local ? { diff: local, pinned: true } : { diff, pinned: false };
  } catch (err) {
    log(`could not diff ${mergeBase}..${head} locally; the API diff is not pinned: ${String(err?.message).slice(0, 200)}`);
    return { diff, pinned: false };
  }
}

// `unfocused` keeps the whole diff for a gate candidate, whose approval must rest on reviewers that saw every file; requiresFocus agents still opt out.
export function reviewerDiff(diff, { fileFocus, requiresFocus }, { unfocused = false, pathOf = path => path } = {}) {
  if (!fileFocus) return { diff, skipped: false, fullDiff: true };
  const sections = diff.split(/^diff --git /gm).filter(Boolean);
  const relevant = sections.filter(s => {
    const m = s.match(/^a\/(.*?) b\/(.*?)\n/);
    return m && fileFocus(pathOf(m[2]));
  });
  if (relevant.length === 0) return { diff, skipped: Boolean(requiresFocus), fullDiff: !requiresFocus };
  if (unfocused) return { diff, skipped: false, fullDiff: true };
  const narrowed = relevant.map(s => `diff --git ${s}`).join("");
  return { diff: narrowed, skipped: false, fullDiff: narrowed === diff };
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
