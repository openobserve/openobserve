// Copyright 2026 OpenObserve Inc.
//
// Phase 2 (tmp/code.md B4) — the server function catalog must actually be FETCHED.
//
// setServerFunctions proves the merge; it does not prove anyone ever calls the
// service. Injecting the list by hand would let every test pass while editors
// stayed on the local catalog forever, which is the "helper tested, wiring
// untested" gap that has now been caught three times in this workstream.
//
// Kept in its OWN file: it imports @/services/query_functions, and while that
// module is unwritten a static import blocks the whole suite it lives in. The
// main useSuggestions spec must keep running so Phase 1 regressions stay visible.

import { describe, it, expect, vi, beforeEach } from "vitest";

// A SINGLE store object, not a fresh one per useStore() call: the composable
// captures the instance it is handed, so a test that mutates the store has to
// be mutating the same one.
const mockStore = vi.hoisted(() => ({
  state: {
    zoConfig: { timestamp_column: "_timestamp" },
    selectedOrganization: { identifier: "storeorg" } as { identifier: string } | undefined,
  },
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return { ...actual, useStore: vi.fn(() => mockStore) };
});

vi.mock("@/composables/useFieldValueStore", () => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
}));

// Defaults to an empty list so no test is perturbed by leftover state.
vi.mock("@/services/query_functions", () => ({
  default: { list: vi.fn().mockResolvedValue({ data: { list: [] } }) },
}));

import queryFunctions from "@/services/query_functions";
import useSqlSuggestions from "./useSuggestions";

const makeComposable = () => {
  const c = useSqlSuggestions();
  c.autoCompleteData.value.org = "myorg";
  c.autoCompleteData.value.streamType = "logs";
  c.autoCompleteData.value.streamName = "http_logs";
  c.autoCompleteData.value.fieldValues = {};
  c.autoCompleteData.value.popup.open = vi.fn();
  return c;
};

const run = async (c: ReturnType<typeof useSqlSuggestions>, query: string) => {
  c.autoCompleteData.value.query = query;
  (c.autoCompleteData.value as any).cursorIndex = query.length;
  await c.getSuggestions();
  return c.effectiveKeywords.value;
};

// ─── Phase 2 (tmp/code.md B4) — the fetch itself must be wired ────────────────
// setServerFunctions proves the merge; it does NOT prove anyone ever calls the
// service. Injecting the list by hand would let every test pass while editors
// stayed on the local catalog forever. The fetch therefore lives INSIDE the
// composable that every surface already uses, so no component can forget it.

describe("Phase 2 — the server catalog is actually fetched (B4 wiring)", () => {
  const SERVER_LIST = [
    { name: "date_trunc", signature: "(precision, timestamp)", doc: "Truncate.", kind: "scalar" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryFunctions.list).mockResolvedValue({ data: { list: [] } } as any);
  });

  it("calls the service for the active organisation while producing suggestions", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    expect(queryFunctions.list).toHaveBeenCalledWith("myorg");
  });

  it("delivers the FETCHED functions into effectiveSuggestions", async () => {
    vi.mocked(queryFunctions.list).mockResolvedValue({ data: { list: SERVER_LIST } } as any);
    const c = makeComposable({ storedValues: [] });
    // Single awaited pass: getSuggestions must await the fetch, not surface the
    // server functions only on the NEXT keystroke.
    await run(c, "SELECT * FROM stream WHERE ");
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("date_trunc");
  });

  it("does not refetch for the same organisation", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    await run(c, "SELECT * FROM stream WHERE a");
    await run(c, "SELECT * FROM stream WHERE ab");
    expect(vi.mocked(queryFunctions.list).mock.calls.length).toBe(1);
  });

  it("refetches when the organisation changes", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    c.autoCompleteData.value.org = "otherorg";
    await run(c, "SELECT * FROM stream WHERE ");
    expect(queryFunctions.list).toHaveBeenCalledWith("otherorg");
  });

  it("DROPS the previous organisation's functions when the org changes", async () => {
    // A second request is not enough: if the old org's entries survive the
    // switch, one tenant sees another tenant's VRL function names.
    vi.mocked(queryFunctions.list).mockImplementation((org: string) =>
      Promise.resolve({
        data: {
          list:
            org === "myorg"
              ? [{ name: "myorg_only_fn", signature: "(a)", doc: "A.", kind: "vrl" }]
              : [{ name: "otherorg_only_fn", signature: "(a)", doc: "B.", kind: "vrl" }],
        },
      } as any),
    );

    const c = makeComposable({ storedValues: [] });
    // ONE awaited pass must be enough. Needing a second would mean the previous
    // org's functions are still on screen for the first popup after switching.
    await run(c, "SELECT * FROM stream WHERE ");
    let names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("myorg_only_fn");

    c.autoCompleteData.value.org = "otherorg";
    await run(c, "SELECT * FROM stream WHERE ");
    names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("otherorg_only_fn");
    expect(names, "stale org functions survived the switch").not.toContain("myorg_only_fn");
    // Local catalog is org-independent and must survive.
    expect(names).toContain("match_all");
  });

  it("does not call the service before an organisation is known", async () => {
    // The composable now falls back to the store's org, so "unknown" means
    // absent from BOTH sources — the state during early boot.
    const saved = mockStore.state.selectedOrganization;
    mockStore.state.selectedOrganization = undefined;

    const c = makeComposable({ storedValues: [] });
    c.autoCompleteData.value.org = "";
    await run(c, "SELECT * FROM stream WHERE ");

    mockStore.state.selectedOrganization = saved;
    expect(queryFunctions.list).not.toHaveBeenCalled();
  });

  it("still serves the local catalog when the fetch rejects", async () => {
    vi.mocked(queryFunctions.list).mockRejectedValue(new Error("500"));
    const c = makeComposable({ storedValues: [] });
    await expect(run(c, "SELECT * FROM stream WHERE ")).resolves.toBeDefined();
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("match_all");
  });

  it("tolerates a malformed payload without dropping the local catalog", async () => {
    vi.mocked(queryFunctions.list).mockResolvedValue({ data: {} } as any);
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("match_all");
  });
});

// ─── Surfaces that never call getSuggestions ─────────────────────────────────
// The SLO form (AddSlo.vue) wires the editor with updateFieldKeywords ONLY: it
// never calls getSuggestions. Hanging the catalog fetch off getSuggestions
// therefore left that page with the ~26 local functions and none of the ~330
// from the registry — reported as "many functions are not available in
// typeahead". It does now set autoCompleteData.org (for the field-value
// resolver's lookup key), but only once a stream is chosen — so the fallback
// to the store's org still carries the fetch for every surface, including this
// one before a stream is picked.

describe("Phase 2 — the catalog loads for surfaces that only set up fields", () => {
  const SERVER_LIST = [
    { name: "date_trunc", signature: "(precision, timestamp)", doc: "Truncate.", kind: "scalar" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryFunctions.list).mockResolvedValue({ data: { list: [] } } as any);
  });

  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };

  it("fetches using the store's org when no caller supplied one", async () => {
    vi.mocked(queryFunctions.list).mockResolvedValue({ data: { list: SERVER_LIST } } as any);
    const c = useSqlSuggestions();
    // Exactly what AddSlo does — no org, no getSuggestions.
    c.updateFieldKeywords([{ name: "code", type: "Int64" }]);
    await settle();
    expect(queryFunctions.list).toHaveBeenCalledWith("storeorg");
  });

  it("delivers the fetched functions to a surface that never calls getSuggestions", async () => {
    vi.mocked(queryFunctions.list).mockResolvedValue({ data: { list: SERVER_LIST } } as any);
    const c = useSqlSuggestions();
    c.updateFieldKeywords([{ name: "code", type: "Int64" }]);
    await settle();
    const names = (c.autoCompleteSuggestions.value as any[]).map((f) => f.name);
    expect(names).toContain("date_trunc");
    expect(names).toContain("match_all"); // local catalog still there
  });

  it("prefers an explicitly supplied org over the store", async () => {
    const c = useSqlSuggestions();
    c.autoCompleteData.value.org = "explicitorg";
    c.updateFieldKeywords([{ name: "code" }]);
    await settle();
    expect(queryFunctions.list).toHaveBeenCalledWith("explicitorg");
  });

  it("does not refetch on every keyword rebuild", async () => {
    const c = useSqlSuggestions();
    c.updateFieldKeywords([{ name: "a" }]);
    await settle();
    c.updateFieldKeywords([{ name: "b" }]);
    c.updateFieldKeywords([{ name: "c" }]);
    await settle();
    expect(vi.mocked(queryFunctions.list).mock.calls.length).toBe(1);
  });
});
