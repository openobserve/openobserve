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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";

import type { AssistantHostAdapter } from "@/composables/assistant/pure";
import {
  resetEditorProposalsForTests,
  useEditorProposal,
} from "@/composables/assistant/useEditorProposal";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantQueryBlock, { type QueryBlock } from "./AssistantQueryBlock.vue";

vi.mock("@/components/QueryEditor.vue", () => ({
  default: { props: ["query"], template: "<pre>{{ query }}</pre>" },
}));

const FROM = Date.UTC(2026, 9, 14, 8, 13);
const TO = FROM + 15 * 60_000;

const block: QueryBlock = {
  blockId: "b1",
  query: {
    language: "sql",
    text: 'SELECT * FROM "default"',
    stream: "default",
    streamType: "logs",
    from: FROM,
    to: TO,
    org: "default",
  },
  rangeSource: "turn",
};

describe("AssistantQueryBlock", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountBlock = (props: Record<string, unknown> = {}, live = true, newTab = false) => {
    const evidence = fakeEvidence();
    evidence.host.prefersNewTab.mockReturnValue(newTab);
    const wrapper = mount(AssistantQueryBlock, {
      props: { block, isLast: true, permissions: {}, sid: live ? evidence.sid : null, ...props },
      attachTo: document.body,
      global: {
        plugins: [
          fakeRouter([
            { path: "/traces", name: "traces", component: { render: () => null } },
            { path: "/metrics/editor", name: "metricsEditor", component: { render: () => null } },
          ]),
        ],
        provide: live ? evidence.provide : {},
      },
    });
    return { wrapper, ...evidence };
  };

  it("names the group by language, stream and range, and offers Run · Open in Logs · Copy query without a Retry", () => {
    const { wrapper } = mountBlock();
    const group = wrapper.get('[data-test="assistant-query-block"]');
    expect(group.attributes("role")).toBe("group");
    expect(group.attributes("aria-label")).toMatch(/^SQL query on default, .+–.+$/);
    expect(wrapper.get('[data-test="assistant-query-run"]').text()).toBe("Run");
    expect(wrapper.get('[data-test="assistant-query-open"]').text()).toBe("Open in Logs");
    expect(wrapper.get('[data-test="assistant-query-copy"]').attributes("aria-label")).toBe(
      "Copy query",
    );
    expect(wrapper.text()).not.toContain("Retry");
  });

  it("names a new tab when Open goes to one, and still opens through the applier", async () => {
    const { wrapper } = mountBlock();
    expect(wrapper.get('[data-test="assistant-query-open"]').attributes("aria-label")).toBe(
      undefined,
    );
    const docked = mountBlock({}, true, true);
    const tab = docked.wrapper.get('[data-test="assistant-query-open"]');
    expect(tab.attributes("aria-label")).toBe("Open in Logs (opens in a new tab)");
    await tab.trigger("click");
    expect(docked.host.dispatch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "open_in_explorer" }),
    );
  });

  it("makes Run primary only on the last block", () => {
    const { wrapper } = mountBlock({ isLast: false });
    expect(wrapper.get('[data-test="assistant-query-run"]').classes().join(" ")).not.toContain(
      "bg-button-primary",
    );
  });

  it("dispatches Run and shows the rows, the stop control while running, and announces the count", async () => {
    const { wrapper, host, runs } = mountBlock();
    runs.set("b1", { status: "running", startedAt: Date.now() });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-query-stop"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-query-actions"]').exists()).toBe(false);
    runs.set("b1", {
      status: "done",
      startedAt: 1,
      rows: [{ a: "1" }],
      columns: ["a"],
      total: 4,
      tookMs: 380,
      window: { from: FROM, to: TO, fallback: false, capped: false },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-query-summary"]').text()).toMatch(
      /^4 rows · 380 ms · .+–.+$/,
    );
    expect(wrapper.get('[data-test="assistant-query-results"]').attributes("aria-label")).toMatch(
      /^Results of SQL query on default, /,
    );
    runs.delete("b1");
    await flushPromises();
    await wrapper.get('[data-test="assistant-query-run"]').trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "run_query",
      query: block.query,
      blockId: "b1",
    });
  });

  it("says no rows, the server's reason or no access, never an empty table", async () => {
    const { wrapper, runs } = mountBlock();
    runs.set("b1", { status: "empty", startedAt: 1, rows: [] });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-query-outcome"]').text()).toBe(
      "No rows in this range",
    );
    runs.set("b1", { status: "forbidden", startedAt: 1 });
    await flushPromises();
    const outcome = wrapper.get('[data-test="assistant-query-outcome"]');
    expect(outcome.text()).toBe("You don't have access to stream default");
    expect(outcome.find("code").text()).toBe("default");
    expect(wrapper.find('[data-test="assistant-query-run"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-query-open"]').classes().join(" ")).not.toContain(
      "bg-button-primary",
    );
    runs.set("b1", { status: "failed", startedAt: 1, reason: "bad field" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-query-outcome"]').text()).toBe(
      "Query failed: bad field",
    );
    expect(wrapper.find('[data-test="assistant-query-table"]').exists()).toBe(false);
  });

  it("states the window that ran when the answer named none, or when it was cut to 7 days", async () => {
    const unknown = { ...block, query: { ...block.query, from: undefined, to: undefined } };
    const { wrapper, runs } = mountBlock({ block: unknown });
    expect(wrapper.get('[data-test="assistant-query-range"]').text()).toBe(
      "range: unknown · runs on the last 15 min",
    );
    const done = { status: "done" as const, startedAt: 1, rows: [], total: 0, tookMs: 5 };
    runs.set("b1", {
      ...done,
      window: { from: TO - 900_000, to: TO, fallback: true, capped: false },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-query-summary"]').text()).toBe(
      "0 rows · 5 ms · last 15 min",
    );
    runs.set("b1", { ...done, window: { from: FROM, to: TO, fallback: false, capped: true } });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-query-summary"]').text()).toMatch(
      /\(cut to the last 7 days\)$/,
    );
  });

  it("moves focus to the results on Stop and says it stopped", async () => {
    const { wrapper, host, runs } = mountBlock();
    runs.set("b1", { status: "running", startedAt: Date.now() });
    await flushPromises();
    host.dispatch.mockImplementationOnce(async () => {
      runs.set("b1", { status: "stopped", startedAt: 1 });
      return { ok: true };
    });
    await wrapper.get('[data-test="assistant-query-stop"]').trigger("click");
    await flushPromises();
    const results = wrapper.get('[data-test="assistant-query-results"]');
    expect(document.activeElement).toBe(results.element);
    expect(wrapper.get('[data-test="assistant-query-outcome"]').text()).toBe("Stopped");
  });

  it("says why another org's session refused a draft, and drafts carry the block's turn", async () => {
    const { wrapper, host } = mountBlock({ turnId: "t7" });
    const items = () => wrapper.vm.$.setupState.menuItems as { id: string; run(): void }[];
    host.dispatch.mockResolvedValueOnce({ ok: false, reason: "other_org" } as never);
    items()
      .find((entry) => entry.id === "add-dashboard")!
      .run();
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "add_to_dashboard_draft",
      query: block.query,
      turnId: "t7",
    });
    expect(host.announce).toHaveBeenCalledWith(
      expect.any(String),
      "This query belongs to default. Switch organization to run it.",
    );
    expect(items().map((entry) => entry.id)).toEqual(["add-dashboard", "create-alert"]);
  });

  it("stops a run on Escape", async () => {
    const { wrapper, host, runs } = mountBlock();
    runs.set("b1", { status: "running", startedAt: Date.now() });
    await flushPromises();
    wrapper
      .get('[data-test="assistant-query-block"]')
      .element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "stop_query",
      blockId: "b1",
    });
  });

  it("opens through the explorer applier on a plain click and leaves Ctrl-click to the browser", async () => {
    const { wrapper, host } = mountBlock();
    const open = wrapper.get('[data-test="assistant-query-open"]');
    expect(open.element.tagName).toBe("A");
    expect(open.attributes("href")).toContain("type=ai_chat_query");
    await open.trigger("click", { ctrlKey: true });
    expect(host.dispatch).not.toHaveBeenCalled();
    await open.trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "open_in_explorer",
      query: block.query,
      explorer: "logs",
    });
  });

  it("reads Open in Metrics for PromQL and Open in Traces for a traces stream", () => {
    const promql = mountBlock({
      block: { ...block, query: { ...block.query, language: "promql", streamType: "metrics" } },
    });
    expect(promql.wrapper.get('[data-test="assistant-query-open"]').text()).toBe("Open in Metrics");
    expect(promql.wrapper.find('[data-test="assistant-query-run"]').exists()).toBe(false);
    const traces = mountBlock({
      block: { ...block, query: { ...block.query, streamType: "traces" } },
    });
    expect(traces.wrapper.get('[data-test="assistant-query-open"]').text()).toBe("Open in Traces");
  });

  it("reads Inserted until the editor's label goes, then offers Insert again", async () => {
    const editorHost = {
      id: "alert_query",
      language: "sql",
      getBuffer: () => text.value,
      focusEditor: vi.fn(),
    } as unknown as AssistantHostAdapter;
    const text = ref("SELECT 1");
    const scope = effectScope();
    const proposal = scope.run(() =>
      useEditorProposal(editorHost, { write: (next) => void (text.value = next) }),
    )!;
    const { wrapper, host } = mountBlock({ host: editorHost });
    host.dispatch.mockImplementationOnce(async () => {
      const handle = await proposal.propose(block.query.text, {
        mode: "replace",
        provenance: { prompt: "" },
        canRun: false,
      });
      handle.accept();
      return { ok: true, detail: { decision: "accepted", note: null } } as never;
    });
    const insert = () => wrapper.get('[data-test="assistant-query-insert"]');
    await insert().trigger("click");
    await flushPromises();
    expect(insert().attributes("data-state")).toBe("inserted");
    proposal.revert("original");
    await flushPromises();
    expect(insert().attributes("data-state")).toBe("idle");
    expect(insert().attributes("aria-disabled")).toBeUndefined();
    scope.stop();
    resetEditorProposalsForTests();
  });

  it("drops Run, Insert and the overflow on a shared page; Open opens a new tab", () => {
    const { wrapper } = mountBlock({ readonly: true }, false);
    expect(wrapper.find('[data-test="assistant-query-run"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-query-more"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-query-insert"]').exists()).toBe(false);
    const open = wrapper.get('[data-test="assistant-query-open"]');
    expect(open.attributes("target")).toBe("_blank");
    expect(open.attributes("rel")).toContain("noopener");
  });

  it("names another org instead of running its query", () => {
    const { wrapper } = mountBlock({ block: { ...block, query: { ...block.query, org: "acme" } } });
    expect(wrapper.get('[data-test="assistant-query-other-org"]').text()).toBe(
      "This query belongs to acme. Switch organization to run it.",
    );
    expect(wrapper.find('[data-test="assistant-query-run"]').exists()).toBe(false);
  });

  it("offers neither Open nor the drafts for a VRL block", () => {
    const { wrapper } = mountBlock({
      block: { ...block, query: { ...block.query, language: "vrl", text: ".a = 1" } },
    });
    expect(wrapper.find('[data-test="assistant-query-open"]').exists()).toBe(false);
    const items = wrapper.vm.$.setupState.menuItems as { id: string }[];
    expect(items.map((entry) => entry.id)).not.toContain("add-dashboard");
    expect(items.map((entry) => entry.id)).not.toContain("create-alert");
  });

  it("has no Open on a readonly page whose host has no explorer", () => {
    const { wrapper } = mountBlock({ readonly: true, openable: false }, false);
    expect(wrapper.find('[data-test="assistant-query-open"]').exists()).toBe(false);
  });

  it("links the source step", () => {
    const linked = mountBlock({ block: { ...block, sourceCallId: "c3" }, sourceStep: 3 });
    expect(linked.wrapper.get('[data-test="assistant-query-source-step"]').text()).toBe(
      "from step 3",
    );
  });

  it("copies through the clipboard applier and offers the text by hand when that fails", async () => {
    const { wrapper, host } = mountBlock();
    host.dispatch.mockResolvedValueOnce({ ok: false, reason: "failed" } as never);
    await wrapper.get('[data-test="assistant-query-copy"]').trigger("click");
    await flushPromises();
    expect(host.announce).toHaveBeenCalledWith(
      expect.any(String),
      "Couldn't copy. Select the text and copy it.",
    );
    expect(wrapper.find('[data-test="assistant-query-copy-manual"]').exists()).toBe(true);
  });
});
