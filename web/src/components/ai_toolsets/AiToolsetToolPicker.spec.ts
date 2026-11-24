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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AiToolsetToolPicker from "./AiToolsetToolPicker.vue";

const lists = { allowed: ["get_metric", "apm_*"], blocked: null, write: null };
const TOOLS = [
  { name: "search_logs", description: "Search logs", read_only_hint: true },
  { name: "create_monitor", read_only_hint: false },
  { name: "apm_traces" },
  { name: "apm_spans" },
];

const mountPicker = (props: Record<string, unknown> = {}) =>
  mount(AiToolsetToolPicker, {
    props: { lists, tools: null, ...props } as any,
    global: { plugins: [i18n] },
  });

const sel = (id: string) => `[data-test="${id}"]`;
const last = (w: ReturnType<typeof mountPicker>) =>
  w.emitted("update:lists")!.at(-1)![0] as Record<string, string[] | null>;
const box = (w: ReturnType<typeof mountPicker>, tool: string) =>
  w.find(`${sel(`ai-toolset-tool-${tool}`)} button[role="checkbox"]`);
const allBox = (w: ReturnType<typeof mountPicker>) =>
  w.find(`${sel("ai-toolset-tools-all")} button[role="checkbox"]`);

describe("AiToolsetToolPicker", () => {
  afterEach(() => vi.useRealTimers());

  it("before connecting shows the intro, the steps, the preset tag and note", () => {
    const w = mountPicker({ presetTools: 2, presetName: "Dynatrace" });
    expect(w.find(sel("ai-toolset-tools-intro")).text()).toContain("in Dynatrace.");
    const hint = w.find(sel("ai-toolset-tools-hint")).text();
    expect(hint).toContain("Not connected yet");
    expect(hint).toContain("Enter your Dynatrace credentials in Connection.");
    expect(hint).toContain("Click Connect to load every tool on the server.");
    expect(w.find(sel("ai-toolset-tools-preset-tag")).text()).toBe("From the Dynatrace preset");
    expect(w.find(sel("ai-toolset-tools-preset-note")).exists()).toBe(true);
    expect(w.find(sel("ai-toolset-tools-count")).text()).toBe("2 of 2 enabled");
  });

  it("uses generic wording for a custom server", () => {
    const w = mountPicker();
    expect(w.find(sel("ai-toolset-tools-intro")).text()).toContain("in this server.");
    expect(w.find(sel("ai-toolset-tools-hint")).text()).toContain(
      "Enter the server URL and any credentials in Connection.",
    );
    expect(w.find(sel("ai-toolset-tools-preset-tag")).exists()).toBe(false);
  });

  it("emits go-connection from the Connection link", async () => {
    const w = mountPicker({ presetName: "Dynatrace" });
    await w.find(sel("ai-toolset-tools-goto-connection")).trigger("click");
    expect(w.emitted("go-connection")).toHaveLength(1);
  });

  it("emits refresh from the button, which is disabled without a URL", async () => {
    const w = mountPicker();
    await w.find(sel("ai-toolset-refresh-tools")).trigger("click");
    expect(w.emitted("refresh")).toHaveLength(1);
    const noUrl = mountPicker({ canRefresh: false });
    expect(noUrl.find(sel("ai-toolset-refresh-tools")).attributes("disabled")).toBeDefined();
    expect(noUrl.find(sel("ai-toolset-tools-hint")).text()).toContain("Enter the server URL");
  });

  it("shows progress with elapsed seconds and skeletons while the server is listed", async () => {
    vi.useFakeTimers();
    const w = mountPicker({ status: "loading", presetName: "Datadog" });
    expect(w.find(sel("ai-toolset-tools-loading")).text()).toContain("Listing Datadog's tools…");
    expect(w.find(sel("ai-toolset-tools-elapsed")).text()).toBe("0 s");
    expect(w.find(sel("ai-toolset-tools-skeleton")).exists()).toBe(true);
    vi.advanceTimersByTime(3000);
    await w.vm.$nextTick();
    expect(w.find(sel("ai-toolset-tools-elapsed")).text()).toBe("3 s");
  });

  it("shows the connected line with the tool count", () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    const line = w.find(sel("ai-toolset-tools-success")).text();
    expect(line).toContain("Connected");
    expect(line).toContain("4 tools found");
    expect(line).toContain("checked just now");
    expect(w.find(sel("ai-toolset-tools-hint")).exists()).toBe(false);
    expect(w.find(sel("ai-toolset-tools-count")).text()).toBe("3 of 5 enabled");
  });

  it("shows the failed panel with the message, the preset note and Retry", async () => {
    const w = mountPicker({
      status: "failed",
      error: "no secret",
      presetName: "Datadog",
      presetTools: 2,
    });
    const panel = w.find(sel("ai-toolset-tools-error")).text();
    expect(panel).toContain("Couldn't connect to Datadog");
    expect(panel).toContain("no secret");
    expect(panel).toContain("The 2 tools from the preset stay on until a refresh works.");
    await w.find(sel("ai-toolset-tools-retry")).trigger("click");
    expect(w.emitted("refresh")).toHaveLength(1);
  });

  it("omits the preset note on a failed custom server", () => {
    const w = mountPicker({ status: "failed", error: "x" });
    expect(w.find(sel("ai-toolset-tools-error-keep")).exists()).toBe(false);
  });

  it("All tools is checked, indeterminate or unchecked from the ticked count", () => {
    const connected = { tools: TOOLS, status: "ok" };
    expect(allBox(mountPicker(connected)).attributes("data-state")).toBe("indeterminate");
    const everything = {
      allowed: ["get_metric", "apm_traces", "apm_spans", "search_logs", "create_monitor"],
      blocked: null,
      write: null,
    };
    expect(allBox(mountPicker({ ...connected, lists: everything })).attributes("data-state")).toBe(
      "checked",
    );
    const none = { allowed: [], blocked: null, write: null };
    expect(allBox(mountPicker({ ...connected, lists: none })).attributes("data-state")).toBe(
      "unchecked",
    );
  });

  it("All tools turns everything on, or everything off when all are on", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    await allBox(w).trigger("click");
    expect(last(w)).toEqual({
      allowed: ["get_metric", "apm_*", "search_logs", "create_monitor"],
      blocked: null,
      write: ["get_metric", "apm_*", "create_monitor"],
    });
    const on = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: {
        allowed: ["search_logs", "create_monitor", "apm_traces", "apm_spans", "get_metric"],
        blocked: null,
        write: null,
      },
    });
    await allBox(on).trigger("click");
    expect(last(on).allowed).toEqual([]);
  });

  it("All tools off clears saved entries too, before and after connecting", async () => {
    const all = { allowed: ["get_metric", "apm_*"], blocked: ["delete_*"], write: null };
    const before = mountPicker({ lists: all });
    await allBox(before).trigger("click");
    expect(last(before)).toEqual({ allowed: [], blocked: ["delete_*"], write: null });
    const tools = [{ name: "apm_traces" }, { name: "apm_spans" }];
    const after = mountPicker({ lists: all, tools, status: "ok" });
    await allBox(after).trigger("click");
    expect(last(after).allowed).toEqual([]);
  });

  it("ticking a tool adds it to allowed only, and keeps stored globs", async () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: { allowed: ["apm_*"], blocked: ["search_logs"], write: ["apm_traces"] },
    });
    await box(w, "search_logs").trigger("click");
    expect(last(w)).toEqual({
      allowed: ["apm_*", "search_logs"],
      blocked: [],
      write: ["apm_traces"],
    });
  });

  it("ticking a tool that may write adds it to write_tools, so read-only turns refuse it", async () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: { allowed: [], blocked: null, write: [] },
    });
    await box(w, "create_monitor").trigger("click");
    expect(last(w)).toEqual({
      allowed: ["create_monitor"],
      blocked: null,
      write: ["create_monitor"],
    });
  });

  it("locks a tool a blocked pattern keeps off, and lifts the block from its own row", async () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: { allowed: ["search_logs"], blocked: ["apm_*"], write: null },
    });
    expect(box(w, "apm_traces").attributes("disabled")).toBeDefined();
    expect(w.find(sel("ai-toolset-tools-count")).text()).toBe("1 of 4 enabled");
    await w.find(`${sel("ai-toolset-blocked-apm_*")} button[role="checkbox"]`).trigger("click");
    expect(w.emitted("remove")).toEqual([[{ list: "blocked", entry: "apm_*" }]]);
    expect(w.emitted("update:lists")).toBeUndefined();
  });

  it("unticking a tool drops it from allowed and write", async () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: {
        allowed: ["apm_*", "search_logs"],
        blocked: null,
        write: ["apm_traces", "search_logs"],
      },
    });
    await box(w, "apm_traces").trigger("click");
    expect(last(w)).toEqual({
      allowed: ["search_logs", "apm_spans"],
      blocked: null,
      write: ["search_logs"],
    });
  });

  it("shows saved tools the server no longer has; unticking removes them", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    expect(w.find(sel("ai-toolset-tool-get_metric")).exists()).toBe(true);
    expect(w.find(sel("ai-toolset-tool-apm_*")).exists()).toBe(false);
    await box(w, "get_metric").trigger("click");
    expect(w.emitted("remove")).toEqual([[{ list: "allowed", entry: "get_metric" }]]);
  });

  it("before connecting, unticking an entry removes it", async () => {
    const w = mountPicker();
    await box(w, "apm_*").trigger("click");
    expect(w.emitted("remove")).toEqual([[{ list: "allowed", entry: "apm_*" }]]);
  });

  it("sets the tooltip text for a glob, a saved tool the server lacks and a described tool", () => {
    const tips = (w: ReturnType<typeof mountPicker>) =>
      w.findAllComponents({ name: "OTooltip" }).map((c) => c.props("content"));
    const before = mountPicker();
    expect(tips(before)).toContain("Matches every tool starting with apm_");
    const after = mountPicker({ tools: TOOLS, status: "ok" });
    expect(tips(after)).toEqual(expect.arrayContaining(["Not on the server", "Search logs"]));
  });

  it("filters by name and description", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    await w.find(`${sel("ai-toolset-tools-filter")} input`).setValue("search");
    expect(w.find(sel("ai-toolset-tool-search_logs")).exists()).toBe(true);
    expect(w.find(sel("ai-toolset-tool-create_monitor")).exists()).toBe(false);
    await w.find(`${sel("ai-toolset-tools-filter")} input`).setValue("nothing-here");
    expect(w.find(sel("ai-toolset-tools-empty")).text()).toBe("No tools match.");
  });
});
