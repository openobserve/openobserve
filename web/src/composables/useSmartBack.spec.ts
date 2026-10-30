// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRouterBack = vi.fn();
const mockRouterPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mockRouterBack, push: mockRouterPush }),
}));

import useSmartBack from "./useSmartBack";

describe("useSmartBack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No back-navigable history by default — tests that need the router.back()
    // path opt in with history.pushState below.
    window.history.replaceState(null, "");
  });

  it("uses real browser back when there's history to pop", () => {
    window.history.pushState({ back: "/previous" }, "", "/previous-fake-url");
    const { goBack } = useSmartBack(() => ({ name: "fallback-route" }));

    goBack();

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("falls back to the given route when there's no history to pop", () => {
    const { goBack } = useSmartBack(() => ({ name: "fallback-route", query: { a: "1" } }));

    goBack();

    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith({ name: "fallback-route", query: { a: "1" } });
  });

  it("evaluates the fallback lazily — only when it's actually needed", () => {
    window.history.pushState({ back: "/previous" }, "", "/previous-fake-url");
    const fallback = vi.fn(() => ({ name: "fallback-route" }));
    const { goBack } = useSmartBack(fallback);

    goBack();

    expect(fallback).not.toHaveBeenCalled();
  });
});
