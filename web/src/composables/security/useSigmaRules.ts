// Copyright 2026 OpenObserve Inc.

// Every rule is a conditional aggregate in ONE query, so the data is read once however many rules run.

import { computed, ref, shallowRef } from "vue";

import { runSql } from "@/composables/security/useSecurityStreamPlans";
import { quoteIdent } from "@/utils/security/sql";
import { queryClient } from "@/composables/query/queryClient";
import { sigmaCatalogQuery, sigmaCompileQuery } from "@/services/securitySigma.queries";
import type { CatalogRule, CompiledSigma } from "@/services/securitySigma";
import type { SourceType } from "@/services/securitySources";

export interface ApplicableRule {
  rule: CatalogRule;
  compiled: CompiledSigma;
}

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

  let compileSeq = 0;
  /** Compiles the shipped pack against a stream on the server; runnable and severe first. */
  async function compileFor(orgId: string, source: SourceType | null, fields: string[]) {
    error.value = "";
    const seq = ++compileSeq;
    if (!orgId || !source || !fields.length) {
      rules.value = [];
      return;
    }
    try {
      const [catalog, result] = await Promise.all([
        queryClient.fetchQuery(sigmaCatalogQuery(orgId)),
        queryClient.fetchQuery(sigmaCompileQuery(orgId, { source_type: source.id, fields })),
      ]);
      if (seq !== compileSeq) return;
      const byKey = new Map(catalog.rules.map((rule) => [rule.key, rule]));
      rules.value = result.applicable.flatMap(({ key, compiled }) => {
        const rule = byKey.get(key);
        return rule ? [{ rule, compiled, count: null }] : [];
      });
    } catch (e: any) {
      if (seq !== compileSeq) return;
      rules.value = [];
      error.value = e?.response?.data?.message ?? e?.message ?? "Could not compile rules";
    }
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
