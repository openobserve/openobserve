// Copyright 2026 OpenObserve Inc.
//
// useSigmaRules.ts — which detections apply to the stream on screen, and what
// they would have caught over the window on screen.
//
// The counts are what make this more than a rule browser. A list of rules that
// "apply" tells an analyst nothing about their data; a list that says which
// three fired 400 times last night and which twenty are silent is the beginning
// of a tuning decision.
//
// All of the counts come from ONE query. The obvious implementation runs a COUNT
// per rule, which is thirty scans of the same partitions to answer thirty
// questions about the same rows. Instead every rule becomes a conditional
// aggregate in a single SELECT, so the data is read once no matter how many
// rules are being evaluated.

import { computed, ref, shallowRef } from "vue";

import searchService from "@/services/search";
import type { SourceType } from "@/utils/security/sourceTypes";
import type { ApplicableRule } from "@/utils/security/sigma";
import { applicableRules } from "@/utils/security/sigma";

export interface RuleHit extends ApplicableRule {
  /** Matching rows in the window, or null when the counts have not been run. */
  count: number | null;
}

export interface SigmaRunRange {
  /** Microseconds since epoch, matching the search API. */
  start: number;
  end: number;
}

/**
 * Builds the single query that counts every runnable rule at once.
 *
 * Aliases are positional (`r0`, `r1`) rather than derived from rule titles,
 * because a title is free text and would have to be escaped into an identifier;
 * the caller already has the rules in order.
 */
export function buildRuleCountSql(stream: string, wheres: string[]): string {
  const projections = wheres.map(
    (where, index) => `SUM(CASE WHEN ${where} THEN 1 ELSE 0 END) AS r${index}`,
  );
  return `SELECT ${projections.join(", ")} FROM "${stream.replace(/"/g, '""')}"`;
}

export function useSigmaRules() {
  const rules = shallowRef<RuleHit[]>([]);
  const counting = ref(false);
  const error = ref("");

  /** Compiles the shipped pack against a stream. Cheap, and does not query. */
  function compileFor(source: SourceType | null, fields: string[]) {
    error.value = "";
    if (!source || !fields.length) {
      rules.value = [];
      return;
    }
    rules.value = applicableRules(source, fields).map((entry) => ({ ...entry, count: null }));
  }

  /** Runs the runnable rules over a window and attaches the hit counts. */
  async function countHits(orgId: string, stream: string, range: SigmaRunRange) {
    const runnable = rules.value.filter((entry) => entry.compiled.runnable);
    if (!orgId || !stream || !runnable.length) return;

    counting.value = true;
    error.value = "";
    try {
      const sql = buildRuleCountSql(
        stream,
        runnable.map((entry) => entry.compiled.where),
      );
      const res = await searchService.search(
        {
          org_identifier: orgId,
          query: {
            query: { sql, start_time: range.start, end_time: range.end, from: 0, size: 1 },
          },
          page_type: "logs",
        },
        "ui",
      );
      const row = res.data?.hits?.[0] ?? {};
      // Rebuilt rather than mutated so the shallowRef actually notifies.
      const counts = new Map<ApplicableRule, number>();
      runnable.forEach((entry, index) => {
        const value = Number(row[`r${index}`] ?? 0);
        counts.set(entry, Number.isFinite(value) ? value : 0);
      });
      rules.value = rules.value.map((entry) => ({
        ...entry,
        count: counts.has(entry) ? counts.get(entry)! : entry.count,
      }));
    } catch (e: any) {
      // A failed count must not hide the rules themselves, which are still
      // correct and still worth showing.
      error.value = e?.response?.data?.error ?? e?.message ?? "Could not evaluate rules";
    } finally {
      counting.value = false;
    }
  }

  const runnableCount = computed(() => rules.value.filter((r) => r.compiled.runnable).length);
  const firingCount = computed(() => rules.value.filter((r) => (r.count ?? 0) > 0).length);

  /**
   * Rules with hits first, so triage order is the read order.
   *
   * Ties keep the order `applicableRules` produced, which is runnable-first then
   * most severe — Array.prototype.sort is stable, so returning 0 preserves it
   * rather than needing the severity comparison repeated here. Rules that were
   * never run (never runnable, or counts not yet fetched) sort below a rule that
   * ran and found nothing, because "silent" and "unknown" are different answers.
   */
  const ranked = computed(() => [...rules.value].sort((a, b) => (b.count ?? -1) - (a.count ?? -1)));

  return { rules, ranked, counting, error, runnableCount, firingCount, compileFor, countHits };
}
