import { reviewerFinished, shortName } from "./confidence.mjs";

export const DEFAULT_COLD_PASSES = 2;
export const MAX_COLD_PASSES = 3;

// Anything unreadable falls back to the default rather than to one pass, so a typo never quietly halves the review.
export function parseColdPasses(raw) {
  const text = String(raw ?? "").trim();
  if (!/^-?\d+$/.test(text)) return DEFAULT_COLD_PASSES;
  return Math.min(MAX_COLD_PASSES, Math.max(1, Number.parseInt(text, 10)));
}

export function passLabel(agentName, pass, passes) {
  return passes > 1 ? `${agentName}, pass ${pass}/${passes}` : agentName;
}

// Pass-major, so when the pool queues work every area gets its first pass before any gets a second.
export function passPlan(agentKeys, passes) {
  const plan = [];
  for (let pass = 1; pass <= passes; pass += 1) {
    for (const agentKey of agentKeys) plan.push({ agentKey, pass });
  }
  return plan;
}

export async function runPooled(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

function mergeArea(group) {
  const finished = group.filter(reviewerFinished);
  const ran = group.filter(r => !r.skipped);
  const base = finished[0] ?? ran[0] ?? group[0];
  const covered = finished.length > 0;
  return {
    agentKey: base.agentKey,
    agentName: base.agentName,
    // Findings from a cut-off pass stay, as in a single-pass run: a blocker must not vanish because its pass failed.
    findings: group.flatMap(r => r.findings || []),
    rawText: "",
    error: covered ? null : (ran.find(r => r.error)?.error ?? null),
    timedOut: !covered && ran.length > 0 && ran.every(r => r.timedOut),
    genAIResponseId: base.genAIResponseId || "",
    skipped: group.every(r => r.skipped),
    fullDiff: base.fullDiff,
    parsed: covered,
    passes: group.length,
    passesFinished: finished.length,
    passResults: group,
  };
}

// An area is reviewed when any of its cold passes finished; only an area whose every pass failed counts as unfinished.
export function mergePassResults(passResults) {
  const groups = new Map();
  for (const r of passResults) {
    if (!groups.has(r.agentKey)) groups.set(r.agentKey, []);
    groups.get(r.agentKey).push(r);
  }
  return [...groups.values()].map(mergeArea);
}

export function lostPasses(results) {
  return results.filter(r => !r.skipped && r.passesFinished > 0 && r.passesFinished < r.passes);
}

// Written by code like the failed-reviewers line, so a reader learns an area got less scrutiny than the rest.
export function lostPassesNote(results) {
  const lost = lostPasses(results);
  if (!lost.length) return "";
  const detail = lost.map(r => `${shortName(r.agentName)}: ${r.passes - r.passesFinished} of ${r.passes}`).join(", ");
  return `> ℹ️ Some reviewer passes did not finish (${detail}); those areas were still reviewed by the passes that finished.`;
}
