import type { EvalTargetScope } from "@/services/online-evals.service";

export type QualityScope = "all" | EvalTargetScope;

export type ScopeCounts = {
  span: number;
  trace: number;
  session: number;
};

export const QUALITY_TARGET_SCOPES: readonly EvalTargetScope[] = [
  "span",
  "trace",
  "session",
];

export function emptyScopeCounts(): ScopeCounts {
  return { span: 0, trace: 0, session: 0 };
}

/** Predicate for the normalized columns exposed by latestScoresFromSql(). */
export function qualityScopeWhere(scope: QualityScope): string | null {
  return scope === "all" ? null : `_target_scope = '${scope}'`;
}

export function scopeCountsFromRow(
  row:
    | {
        span_count?: unknown;
        trace_count?: unknown;
        session_count?: unknown;
      }
    | null
    | undefined,
): ScopeCounts {
  const count = (value: unknown): number => {
    if (value == null) return 0;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    span: count(row?.span_count),
    trace: count(row?.trace_count),
    session: count(row?.session_count),
  };
}
