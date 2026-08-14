// Tests for the URL ↔ view-state machine extracted from OnlineEvals.vue.
// Each test pins one branch of the state machine and would fail loudly if the
// drawer / dialog / form-page selection logic regresses.

import { describe, it, expect } from "vitest";
import {
  buildCrossNavigationQuery,
  computeViewState,
  findRowById,
  parseTabFromRoute,
  rowIdOf,
  VALID_TABS,
  type RowsByTab,
} from "./routeSync";

const SC1 = { id: "sc1", entityId: "sc1-entity", name: "Faithfulness" } as any;
const SC2 = { id: "sc2", entityId: "sc2-entity", name: "Relevance" } as any;
const S1 = { id: "s1", entityId: "s1-entity", name: "Judge" } as any;
const S2 = { id: "s2", entityId: "s2-entity", name: "Remote" } as any;
const J1 = { id: "j1", name: "Job One" } as any;
const J2 = { id: "j2", name: "Job Two" } as any;

const ROWS: RowsByTab = {
  scoreConfigs: [SC1, SC2],
  scorers: [S1, S2],
  jobs: [J1, J2],
};

describe("parseTabFromRoute", () => {
  it.each(VALID_TABS)("accepts the valid tab %s", (tab) => {
    expect(parseTabFromRoute(tab)).toBe(tab);
  });

  it("defaults to 'quality' on undefined", () => {
    expect(parseTabFromRoute(undefined)).toBe("quality");
  });

  it("defaults to 'quality' on unknown string", () => {
    expect(parseTabFromRoute("bogus")).toBe("quality");
  });

  it("defaults to 'quality' on non-string types", () => {
    expect(parseTabFromRoute(null)).toBe("quality");
    expect(parseTabFromRoute(42)).toBe("quality");
    expect(parseTabFromRoute(["jobs"])).toBe("quality");
    expect(parseTabFromRoute({ tab: "jobs" })).toBe("quality");
  });
});

describe("rowIdOf", () => {
  it("returns String(row.id) for jobs", () => {
    expect(rowIdOf(J1, "jobs")).toBe("j1");
  });

  it("returns the entityId for scorers", () => {
    expect(rowIdOf(S1, "scorers")).toBe("s1-entity");
  });

  it("returns the entityId for scoreConfigs", () => {
    expect(rowIdOf(SC1, "scoreConfigs")).toBe("sc1-entity");
  });

  it("falls back to row.id when entityId is absent", () => {
    expect(rowIdOf({ id: "bare", name: "x" } as any, "scorers")).toBe("bare");
  });
});

describe("findRowById", () => {
  it("returns null for quality", () => {
    expect(findRowById("quality", "anything", ROWS)).toBeNull();
  });

  it("finds a job by numeric/string id", () => {
    expect(findRowById("jobs", "j2", ROWS)).toBe(J2);
  });

  it("finds a scorer by entityId", () => {
    expect(findRowById("scorers", "s2-entity", ROWS)).toBe(S2);
  });

  it("finds a scoreConfig by entityId", () => {
    expect(findRowById("scoreConfigs", "sc1-entity", ROWS)).toBe(SC1);
  });

  it("returns null when id does not match anything", () => {
    expect(findRowById("jobs", "missing", ROWS)).toBeNull();
    expect(findRowById("scorers", "missing", ROWS)).toBeNull();
  });

  it("returns null when the tab is empty", () => {
    const empty: RowsByTab = { jobs: [], scorers: [], scoreConfigs: [] };
    expect(findRowById("jobs", "j1", empty)).toBeNull();
  });
});

describe("computeViewState — no action", () => {
  it("returns 'none' when there is no action param", () => {
    expect(computeViewState({ tab: "jobs" }, ROWS)).toEqual({ kind: "none" });
  });

  it("returns 'none' for an unknown action", () => {
    expect(computeViewState({ tab: "jobs", action: "explode" }, ROWS)).toEqual({
      kind: "none",
    });
  });
});

describe("computeViewState — view action", () => {
  it("opens the scoreConfig detail drawer", () => {
    expect(
      computeViewState({ tab: "scoreConfigs", action: "view", id: "sc1-entity" }, ROWS),
    ).toEqual({ kind: "viewScoreConfig", row: SC1 });
  });

  it("opens the scorer detail drawer", () => {
    expect(computeViewState({ tab: "scorers", action: "view", id: "s2-entity" }, ROWS)).toEqual({
      kind: "viewScorer",
      row: S2,
    });
  });

  it("opens the job detail drawer", () => {
    expect(computeViewState({ tab: "jobs", action: "view", id: "j2" }, ROWS)).toEqual({
      kind: "viewJob",
      row: J2,
    });
  });

  it("returns 'none' when the row is not found", () => {
    expect(computeViewState({ tab: "jobs", action: "view", id: "missing" }, ROWS)).toEqual({
      kind: "none",
    });
  });

  it("returns 'none' when the active tab is 'quality'", () => {
    expect(computeViewState({ tab: "quality", action: "view", id: "anything" }, ROWS)).toEqual({
      kind: "none",
    });
  });

  it("returns 'none' when action is 'view' but id is missing", () => {
    expect(computeViewState({ tab: "jobs", action: "view" }, ROWS)).toEqual({
      kind: "none",
    });
  });
});

describe("computeViewState — scoreConfigs add/edit", () => {
  it("returns 'scoreConfigCreate' for add", () => {
    expect(computeViewState({ tab: "scoreConfigs", action: "add" }, ROWS)).toEqual({
      kind: "scoreConfigCreate",
    });
  });

  it("returns 'scoreConfigEdit' when id resolves", () => {
    expect(
      computeViewState({ tab: "scoreConfigs", action: "update", id: "sc2-entity" }, ROWS),
    ).toEqual({ kind: "scoreConfigEdit", row: SC2 });
  });

  it("returns 'none' when scoreConfig id does not match", () => {
    expect(
      computeViewState({ tab: "scoreConfigs", action: "update", id: "missing" }, ROWS),
    ).toEqual({ kind: "none" });
  });
});

describe("computeViewState — scorers add flow", () => {
  it("shows the type-picker dialog when scorer_type is missing", () => {
    expect(computeViewState({ tab: "scorers", action: "add" }, ROWS)).toEqual({
      kind: "scorerTypeDialog",
    });
  });

  it("jumps to the form page when scorer_type is supplied", () => {
    expect(
      computeViewState({ tab: "scorers", action: "add", scorer_type: "llm_judge" }, ROWS),
    ).toEqual({ kind: "scorerFormCreate", scorerType: "llm_judge" });
  });

  it("preserves the scorer_type value verbatim", () => {
    expect(
      computeViewState({ tab: "scorers", action: "add", scorer_type: "remote" }, ROWS),
    ).toEqual({ kind: "scorerFormCreate", scorerType: "remote" });
  });
});

describe("computeViewState — scorer/job edit", () => {
  it("opens the scorer form in edit mode", () => {
    expect(computeViewState({ tab: "scorers", action: "update", id: "s1-entity" }, ROWS)).toEqual({
      kind: "scorerFormEdit",
      row: S1,
    });
  });

  it("opens the job form in edit mode", () => {
    expect(computeViewState({ tab: "jobs", action: "update", id: "j1" }, ROWS)).toEqual({
      kind: "jobFormEdit",
      row: J1,
    });
  });

  it("returns 'none' on edit when id does not resolve", () => {
    expect(computeViewState({ tab: "jobs", action: "update", id: "missing" }, ROWS)).toEqual({
      kind: "none",
    });
  });
});

describe("computeViewState — jobs add", () => {
  it("opens the job form in create mode", () => {
    expect(computeViewState({ tab: "jobs", action: "add" }, ROWS)).toEqual({
      kind: "jobFormCreate",
    });
  });
});

describe("buildCrossNavigationQuery", () => {
  it("sets tab + action=view + id while preserving other query params", () => {
    const current = { foo: "bar", org_identifier: "acme", tab: "scorers" };
    expect(buildCrossNavigationQuery(current, "jobs", "j1")).toEqual({
      foo: "bar",
      org_identifier: "acme",
      tab: "jobs",
      action: "view",
      id: "j1",
    });
  });

  it("overrides existing action and id", () => {
    const current = { action: "add", id: "old" };
    expect(buildCrossNavigationQuery(current, "scorers", "s1")).toEqual({
      action: "view",
      id: "s1",
      tab: "scorers",
    });
  });

  it("does not mutate the input query object", () => {
    const current = { foo: "bar" };
    buildCrossNavigationQuery(current, "jobs", "j1");
    expect(current).toEqual({ foo: "bar" });
  });
});
