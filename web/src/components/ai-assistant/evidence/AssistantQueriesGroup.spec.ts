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
import { revealStep } from "./revealStep";

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
    isAdmin?: boolean,
  ) => {
    const evidence = fakeEvidence({ isAdmin });
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

  it("shows one closed line counting the queries, their window only inside the open trail", async () => {
    const { wrapper } = mountGroup([query("a", "default"), query("b", "default")]);
    const line = wrapper.get('[data-test="assistant-queries-line"]');
    expect(line.text()).toBe("2 queries");
    expect(line.attributes("aria-expanded")).toBe("false");
    expect(line.classes()).toContain("[&&:focus-visible]:outline-offset-0!");
    expect(wrapper.find('[data-test="assistant-queries-rows"]').exists()).toBe(false);
    await line.trigger("click");
    expect(wrapper.get('[data-test="assistant-queries-range"]').text()).toMatch(
      /^Evaluated \d\d:\d\d–\d\d:\d\d$/,
    );
  });

  it("puts the answer's own line end beside the count, and renders it alone when no step ran", () => {
    const slots = { "line-end": '<span data-test="end">Copy</span>' };
    const { wrapper } = mountGroup([query("a", "default")], {}, undefined, {}, undefined);
    expect(wrapper.find('[data-test="end"]').exists()).toBe(false);
    const withEnd = mount(AssistantQueriesGroup, {
      props: { message: message([query("a", "default")]) },
      slots,
      global: { plugins: [fakeRouter([])] },
    });
    const head = withEnd.get('[data-test="assistant-queries-line"]').element.parentElement!;
    expect(head.querySelector('[data-test="end"]')).not.toBeNull();
    const alone = mount(AssistantQueriesGroup, {
      props: { message: message([]) },
      slots,
      global: { plugins: [fakeRouter([])] },
    });
    expect(alone.find('[data-test="end"]').exists()).toBe(true);
    expect(alone.find('[data-test="assistant-queries-line"]').exists()).toBe(false);
    expect(alone.get('[data-test="assistant-queries-group"]').attributes("role")).toBeUndefined();
    expect(mountGroup([]).wrapper.find('[data-test="assistant-queries-group"]').exists()).toBe(
      false,
    );
  });

  it("draws a step with nothing to open as a plain row, its tool named in words", async () => {
    const listed: ContentBlock = {
      type: "tool_call",
      tool: "ListIncidents",
      call_id: "l1",
      stepState: "done",
    };
    const custom: ContentBlock = { ...listed, tool: "o2_GetWidgetHistory", call_id: "l2" };
    const { wrapper } = mountGroup([listed, custom, query("a", "default")]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    const plain = wrapper.get('[data-test="assistant-queries-row-l1"]');
    expect(plain.text()).toContain("Listed incidents");
    expect(plain.find("button").exists()).toBe(false);
    expect(plain.find('[data-step-header="l1"]').attributes("tabindex")).toBe("-1");
    expect(wrapper.get('[data-test="assistant-queries-row-l2"]').text()).toContain(
      "Ran get widget history",
    );
    expect(wrapper.get('[data-test="assistant-queries-row-a"]').find("button").exists()).toBe(true);
  });

  it("opens to numbered rows that read each query from its start, with the row count and the table only when it differs", async () => {
    const { wrapper } = mountGroup([
      query("a", "default"),
      query("b", "default"),
      query("c", "other"),
    ]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    const row = wrapper.get('[data-test="assistant-queries-row-a"]');
    const head = row.get('[data-test="o-truncated-text"]');
    expect(head.text()).toBe(
      `SELECT count(*) FROM "default" WHERE service='cart' AND status>=500 GROUP BY default`,
    );
    expect(head.classes()).toContain("truncate");
    expect(head.attributes("dir")).toBeUndefined();
    expect(head.attributes("style") ?? "").not.toContain("direction");
    expect(row.get('[data-test="assistant-queries-count-a"]').text()).toBe("4 rows");
    expect(wrapper.get('[data-test="assistant-queries-row-c"]').text()).toContain("other");
  });

  it("reads a multi-line query on one line from its SELECT", async () => {
    const long = query("m", "default");
    long.callArgs = {
      ...long.callArgs,
      sql: `SELECT service, count(*)\n  FROM "default"\n  WHERE status>=500\n  GROUP BY service`,
    };
    const { wrapper } = mountGroup([long, query("b", "default")]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    const row = wrapper.get('[data-test="assistant-queries-row-m"]');
    const head = row.get('[data-test="o-truncated-text"]');
    expect(head.text()).toBe(
      `SELECT service, count(*) FROM "default" WHERE status>=500 GROUP BY service`,
    );
    expect(head.text().startsWith("SELECT")).toBe(true);
    expect(head.classes()).toContain("truncate");
  });

  it("keeps a step that ran no query as its own row, so nothing the agent did is lost", async () => {
    const { wrapper } = mountGroup([schema, query("a", "default")]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    expect(wrapper.find('[data-test="assistant-queries-row-s1"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-queries-line"]').text()).toBe("2 steps");
  });

  it("folds every schema read into one row and counts the rows it opens to", async () => {
    const second: ContentBlock = { ...schema, call_id: "s2", context: { stream_name: "other" } };
    const { wrapper } = mountGroup([schema, second, query("a", "default")]);
    await wrapper.get('[data-test="assistant-queries-line"]').trigger("click");
    const rows = wrapper.findAll('[data-test^="assistant-queries-row-"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Read schema for default, other");
    expect(rows[0].find('[data-step-header="s2"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-queries-line"]').text()).toBe("2 steps");
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

  it("lands a citation of the second folded schema read on the visible plain row", async () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const evidence = fakeEvidence();
    const second: ContentBlock = { ...schema, call_id: "s2", context: { stream_name: "other" } };
    mount(AssistantQueriesGroup, {
      props: { message: message([schema, second, query("a", "default")]), turn: evidence.turn() },
      attachTo: article,
      global: {
        plugins: [fakeRouter([{ path: "/logs", name: "logs", component: { render: () => null } }])],
        provide: evidence.provide,
      },
    });
    await flushPromises();
    expect(await revealStep(article, "s2")).toBe(true);
    await flushPromises();
    const visible = article.querySelector<HTMLElement>('[data-step-header="s1"]')!;
    expect(visible.hidden).toBe(false);
    expect(document.activeElement).toBe(visible);
    expect(visible.classList.contains("ring-2")).toBe(true);
    expect(article.querySelector('[data-step-header="s2"]')!.classList.contains("ring-2")).toBe(
      false,
    );
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

  it("offers Ask an admin to a member, never to an admin", () => {
    const member = mountGroup([query("a", "app_logs")], { unavailable: 1 }, undefined, {}, false);
    const line = (wrapper: typeof member.wrapper) =>
      wrapper.get('[data-test="assistant-queries-no-access"]').text();
    expect(line(member.wrapper)).toContain("·");
    const admin = mountGroup([query("a", "app_logs")], { unavailable: 1 });
    expect(line(admin.wrapper)).toBe("1 citation unavailable: no access to app_logs");
  });
});
