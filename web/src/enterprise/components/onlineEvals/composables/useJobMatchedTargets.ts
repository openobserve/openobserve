// Live matched-target preview for the Eval Job form. The filter is evaluated
// against spans, while the result is counted at the selected Target Scope:
// rows for span scope, distinct trace ids for trace scope, and distinct session
// ids for session scope.

import { ref, watch, onUnmounted, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { EvalTargetScope } from "@/services/online-evals.service";

const WINDOW_MS = 60 * 60 * 1000;
const DEBOUNCE_MS = 400;

export function buildJobMatchedTargetsTimeRange(nowMs = Date.now()) {
  return {
    startUs: (nowMs - WINDOW_MS) * 1000,
    endUs: nowMs * 1000,
  };
}

/** Double-quote a SQL identifier so unusual stream names remain valid. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The columns the eval scheduler reads a span's session id from, in its order. */
export const SESSION_ID_COLUMNS = ["session_id", "gen_ai_conversation_id", "llm_session_id"];

/** A target's id at `scope` as SQL; null when session scope has no session column. */
export function targetIdExpression(
  targetScope: EvalTargetScope,
  fields: readonly string[],
): string | null {
  if (targetScope === "span") return quoteIdent("span_id");
  if (targetScope === "trace") return quoteIdent("trace_id");
  const cols = SESSION_ID_COLUMNS.filter((c) => fields.includes(c)).map(
    (c) => `NULLIF(${quoteIdent(c)}, '')`,
  );
  if (!cols.length) return null;
  return cols.length === 1 ? cols[0] : `COALESCE(${cols.join(", ")})`;
}

/** Matched targets at `scope`; null when the stream cannot be counted at it. */
export function countExpression(
  targetScope: EvalTargetScope,
  fields: readonly string[],
): string | null {
  if (targetScope === "span") return "COUNT(*)";
  const id = targetIdExpression(targetScope, fields);
  return id && `COUNT(DISTINCT ${id})`;
}

export function buildJobMatchedTargetsSql(
  stream: string,
  whereClause: string,
  targetScope: EvalTargetScope,
  fields: readonly string[],
): string | null {
  const count = countExpression(targetScope, fields);
  if (!count) return null;
  const where = whereClause.trim();
  return [`SELECT ${count} AS cnt`, `FROM ${quoteIdent(stream)}`, where ? `WHERE ${where}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function useJobMatchedTargets(
  stream: Ref<string>,
  /** A ready-to-use SQL WHERE body (no `WHERE` prefix), or "" for no filter. */
  whereClause: Ref<string>,
  /** Gate while a partially configured condition would produce invalid SQL. */
  ready: Ref<boolean>,
  targetScope: Ref<EvalTargetScope>,
  /** Field names of the stream's schema; null while it loads. */
  fields: Ref<readonly string[] | null>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const count = ref<number | null>(null);
  const isLoading = ref(false);
  const error = ref(false);
  /** Session scope on a stream without a session column. */
  const noSessionColumn = ref(false);

  let timer: ReturnType<typeof setTimeout> | null = null;

  async function run() {
    error.value = false;
    noSessionColumn.value = false;
    if (!stream.value) {
      count.value = null;
      isLoading.value = false;
      return;
    }
    if (!ready.value) {
      isLoading.value = false;
      return;
    }

    // A session count waits for the schema that names its column.
    if (targetScope.value === "session" && !fields.value) {
      count.value = null;
      isLoading.value = true;
      return;
    }
    const sql = buildJobMatchedTargetsSql(
      stream.value,
      whereClause.value,
      targetScope.value,
      fields.value ?? [],
    );
    if (!sql) {
      noSessionColumn.value = true;
      count.value = null;
      isLoading.value = false;
      return;
    }
    const { startUs, endUs } = buildJobMatchedTargetsTimeRange();
    isLoading.value = true;
    try {
      const hits = await executeQuery(sql, startUs, endUs, "traces");
      const raw = (hits as Array<{ cnt?: number | string }>)[0]?.cnt;
      const value = typeof raw === "number" ? raw : Number(raw);
      count.value = Number.isFinite(value) ? value : 0;
    } catch (err) {
      console.warn("[JobMatchedTargets] failed", err);
      error.value = true;
      count.value = null;
    } finally {
      isLoading.value = false;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  }

  watch([stream, whereClause, ready, targetScope, fields], schedule, {
    immediate: true,
  });

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return { count, isLoading, error, noSessionColumn };
}
