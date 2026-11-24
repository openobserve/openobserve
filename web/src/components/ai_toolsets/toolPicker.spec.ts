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
  blockedByGlob,
  globPrefix,
  globMatches,
  mayWrite,
  otherEntries,
  prefillFromDiscovery,
  removeEntry,
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
    const off = setToolOn(row, wipe, false, tools);
    expect(off.allowed).toEqual(["search_*", "create_monitor", "gone_tool"]);
    expect(off.write).toEqual(["search_*", "create_monitor", "gone_tool"]);
  });

  it("adds a tool under its normalized name, never as a wildcard", () => {
    const star = { name: "run*all" };
    const on = setToolState(lists(), star.name, "write");
    expect(on).toEqual({ allowed: ["run_all"], blocked: null, write: ["run_all"] });
    expect(toolState(on, star)).toBe("write");
    expect(toolState(on, { name: "run_x_all" })).toBe("off");
    expect(expandGlobs(on, star.name, [star])).toBe(on);
    expect(otherEntries(on, [star])).toEqual([]);
    expect(setToolState(on, star.name, "off")).toEqual(lists());
    const row = { allowed: null, blocked: null, write: null };
    expect(prefillFromDiscovery(row, [star, { name: "a.b" }]).allowed).toEqual(["run_all", "a_b"]);
    // A stored `run*all` is a wildcard, so it isn't the tool's own entry.
    expect(blockedByGlob(lists({ blocked: ["run*all"] }), star.name)).toBe(true);
    expect(expandGlobs(lists({ allowed: ["run*all"] }), star.name, [star]).allowed).toEqual([
      "run_all",
    ]);
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

  it("turns a tool that may write on as a write and a read-only one as allowed", () => {
    const all = tools.reduce((acc, tool) => setToolOn(acc, tool, true, tools), lists());
    expect(all).toEqual({
      allowed: ["search_logs", "create_monitor", "wipe_index"],
      blocked: null,
      write: ["create_monitor", "wipe_index"],
    });
    expect(setToolOn(all, create, false, tools)).toEqual({
      allowed: ["search_logs", "wipe_index"],
      blocked: null,
      write: ["wipe_index"],
    });
  });

  it("changes nothing for a tool already in that state, and keeps a stored write entry", () => {
    const l = lists({ allowed: ["create_monitor"], write: [] });
    expect(setToolOn(l, create, true, tools)).toBe(l);
    expect(setToolOn(l, search, false, tools)).toBe(l);
    const marked = lists({ write: ["search_logs"] });
    expect(setToolOn(marked, search, true, tools).write).toEqual(["search_logs"]);
  });

  it("lifts an exact block, but can't turn on a tool a blocked glob or other spelling keeps off", () => {
    const exact = lists({ blocked: ["search_logs"] });
    expect(setToolOn(exact, search, true, tools)).toMatchObject({
      allowed: ["search_logs"],
      blocked: [],
    });
    const glob = lists({ blocked: ["search_*"] });
    expect(blockedByGlob(glob, "search_logs")).toBe(true);
    expect(setToolOn(glob, search, true, tools)).toBe(glob);
    expect(blockedByGlob(lists({ blocked: ["update.monitor"] }), "update_monitor")).toBe(true);
    expect(blockedByGlob(lists({ blocked: ["update.monitor"] }), "update.monitor")).toBe(false);
  });

  it("lists entries naming no listed tool, and removes one on request", () => {
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
    expect(otherEntries(l, null).map((o) => o.entry)).toContain("search_logs");
    expect(otherEntries(setToolState(l, "search_logs", "off"), tools)).toEqual(others);
    expect(removeEntry(l, { list: "blocked", entry: "delete_*" }).blocked).toEqual([]);
    expect(removeEntry(l, { list: "allowed", entry: "get_*" })).toEqual({
      ...l,
      allowed: ["search_logs", "gone_tool"],
    });
  });

  it("expands only the globs that match the tool, into the discovered names they match", () => {
    const l = lists({ allowed: ["gone", "search_*", "zzz_*"], write: null });
    expect(expandGlobs(l, "search_logs", tools).allowed).toEqual(["gone", "zzz_*", "search_logs"]);
    expect(expandGlobs(l, "create_monitor", tools)).toBe(l);
    expect(expandGlobs(lists({ allowed: null }), "search_logs", tools).allowed).toEqual([
      "search_logs",
      "create_monitor",
      "wipe_index",
    ]);
    const spelled = lists({ allowed: ["update.monitor"] });
    const underscored = { name: "update_monitor" };
    expect(expandGlobs(spelled, "update_monitor", [underscored]).allowed).toEqual([
      "update_monitor",
    ]);
  });

  it("turns off a tool a glob allows and leaves the glob's other tools on", () => {
    const l = lists({ allowed: ["*"], write: null });
    const off = setToolOn(l, create, false, tools);
    expect(off.allowed).toEqual(["search_logs", "wipe_index"]);
    expect(toolState(off, search)).toBe("allowed");
    expect(toolState(off, create)).toBe("off");
  });

  it.each([
    ["no allowlist", null, ["create_monitor"]],
    ["an explicit allowlist", ["search_logs", "other"], ["other"]],
    ["a glob allowlist", ["get_*", "other"], ["get_*", "other"]],
  ])("counts what %s allows but isn't known read-only as writes", (_label, allowed, writes) => {
    const row = lists({ allowed, blocked: ["wipe_index"], write: null });
    const set = setToolOn(row, wipe, true, tools);
    expect(set.write).toEqual([...writes, "wipe_index"]);
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
