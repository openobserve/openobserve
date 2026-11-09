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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import { raw } from "@/types/i18n";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import AssistantMessageActions, { COPIED_MS } from "./AssistantMessageActions.vue";
import { setMarkdownParserForTests, syncMarkdownParserForTests } from "./markdown";

const { fake, copy, track, branch } = vi.hoisted(() => ({
  fake: { current: null as any },
  copy: vi.fn(),
  track: vi.fn(),
  branch: vi.fn(),
}));

vi.mock("./useBranchChat", async () => {
  const { ref } = await import("vue");
  return { useBranchChat: () => ({ pending: ref(false), branch }) };
});

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: (...args: unknown[]) => copy(...args) }));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: (...args: unknown[]) => track(...args),
}));

const prompt: ChatMessage = { role: "user", content: raw("why 5xx?"), sentAt: 0, turnId: "t1" };
const answer: ChatMessage = {
  role: "assistant",
  content: raw(""),
  contentBlocks: [
    {
      type: "tool_call",
      tool: "SearchSQL",
      message: raw("Querying default"),
      context: { stream_name: "default" },
      stepState: "done",
    },
    { type: "text", text: "## Checkout 5xx spike\n\nThe **cart** failed." },
  ],
};

function mountActions(props: Record<string, unknown>) {
  return mount(AssistantMessageActions, {
    props: { sid: fake.current.sid, isLast: true, ...props },
    attachTo: document.body,
  });
}

describe("AssistantMessageActions", () => {
  beforeEach(() => {
    setMarkdownParserForTests(syncMarkdownParserForTests);
    fake.current = fakeAssistant();
    fake.current.sid = fake.current.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    copy.mockReset().mockResolvedValue(true);
    track.mockReset();
    document.body.innerHTML = "";
  });

  it("copies the answer as plain text and shows Copied for a moment (EB-09 AC 1, AC 5)", async () => {
    vi.useFakeTimers();
    const wrapper = mountActions({ message: answer });
    const button = wrapper.get('[data-test="assistant-msg-copy-answer"]');
    expect(button.text()).toBe("");
    expect(button.attributes("aria-label")).toBe("Copy answer");
    await button.trigger("click");
    await flushPromises();
    expect(copy.mock.calls[0][0]).toBe("Checkout 5xx spike\n\nThe cart failed.");
    expect(track).toHaveBeenCalledWith("ai_thread_action", { action: "copy_answer" });
    expect(button.attributes("aria-label")).toBe("Copied");
    vi.advanceTimersByTime(COPIED_MS);
    await flushPromises();
    expect(button.attributes("aria-label")).toBe("Copy answer");
    vi.useRealTimers();
  });

  it("adds an icon-only Re-run on the latest answer that resends the prompt (H5)", async () => {
    const regenerate = vi
      .spyOn(fake.current.store, "regenerate")
      .mockResolvedValue({ state: "done", saved: "server" });
    const wrapper = mountActions({ message: answer, prompt });
    const ids = [
      ...wrapper.get('[data-test="assistant-msg-actions"]').element.querySelectorAll("[data-test]"),
    ].map((el) => el.getAttribute("data-test"));
    expect(ids).toEqual(["assistant-msg-copy-answer", "assistant-msg-regenerate"]);
    const rerun = wrapper.get('[data-test="assistant-msg-regenerate"]');
    expect(rerun.text()).toBe("");
    expect(rerun.attributes("aria-label")).toBe("Re-run");
    await rerun.trigger("click");
    expect(regenerate).toHaveBeenCalledWith(fake.current.sid);
    expect(track).toHaveBeenCalledWith("ai_thread_action", { action: "regenerate" });
    for (const props of [{ isLast: false }, { canRegenerate: false }, { prompt: null }])
      expect(
        mountActions({ message: answer, prompt, ...props })
          .find('[data-test="assistant-msg-regenerate"]')
          .exists(),
      ).toBe(false);
  });

  it("re-runs a stale answer once, over its range ending now, never as a regenerate", async () => {
    const dispatch = vi.spyOn(fake.current.store, "dispatch").mockResolvedValue({} as never);
    const regenerate = vi.spyOn(fake.current.store, "regenerate");
    const fresh = { turnId: "t1", range: raw("08:00–08:15") };
    const wrapper = mountActions({ message: answer, prompt, fresh, canRegenerate: false });
    expect(wrapper.find('[data-test="assistant-msg-regenerate"]').exists()).toBe(false);
    const rerun = wrapper.get('[data-test="assistant-rerun"]');
    expect(rerun.attributes("aria-label")).toBe("Re-run for 08:00–08:15");
    await rerun.trigger("click");
    expect(dispatch).toHaveBeenCalledWith(fake.current.sid, { kind: "rerun_now", turnId: "t1" });
    expect(regenerate).not.toHaveBeenCalled();
    expect(
      mountActions({ message: answer, prompt, fresh, isLast: false })
        .find('[data-test="assistant-rerun"]')
        .exists(),
    ).toBe(false);
  });

  it("disables Re-run with the credits or sign-out reason, Copy still works (EB-09 AC 8)", () => {
    const base = fake.current.capability.value;
    fake.current.capability.value = { ...base, creditMode: "exhausted" };
    const bar = mountActions({ message: answer, prompt });
    expect(bar.get('[data-test="assistant-msg-regenerate"]').attributes("aria-disabled")).toBe(
      "true",
    );
    expect(bar.text()).toContain("AI credits are used up for this organization");
    expect(
      bar.get('[data-test="assistant-msg-copy-answer"]').attributes("aria-disabled"),
    ).toBeUndefined();
    fake.current.capability.value = base;
    setRuntimeHandle({
      lifecycle: { signedOutElsewhere: computed(() => true), turnLock: () => "signed_out" },
    } as never);
    expect(mountActions({ message: answer, prompt }).text()).toContain(
      "You signed out in another tab.",
    );
    setRuntimeHandle(null);
  });

  it("keeps an older answer's row in place and in the Tab order, shown on hover or focus, always on touch (`30` §8)", () => {
    const row = (props: Record<string, unknown>) =>
      mountActions({ message: answer, ...props }).get('[data-test="assistant-msg-actions"]');
    expect(row({}).classes()).toContain("flex");
    expect(row({}).classes()).not.toContain("opacity-0");
    const older = row({ isLast: false });
    expect(older.classes()).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover/message:opacity-100",
        "group-focus-within/message:opacity-100",
        "pointer-coarse:opacity-100",
      ]),
    );
    expect(older.classes()).not.toContain("sr-only");
    expect(older.get('[data-test="assistant-msg-copy-answer"]').attributes("tabindex")).not.toBe(
      "-1",
    );
  });

  describe("the full answer row", () => {
    const spoken: { onboundary?: (e: { charIndex: number }) => void }[] = [];
    beforeEach(() => {
      spoken.length = 0;
      vi.stubGlobal("speechSynthesis", {
        speak: (u: (typeof spoken)[number]) => spoken.push(u),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      });
      vi.stubGlobal(
        "SpeechSynthesisUtterance",
        class {
          constructor(public text: string) {}
        },
      );
      branch.mockReset().mockResolvedValue(null);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("orders Copy, Read aloud, Share link, Regenerate, the stepper, Branch", () => {
      const wrapper = mount(AssistantMessageActions, {
        props: { sid: fake.current.sid, isLast: true, message: answer, prompt, turnId: "t1" },
        slots: { versions: '<span data-test="stepper" />' },
      });
      const ids = [
        ...wrapper
          .get('[data-test="assistant-msg-actions"]')
          .element.querySelectorAll("[data-test]"),
      ].map((el) => el.getAttribute("data-test"));
      expect(ids).toEqual([
        "assistant-msg-copy-answer",
        "assistant-msg-read-aloud",
        "assistant-msg-share-link",
        "assistant-msg-regenerate",
        "stepper",
        "assistant-msg-branch",
      ]);
    });

    it("reads aloud: Pause shows on, a progress bar runs under the row", async () => {
      const wrapper = mountActions({ message: answer, turnId: "t1" });
      const button = wrapper.get('[data-test="assistant-msg-read-aloud"]');
      expect(button.attributes("aria-label")).toBe("Read aloud");
      await button.trigger("click");
      await flushPromises();
      expect(button.attributes("aria-label")).toBe("Pause");
      expect(button.attributes("data-on")).toBe("true");
      spoken[0].onboundary?.({ charIndex: 10 });
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-msg-read-progress"]').exists()).toBe(true);
      expect(track).toHaveBeenCalledWith("ai_read_aloud", { action: "start" });
      await button.trigger("click");
      await flushPromises();
      expect(track).toHaveBeenCalledWith("ai_read_aloud", { action: "stop" });
    });

    it("copies the answer's link and says Link copied in place for 2 s", async () => {
      vi.useFakeTimers();
      const wrapper = mountActions({ message: answer, turnId: "t1" });
      await wrapper.get('[data-test="assistant-msg-share-link"]').trigger("click");
      await flushPromises();
      expect(String(copy.mock.calls[0][0])).toContain("#answer-t1");
      expect(track).toHaveBeenCalledWith("ai_answer_link", { result: "copied" });
      const done = wrapper.get('[data-test="assistant-msg-share-link"]');
      expect(done.attributes("data-done")).toBe("true");
      expect(done.text()).toContain("Link copied");
      vi.advanceTimersByTime(COPIED_MS);
      await flushPromises();
      expect(wrapper.get('[data-test="assistant-msg-share-link"]').attributes("data-done")).toBe(
        undefined,
      );
      vi.useRealTimers();
    });

    it("branches at the shown answer's own server id, else at the turn and the version shown", async () => {
      const message: ChatMessage = {
        ...answer,
        contentBlocks: [
          ...answer.contentBlocks!,
          { type: "footer", footer: { serverTurnId: "srv-1" } },
        ],
      };
      const version = { current: 1, count: 2 };
      const own = mountActions({ message, turnId: "t1", version });
      await own.get('[data-test="assistant-msg-branch"]').trigger("click");
      expect(branch).toHaveBeenLastCalledWith({ sid: fake.current.sid, turnId: "srv-1" });
      const stored = mountActions({ message: answer, turnId: "t1", version });
      await stored.get('[data-test="assistant-msg-branch"]').trigger("click");
      expect(branch).toHaveBeenLastCalledWith({ sid: fake.current.sid, turnId: "t1", version: 1 });
    });
  });

  it("gives a sent message Copy and Edit; Edit puts its words back in the composer", async () => {
    const stage = vi.spyOn(fake.current.store, "stage");
    const wrapper = mountActions({ message: prompt, variant: "prompt" });
    const row = wrapper.get('[data-test="assistant-msg-actions"]');
    expect(row.findAll("[data-test]").map((el) => el.attributes("data-test"))).toEqual([
      "assistant-msg-copy-prompt",
      "assistant-msg-edit",
    ]);
    await row.get('[data-test="assistant-msg-copy-prompt"]').trigger("click");
    await flushPromises();
    expect(copy.mock.calls[0][0]).toBe("why 5xx?");
    await row.get('[data-test="assistant-msg-edit"]').trigger("click");
    expect(stage).toHaveBeenCalledWith(fake.current.sid, {
      text: "why 5xx?",
      chips: [],
      mode: "replace",
    });
  });
});
