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
