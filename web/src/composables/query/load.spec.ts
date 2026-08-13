import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { defineQuery } from "@/composables/query/queryClient";
import { CONFIG_STALE_TIME } from "@/composables/query/cachePolicy";

describe("load", () => {
  it("applies the cached value before the refetch resolves", async () => {
    let call = 0;
    const q = defineQuery<[], string[]>({
      key: ["load-probe"],
      fetch: async () => {
        call++;
        if (call === 1) return ["old"];
        await new Promise((r) => setTimeout(r, 40));
        return ["old", "new"];
      },
      staleTime: 0,
    });

    await q.get("acme");

    const painted: string[][] = [];
    const loading = ref(false);
    const done = q.load({ org: "acme", apply: (d) => painted.push(d), loading });

    // The cached value is applied synchronously, so nothing is "loading".
    expect(painted).toEqual([["old"]]);
    expect(loading.value).toBe(false);

    await done;
    expect(painted).toEqual([["old"], ["old", "new"]]);
    expect(call).toBe(2);
  });

  it("flags loading only when there is nothing to show", async () => {
    const q = defineQuery<[], number>({
      key: ["load-cold"],
      fetch: async () => 1,
      staleTime: 0,
    });
    const loading = ref(false);
    const done = q.load({ org: "acme", apply: () => {}, loading });
    expect(loading.value).toBe(true);
    await done;
    expect(loading.value).toBe(false);
  });

  it("costs no request while the entry is fresh", async () => {
    let call = 0;
    const q = defineQuery<[], number>({
      key: ["load-fresh"],
      fetch: async () => ++call,
      staleTime: CONFIG_STALE_TIME,
    });
    await q.get("acme");
    await q.load({ org: "acme", apply: () => {} });
    expect(call).toBe(1);
  });

  it("force bypasses the cached value and refetches", async () => {
    let call = 0;
    const q = defineQuery<[], number>({
      key: ["load-force"],
      fetch: async () => ++call,
      staleTime: CONFIG_STALE_TIME,
    });
    await q.get("acme");
    await q.load({ org: "acme", apply: () => {}, force: true });
    expect(call).toBe(2);
  });

  it("keeps the rows and spins the button when a refresh has cached data", async () => {
    let release: (v: string[]) => void = () => {};
    let call = 0;
    const q = defineQuery<[], string[]>({
      key: ["load-refresh-flags"],
      fetch: async () => {
        call++;
        if (call === 1) return ["old"];
        return new Promise<string[]>((r) => (release = r));
      },
      staleTime: CONFIG_STALE_TIME,
    });
    await q.get("acme");

    const painted: string[][] = [];
    const loading = ref(false);
    const fetching = ref(false);
    const done = q.load({
      org: "acme",
      apply: (d) => painted.push(d),
      loading,
      fetching,
      force: true,
    });

    // Mid-flight: the cached rows are on screen, the button spins, and the
    // skeleton stays away — this is the whole point of the refresh path.
    expect(painted).toEqual([["old"]]);
    expect(loading.value).toBe(false);
    expect(fetching.value).toBe(true);

    release(["new"]);
    await done;

    expect(painted).toEqual([["old"], ["new"]]);
    expect(fetching.value).toBe(false);
    expect(loading.value).toBe(false);
  });

  it("clears fetching and keeps the cached rows when the refetch fails", async () => {
    let call = 0;
    const q = defineQuery<[], string[]>({
      key: ["load-refresh-error"],
      fetch: async () => {
        call++;
        if (call === 1) return ["old"];
        throw new Error("boom");
      },
      staleTime: CONFIG_STALE_TIME,
      // The client retries non-4xx twice by default; one attempt is enough here.
      gcTime: 60_000,
    });
    await q.get("acme");

    const painted: string[][] = [];
    const loading = ref(false);
    const fetching = ref(false);

    await expect(
      q.load({ org: "acme", apply: (d) => painted.push(d), loading, fetching, force: true }),
    ).rejects.toThrow("boom");

    // The rows the user was reading are still the ones that were applied.
    expect(painted).toEqual([["old"]]);
    expect(fetching.value).toBe(false);
    expect(loading.value).toBe(false);
  });

  it("applies the cached value synchronously, before load() is awaited", async () => {
    // Call sites rely on this: a warm cache paints during the caller's own tick,
    // so a loader invoked from a setup() body reaches whatever `apply` touches.
    const q = defineQuery<[], string[]>({
      key: ["load-sync-apply"],
      fetch: async () => ["cached"],
      staleTime: CONFIG_STALE_TIME,
    });
    await q.get("acme");

    let appliedDuringCall = false;
    const p = q.load({ org: "acme", apply: () => (appliedDuringCall = true) });
    expect(appliedDuringCall).toBe(true);
    await p;
  });

  it("peek reports the cached value without fetching", async () => {
    let call = 0;
    const q = defineQuery<[], string>({
      key: ["peek-probe"],
      fetch: async () => {
        call++;
        return "x";
      },
    });
    expect(q.peek("acme")).toBeUndefined();
    expect(call).toBe(0);
    await q.get("acme");
    expect(q.peek("acme")).toBe("x");
    expect(call).toBe(1);
  });
});
