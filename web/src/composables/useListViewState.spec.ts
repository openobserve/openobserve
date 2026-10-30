import { beforeEach, describe, expect, it } from "vitest";
import store from "@/stores";
import { resetListViewState, useListViewState } from "./useListViewState";

describe("useListViewState", () => {
  beforeEach(() => {
    resetListViewState();
    store.state.selectedOrganization = { identifier: "org1" } as any;
  });

  it("returns the defaults the first time", () => {
    const state = useListViewState("alerts", { searchQuery: "", pageSize: 20 });
    expect(state).toEqual({ searchQuery: "", pageSize: 20 });
  });

  it("hands back the same state after the component is gone", () => {
    useListViewState("alerts", { searchQuery: "" }).searchQuery = "cpu";
    expect(useListViewState("alerts", { searchQuery: "" }).searchQuery).toBe("cpu");
  });

  it("shares one object between callers of the same list", () => {
    const first = useListViewState("alerts", { searchQuery: "" });
    const second = useListViewState("alerts", { searchQuery: "", sortBy: "" });
    expect(second).toBe(first);
    expect(first.sortBy).toBe("");
  });

  it("fills in fields added after the state was first stored", () => {
    useListViewState("alerts", { searchQuery: "cpu" });
    expect(useListViewState("alerts", { searchQuery: "", sortBy: "" })).toEqual({
      searchQuery: "cpu",
      sortBy: "",
    });
  });

  it("keeps lists and organizations apart", () => {
    useListViewState("alerts", { searchQuery: "" }).searchQuery = "cpu";
    expect(useListViewState("reports", { searchQuery: "" }).searchQuery).toBe("");
    store.state.selectedOrganization = { identifier: "org2" } as any;
    expect(useListViewState("alerts", { searchQuery: "" }).searchQuery).toBe("");
  });

  it("resets one list or all of them", () => {
    useListViewState("alerts", { q: "" }).q = "a";
    useListViewState("reports", { q: "" }).q = "b";
    resetListViewState("alerts");
    expect(useListViewState("alerts", { q: "" }).q).toBe("");
    expect(useListViewState("reports", { q: "" }).q).toBe("b");
    resetListViewState();
    expect(useListViewState("reports", { q: "" }).q).toBe("");
  });
});
