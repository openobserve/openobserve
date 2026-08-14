// Live matched-target preview for the Eval Job form. The filter is evaluated
// against spans, while the result is counted at the selected Target Scope:
// rows for span scope, distinct trace ids for trace scope, and distinct session
// ids for session scope.

import { ref, watch, onUnmounted, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { EvalTargetScope } from "@/services/online-evals.service";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 400;

/** Double-quote a SQL identifier so unusual stream names remain valid. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function countExpression(targetScope: EvalTargetScope): string {
  if (targetScope === "trace") {
    return `COUNT(DISTINCT ${quoteIdent("trace_id")})`;
  }
  if (targetScope === "session") {
    return `COUNT(DISTINCT ${quoteIdent("session_id")})`;
  }
  return "COUNT(*)";
}

export function buildJobMatchedTargetsSql(
  stream: string,
  whereClause: string,
  targetScope: EvalTargetScope,
): string {
  const where = whereClause.trim();
  return [
    `SELECT ${countExpression(targetScope)} AS cnt`,
    `FROM ${quoteIdent(stream)}`,
    where ? `WHERE ${where}` : "",
  ]
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
) {
  const { executeQuery } = useLLMStreamQuery();
  const count = ref<number | null>(null);
  const isLoading = ref(false);
  const error = ref(false);

  let timer: ReturnType<typeof setTimeout> | null = null;

  async function run() {
    error.value = false;
    if (!stream.value) {
      count.value = null;
      isLoading.value = false;
      return;
    }
    if (!ready.value) {
      isLoading.value = false;
      return;
    }

    const sql = buildJobMatchedTargetsSql(stream.value, whereClause.value, targetScope.value);
    const endUs = Date.now() * 1000;
    const startUs = (Date.now() - WINDOW_MS) * 1000;
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

  watch([stream, whereClause, ready, targetScope], schedule, {
    immediate: true,
  });

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return { count, isLoading, error };
}
