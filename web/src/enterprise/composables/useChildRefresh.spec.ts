// @vitest-environment jsdom
// Tests for useChildRefresh — the shared header refresh-button wiring
// extracted from AgentBehaviorPage.vue (and duplicated across the other
// AI host pages). Covers:
//   • lastRunAt mirrors the child's lastRunAt
//   • isLoading reflects child.loading
//   • isLoading is true while a refresh is in flight
//   • refresh() calls onBeforeRefresh before child.refresh
//   • refresh() is re-entrant-guarded (no-op while already refreshing)
//   • isRefreshing toggles across the refresh lifecycle

import { describe, it, expect, vi } from "vitest";
import { ref, nextTick } from "vue";
import { useChildRefresh } from "./useChildRefresh";

describe("useChildRefresh", () => {
  it("mirrors lastRunAt from the child ref", () => {
    const childRef = ref({ refresh: vi.fn(), lastRunAt: 123, loading: false });
    const { lastRunAt } = useChildRefresh(childRef as any);
    expect(lastRunAt.value).toBe(123);
  });

  it("lastRunAt is null when child is absent", () => {
    const childRef = ref(null);
    const { lastRunAt } = useChildRefresh(childRef as any);
    expect(lastRunAt.value).toBeNull();
  });

  it("isLoading is true when child.loading is true", () => {
    const childRef = ref({ refresh: vi.fn(), lastRunAt: null, loading: true });
    const { isLoading } = useChildRefresh(childRef as any);
    expect(isLoading.value).toBe(true);
  });

  it("isLoading is false when child.loading is false and not refreshing", () => {
    const childRef = ref({ refresh: vi.fn(), lastRunAt: null, loading: false });
    const { isLoading } = useChildRefresh(childRef as any);
    expect(isLoading.value).toBe(false);
  });

  it("isLoading is true while refresh() is in flight, even if child.loading is false", async () => {
    let resolveRefresh: () => void = () => {};
    const childRefreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const childRef = ref({
      refresh: vi.fn(() => childRefreshPromise),
      lastRunAt: null,
      loading: false,
    });
    const { isLoading, refresh, isRefreshing } = useChildRefresh(childRef as any);

    const refreshCall = refresh();
    await nextTick();
    expect(isRefreshing.value).toBe(true);
    expect(isLoading.value).toBe(true);

    resolveRefresh();
    await refreshCall;

    expect(isRefreshing.value).toBe(false);
    expect(isLoading.value).toBe(false);
  });

  it("refresh() calls onBeforeRefresh before child.refresh", async () => {
    const callOrder: string[] = [];
    const childRef = ref({
      refresh: vi.fn(async () => {
        callOrder.push("child.refresh");
      }),
      lastRunAt: null,
      loading: false,
    });
    const onBeforeRefresh = vi.fn(() => {
      callOrder.push("onBeforeRefresh");
    });
    const { refresh } = useChildRefresh(childRef as any, { onBeforeRefresh });

    await refresh();

    expect(callOrder).toEqual(["onBeforeRefresh", "child.refresh"]);
    expect(onBeforeRefresh).toHaveBeenCalledTimes(1);
    expect(childRef.value.refresh).toHaveBeenCalledTimes(1);
  });

  it("refresh() works without onBeforeRefresh provided", async () => {
    const childRef = ref({ refresh: vi.fn(), lastRunAt: null, loading: false });
    const { refresh } = useChildRefresh(childRef as any);

    await expect(refresh()).resolves.toBeUndefined();
    expect(childRef.value.refresh).toHaveBeenCalledTimes(1);
  });

  it("refresh() is a no-op re-entry guard while already refreshing", async () => {
    let resolveRefresh: () => void = () => {};
    const childRefreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshFn = vi.fn(() => childRefreshPromise);
    const childRef = ref({ refresh: refreshFn, lastRunAt: null, loading: false });
    const { refresh, isRefreshing } = useChildRefresh(childRef as any);

    const firstCall = refresh();
    await nextTick();
    expect(isRefreshing.value).toBe(true);

    // second call while refreshing should be a no-op
    const secondCall = refresh();
    await secondCall;

    expect(refreshFn).toHaveBeenCalledTimes(1);

    resolveRefresh();
    await firstCall;
    expect(isRefreshing.value).toBe(false);
  });

  it("does not throw when child.refresh is undefined", async () => {
    const childRef = ref({ lastRunAt: null, loading: false } as any);
    const { refresh, isRefreshing } = useChildRefresh(childRef as any);

    await expect(refresh()).resolves.toBeUndefined();
    expect(isRefreshing.value).toBe(false);
  });
});
