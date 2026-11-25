import { normalizedTitle, titleWords } from "./report.mjs";

// Numeric score configs the harness reports to; run-experiment.mjs checks they exist before it spends anything.
export const SCORE_CONFIGS = {
  cacheWrite: "ai_review_cache_write_tokens",
  cacheRead: "ai_review_cache_read_tokens",
  recall: "ai_review_recall",
  newFindings: "ai_review_new_findings",
};

const NEARBY_LINES = 5;

function pathOf(finding) {
  return String(finding?.file ?? "").trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

// 0 is unknown: findings without a reliable line carry none.
function lineOf(finding) {
  const line = Number.parseInt(finding?.line, 10);
  return Number.isFinite(line) && line > 0 ? line : 0;
}

function titleOf(finding) {
  return String(finding?.title ?? finding?.summary ?? "");
}

// The same title once normalized, or at least two shared content words covering at least half of the longer title.
export function titleMatch(a, b) {
  const [na, nb] = [normalizedTitle(a), normalizedTitle(b)];
  if (!na || !nb) return { ok: false, exact: false, shared: 0 };
  if (na === nb) return { ok: true, exact: true, shared: Number.MAX_SAFE_INTEGER };
  const [wa, wb] = [titleWords(a), titleWords(b)];
  const shared = [...wa].filter(word => wb.has(word)).length;
  return { ok: shared >= 2 && shared / Math.max(wa.size, wb.size) >= 0.5, exact: false, shared };
}

// What an ineligible pair costs inside one group of findings: more than any total of real pair costs, so the largest possible number of
// pairs always wins and an ineligible pair is only ever "assigned" to fill a row, then dropped.
const INELIGIBLE = 1e9;

// Minimum-cost assignment of every row of an n x m matrix (n <= m) to its own column (Hungarian algorithm); returns each row's column.
function assign(cost, n, m) {
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const owner = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    owner[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = owner[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const reduced = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (reduced < minv[j]) { minv[j] = reduced; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) { u[owner[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (owner[j0] !== 0);
    do {
      const j1 = way[j0];
      owner[j0] = owner[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const columnOf = new Array(n);
  for (let j = 1; j <= m; j += 1) if (owner[j] > 0) columnOf[owner[j] - 1] = j - 1;
  return columnOf;
}

// Eligible pairs only: the same file, lines within 5 (a line either side lacks is not held against the title match) and matching titles.
// Kept findings are only compared with the ones of their own file.
function eligiblePairs(expected, kept) {
  const keptByFile = new Map();
  kept.forEach((finding, j) => {
    const file = pathOf(finding);
    if (!file) return;
    if (!keptByFile.has(file)) keptByFile.set(file, []);
    keptByFile.get(file).push(j);
  });
  const edges = [];
  expected.forEach((e, i) => {
    const candidates = keptByFile.get(pathOf(e));
    if (!candidates) return;
    const le = lineOf(e);
    for (const j of candidates) {
      const lk = lineOf(kept[j]);
      if (le > 0 && lk > 0 && Math.abs(le - lk) > NEARBY_LINES) continue;
      const title = titleMatch(titleOf(e), titleOf(kept[j]));
      if (!title.ok) continue;
      edges.push({ i, j, cost: (title.exact ? 0 : 100) + (le > 0 && lk > 0 ? Math.abs(le - lk) : NEARBY_LINES + 1) });
    }
  });
  return edges;
}

// Same file, lines within 5 (an unknown line is not held against it) and matching titles, one to one with as many pairs as possible;
// exact titles and nearer lines break ties. Only eligible pairs are assigned, in connected groups, so work follows the pairs there are.
export function matchFindings(expected, kept) {
  if (expected.length === 0 || kept.length === 0) return [];
  const edges = eligiblePairs(expected, kept);
  if (edges.length === 0) return [];
  // Groups: connected sets of findings joined by eligible pairs (expected i is node i, kept j is node expected.length + j).
  const parent = Array.from({ length: expected.length + kept.length }, (_, node) => node);
  const find = node => {
    while (parent[node] !== node) { parent[node] = parent[parent[node]]; node = parent[node]; }
    return node;
  };
  for (const { i, j } of edges) parent[find(i)] = find(expected.length + j);
  const groups = new Map();
  for (const edge of edges) {
    const root = find(edge.i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(edge);
  }
  const pairs = [];
  for (const group of groups.values()) {
    const rows = [...new Set(group.map(edge => edge.i))].sort((a, b) => a - b);
    const cols = [...new Set(group.map(edge => edge.j))].sort((a, b) => a - b);
    // The matrix has the smaller side as its rows.
    const transpose = rows.length > cols.length;
    const [small, large] = transpose ? [cols, rows] : [rows, cols];
    const smallIndex = new Map(small.map((value, index) => [value, index]));
    const largeIndex = new Map(large.map((value, index) => [value, index]));
    const cost = small.map(() => new Array(large.length).fill(INELIGIBLE));
    for (const { i, j, cost: pairCost } of group) {
      cost[smallIndex.get(transpose ? j : i)][largeIndex.get(transpose ? i : j)] = pairCost;
    }
    assign(cost, small.length, large.length).forEach((column, row) => {
      if (cost[row][column] >= INELIGIBLE) return;
      pairs.push(transpose ? [large[column], small[row]] : [small[row], large[column]]);
    });
  }
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// null when the row carries no usable expectation: such a row is scored on cost and tokens only.
export function expectedFindings(expectedOutput) {
  return Array.isArray(expectedOutput?.findings) ? expectedOutput.findings : null;
}

// An empty expectation is fully recalled by any answer; everything kept beyond the matched ones is new.
export function scoreFindings(expected, kept) {
  const matched = matchFindings(expected, kept).length;
  return { matched, recall: expected.length === 0 ? 1 : matched / expected.length, newFindings: kept.length - matched };
}

const known = value => Number.isFinite(value);

// Tokens in include the cache, tokens out include reasoning (the record's convention); a total is only stated when every part is known.
export function usageFromSummary(summary) {
  const tokens = summary?.totals?.tokens;
  const sum = fields => (tokens && fields.every(field => known(tokens[field])) ? fields.reduce((total, field) => total + tokens[field], 0) : null);
  return {
    tokensIn: sum(["input", "cache_read", "cache_write"]),
    tokensOut: sum(["output", "reasoning"]),
    cacheRead: known(tokens?.cache_read) ? tokens.cache_read : null,
    cacheWrite: known(tokens?.cache_write) ? tokens.cache_write : null,
    cost: known(summary?.totals?.cost) ? summary.totals.cost : null,
  };
}

// Only for an ok record; an unknown count is left out rather than reported as zero.
export function slotScores({ rowId, trialIndex, usage, expectedOutput, kept }) {
  const scores = [];
  const add = (key, scoreConfig, value, reasoning) => scores.push({
    rowId,
    trialIndex,
    clientScorerKey: `ai-review-harness:${key}`,
    scoreConfig,
    value,
    ...(reasoning ? { reasoning } : {}),
  });
  if (usage.cacheWrite !== null) add("cache_write_tokens", SCORE_CONFIGS.cacheWrite, usage.cacheWrite);
  if (usage.cacheRead !== null) add("cache_read_tokens", SCORE_CONFIGS.cacheRead, usage.cacheRead);
  const expected = expectedFindings(expectedOutput);
  if (expected) {
    const result = scoreFindings(expected, kept);
    add("recall", SCORE_CONFIGS.recall, result.recall, `${result.matched} of ${expected.length} expected findings matched`);
    add("new_findings", SCORE_CONFIGS.newFindings, result.newFindings, `${kept.length} kept, ${result.matched} matched an expected finding`);
  }
  return scores;
}
