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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import AiToolsetToolPicker from "./AiToolsetToolPicker.vue";

const lists = { allowed: ["get_metric", "apm_*"], blocked: null, write: null };
const TOOLS = [
  { name: "search_logs", description: "Search logs", read_only_hint: true },
  { name: "create_monitor", read_only_hint: false },
  { name: "apm_traces" },
  { name: "apm_spans" },
];
const WRITES = [
  { name: "read_a", read_only_hint: true },
  { name: "update_b", read_only_hint: false },
  { name: "drop_c", read_only_hint: false, destructive_hint: true, description: "Drops it" },
];

const mountPicker = (props: Record<string, unknown> = {}) =>
  mount(AiToolsetToolPicker, {
    props: { lists, tools: null, ...props } as any,
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
type Picker = ReturnType<typeof mountPicker>;

const sel = (id: string) => `[data-test="${id}"]`;
const last = (w: Picker) =>
  w.emitted("update:lists")!.at(-1)![0] as Record<string, string[] | null>;
const radio = (w: Picker, row: string, level: string) =>
  w.find(`${sel(row)} [data-test="ai-toolset-tool-level"][data-test-value="${level}"]`);
const level = (w: Picker, tool: string) =>
  ["off", "chat", "everywhere", "on"].find(
    (l) => radio(w, `ai-toolset-tool-${tool}`, l).attributes("data-state") === "checked",
  );
const groupRadio = (w: Picker, group: string, l: string) =>
  w.find(
    `${sel(`ai-toolset-tools-group-${group}`)} [data-test="ai-toolset-group-level"][data-test-value="${l}"]`,
  );
const groupCount = (w: Picker, group: string) =>
  w.find(`${sel(`ai-toolset-tools-group-${group}`)} ${sel("ai-toolset-tools-group-count")}`).text();

describe("AiToolsetToolPicker", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("before connecting shows the intro, the steps, the preset tag and note", () => {
    const w = mountPicker({ presetTools: 2, presetName: "Acme" });
    expect(w.find(sel("ai-toolset-tools-intro")).text()).toContain("in Acme, and where.");
    const hint = w.find(sel("ai-toolset-tools-hint")).text();
    expect(hint).toContain("Not connected yet");
    expect(hint).toContain("Enter your Acme credentials in Connection.");
    expect(hint).toContain("Click Connect to load every tool on the server.");
    expect(w.find(sel("ai-toolset-tools-preset-tag")).text()).toBe("From the Acme preset");
    expect(w.find(sel("ai-toolset-tools-preset-note")).exists()).toBe(true);
    expect(groupCount(w, "saved")).toBe("2 of 2 on");
    expect(w.find(sel("ai-toolset-tools-reach")).exists()).toBe(false);
  });

  it("uses generic wording for a custom server", () => {
    const w = mountPicker();
    expect(w.find(sel("ai-toolset-tools-intro")).text()).toContain("in this server");
    expect(w.find(sel("ai-toolset-tools-hint")).text()).toContain(
      "Enter the server URL and any credentials in Connection.",
    );
    expect(w.find(sel("ai-toolset-tools-preset-tag")).exists()).toBe(false);
  });

  it("emits go-connection from the Connection link", async () => {
    const w = mountPicker({ presetName: "Acme" });
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
    const w = mountPicker({ status: "loading", presetName: "Acme" });
    expect(w.find(sel("ai-toolset-tools-loading")).text()).toContain("Listing Acme's tools…");
    expect(w.find(sel("ai-toolset-tools-elapsed")).text()).toBe("0 s");
    expect(w.find(sel("ai-toolset-tools-skeleton")).exists()).toBe(true);
    expect(w.findAll(sel("ai-toolset-tools-skeleton-radio"))).toHaveLength(18);
    vi.advanceTimersByTime(3000);
    await w.vm.$nextTick();
    expect(w.find(sel("ai-toolset-tools-elapsed")).text()).toBe("3 s");
  });

  it("shows the connected line and the reach of the tools", () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    const line = w.find(sel("ai-toolset-tools-success")).text();
    expect(line).toContain("Connected");
    expect(line).toContain("4 tools found");
    expect(line).toContain("checked just now");
    expect(w.find(sel("ai-toolset-tools-hint")).exists()).toBe(false);
    expect(w.find(sel("ai-toolset-tools-reach")).exists()).toBe(false);
  });

  it("maps the saved lists onto Off, Chat and Everywhere", () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: {
        allowed: ["search_logs", "create_monitor"],
        blocked: null,
        write: ["create_monitor"],
      },
    });
    expect(level(w, "search_logs")).toBe("everywhere");
    expect(level(w, "create_monitor")).toBe("chat");
    expect(level(w, "apm_traces")).toBe("off");
  });

  it("puts read-only tools under Reads data and the rest, with no Everywhere, under Changes things", () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    const reads = w.find(sel("ai-toolset-tools-group-reads"));
    expect(reads.find(sel("ai-toolset-tool-search_logs")).exists()).toBe(true);
    expect(groupCount(w, "reads")).toBe("0 of 1 on");
    expect(groupCount(w, "changes")).toBe("2 of 3 on");
    expect(radio(w, "ai-toolset-tool-search_logs", "everywhere").exists()).toBe(true);
    for (const tool of ["create_monitor", "apm_traces"]) {
      expect(radio(w, `ai-toolset-tool-${tool}`, "everywhere").exists()).toBe(false);
    }
    expect(groupRadio(w, "changes", "everywhere").exists()).toBe(false);
  });

  it("labels each group radio as setting all, on the same surface as the rows", () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    const reads = w.find(sel("ai-toolset-tools-group-reads"));
    expect(reads.findAll(sel("ai-toolset-group-level-caption")).map((c) => c.text())).toEqual([
      "All",
      "All",
      "All",
    ]);
    expect(reads.html()).not.toContain("bg-surface-panel");
  });

  it("cuts a description to one line inside a panel that never scrolls sideways", () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    const desc = w.find(
      `${sel("ai-toolset-tool-search_logs")} [data-test="o-truncated-text"].text-xs`,
    );
    expect(desc.classes()).toContain("truncate");
    expect(w.find(sel("ai-toolset-tools-grid")).classes()).toContain("overflow-x-hidden");
  });

  it("hides a group with no tools", () => {
    const w = mountPicker({
      tools: [{ name: "read_a", read_only_hint: true }],
      status: "ok",
      lists: { allowed: [], blocked: null, write: [] },
    });
    expect(w.find(sel("ai-toolset-tools-group-reads")).exists()).toBe(true);
    expect(w.find(sel("ai-toolset-tools-group-changes")).exists()).toBe(false);
    expect(w.find(sel("ai-toolset-tools-group-saved")).exists()).toBe(false);
  });

  it("sets a read-only tool to Everywhere or Chat, and a write tool to Chat", async () => {
    const start = { allowed: [], blocked: null, write: [] };
    const w = mountPicker({ tools: TOOLS, status: "ok", lists: start });
    await radio(w, "ai-toolset-tool-search_logs", "everywhere").trigger("click");
    expect(last(w)).toEqual({ allowed: ["search_logs"], blocked: null, write: [] });
    await radio(w, "ai-toolset-tool-search_logs", "chat").trigger("click");
    expect(last(w)).toEqual({ allowed: ["search_logs"], blocked: null, write: ["search_logs"] });
    await radio(w, "ai-toolset-tool-create_monitor", "chat").trigger("click");
    expect(last(w)).toEqual({
      allowed: ["create_monitor"],
      blocked: null,
      write: ["create_monitor"],
    });
  });

  it("turning a tool off drops it from allowed and write, and keeps stored globs", async () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: {
        allowed: ["apm_*", "search_logs"],
        blocked: null,
        write: ["apm_traces", "search_logs"],
      },
    });
    await radio(w, "ai-toolset-tool-apm_traces", "off").trigger("click");
    expect(last(w)).toEqual({
      allowed: ["search_logs", "apm_spans"],
      blocked: null,
      write: ["search_logs"],
    });
  });

  it("a group radio sets every tool in the group and skips destructive ones", async () => {
    const w = mountPicker({
      tools: WRITES,
      status: "ok",
      lists: { allowed: [], blocked: null, write: [] },
    });
    await groupRadio(w, "changes", "chat").trigger("click");
    expect(last(w)).toEqual({ allowed: ["update_b"], blocked: null, write: ["update_b"] });
    await groupRadio(w, "reads", "everywhere").trigger("click");
    expect(last(w)).toEqual({ allowed: ["read_a"], blocked: null, write: [] });
  });

  it("a group's Off turns destructive tools off too", async () => {
    const all = ["read_a", "update_b", "drop_c"];
    const w = mountPicker({
      tools: WRITES,
      status: "ok",
      lists: { allowed: all, blocked: null, write: ["update_b", "drop_c"] },
    });
    expect(groupRadio(w, "changes", "chat").attributes("data-state")).toBe("checked");
    await groupRadio(w, "changes", "off").trigger("click");
    expect(last(w)).toEqual({ allowed: ["read_a"], blocked: null, write: [] });
  });

  it("asks before a destructive tool goes on, and Keep off changes nothing", async () => {
    const w = mountPicker({
      tools: WRITES,
      status: "ok",
      lists: { allowed: [], blocked: null, write: [] },
    });
    expect(
      w.find(`${sel("ai-toolset-tool-drop_c")} ${sel("ai-toolset-tool-destructive")}`).text(),
    ).toBe("Cannot be undone");
    const dialog = w.findComponent(ODialog);
    await radio(w, "ai-toolset-tool-drop_c", "chat").trigger("click");
    expect(w.emitted("update:lists")).toBeUndefined();
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("title")).toBe('Allow "drop_c" in chat?');
    dialog.vm.$emit("click:secondary");
    await w.vm.$nextTick();
    expect(dialog.props("open")).toBe(false);
    expect(w.emitted("update:lists")).toBeUndefined();

    await radio(w, "ai-toolset-tool-drop_c", "chat").trigger("click");
    dialog.vm.$emit("click:primary");
    await w.vm.$nextTick();
    expect(last(w)).toEqual({ allowed: ["drop_c"], blocked: null, write: ["drop_c"] });
    expect(dialog.props("open")).toBe(false);
  });

  it("counts the filters and shows only the matching rows", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    const count = (id: string) => w.find(sel(`ai-toolset-tools-view-${id}`)).text();
    expect(count("all")).toBe("All 5");
    expect(count("on")).toBe("On 3");
    expect(count("off")).toBe("Off 2");
    expect(count("changes")).toBe("Changes things 3");
    await w.find(sel("ai-toolset-tools-view-changes")).trigger("click");
    expect(w.find(sel("ai-toolset-tools-group-reads")).exists()).toBe(false);
    expect(w.find(sel("ai-toolset-tools-group-saved")).exists()).toBe(false);
    expect(w.find(sel("ai-toolset-tool-create_monitor")).exists()).toBe(true);
    await w.find(sel("ai-toolset-tools-view-off")).trigger("click");
    expect(w.find(sel("ai-toolset-tool-search_logs")).exists()).toBe(true);
    expect(w.find(sel("ai-toolset-tool-apm_traces")).exists()).toBe(false);
  });

  it("searches by name and description, and says when nothing matches", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    await w.find(`${sel("ai-toolset-tools-filter")} input`).setValue("search logs");
    expect(w.find(sel("ai-toolset-tool-search_logs")).exists()).toBe(true);
    expect(w.find(sel("ai-toolset-tool-create_monitor")).exists()).toBe(false);
    await w.find(`${sel("ai-toolset-tools-filter")} input`).setValue("nothing-here");
    expect(w.find(sel("ai-toolset-tools-empty")).text()).toBe(
      "No tools match. Clear the search or pick another filter.",
    );
  });

  it("highlights a row whose level changed since the tools were listed", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    expect(w.find(`${sel("ai-toolset-tool-search_logs")}[data-changed]`).exists()).toBe(false);
    await w.setProps({ lists: { allowed: ["search_logs"], blocked: null, write: [] } });
    expect(w.find(`${sel("ai-toolset-tool-search_logs")}[data-changed]`).exists()).toBe(true);
  });

  it("locks a tool a blocked pattern keeps off, and lifts the block from its own row", async () => {
    const w = mountPicker({
      tools: TOOLS,
      status: "ok",
      lists: { allowed: ["search_logs"], blocked: ["apm_*"], write: null },
    });
    expect(radio(w, "ai-toolset-tool-apm_traces", "chat").attributes("disabled")).toBeDefined();
    expect(
      w.find(`${sel("ai-toolset-tool-apm_traces")} ${sel("ai-toolset-tool-note")}`).exists(),
    ).toBe(true);
    await radio(w, "ai-toolset-blocked-apm_*", "on").trigger("click");
    expect(w.emitted("remove")).toEqual([[{ list: "blocked", entry: "apm_*" }]]);
    expect(w.emitted("update:lists")).toBeUndefined();
  });

  it("shows saved tools the server no longer has; turning one off removes it", async () => {
    const w = mountPicker({ tools: TOOLS, status: "ok" });
    expect(
      w.find(`${sel("ai-toolset-tool-get_metric")} ${sel("ai-toolset-tool-note")}`).text(),
    ).toBe("Not on the server");
    expect(w.find(sel("ai-toolset-tool-apm_*")).exists()).toBe(false);
    await radio(w, "ai-toolset-tool-get_metric", "off").trigger("click");
    expect(w.emitted("remove")).toEqual([[{ list: "allowed", entry: "get_metric" }]]);
  });

  it("before connecting, a glob row says what it matches and Off removes it", async () => {
    const w = mountPicker();
    expect(w.find(`${sel("ai-toolset-tool-apm_*")} ${sel("ai-toolset-tool-note")}`).text()).toBe(
      "Matches every tool starting with apm_",
    );
    await radio(w, "ai-toolset-tool-apm_*", "off").trigger("click");
    expect(w.emitted("remove")).toEqual([[{ list: "allowed", entry: "apm_*" }]]);
  });

  it("the saved group's Off clears every saved entry and keeps the blocks", async () => {
    const w = mountPicker({
      lists: { allowed: ["get_metric", "apm_*"], blocked: ["delete_*"], write: null },
    });
    await groupRadio(w, "saved", "off").trigger("click");
    expect(last(w)).toEqual({ allowed: [], blocked: ["delete_*"], write: null });
  });
});
