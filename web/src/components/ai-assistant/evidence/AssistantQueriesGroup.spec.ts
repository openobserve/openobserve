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

import { turnAnnotationKey } from "@/composables/assistant/pure";

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
    sql: `SELECT count(*) FROM "${stream}" WHERE service='cart' AND status>=500 GROUP BY ${stream}`,
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

  const mountGroup = (
    blocks: ContentBlock[],
    props: Record<string, unknown> = {},
    annotate?: (evidence: ReturnType<typeof fakeEvidence>) => void,
    turn: Record<string, unknown> = {},
  ) => {
    const evidence = fakeEvidence();
    annotate?.(evidence);
    const wrapper = mount(AssistantQueriesGroup, {
      props: { message: message(blocks), turn: evidence.turn(turn), ...props },
      attachTo: document.body,
      global: {
        plugins: [fakeRouter([{ path: "/logs", name: "logs", component: { render: () => null } }])],
        provide: evidence.provide,
      },
    });
    return { wrapper, ...evidence };
  };

  it("shows one closed line naming the queries and their window", () => {
    const { wrapper } = mountGroup([query("a", "default"), query("b", "default")]);
    const line = wrapper.get('[data-test="assistant-queries-line"]');
    expect(line.text()).toMatch(/^2 queries, \d\d:\d\d–\d\d:\d\d$/);
    expect(line.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-test="assistant-queries-rows"]').exists()).toBe(false);
  });

  it("opens to numbered rows with the SQL fragment and the row count, the table only when it differs", async () => {
    const { wrapper } = mountGroup([
      query("a", "default"),
      query("b", "default"),
      query("c", "other"),
    ]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    const row = wrapper.get('[data-test="assistant-queries-row-a"]');
    expect(row.text()).toContain("status>=500 GROUP BY default");
    expect(row.text()).not.toContain("service='cart'");
    expect(row.get('[data-test="assistant-queries-count-a"]').text()).toBe("4 rows");
    expect(row.text()).not.toContain("default ");
    expect(wrapper.get('[data-test="assistant-queries-row-c"]').text()).toContain("other");
  });

  it("keeps a step that ran no query as its own row, so nothing the agent did is lost", async () => {
    const { wrapper } = mountGroup([schema, query("a", "default")]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    expect(wrapper.find('[data-test="assistant-queries-row-s1"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-queries-line"]').text()).toMatch(/^1 query, /);
  });

  it("opens a citation's line when the answer asks for that step, and leaves the row closed", async () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const evidence = fakeEvidence();
    const wrapper = mount(AssistantQueriesGroup, {
      props: { message: message([query("a", "default")]), turn: evidence.turn() },
      attachTo: article,
      global: {
        plugins: [fakeRouter([{ path: "/logs", name: "logs", component: { render: () => null } }])],
        provide: evidence.provide,
      },
    });
    await flushPromises();
    article.dispatchEvent(new CustomEvent("o2-assistant-open-step", { detail: { callId: "a" } }));
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-queries-rows"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-queries-body-a"]').exists()).toBe(false);
  });

  it("offers the wider window on the line after an empty default window, and only the click sends", async () => {
    const empty: ContentBlock = {
      ...query("a", "default"),
      summary: { count: 0, took: 1 } as never,
      result: { hits: [], total: 0 },
    };
    const { wrapper, host, sid } = mountGroup([empty], {}, (evidence) =>
      evidence.store.annotate(evidence.sid, turnAnnotationKey("t1", "window"), {
        homeDefaultWindow: true,
      }),
    );
    const offer = wrapper.get('[data-test="assistant-rerun-wider"]');
    expect(host.dispatch).not.toHaveBeenCalled();
    await offer.trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(sid, { kind: "rerun_wider", turnId: "t1" });
  });

  it("explains unavailable citations under the line, and shows nothing but a count when the owner hid them", () => {
    const { wrapper } = mountGroup([query("a", "app_logs")], { unavailable: 2, readonly: true });
    expect(wrapper.get('[data-test="assistant-queries-no-access"]').text()).toContain(
      "2 citations unavailable: no access to app_logs",
    );
    const hidden = mountGroup([query("a", "default")], {}, undefined, { hiddenByOwner: true });
    expect(hidden.wrapper.find('[data-test="assistant-trail-hidden"]').exists()).toBe(true);
    expect(hidden.wrapper.find('[data-test="assistant-queries-line"]').exists()).toBe(false);
  });
});
