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
import AssistantQueriesGroup from "./AssistantQueriesGroup.vue";

vi.mock("@/components/QueryEditor.vue", () => ({
  default: { props: ["query"], template: "<pre>{{ query }}</pre>" },
}));

const FROM = Date.UTC(2026, 9, 14, 8, 13);
const TO = FROM + 15 * 60_000;

const query = (callId: string, stream: string, stepState = "done"): ContentBlock => ({
  type: "tool_call",
  tool: "SearchSQL",
  call_id: callId,
  stepState: stepState as ContentBlock["stepState"],
  callArgs: {
    stream_name: stream,
    sql: `SELECT * FROM "${stream}"`,
    start_time: FROM * 1000,
    end_time: TO * 1000,
  },
  summary: { count: 4, took: 380 } as any,
  result: { hits: [{ a: "1" }], total: 4 },
});

const schema: ContentBlock = {
  type: "tool_call",
  tool: "StreamSchema",
  call_id: "s1",
  stepState: "done",
  context: { stream_name: "default" },
};

const message = (blocks: ContentBlock[]): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: blocks,
});

describe("AssistantQueriesGroup", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountGroup = (blocks: ContentBlock[], numbers = new Map<string, number>()) => {
    const { provide, turn, host, sid } = fakeEvidence();
    const wrapper = mount(AssistantQueriesGroup, {
      props: { message: message(blocks), numbers, turn: turn() },
      attachTo: document.body,
      global: { plugins: [fakeRouter()], provide },
    });
    return { wrapper, host, sid };
  };

  const rows = (wrapper: ReturnType<typeof mountGroup>["wrapper"]) =>
    wrapper
      .findAll('[data-test^="assistant-queries-row-"]')
      .map((row) => row.attributes("data-test")!.replace("assistant-queries-row-", ""));

  it("renders nothing when the turn ran no query", () => {
    const { wrapper } = mountGroup([schema]);
    expect(wrapper.find('[data-test="assistant-queries-group"]').exists()).toBe(false);
  });

  it("lists cited queries first by claim number, the first open, and the rest behind Show more (D3-h)", async () => {
    const numbers = new Map([
      ["q3", 1],
      ["q1", 2],
    ]);
    const { wrapper } = mountGroup([query("q1", "a"), query("q2", "b"), query("q3", "c")], numbers);
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-queries-cited"]').text()).toContain("2 cited");
    expect(rows(wrapper)).toEqual(["q3", "q1"]);
    expect(wrapper.find('[data-test="assistant-step-evidence-q3"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-step-evidence-q1"]').exists()).toBe(false);
    const more = wrapper.get('[data-test="assistant-queries-more"]');
    expect(more.text()).toBe("Show 1 more");
    await more.trigger("click");
    expect(rows(wrapper)).toEqual(["q3", "q1", "q2"]);
  });

  it("with no citation shows the first query open and never lists a failed one", async () => {
    const { wrapper } = mountGroup([query("q1", "a"), query("q2", "b", "failed")]);
    await flushPromises();
    expect(rows(wrapper)).toEqual(["q1"]);
    expect(wrapper.find('[data-test="assistant-step-evidence-q1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-queries-more"]').exists()).toBe(false);
  });

  it("says what the assistant got, and Run now opens the query in its explorer without running it", async () => {
    const { wrapper, host, sid } = mountGroup([query("q1", "a")]);
    await flushPromises();
    const evidence = wrapper.get('[data-test="assistant-step-evidence-q1"]');
    expect(evidence.get('[data-test="assistant-step-evidence-line"]').text()).toContain(
      "The assistant got 4 rows in",
    );
    const run = evidence.get('[data-test="assistant-step-evidence-run"]');
    expect(run.text()).toContain("Run now");
    await run.trigger("click");
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ kind: "open_in_explorer", explorer: "logs" }),
    );
    expect(host.dispatch).not.toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ kind: "run_query" }),
    );
  });

  it("toggles a row open and shut on its header", async () => {
    const { wrapper } = mountGroup([query("q1", "a")]);
    await flushPromises();
    const row = wrapper.get('[data-test="assistant-queries-row-q1"]');
    expect(row.attributes("aria-expanded")).toBe("true");
    await row.trigger("click");
    expect(row.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-test="assistant-step-evidence-q1"]').exists()).toBe(false);
  });
});
