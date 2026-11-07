// Copyright 2026 OpenObserve Inc.

// Every rule is a conditional aggregate in ONE query, so the data is read once however many rules run.

import { computed, ref, shallowRef } from "vue";

import { runSql } from "@/composables/security/useSecurityStreamPlans";
import type { SourceType } from "@/utils/security/sourceTypes";
import { quoteIdent } from "@/utils/security/sql";
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

/** Aliases are positional (`r0`, `r1`) because a free-text rule title would need escaping into an identifier. */
export function buildRuleCountSql(stream: string, wheres: string[]): string {
  const projections = wheres.map(
    (where, index) => `SUM(CASE WHEN ${where} THEN 1 ELSE 0 END) AS r${index}`,
  );
  return `SELECT ${projections.join(", ")} FROM ${quoteIdent(stream)}`;
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
      const { hits } = await runSql(orgId, sql, range.start, range.end, 1);
      const row = hits[0] ?? {};
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
      // A failed count must not hide the rules themselves, which are still worth showing.
      error.value = e?.response?.data?.error ?? e?.message ?? "Could not evaluate rules";
    } finally {
      counting.value = false;
    }
  }

  const runnableCount = computed(() => rules.value.filter((r) => r.compiled.runnable).length);
  const firingCount = computed(() => rules.value.filter((r) => (r.count ?? 0) > 0).length);

  // Stable sort keeps the severity order on ties; never-run rules (-1) sort below silent ones.
  const ranked = computed(() => [...rules.value].sort((a, b) => (b.count ?? -1) - (a.count ?? -1)));

  return { rules, ranked, counting, error, runnableCount, firingCount, compileFor, countHits };
}
