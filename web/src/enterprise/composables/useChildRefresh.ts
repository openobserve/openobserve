import { ref, computed, type Ref } from "vue";

interface RefreshableChild {
  refresh?: () => any;
  lastRunAt?: number | null;
  loading?: boolean;
}

export function useChildRefresh(
  childRef: Ref<RefreshableChild | null | undefined>,
  opts: {
    onBeforeRefresh?: () => void | Promise<void>;
    // Custom child-refresh invocation. When omitted, the child's bare
    // `refresh()` is called (correct for children that default their window to
    // their own props — Agent Behavior / Agent Graph). Host pages whose child
    // must be handed an explicit re-anchored window after a nextTick (Sessions /
    // LLM Insights, which pass `refresh(start, end)`) supply this instead, so
    // their exact prior refresh call is preserved byte-for-byte.
    invokeRefresh?: () => void | Promise<void>;
  } = {},
) {
  const isRefreshing = ref(false);
  const lastRunAt = computed<number | null>(() => childRef.value?.lastRunAt ?? null);
  const isLoading = computed(() => isRefreshing.value || childRef.value?.loading || false);

  async function refresh() {
    if (isRefreshing.value) return;
    isRefreshing.value = true;
    try {
      await opts.onBeforeRefresh?.();
      if (opts.invokeRefresh) {
        await opts.invokeRefresh();
      } else {
        await childRef.value?.refresh?.();
      }
    } finally {
      isRefreshing.value = false;
    }
  }

  return { isRefreshing, lastRunAt, isLoading, refresh };
}
