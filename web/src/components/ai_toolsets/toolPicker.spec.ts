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
  addTypedTool,
  allowAll,
  allowReadOnly,
  globMatches,
  mayWrite,
  otherEntries,
  prefillFromDiscovery,
  removeEntry,
  setByGlob,
  setToolState,
  toolState,
  toolsetBadges,
  failingSince,
  typedToolError,
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

  it("matches names as the agent sees them, with other characters replaced by _", () => {
    expect(globMatches("update.*", "update_monitor")).toBe(true);
    expect(globMatches("update.monitor", "update_monitor")).toBe(true);
    expect(globMatches("get_*", "get.logs")).toBe(true);
    expect(globMatches("a?b", "a_b")).toBe(true);
    expect(globMatches("update-*", "update_monitor")).toBe(false);
    expect(globMatches("x__", "x😀")).toBe(true);
    const l = lists({ allowed: ["update.*"], write: ["update.*"] });
    expect(toolState(l, { name: "update_monitor" })).toBe("write");
    expect(toolState(lists({ allowed: ["*"], blocked: ["a.b"] }), { name: "a_b" })).toBe("off");
  });

  it("locks the control of a tool that another spelling decides, but not its own", () => {
    expect(setByGlob(lists({ allowed: ["update.monitor"] }), "update_monitor")).toBe(true);
    expect(setByGlob(lists({ allowed: ["update.monitor"] }), "update.monitor")).toBe(false);
  });

  it("matches globs like the agent: * is any run, the rest literal, whole name", () => {
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
    // Without write_tools the agent goes by readOnlyHint alone, as wipe_index declares it.
    expect(toolState(l, wipe)).toBe("allowed");
    expect(toolState(l, { name: "x" })).toBe("write");
    const next = setToolState(l, "create_monitor", "write");
    expect(next.blocked).toEqual([]);
    expect(toolState(next, create)).toBe("write");
  });

  it("locks the control of a tool a glob decides", () => {
    const l = lists({ allowed: ["search_*"] });
    expect(setByGlob(l, "search_logs")).toBe(true);
    expect(setByGlob(l, "create_monitor")).toBe(false);
  });

  it("prefills a row saved without allowed_tools as today's behaviour", () => {
    const l = prefillFromDiscovery({ allowed: null, blocked: null, write: null }, tools);
    expect(l).toEqual({
      allowed: ["search_logs", "create_monitor", "wipe_index"],
      blocked: null,
      write: null,
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

  it.each([[["*"]], [["search_*", "create_monitor"]]])(
    "spells out no writes for the allowlist %j, whose globs match tools not seen yet",
    (allowed) => {
      const row = lists({ allowed, write: null });
      expect(prefillFromDiscovery(row, tools)).toEqual(row);
    },
  );

  it("keeps an unseen match of a glob refused once the admin sets a tool", () => {
    const row = lists({
      allowed: ["search_*", "create_monitor", "wipe_index", "gone_tool"],
      write: null,
    });
    const set = setToolState(row, "create_monitor", "allowed", tools);
    expect(set.write).toEqual(["search_*", "gone_tool"]);
    expect(toolState(set, { name: "search_added_later", read_only_hint: true })).toBe("write");
    expect(toolState(set, create)).toBe("allowed");
    const writes = ["search_*", "create_monitor", "gone_tool", "wipe_index"];
    expect(allowAll(row, tools).write).toEqual(writes);
    expect(allowReadOnly(row, tools).write).toEqual(["search_*", "gone_tool"]);
  });

  it("adds a tool under its normalized name, never as a wildcard", () => {
    const star = { name: "run*all" };
    const on = setToolState(lists(), star.name, "write");
    expect(on).toEqual({ allowed: ["run_all"], blocked: null, write: ["run_all"] });
    expect(toolState(on, star)).toBe("write");
    expect(toolState(on, { name: "run_x_all" })).toBe("off");
    expect(setByGlob(on, star.name)).toBe(false);
    expect(otherEntries(on, [star])).toEqual([]);
    expect(setToolState(on, star.name, "off")).toEqual(lists());
    const row = { allowed: null, blocked: null, write: null };
    expect(prefillFromDiscovery(row, [star, { name: "a.b" }]).allowed).toEqual(["run_all", "a_b"]);
    // A stored `run*all` is a wildcard, so it isn't the tool's own entry.
    expect(setByGlob(lists({ allowed: ["run*all"] }), star.name)).toBe(true);
    expect(otherEntries(lists({ allowed: ["run*all"] }), [star])).toHaveLength(1);
  });

  it("takes a stored vendor spelling as the tool's own entry", () => {
    const dotted = { name: "update.monitor" };
    const row = lists({ allowed: ["update.monitor"] });
    expect(otherEntries(row, [dotted])).toEqual([]);
    expect(setToolState(row, dotted.name, "write")).toEqual({
      allowed: ["update.monitor"],
      blocked: null,
      write: ["update_monitor"],
    });
    expect(setToolState(row, dotted.name, "off").allowed).toEqual([]);
  });

  it("Allow all turns tagged tools on as can change things; Allow read-only only the rest", () => {
    expect(allowAll(lists(), tools)).toEqual({
      allowed: ["search_logs", "create_monitor", "wipe_index"],
      blocked: null,
      write: ["create_monitor", "wipe_index"],
    });
    expect(allowReadOnly(allowAll(lists(), tools), tools)).toEqual({
      allowed: ["search_logs"],
      blocked: null,
      write: [],
    });
  });

  it("keeps entries naming no listed tool under Other entries, and removes one on request", () => {
    const l = lists({
      allowed: ["search_logs", "get_*", "gone_tool"],
      blocked: ["delete_*"],
      write: ["gone_tool"],
    });
    const others = otherEntries(l, tools);
    expect(others).toEqual([
      { list: "allowed", entry: "get_*" },
      { list: "allowed", entry: "gone_tool" },
      { list: "blocked", entry: "delete_*" },
      { list: "write", entry: "gone_tool" },
    ]);
    const next = setToolState(l, "search_logs", "off");
    expect(otherEntries(next, tools)).toEqual(others);
    expect(removeEntry(l, { list: "blocked", entry: "delete_*" }).blocked).toEqual([]);
  });

  it("refuses a glob in the typed tool name", () => {
    expect(typedToolError("run_*")).toBe("glob");
    expect(typedToolError("*")).toBe("glob");
    expect(typedToolError("run_query")).toBeNull();
    expect(addTypedTool(lists(), "*", false)).toEqual(lists());
  });

  it("adds a typed tool name when the server can't be listed", () => {
    let l = addTypedTool(lists(), "  run_query ", false);
    l = addTypedTool(l, "restart_pod", true);
    l = addTypedTool(l, "   ", true);
    expect(l).toEqual({
      allowed: ["run_query", "restart_pod"],
      blocked: null,
      write: ["restart_pod"],
    });
    expect(otherEntries(l, null).map((o) => o.entry)).toEqual([
      "run_query",
      "restart_pod",
      "restart_pod",
    ]);
  });

  it.each([
    ["no allowlist", null, ["*"]],
    ["an explicit allowlist", ["search_logs", "create_monitor"], ["search_logs", "create_monitor"]],
    ["a glob allowlist", ["get_*", "create_monitor"], ["get_*", "create_monitor"]],
  ])("counts all that %s allows as writes when a tool is typed", (_label, allowed, writes) => {
    const row = lists({ allowed, write: null });
    const read = addTypedTool(row, "run_query", false);
    expect(read.allowed).toEqual([...(allowed ?? []), "run_query"]);
    expect(read.write).toEqual(writes);
    expect(addTypedTool(row, "run_query", true).write).toEqual([...writes, "run_query"]);
    // The second typed tool finds write_tools set and adds no more.
    expect(addTypedTool(read, "other", false).write).toEqual(writes);
  });

  it("writes the state picked for a typed tool that was already allowed", () => {
    const row = lists({ allowed: ["a", "b"], write: null });
    expect(addTypedTool(row, "a", false).write).toEqual(["b"]);
    expect(addTypedTool(row, "a", true).write).toEqual(["a", "b"]);
    expect(addTypedTool(lists({ allowed: ["a"], write: [] }), "b", false).write).toEqual([]);
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
