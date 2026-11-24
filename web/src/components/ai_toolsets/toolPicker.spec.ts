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

import { describe, expect, it } from "vitest";
import {
  globPrefix,
  globMatches,
  mayWrite,
  otherEntries,
  prefillFromDiscovery,
  expandGlobs,
  setToolOn,
  setToolState,
  toolState,
  toolsetBadges,
  failingSince,
  type DiscoveredTool,
  type ToolLists,
} from "./toolPicker";

const search: DiscoveredTool = { name: "search_logs", read_only_hint: true };
const create: DiscoveredTool = { name: "create_monitor" };
const wipe: DiscoveredTool = { name: "wipe_index", read_only_hint: true, destructive_hint: true };
const tools = [search, create, wipe];

const lists = (over: Partial<ToolLists> = {}): ToolLists => ({
  allowed: [],
  blocked: null,
  write: [],
  ...over,
});

describe("toolPicker", () => {
  it("tags a tool that doesn't promise to be read-only, or says it's destructive", () => {
    expect([search, create, wipe].map(mayWrite)).toEqual([false, true, true]);
  });

  it("matches globs like the gateway: * is any run, the rest literal, whole name", () => {
    expect(globMatches("*", "anything")).toBe(true);
    expect(globMatches("search_*", "search_logs")).toBe(true);
    expect(globMatches("search_*", "my_search_logs")).toBe(false);
    expect(globMatches("*_logs", "search_logs")).toBe(true);
    expect(globMatches("s*_*s", "search_logs")).toBe(true);
    expect(globMatches("a*a", "a")).toBe(false);
    expect(globMatches("search.logs", "searchXlogs")).toBe(false);
    expect(globMatches("Search_logs", "search_logs")).toBe(false);
  });

  it("maps the three states to the lists and back", () => {
    let l = lists();
    expect(toolState(l, search)).toBe("off");

    l = setToolState(l, "search_logs", "allowed");
    expect(l).toEqual({ allowed: ["search_logs"], blocked: null, write: [] });
    expect(toolState(l, search)).toBe("allowed");

    l = setToolState(l, "search_logs", "write");
    expect(l).toEqual({ allowed: ["search_logs"], blocked: null, write: ["search_logs"] });
    expect(toolState(l, search)).toBe("write");

    l = setToolState(l, "search_logs", "off");
    expect(l).toEqual({ allowed: [], blocked: null, write: [] });
    expect(toolState(l, search)).toBe("off");
  });

  it("lets a blocked entry win, and setting a state lifts an exact block", () => {
    const l = lists({ allowed: ["*"], blocked: ["create_monitor"], write: null });
    expect(toolState(l, create)).toBe("off");
    expect(toolState(l, search)).toBe("allowed");
    // Without write_tools the gateway goes by readOnlyHint alone, as wipe_index declares it.
    expect(toolState(l, wipe)).toBe("allowed");
    expect(toolState(l, { name: "x" })).toBe("write");
    const next = setToolState(l, "create_monitor", "write");
    expect(next.blocked).toEqual([]);
    expect(toolState(next, create)).toBe("write");
  });

  it("prefills a row saved without allowed_tools as today's behaviour", () => {
    const l = prefillFromDiscovery({ allowed: null, blocked: null, write: null }, tools);
    expect(l).toEqual({
      allowed: ["search_logs", "create_monitor", "wipe_index"],
      blocked: null,
      write: ["create_monitor", "wipe_index"],
    });
    const kept = prefillFromDiscovery(lists({ allowed: ["search_logs"], write: [] }), tools);
    expect(kept).toEqual(lists({ allowed: ["search_logs"], write: [] }));
    // An allowlist without write_tools gets the writes the picker shows (the readOnlyHint rule).
    const implicit = lists({ allowed: ["create_monitor", "wipe_index"], write: null });
    expect(prefillFromDiscovery(implicit, tools)).toEqual({
      allowed: ["create_monitor", "wipe_index"],
      blocked: null,
      write: ["create_monitor"],
    });
  });

  it("lists allowed entries naming no listed tool, globs and dropped tools included", () => {
    const l = lists({ allowed: ["search_logs", "get_*", "gone_tool"], blocked: ["delete_*"] });
    expect(otherEntries(l, tools)).toEqual(["get_*", "gone_tool"]);
    expect(otherEntries(l, null)).toEqual(["search_logs", "get_*", "gone_tool"]);
  });

  it("turns a tool on without touching write, and off by dropping it from allowed and write", () => {
    const l = lists({ allowed: ["a"], blocked: ["b"], write: ["a"] });
    expect(setToolOn(l, "b", true)).toEqual({ allowed: ["a", "b"], blocked: [], write: ["a"] });
    expect(setToolOn(lists({ write: null }), "b", true).write).toBeNull();
    expect(setToolOn(l, "a", false)).toEqual({ allowed: [], blocked: ["b"], write: [] });
  });

  it("expands globs into the discovered names they match", () => {
    const l = lists({ allowed: ["gone", "search_*", "zzz_*"], write: null });
    expect(expandGlobs(l, tools).allowed).toEqual(["gone", "zzz_*", "search_logs"]);
    expect(expandGlobs(lists({ allowed: null }), tools).allowed).toEqual([
      "search_logs",
      "create_monitor",
      "wipe_index",
    ]);
    expect(expandGlobs(lists({ allowed: ["a"] }), tools).allowed).toEqual(["a"]);
  });

  it("derives each list badge from the saved data", () => {
    expect(toolsetBadges({ url: "u" })).toEqual(["allTools"]);
    expect(toolsetBadges({ allowed_tools: null })).toEqual(["allTools"]);
    expect(toolsetBadges({ allowed_tools: [], tools_verified_at: 1 })).toEqual(["noTools"]);
    expect(toolsetBadges({ allowed_tools: [] })).toEqual(["noTools", "notVerified"]);
    expect(toolsetBadges({ allowed_tools: ["a"] })).toEqual(["notVerified"]);
    expect(toolsetBadges({ allowed_tools: ["a"], tools_verified_at: 1 })).toEqual([]);
    expect(toolsetBadges(null)).toEqual([]);
  });

  it("shows Failing since only while the last 15 minutes held only failures", () => {
    const min = 60 * 1_000_000;
    const now = 100 * min;
    const failing = {
      failing_since: now - 30 * min,
      last_error_at: now - 5 * min,
      last_error: "401",
    };
    expect(failingSince(failing, now)).toEqual({ since: now - 30 * min, error: "401" });
    expect(failingSince({ ...failing, last_error_at: now - 16 * min }, now)).toBeNull();
    expect(failingSince({ ...failing, failing_since: null }, now)).toBeNull();
    expect(failingSince(null, now)).toBeNull();
  });
});

describe("globPrefix", () => {
  it("returns the literal start of a glob", () => {
    expect(globPrefix("apm_*")).toBe("apm_");
    expect(globPrefix("*_read")).toBeNull();
    expect(globPrefix("exact")).toBeNull();
  });
});
