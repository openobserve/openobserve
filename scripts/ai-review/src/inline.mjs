import { createHash } from "node:crypto";

export const INLINE_SEVERITIES = new Set(["critical", "warning"]);
export const MAX_INLINE_COMMENTS = 10;
// A model that wraps the block in a code fence leaves an empty fence behind once the block is cut out.
const EMPTY_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[a-z]*[ \t]*\n\s*\1[ \t]*$/gim;
const FINGERPRINT_RE = /<!--\s*ai-review-fp:([0-9a-f]{40})\s*-->/g;
const SEVERITY_LABEL = { critical: "🔴 Blocker", warning: "🟡 Warning" };

// Lines a review comment may anchor to with side RIGHT: added and context lines of each hunk, keyed by new path.
export function rightSideLines(diff) {
  const files = new Map();
  let lines = null;
  let next = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("\\")) continue;
      if (line.startsWith("-")) { oldLeft -= 1; continue; }
      // Some tools strip the space off an empty context line.
      if (line.startsWith("+")) newLeft -= 1;
      else { oldLeft -= 1; newLeft -= 1; }
      lines?.add(next);
      next += 1;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      lines = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = /^\+\+\+ "?b\/(.*?)"?$/.exec(line)?.[1];
      lines = path ? new Set() : null;
      if (path) files.set(path, lines);
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      next = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return files;
}

function stripComments(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

function normalizeFinding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = stripComments(raw.title ?? raw.summary);
  if (!title) return null;
  return {
    file: String(raw.file ?? "").trim().replace(/^\.?\//, ""),
    line: Number.parseInt(raw.line, 10) || 0,
    severity: String(raw.severity ?? "").trim().toLowerCase(),
    category: stripComments(raw.category),
    title,
    body: stripComments(raw.body ?? raw.description),
  };
}

// Finds each `<!-- ai-review-inline [...] -->` block. The end is the first `-->` after which the JSON parses,
// so a `-->` inside a JSON string does not cut the block short.
function findInlineBlocks(source) {
  const blocks = [];
  const startRe = /<!--\s*ai-review-inline\b/gi;
  let start;
  while ((start = startRe.exec(source)) !== null) {
    const bodyAt = start.index + start[0].length;
    let end = source.indexOf("-->", bodyAt);
    if (end === -1) break;
    const firstEnd = end;
    let json = null;
    while (end !== -1) {
      try {
        json = JSON.parse(source.slice(bodyAt, end).trim());
        break;
      } catch {
        end = source.indexOf("-->", end + 3);
      }
    }
    if (json === null) end = firstEnd;
    blocks.push({ from: start.index, to: end + 3, json, raw: source.slice(bodyAt, end) });
    startRe.lastIndex = end + 3;
  }
  return blocks;
}

// Cuts every inline block out of the coordinator output and parses the first one.
export function extractInlineBlock(text) {
  const source = String(text ?? "");
  const blocks = findInlineBlocks(source);
  let stripped = source;
  for (const b of [...blocks].reverse()) stripped = stripped.slice(0, b.from) + stripped.slice(b.to);
  stripped = stripped.replace(EMPTY_FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (blocks.length === 0) return { text: stripped, findings: [], error: "no inline block" };
  const parsed = blocks[0].json;
  if (parsed === null) return { text: stripped, findings: [], error: "inline block is not valid JSON" };
  if (!Array.isArray(parsed)) return { text: stripped, findings: [], error: "inline block is not a JSON array" };
  return { text: stripped, findings: parsed.map(normalizeFinding).filter(Boolean), error: null };
}

export function normalizeTitle(title) {
  return String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function fingerprint(file, title) {
  return createHash("sha1").update(`${file}|${normalizeTitle(title)}`).digest("hex");
}

export function fingerprintMarker(fp) {
  return `<!-- ai-review-fp:${fp} -->`;
}

export function existingFingerprints(comments, botLogin) {
  const found = new Set();
  if (!botLogin) return found;
  for (const c of comments) {
    if (c?.user?.login !== botLogin) continue;
    for (const m of String(c.body ?? "").matchAll(FINGERPRINT_RE)) found.add(m[1]);
  }
  return found;
}

// Keeps critical/warning findings whose anchor is a RIGHT-side line of the PR diff, skips ones already posted, caps the count.
export function selectInlineComments(findings, rightLines, posted = new Set(), max = MAX_INLINE_COMMENTS) {
  const selected = [];
  const dropped = { severity: 0, anchor: 0, duplicate: 0, cap: 0 };
  const seen = new Set(posted);
  const ranked = [...findings].sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));
  for (const f of ranked) {
    if (!INLINE_SEVERITIES.has(f.severity)) { dropped.severity += 1; continue; }
    if (!f.file || !(f.line > 0) || !rightLines.get(f.file)?.has(f.line)) { dropped.anchor += 1; continue; }
    const fp = fingerprint(f.file, f.title);
    if (seen.has(fp)) { dropped.duplicate += 1; continue; }
    if (selected.length >= max) { dropped.cap += 1; continue; }
    seen.add(fp);
    selected.push({ ...f, fingerprint: fp });
  }
  return { selected, dropped };
}

// `scrub` runs over the model-written text only; the fingerprint is appended after it so the scrub cannot alter it.
export function renderInlineBody(f, scrub = text => text) {
  const label = SEVERITY_LABEL[f.severity] || f.severity;
  const head = `**${label}${f.category ? ` · ${f.category}` : ""}:** ${f.title}`;
  const text = scrub(f.body ? `${head}\n\n${f.body}` : head);
  return `${text}\n\n${fingerprintMarker(f.fingerprint)}`;
}

export function buildReviewPayload(selected, commitId, body, scrub) {
  const payload = {
    event: "COMMENT",
    body,
    comments: selected.map(f => ({ path: f.file, line: f.line, side: "RIGHT", body: renderInlineBody(f, scrub) })),
  };
  if (commitId) payload.commit_id = commitId;
  return payload;
}
