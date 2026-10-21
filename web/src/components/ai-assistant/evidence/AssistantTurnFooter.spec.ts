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
import { afterEach, describe, expect, it } from "vitest";
import { computed } from "vue";

import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";

import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantTurnFooter from "./AssistantTurnFooter.vue";

const FROM = Date.UTC(2026, 9, 14, 8, 13);
const TO = FROM + 15 * 60_000;

const query = (id: string, from = FROM, to = TO): ContentBlock => ({
  type: "tool_call",
  tool: "SearchSQL",
  call_id: id,
  stepState: "done",
  callArgs: {
    stream_name: "default",
    sql: "SELECT 1",
    start_time: from * 1000,
    end_time: to * 1000,
  },
});

const answer = (blocks: ContentBlock[], footer: ContentBlock["footer"] = {}): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: [...blocks, { type: "text", text: "x" }, { type: "footer", footer }],
});

const prompt: ChatMessage = {
  role: "user",
  content: raw("why"),
  chips: [
    {
      id: "page:timeRange",
      kind: "time",
      label: raw("Time · 13:43–13:58"),
      ref: { type: "time", org: "default", from: FROM, to: TO },
      sizeBytes: 0,
      provenance: "page",
      sent: "whitelist",
    },
    {
      id: "page:stream",
      kind: "stream",
      label: raw("Stream · default"),
      sizeBytes: 0,
      provenance: "page",
      sent: "whitelist",
    },
  ],
};

describe("AssistantTurnFooter", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountFooter = (
    message: ChatMessage,
    turn: Record<string, unknown> = {},
    evidenceOver: Parameters<typeof fakeEvidence>[0] = {},
    readonly = false,
  ) => {
    const evidence = fakeEvidence(evidenceOver);
    const wrapper = mount(AssistantTurnFooter, {
      props: { message, readonly, turn: evidence.turn({ prompt, ...turn }) },
      attachTo: document.body,
      global: { provide: readonly ? {} : evidence.provide },
    });
    return { wrapper, ...evidence };
  };

  it("states the evaluated window, the query count, the flat credit on Cloud and Re-run", async () => {
    const { wrapper, host } = mountFooter(
      answer([query("c3")]),
      {},
      { creditMode: "pay_as_you_go" },
    );
    const line = wrapper.get('[data-test="assistant-turn-footer"]');
    expect(line.text()).toMatch(/^Evaluated .+–.+ UTC·1 query·1 credit\s?Re-run for now$/);
    await wrapper.get('[data-test="assistant-rerun"]').trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "rerun_now",
      turnId: "t1",
    });
  });

  it("holds Re-run with the reason while another tab locks the chat", async () => {
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => false),
        turnLock: () => "approval_elsewhere",
      },
    } as never);
    const { wrapper, host } = mountFooter(answer([query("c3")]));
    const rerun = wrapper.get('[data-test="assistant-rerun"]');
    expect(rerun.attributes("aria-disabled")).toBe("true");
    expect(wrapper.text()).toContain("Another tab is waiting for your approval on this chat.");
    await rerun.trigger("click");
    expect(host.dispatch).not.toHaveBeenCalled();
    setRuntimeHandle(null);
  });

  it("hides Re-run while another turn of the chat runs", async () => {
    const { wrapper, store, sid } = mountFooter(answer([query("c3")]));
    expect(wrapper.find('[data-test="assistant-rerun"]').exists()).toBe(true);
    store.state.sessions[sid].turn = { state: "connecting" } as never;
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-rerun"]').exists()).toBe(false);
  });

  it("opens the credits note as a popover a touch can reach", async () => {
    const { wrapper } = mountFooter(answer([query("c3")]), {}, { creditMode: "pay_as_you_go" });
    const credits = wrapper.get('[data-test="assistant-turn-footer-credits"]');
    expect(credits.element.tagName).toBe("BUTTON");
    await credits.trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("Credits are counted when a request is accepted.");
  });

  it("never shows credits off Cloud and says included credits on the free mode", () => {
    expect(
      mountFooter(answer([query("c3")]))
        .wrapper.find('[data-test="assistant-turn-footer-credits"]')
        .exists(),
    ).toBe(false);
    const free = mountFooter(
      answer([query("c3")], { usage: { totalTokens: 18954, llmCalls: 3 } }),
      {},
      { creditMode: "free" },
    );
    expect(free.wrapper.get('[data-test="assistant-turn-footer-credits"]').text()).toBe(
      "1 included credit",
    );
  });

  it("charges a failed turn that ran no query, and says refunded only on a server count of 0", () => {
    const failed = mountFooter(answer([]), { outcome: "failed" }, { creditMode: "free" });
    expect(failed.wrapper.get('[data-test="assistant-turn-footer-credits"]').text()).toBe(
      "1 included credit",
    );
    expect(failed.wrapper.find('[data-test="assistant-turn-footer-no-query"]').exists()).toBe(
      false,
    );
    const refunded = mountFooter(
      answer([], { usage: { credits: 0 } }),
      { outcome: "failed" },
      { creditMode: "pay_as_you_go" },
    );
    expect(refunded.wrapper.get('[data-test="assistant-turn-footer-credits"]').text()).toBe(
      "0 credits · refunded",
    );
  });

  it("names several windows as one sentence that opens the list", () => {
    const { wrapper } = mountFooter(answer([query("c2"), query("c3", FROM - 3_600_000, TO)]));
    expect(wrapper.get('[data-test="assistant-turn-footer-windows"]').text()).toMatch(
      /and 1 other window$/,
    );
  });

  it("says it answered without a query and offers no Re-run", () => {
    const { wrapper } = mountFooter(answer([]));
    expect(wrapper.get('[data-test="assistant-turn-footer-no-query"]').text()).toBe(
      "Answered without running a query",
    );
    expect(wrapper.find('[data-test="assistant-rerun"]').exists()).toBe(false);
  });

  it("adds stopped to a stopped turn and not saved with its reason", () => {
    const stopped = mountFooter(
      { ...answer([query("c3")]), contentBlocks: [query("c3")] },
      { outcome: "stopped" },
    );
    expect(stopped.wrapper.get('[data-test="assistant-turn-footer-stopped"]').text()).toBe(
      "stopped",
    );
    const notSaved = mountFooter(answer([query("c3")], { persisted: false }));
    expect(notSaved.wrapper.get('[data-test="assistant-turn-footer-not-saved"]').text()).toBe(
      "not saved",
    );
  });

  it("disables Re-run with the credits reason when credits are used up", () => {
    const { wrapper } = mountFooter(answer([query("c3")]), {}, { creditMode: "exhausted" });
    expect(wrapper.get('[data-test="assistant-rerun"]').attributes("aria-disabled")).toBe("true");
  });

  it("lists what was sent without a used list, and what was used with one", () => {
    const sent = mountFooter(answer([query("c3")]));
    const line = sent.wrapper.get('[data-test="assistant-turn-context-used"]');
    expect(line.attributes("aria-label")).toBe("Context used");
    expect(line.findAll(".rounded-default, [data-test]").length).toBeGreaterThanOrEqual(0);
    expect(line.text()).toBe("Sent:Time · 13:43–13:58Stream · default");
    const used = mountFooter(answer([query("c3")], { contextUsed: ["page:stream"] }));
    expect(used.wrapper.get('[data-test="assistant-turn-context-used"]').text()).toBe(
      "Used:Stream · default",
    );
    const none = mountFooter(answer([query("c3")], { contextUsed: [] }));
    expect(none.wrapper.get('[data-test="assistant-turn-context-used"]').text()).toBe(
      "Used:No page context was used",
    );
  });

  it("is absent while the turn runs and on a shared page has no Re-run or credits", () => {
    expect(mountFooter(answer([query("c3")]), { outcome: "live" }).wrapper.html()).toBe(
      "<!--v-if-->",
    );
    const shared = mountFooter(
      answer([query("c3")]),
      { sid: null },
      { creditMode: "pay_as_you_go" },
      true,
    );
    expect(shared.wrapper.find('[data-test="assistant-rerun"]').exists()).toBe(false);
    expect(shared.wrapper.find('[data-test="assistant-turn-footer-credits"]').exists()).toBe(false);
  });
});
