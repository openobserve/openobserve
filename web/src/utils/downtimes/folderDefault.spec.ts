// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  preferredDowntimeFolder,
  readLastDowntimeFolder,
  rememberDowntimeFolder,
} from "./folderDefault";

describe("preferredDowntimeFolder", () => {
  it("keeps the last used folder while the user may still use it", () => {
    expect(preferredDowntimeFolder(["default", "payments"], "payments")).toBe("payments");
    expect(preferredDowntimeFolder(["default", "ops"], "payments")).toBe("default");
  });

  it("falls back to default, then to the first permitted folder", () => {
    expect(preferredDowntimeFolder(["default", "ops"], null)).toBe("default");
    expect(preferredDowntimeFolder(["payments", "ops"], null)).toBe("payments");
    expect(preferredDowntimeFolder([], null)).toBe("default");
  });

  it("uses the last folder, else default, before the list has answered", () => {
    expect(preferredDowntimeFolder(undefined, "payments")).toBe("payments");
    expect(preferredDowntimeFolder(undefined, null)).toBe("default");
  });
});

describe("the last used folder", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is remembered per org", () => {
    rememberDowntimeFolder("acme", "payments");
    expect(readLastDowntimeFolder("acme")).toBe("payments");
    expect(readLastDowntimeFolder("other")).toBeNull();
  });
});
