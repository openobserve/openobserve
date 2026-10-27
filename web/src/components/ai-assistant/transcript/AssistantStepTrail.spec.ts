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

import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import { fakeRouter } from "../__tests__/fakeAssistant";
import { OPEN_STEP_EVENT } from "../evidence/revealStep";
import AssistantStepTrail from "./AssistantStepTrail.vue";

vi.mock("@/components/QueryEditor.vue", () => ({
  default: { props: ["query"], template: "<pre>{{ query }}</pre>" },
}));

const FROM = Date.UTC(2026, 9, 14, 8, 13);
const TO = FROM + 15 * 60_000;

const sql = 'SELECT * FROM "default"';

const blocks: ContentBlock[] = [
  {
    type: "tool_call",
    tool: "StreamList",
    call_id: "call_1",
    stepState: "done",
    summary: { count: 3, took: 120 } as any,
  },
  {
    type: "tool_call",
    tool: "StreamSchema",
    call_id: "call_2",
    stepState: "done",
    context: { stream_name: "default" },
    summary: { count: 9, took: 90 } as any,
  },
  {
    type: "tool_call",
    tool: "SearchSQL",
    call_id: "call_3",
    stepState: "done",
    callArgs: { stream_name: "default", sql, start_time: FROM * 1000, end_time: TO * 1000 },
    summary: { count: 4, took: 380 } as any,
    result: { hits: [{ a: "1" }], total: 2341 },
  },
  { type: "text", text: "answer" },
  { type: "footer", footer: { durationMs: 12_000 } },
];

const message = (list: ContentBlock[] = blocks): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: list,
});

describe("AssistantStepTrail", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountTrail = (props: Record<string, unknown>, provide: Record<symbol, unknown> = {}) =>
    mount(AssistantStepTrail, {
      props,
      attachTo: document.body,
      global: { plugins: [fakeRouter()], provide },
    });

  it("collapses a finished trail to one line with its count and duration", () => {
    const { provide, turn } = fakeEvidence();
    const wrapper = mountTrail({ message: message(), turn: turn() }, provide);
    const toggle = wrapper.get('[data-test="assistant-trail-toggle"]');
    expect(toggle.text()).toBe("Worked through 3 steps · 12 s");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-test="assistant-step-call_1"]').exists()).toBe(false);
  });

  it("lists rows from structured fields when expanded, with no uppercase", async () => {
    const { provide, turn } = fakeEvidence();
    const wrapper = mountTrail({ message: message(), turn: turn() }, provide);
    await wrapper.get('[data-test="assistant-trail-toggle"]').trigger("click");
    const rows = ["call_1", "call_2", "call_3"].map((id) =>
      wrapper.get(`[data-test="assistant-step-${id}"]`).text(),
    );
    expect(rows[0]).toBe("Listed streams · 3 streams · 120 ms");
    expect(rows[1]).toBe("Read schema for default · 9 fields · 90 ms");
    expect(rows[2]).toMatch(/^Queried default · .+–.+ · 4 rows · 380 ms$/);
  });

  it("shows a failed row under the collapsed header, in words and not green", () => {
    const { provide, turn } = fakeEvidence();
    const failed: ContentBlock = {
      type: "tool_call",
      tool: "SearchSQL",
      call_id: "e1",
      stepState: "failed",
      success: false,
      resultMessage: "Search field not found: latency",
    };
    const wrapper = mountTrail(
      { message: message([failed]), turn: turn({ outcome: "failed" }) },
      provide,
    );
    expect(wrapper.get('[data-test="assistant-trail-toggle"]').text()).toBe(
      "Worked through 1 step · 1 failed",
    );
    const row = wrapper.get('[data-test="assistant-step-e1"]');
    expect(row.text()).toBe("Query failed · Search field not found: latency");
    expect(row.attributes("aria-label")).toBe(
      "Query failed · Search field not found: latency, Failed",
    );
    expect(wrapper.get('[data-test="assistant-step-state-e1"]').attributes("data-state")).toBe(
      "failed",
    );
  });

  it("marks a stopped step interrupted with a neutral glyph, never a check", () => {
    const { provide, turn } = fakeEvidence();
    const stopped: ContentBlock = {
      type: "tool_call",
      tool: "SearchSQL",
      call_id: "c9",
      stepState: "interrupted",
      context: { stream_name: "default" },
    };
    const wrapper = mountTrail(
      { message: message([stopped]), turn: turn({ outcome: "stopped" }) },
      provide,
    );
    expect(wrapper.get('[data-test="assistant-step-c9"]').text()).toBe(
      "Queried default · stopped before it finished",
    );
    const state = wrapper.get('[data-test="assistant-step-state-c9"]');
    expect(state.attributes("data-state")).toBe("interrupted");
    expect(state.classes()).not.toContain("text-status-success-text");
  });

  it("stays open while running with the running row last", () => {
    const { provide, turn } = fakeEvidence();
    const running: ContentBlock = {
      type: "tool_call",
      tool: "SearchSQL",
      call_id: "c1",
      stepState: "running",
      context: { stream_name: "default" },
    };
    const wrapper = mountTrail(
      { message: message([blocks[0], running]), turn: turn({ outcome: "live" }) },
      provide,
    );
    expect(wrapper.get('[data-test="assistant-trail-toggle"]').text()).toBe("2 steps so far");
    expect(wrapper.get('[data-test="assistant-step-state-c1"]').attributes("data-state")).toBe(
      "running",
    );
  });

  it("lets the reader close a running trail, and keeps that choice in the session", async () => {
    const { provide, turn, store, sid } = fakeEvidence();
    const running: ContentBlock = {
      type: "tool_call",
      tool: "SearchSQL",
      call_id: "c1",
      stepState: "running",
      context: { stream_name: "default" },
    };
    const wrapper = mountTrail(
      { message: message([blocks[0], running]), turn: turn({ outcome: "live" }) },
      provide,
    );
    const toggle = wrapper.get('[data-test="assistant-trail-toggle"]');
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(store.state.sessions[sid].ui.expandedSteps).toContain("trail:t1:closed");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
  });

  it("keeps expansion in the session by call id, so another chat expands nothing", async () => {
    const { provide, turn, store, sid } = fakeEvidence();
    const wrapper = mountTrail({ message: message(), turn: turn() }, provide);
    await wrapper.get('[data-test="assistant-trail-toggle"]').trigger("click");
    await wrapper.get('[data-test="assistant-step-call_3"]').trigger("click");
    expect(store.state.sessions[sid].ui.expandedSteps).toEqual(["trail:t1", "call_3"]);
    const other = fakeEvidence();
    const second = mountTrail({ message: message(), turn: other.turn() }, other.provide);
    expect(second.get('[data-test="assistant-trail-toggle"]').attributes("aria-expanded")).toBe(
      "false",
    );
  });

  it("expands a query step to its query, window, first rows and actions", async () => {
    const { provide, turn, host } = fakeEvidence();
    const wrapper = mountTrail({ message: message(), turn: turn() }, provide);
    await wrapper.get('[data-test="assistant-trail-toggle"]').trigger("click");
    await wrapper.get('[data-test="assistant-step-call_3"]').trigger("click");
    await flushPromises();
    const body = wrapper.get('[data-test="assistant-step-body-call_3"]');
    expect(body.text()).toContain("Showing 1 of 2,341 rows");
    const open = wrapper.get('[data-test="assistant-step-open-call_3"]');
    expect(open.find("svg").exists()).toBe(false);
    await open.trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "open_in_explorer", explorer: "logs" }),
    );
  });

  it("says the owner hid the steps and expands nothing on such a share", () => {
    const wrapper = mountTrail({
      message: message(),
      readonly: true,
      turn: { ...fakeEvidence().turn(), sid: null, hiddenByOwner: true },
    });
    expect(wrapper.get('[data-test="assistant-trail-hidden"]').text()).toBe(
      "3 steps hidden by the owner",
    );
    expect(wrapper.find('[data-test="assistant-trail-toggle"]').exists()).toBe(false);
  });

  it("expands locally on a shared page when a claim opens a step", async () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const wrapper = mount(AssistantStepTrail, {
      props: { message: message(), readonly: true, turn: { ...fakeEvidence().turn(), sid: null } },
      attachTo: article,
      global: { plugins: [fakeRouter()] },
    });
    await flushPromises();
    article.dispatchEvent(new CustomEvent(OPEN_STEP_EVENT, { detail: { callId: "call_2" } }));
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-step-body-call_2"]').exists()).toBe(true);
  });

  it("opens a step from a shared page as a plain new-tab link, and offers none when not openable", async () => {
    const shared = (openable: boolean) =>
      mount(AssistantStepTrail, {
        props: {
          message: message(),
          readonly: true,
          turn: { ...fakeEvidence().turn(), sid: null, openable },
        },
        attachTo: document.body,
        global: { plugins: [fakeRouter()] },
      });
    const wrapper = shared(true);
    await wrapper.get('[data-test="assistant-trail-toggle"]').trigger("click");
    await wrapper.get('[data-test="assistant-step-call_3"]').trigger("click");
    const open = wrapper.get('[data-test="assistant-step-open-call_3"]');
    expect(open.element.tagName).toBe("A");
    expect(open.attributes("target")).toBe("_blank");
    expect(open.attributes("rel")).toContain("noopener");
    const closed = shared(false);
    await closed.get('[data-test="assistant-trail-toggle"]').trigger("click");
    await closed.get('[data-test="assistant-step-call_3"]').trigger("click");
    expect(closed.find('[data-test="assistant-step-open-call_3"]').exists()).toBe(false);
  });
});
