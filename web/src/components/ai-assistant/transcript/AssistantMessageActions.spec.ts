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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import { raw } from "@/types/i18n";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import AssistantMessageActions, { COPIED_MS } from "./AssistantMessageActions.vue";
import { setMarkdownParserForTests, syncMarkdownParserForTests } from "./markdown";

const { fake, copy, track } = vi.hoisted(() => ({
  fake: { current: null as any },
  copy: vi.fn(),
  track: vi.fn(),
}));

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
    const ids = [...wrapper.element.querySelectorAll("[data-test]")].map((el) =>
      el.getAttribute("data-test"),
    );
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

  it("keeps an older answer's row in the Tab order but out of the layout until hover or focus, never on a coarse pointer (`30` §8)", () => {
    expect(mountActions({ message: answer }).classes()).toContain("flex");
    expect(mountActions({ message: answer }).classes()).not.toContain("sr-only");
    const older = mountActions({ message: answer, isLast: false });
    expect(older.classes()).toEqual(
      expect.arrayContaining([
        "sr-only",
        "group-hover/message:not-sr-only",
        "group-focus-within/message:not-sr-only",
        "pointer-coarse:not-sr-only",
      ]),
    );
    expect(older.classes()).not.toContain("hidden");
    expect(older.get('[data-test="assistant-msg-copy-answer"]').attributes("tabindex")).not.toBe(
      "-1",
    );
  });
});
