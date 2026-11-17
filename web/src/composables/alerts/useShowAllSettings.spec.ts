// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { useShowAllSettings } from "./useShowAllSettings";

const memoryStorage = () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
};
const A = () => ({ user: "a@x.io", org: "o1" });

afterEach(() => vi.unstubAllGlobals());

describe("useShowAllSettings", () => {
  it("is off by default and remembered for the same user and org only", () => {
    memoryStorage();
    expect(useShowAllSettings(A).showAll.value).toBe(false);
    useShowAllSettings(A).setShowAll(true);
    expect(useShowAllSettings(A).showAll.value).toBe(true);
    expect(useShowAllSettings(() => ({ user: "b@x.io", org: "o1" })).showAll.value).toBe(false);
  });

  it("reads off and still toggles when storage throws (Review Focus 3)", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    const s = useShowAllSettings(A);
    expect(s.showAll.value).toBe(false);
    expect(() => s.setShowAll(true)).not.toThrow();
    expect(s.showAll.value).toBe(true);
  });
});
