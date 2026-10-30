// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import analytics from "@/services/product_analytics";
import {
  SUGGEST_SUMMARY_EVENT,
  createSuggestTracker,
  flushEditorSuggestSummary,
} from "./editorSuggestStats";

const sent = () => vi.mocked(analytics.track).mock.calls.map((c) => c[1] as any);
const summary = () => {
  flushEditorSuggestSummary();
  return sent().at(-1);
};
const key = (k: string, ctrlOrMeta = false) => ({ key: k, ctrlOrMeta });
const chainedMenu = { triggerKind: 1, chained: true, lanes: ["operator" as const], rows: 9 };

describe("editor suggest summary — one event per query run, counts only", () => {
  let tracker: ReturnType<typeof createSuggestTracker>;

  beforeEach(() => {
    flushEditorSuggestSummary();
    vi.mocked(analytics.track).mockClear();
    tracker = createSuggestTracker(
      "logs",
      () => "sql",
      () => "automatic",
    );
  });
  afterEach(() => vi.useRealTimers());

  it("sends nothing when no menu was offered", () => {
    flushEditorSuggestSummary();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("sends one event, then starts again", () => {
    tracker.offered(chainedMenu);
    flushEditorSuggestSummary();
    flushEditorSuggestSummary();
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(vi.mocked(analytics.track).mock.calls[0][0]).toBe(SUGGEST_SUMMARY_EVENT);
  });

  it("counts a chained menu and its lane", () => {
    tracker.offered(chainedMenu);
    expect(summary()).toMatchObject({
      surface: "logs",
      language: "sql",
      mode: "automatic",
      chain_shown: 1,
      lane_offered_operator: 1,
    });
  });

  it("does not count a re-filter of the same menu as shown again", () => {
    tracker.offered(chainedMenu);
    tracker.offered({ ...chainedMenu, triggerKind: 2, chained: false });
    expect(summary().chain_shown).toBe(1);
  });

  it("counts Esc on a chained menu as dismissed", () => {
    tracker.offered(chainedMenu);
    tracker.keyDown(key("Escape"));
    tracker.keyDown(key("Escape"));
    expect(summary().chain_dismissed_esc).toBe(1);
  });

  it("counts a printable key typed into a chained menu as typed through", () => {
    tracker.offered(chainedMenu);
    tracker.keyDown(key("="));
    expect(summary().chain_typed_through).toBe(1);
  });

  it("counts an Enter that left an open menu unaccepted", () => {
    vi.useFakeTimers();
    tracker.offered({ triggerKind: 1, chained: false, lanes: ["field"], rows: 4 });
    tracker.keyDown(key("Enter"));
    vi.runAllTimers();
    expect(summary()).toMatchObject({ enter_with_menu_open: 1, auto_shown: 1 });
  });

  it("does not count an Enter that accepted the row", () => {
    vi.useFakeTimers();
    tracker.offered({ triggerKind: 0, chained: false, lanes: ["field"], rows: 4 });
    tracker.keyDown(key("Enter"));
    tracker.accepted("field");
    vi.runAllTimers();
    expect(summary()).toMatchObject({ enter_with_menu_open: 0, auto_accepted: 1 });
  });

  it("keeps SQL and PromQL apart on one surface", () => {
    const promql = createSuggestTracker(
      "logs",
      () => "promql",
      () => "automatic",
    );
    tracker.offered(chainedMenu);
    promql.offered({ triggerKind: 1, chained: false, lanes: ["value"], rows: 2 });
    flushEditorSuggestSummary();
    expect(
      sent()
        .map((p) => p.language)
        .sort(),
    ).toEqual(["promql", "sql"]);
  });

  it("splits chained accepts by Tab, Enter and click", () => {
    tracker.offered(chainedMenu);
    tracker.keyDown(key("Tab"));
    tracker.accepted("operator");
    tracker.offered(chainedMenu);
    tracker.keyDown(key("Enter"));
    tracker.accepted("operator");
    tracker.offered(chainedMenu);
    tracker.keyDown(key("e"));
    tracker.offered(chainedMenu);
    tracker.accepted("operator");
    expect(summary()).toMatchObject({
      chain_shown: 4,
      chain_accepted_tab: 1,
      chain_accepted_enter: 1,
      chain_accepted_click: 1,
      lane_accepted_operator: 3,
    });
  });

  it("tells a Ctrl+Space menu from a quick suggestion", () => {
    tracker.keyDown(key(" ", true));
    tracker.offered({ triggerKind: 0, chained: false, lanes: ["field"], rows: 3 });
    tracker.accepted("field");
    tracker.keyDown(key("l"));
    tracker.offered({ triggerKind: 0, chained: false, lanes: ["field"], rows: 3 });
    tracker.accepted("field");
    expect(summary()).toMatchObject({
      invoke_shown: 1,
      invoke_accepted: 1,
      auto_shown: 1,
      auto_accepted: 1,
    });
  });

  it("counts an Enter accept undone within two seconds", () => {
    vi.useFakeTimers();
    tracker.offered({ triggerKind: 0, chained: false, lanes: ["field"], rows: 3 });
    tracker.keyDown(key("Enter"));
    tracker.accepted("field");
    vi.advanceTimersByTime(1500);
    tracker.keyDown(key("z", true));
    tracker.offered({ triggerKind: 0, chained: false, lanes: ["field"], rows: 3 });
    tracker.keyDown(key("Enter"));
    tracker.accepted("field");
    vi.advanceTimersByTime(2500);
    tracker.keyDown(key("Backspace"));
    expect(summary().enter_accept_undone).toBe(1);
  });

  it("reports the median value fetch and the budget hits", () => {
    tracker.valueFetched(40);
    tracker.valueFetched(900);
    tracker.valueFetched(120);
    tracker.budgetHit();
    expect(summary()).toMatchObject({ value_fetch_ms_p50: 120, value_budget_hits: 1 });
  });

  it("carries numbers, the surface, the language and the mode, and nothing else", () => {
    tracker.offered(chainedMenu);
    const props = summary();
    for (const [name, value] of Object.entries(props)) {
      if (name === "surface" || name === "mode" || name === "language") continue;
      expect(value === null || typeof value === "number", name).toBe(true);
    }
  });

  it("keeps one summary per surface", () => {
    const other = createSuggestTracker(
      "addAlert",
      () => "sql",
      () => "automatic",
    );
    tracker.offered(chainedMenu);
    other.offered(chainedMenu);
    flushEditorSuggestSummary("addAlert");
    expect(sent().map((p) => p.surface)).toEqual(["addAlert"]);
    flushEditorSuggestSummary();
    expect(sent().map((p) => p.surface)).toEqual(["addAlert", "logs"]);
  });
});
