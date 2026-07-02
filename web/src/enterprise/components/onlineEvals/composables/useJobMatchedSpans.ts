// Live "matched spans" preview for the Eval Job form. Runs a COUNT(*) against
// the selected trace stream with the job's filter applied, over a recent window
// (the form has no date picker, so we use a fixed last-24h window as an
// estimate — sampling/scoring happen going forward). Uses the same streaming
// search runner the detail-page KPIs use.

import { ref, watch, onUnmounted, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 400;

/** Double-quote a stream identifier so names with odd characters stay valid. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function useJobMatchedSpans(
  stream: Ref<string>,
  /** A ready-to-use SQL WHERE body (no `WHERE` prefix), or "" for no filter. */
  whereClause: Ref<string>,
  /** Gate — only query when the filter is fully specified. While a condition is
   * half-filled this is false and we skip the query (no flicker, no bad SQL). */
  ready: Ref<boolean>,
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
    // Filter still being edited — don't fire a query (the panel shows a hint).
    if (!ready.value) {
      isLoading.value = false;
      return;
    }
    const where = whereClause.value.trim();
    const sql = [
      "SELECT COUNT(*) AS cnt",
      `FROM ${quoteIdent(stream.value)}`,
      where ? `WHERE ${where}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const endUs = Date.now() * 1000;
    const startUs = (Date.now() - WINDOW_MS) * 1000;
    isLoading.value = true;
    try {
      const hits = await executeQuery(sql, startUs, endUs, "traces");
      const raw = (hits as Array<{ cnt?: number | string }>)[0]?.cnt;
      const n = typeof raw === "number" ? raw : Number(raw);
      count.value = Number.isFinite(n) ? n : 0;
    } catch (err) {
      console.warn("[JobMatchedSpans] failed", err);
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

  watch([stream, whereClause, ready], schedule, { immediate: true });

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return { count, isLoading, error };
}
