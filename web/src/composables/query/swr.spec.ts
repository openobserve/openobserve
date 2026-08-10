import { describe, it, expect } from "vitest";
import { defineQuery } from "@/composables/query/queryClient";

describe("swr", () => {
  it("hands back the stale value before the refetch resolves", async () => {
    let call = 0;
    const q = defineQuery<[], string[]>({
      key: ["swr-probe"],
      fetch: async () => {
        call++;
        if (call === 1) return ["old"];
        await new Promise((r) => setTimeout(r, 40));
        return ["old", "new"];
      },
      tier: "VOLATILE",
    });

    await q.get("acme");

    const { cached, fresh } = q.swr("acme");
    expect(cached).toEqual(["old"]); // painted immediately, no await
    expect(await fresh).toEqual(["old", "new"]); // swapped in when it lands
    expect(call).toBe(2);
  });

  it("costs no request while the entry is fresh", async () => {
    let call = 0;
    const q = defineQuery<[], number>({
      key: ["swr-fresh"],
      fetch: async () => ++call,
      tier: "ORG_CONFIG", // 5 min
    });

    await q.get("acme");
    const { cached, fresh } = q.swr("acme");
    expect(cached).toBe(1);
    expect(await fresh).toBe(1);
    expect(call).toBe(1);
  });

  it("reports no cached value on a cold entry", () => {
    const q = defineQuery<[], string>({
      key: ["swr-cold"],
      fetch: async () => "x",
      tier: "ENTITY_LIST",
    });
    expect(q.swr("acme").cached).toBeUndefined();
  });
});
