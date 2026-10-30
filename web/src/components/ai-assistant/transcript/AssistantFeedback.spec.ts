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

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantFeedback from "./AssistantFeedback.vue";

const done: ChatMessage = {
  role: "assistant",
  content: raw("x"),
  contentBlocks: [
    { type: "text", text: "x" },
    { type: "footer", footer: { traceId: "tr-1" } },
  ],
};

describe("AssistantFeedback", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountBar = (
    turn: Record<string, unknown> = {},
    message: ChatMessage = done,
    readonly = false,
  ) => {
    const evidence = fakeEvidence();
    const wrapper = mount(AssistantFeedback, {
      props: { message, readonly, turn: evidence.turn(turn) },
      attachTo: document.body,
      global: { provide: readonly ? {} : evidence.provide },
    });
    return { wrapper, ...evidence };
  };

  it("renders only on done, never while streaming, stopped, failed or shared", () => {
    expect(mountBar().wrapper.find('[data-test="assistant-feedback-up"]').exists()).toBe(true);
    expect(
      mountBar({ outcome: "done_not_saved" })
        .wrapper.find('[data-test="assistant-feedback-up"]')
        .exists(),
    ).toBe(true);
    for (const outcome of ["live", "stopped", "failed"])
      expect(mountBar({ outcome }).wrapper.find('[data-test="assistant-feedback"]').exists()).toBe(
        false,
      );
    expect(mountBar({}, done, true).wrapper.find('[data-test="assistant-feedback"]').exists()).toBe(
      false,
    );
    const noComplete: ChatMessage = { ...done, contentBlocks: [{ type: "text", text: "x" }] };
    expect(mountBar({}, noComplete).wrapper.find('[data-test="assistant-feedback"]').exists()).toBe(
      false,
    );
  });

  it("sends Helpful for this turn and shows it pressed with the inline thanks", async () => {
    const { wrapper, host, store, sid } = mountBar();
    host.dispatch.mockImplementationOnce(async () => {
      store.annotate(sid, "turn:t1:feedback", { feedback: { rating: "up" } });
      return { ok: true };
    });
    await wrapper.get('[data-test="assistant-feedback-up"]').trigger("click");
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(sid, {
      kind: "feedback",
      messageId: "t1",
      vote: "up",
    });
    expect(wrapper.get('[data-test="assistant-feedback-up"]').attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper.get('[data-test="assistant-feedback-thanks"]').text()).toBe(
      "Thanks for the feedback",
    );
    expect(host.announce).toHaveBeenCalledWith(sid, "Thanks for the feedback");
  });

  it("asks what went wrong on Not helpful and sends the reason with the detail", async () => {
    const { wrapper, host, sid } = mountBar();
    await wrapper.get('[data-test="assistant-feedback-down"]').trigger("click");
    await flushPromises();
    const panel = document.querySelector('[data-test="assistant-feedback-reason"]') as HTMLElement;
    expect(panel.getAttribute("role")).toBeNull();
    expect(panel.closest('[role="dialog"]')).not.toBeNull();
    expect(panel.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(panel.textContent).toContain(
      "Sends your rating, the reason and this chat's id. It never sends the chat text.",
    );
    (
      panel.querySelector('[data-test="assistant-feedback-reason-wrong_query"]') as HTMLElement
    ).click();
    await flushPromises();
    (panel.querySelector('[data-test="assistant-feedback-send"]') as HTMLElement).click();
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(sid, {
      kind: "feedback",
      messageId: "t1",
      vote: "down",
      reason: "wrong_query",
    });
  });

  it("says it couldn't send, leaves the thumb unpressed and retries the same vote", async () => {
    const { wrapper, host, sid } = mountBar();
    host.dispatch.mockResolvedValueOnce({ ok: false, reason: "failed" } as never);
    await wrapper.get('[data-test="assistant-feedback-up"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-feedback-failed"]').text()).toContain(
      "Couldn't send feedback. Try again.",
    );
    expect(wrapper.get('[data-test="assistant-feedback-up"]').attributes("aria-pressed")).toBe(
      "false",
    );
    expect(host.announce).toHaveBeenCalledWith(sid, "Couldn't send feedback. Try again.");
    await wrapper.get('[data-test="assistant-feedback-retry"]').trigger("click");
    expect(host.dispatch).toHaveBeenLastCalledWith(sid, {
      kind: "feedback",
      messageId: "t1",
      vote: "up",
    });
  });

  it("copies the chat id from the reason popover and shows its first eight characters", async () => {
    const { wrapper, host, sid } = mountBar();
    await wrapper.get('[data-test="assistant-feedback-down"]').trigger("click");
    await flushPromises();
    const copy = document.querySelector('[data-test="assistant-copy-chat-id"]') as HTMLElement;
    expect(copy.textContent).toContain(sid.slice(0, 8));
    copy.click();
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(sid, { kind: "copy", text: sid, what: "chat_id" });
    expect(host.announce).toHaveBeenCalledWith(sid, "Chat id copied");
  });
});
