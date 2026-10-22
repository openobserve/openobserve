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

import type { ContextChip, PendingApproval } from "@/composables/assistant";
import { runEscapeLadder } from "@/composables/assistant/shortcuts";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { queryClient } from "@/composables/query/queryClient";
import { alertKeys } from "@/services/alerts.querykeys";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";
import AssistantComposer, {
  PREFILL_CHOICE_CHARS,
  type AssistantComposerProps,
} from "./AssistantComposer.vue";
import { composerUi, noteDraftCleared, resetComposerUiForTests } from "./composerUi";

const { fake, breakpoint } = vi.hoisted(() => ({
  fake: { current: null as any },
  breakpoint: { md: true },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));
vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const { computed } = await import("vue");
  const real = (await importOriginal<typeof import("@/composables/useBreakpoint")>()).default;
  return { default: () => ({ ...real(), mdUp: computed(() => breakpoint.md) }) };
});
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

const ROW: ContextChip = {
  id: "row-1",
  kind: "log_row",
  label: raw("Log row · cart · 13:57"),
  data: { level: "error" },
  sizeBytes: 17,
  provenance: "door",
  sent: "serialized",
};

function setup(props: Partial<AssistantComposerProps> = {}, withSession = true) {
  fake.current = fakeAssistant();
  const store = fake.current.store;
  const sid = withSession
    ? store.createSession({
        origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      })
    : null;
  const send = vi.spyOn(store, "send").mockResolvedValue({ state: "done", saved: "server" });
  const host = document.createElement("div");
  host.setAttribute("data-assistant-root", "");
  host.innerHTML =
    '<span data-assistant-chip><button data-test="assistant-context-chip-button">chip</button><button data-test="assistant-context-chip-remove">x</button></span><div></div>';
  document.body.appendChild(host);
  const wrapper = mount(AssistantComposer, {
    props: { sid, ...props },
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: host.lastElementChild as HTMLElement,
  });
  const textarea = () => wrapper.get<HTMLTextAreaElement>('[data-test="assistant-composer-field"]');
  const status = () => wrapper.get('[data-test="assistant-composer-status"]').text();
  return { wrapper, store, sid: sid!, send, textarea, status, host };
}

function seedMentionGroups(): void {
  queryClient.clear();
  queryClient.setQueryData(streamKeys.nameList("default", "logs"), [{ name: "checkout" }]);
  queryClient.setQueryData(streamKeys.nameList("default", "metrics"), []);
  queryClient.setQueryData(streamKeys.nameList("default", "traces"), []);
  queryClient.setQueryData(alertKeys.list("default", "default", undefined, undefined), []);
  queryClient.setQueryData(pipelineKeys.list("default"), []);
  queryClient.setQueryData(dashboardKeys.byFolder("default", "default"), []);
}

async function type(textarea: ReturnType<ReturnType<typeof setup>["textarea"]>, value: string) {
  await textarea.setValue(value);
  await flushPromises();
}

beforeEach(() => {
  breakpoint.md = true;
  sessionStorage.clear();
  localStorage.clear();
  resetComposerUiForTests();
  vi.mocked(trackAssistant).mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("names and regions (CT-08)", () => {
  it("names the textbox, masks the composer and owns one polite status region", () => {
    const { wrapper, textarea } = setup();
    expect(textarea().attributes("aria-label")).toBe("Message O2 Assistant");
    expect(textarea().attributes("aria-multiline")).toBe("true");
    expect(textarea().attributes("aria-placeholder")).toBe(textarea().attributes("placeholder"));
    expect(textarea().attributes("data-assistant-composer")).toBe("");
    expect(wrapper.get('[data-test="assistant-composer-root"]').attributes("data-dd-privacy")).toBe(
      "mask",
    );
    const region = wrapper.get('[data-test="assistant-composer-status"]');
    expect(region.attributes()).toMatchObject({ role: "status", "aria-live": "polite" });
  });

  it("grows the field to a 2.75 rem target below md and on coarse pointers", () => {
    const { textarea } = setup();
    expect(textarea().classes()).toEqual(
      expect.arrayContaining(["max-md:min-h-11", "pointer-coarse:min-h-11"]),
    );
  });

  it("uses the static name as the placeholder while the welcome offers a ghost (IW-06 AC 1)", () => {
    const { textarea } = setup({
      ghost: { label: raw("Why errors?"), text: "Why errors?", chips: [] },
    });
    expect(textarea().attributes("placeholder")).toBe("Message O2 Assistant");
  });

  it("teaches scope with the default range when the page has no stream (CT-01 AC 10)", () => {
    const { textarea } = setup();
    expect(textarea().attributes("placeholder")).toBe("Ask a question or add context with @");
  });
});

describe("states (`40` §1.3)", () => {
  it("is empty with Send aria-disabled and a reason, then a draft with Send enabled (CT-09 AC 6)", async () => {
    const { wrapper, textarea } = setup();
    expect(wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe("empty");
    const sendButton = () => wrapper.get('[data-test="assistant-send"]');
    expect(sendButton().attributes("aria-disabled")).toBe("true");
    await type(textarea(), "why?");
    expect(wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe("draft");
    expect(sendButton().attributes("aria-disabled")).toBeUndefined();
  });

  it("counts a chip alone as a message", async () => {
    const { wrapper, store, sid } = setup();
    store.addChip(sid, ROW);
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBeUndefined();
  });

  it("puts Stop in the Send slot while running and keeps the draft editable (CT-09 AC 4–5)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    const stop = vi.spyOn(store, "stop").mockResolvedValue();
    store.state.sessions[sid].turn = { state: "connecting" } as never;
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-send"]').exists()).toBe(false);
    expect(textarea().attributes("readonly")).toBeUndefined();
    await type(textarea(), "next one");
    await wrapper.get('[data-test="assistant-stop"]').trigger("click");
    expect(stop).toHaveBeenCalledWith(sid);
    expect(store.state.sessions[sid].composer.text).toBe("next one");
    await flushPromises();
    expect(document.activeElement).toBe(textarea().element);
  });

  it("holds Send with the reason while a retry_after counts down (U16)", async () => {
    const reason = raw("Wait for the Retry countdown to end.");
    const { wrapper, textarea, send } = setup({ cooldownReason: reason });
    await type(textarea(), "again");
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBe("true");
    await textarea().trigger("keydown", { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    await wrapper.setProps({ cooldownReason: undefined });
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBeUndefined();
  });

  it("says why when a lock lands between render and click, keeps the draft, and sends once it lifts", async () => {
    const { wrapper, store, sid, textarea, send, status } = setup();
    let lock: "approval_elsewhere" | null = "approval_elsewhere";
    vi.spyOn(store, "turnLockOf").mockImplementation(() => lock);
    send.mockResolvedValueOnce({
      state: "refused",
      error: {
        code: "approval_elsewhere",
        phase: "pre_admission",
        retryable: false,
        action: "none",
      },
    });
    await type(textarea(), "why 5xx?");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    const line = "Another tab is waiting for your approval on this chat. Decide there first.";
    expect(wrapper.get('[data-test="assistant-composer-helper"]').text()).toBe(line);
    expect(status()).toContain(line);
    expect(store.state.sessions[sid].composer.text).toBe("why 5xx?");
    lock = null;
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("is inert under an approval card: readonly, aria-disabled, the reason as helper (CT-07)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe("inert");
    expect(textarea().attributes("readonly")).toBeDefined();
    expect(textarea().attributes("aria-disabled")).toBe("true");
    const helper = wrapper.get('[data-test="assistant-composer-helper"]');
    expect(helper.text()).toBe("Answer the request above to continue.");
    expect(textarea().attributes("aria-describedby")).toContain(helper.attributes("id"));
  });

  it("switches to the reply placeholder and helper (CT-07 AC 4)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    store.startReply(sid, "c1");
    await flushPromises();
    expect(textarea().attributes("placeholder")).toBe("Reply to the assistant");
    expect(textarea().attributes("readonly")).toBeUndefined();
    expect(wrapper.get('[data-test="assistant-composer-helper"]').text()).toContain(
      "Your reply answers",
    );
  });

  it("answers the card with Enter in reply mode, the turn still running, chips left staged", async () => {
    const { store, sid, textarea } = setup();
    const session = store.state.sessions[sid];
    session.pendingApproval = { id: "c1" } as PendingApproval;
    session.turn = { state: "awaiting_approval", callId: "c1" };
    store.setDraft(sid, { text: "and check cart too" });
    store.startReply(sid, "c1");
    const decide = vi.spyOn(store, "decideApproval").mockImplementation(async () => {
      session.pendingApproval = null;
      return {} as never;
    });
    const send = vi.spyOn(store, "send");
    await flushPromises();
    expect(textarea().element.value).toBe("");
    await textarea().trigger("keydown", { key: "Enter" });
    expect(decide).not.toHaveBeenCalled();
    await type(textarea(), "use staging");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(decide).toHaveBeenCalledWith(
      sid,
      { approved: false, reason: "reply", reply: "use staging" },
      "c1",
    );
    expect(send).not.toHaveBeenCalled();
    expect(session.composer.text).toBe("and check cart too");
    expect(session.composer.mode).toBe("compose");
  });

  it("keeps a refused reply in the box and says why", async () => {
    const { store, sid, textarea, wrapper } = setup();
    const session = store.state.sessions[sid];
    session.pendingApproval = { id: "c1" } as PendingApproval;
    store.startReply(sid, "c1");
    vi.spyOn(store, "decideApproval").mockResolvedValue({} as never);
    await flushPromises();
    await type(textarea(), "use staging");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(session.composer).toMatchObject({ mode: "reply", text: "use staging" });
    expect(wrapper.get('[data-test="assistant-composer-status"]').text()).toBe(
      "Your reply wasn't sent. This request can't be answered from this page.",
    );
  });

  it("leaves Reply with Cancel or Escape, the draft back and nothing sent", async () => {
    const { store, sid, textarea, wrapper } = setup();
    const session = store.state.sessions[sid];
    session.pendingApproval = { id: "c1" } as PendingApproval;
    store.setDraft(sid, { text: "my draft" });
    store.startReply(sid, "c1");
    const decide = vi.spyOn(store, "decideApproval");
    await flushPromises();
    await wrapper.get('[data-test="assistant-composer-reply-cancel"]').trigger("click");
    expect(session.composer).toMatchObject({ mode: "compose", text: "my draft" });
    store.startReply(sid, "c1");
    await flushPromises();
    const escape = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(escape, "target", { value: textarea().element });
    expect(runEscapeLadder(escape)).toBe(true);
    expect(session.composer).toMatchObject({ mode: "compose", text: "my draft" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("says once that drafts will not survive a reload when storage is blocked (ERR-14)", async () => {
    const { wrapper, store } = setup();
    store.drafts.storageBlocked.value = true;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer-storage-blocked"]').text()).toBe(
      "Drafts won't be kept if you reload this page.",
    );
  });
});

describe("keys (`40` §1.4, CT-09)", () => {
  it("sends once per draft on Enter, however often Enter repeats", async () => {
    const { send, textarea, sid } = setup();
    await type(textarea(), "why?");
    await textarea().trigger("keydown", { key: "Enter" });
    await textarea().trigger("keydown", { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(sid);
  });

  it("ignores Enter while an IME composes, and Shift+Enter is a newline (CT-09 AC 1, 3)", async () => {
    const { send, textarea } = setup();
    await type(textarea(), "にほん");
    await textarea().trigger("keydown", { key: "Enter", isComposing: true });
    await textarea().trigger("keydown", { key: "Enter", keyCode: 229 });
    await textarea().trigger("keydown", { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    await textarea().trigger("keydown", { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("swallows Enter while running and says why, once (CT-09 AC 4, 10)", async () => {
    const { wrapper, send, store, sid, textarea, status } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "next");
    await textarea().trigger("keydown", { key: "Enter" });
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="assistant-composer-helper"]').text()).toBe(
      "Wait for this answer to finish, or stop it.",
    );
    expect(status()).toBe("Wait for this answer to finish, or stop it.");
    expect(trackAssistant).toHaveBeenCalledWith("ai_composer_enter_blocked", { reason: "running" });
  });

  it("recalls with ↑ from the first line, announces it, and ↓ brings the draft back (CT-11 AC 1)", async () => {
    localStorage.setItem(
      "o2.assistant.recall:k1",
      JSON.stringify([{ text: "older prompt", chips: [], at: 1 }]),
    );
    const { textarea, store, sid, status } = setup();
    await type(textarea(), "half a thought");
    textarea().element.setSelectionRange(0, 0);
    await textarea().trigger("keydown", { key: "ArrowUp" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("older prompt");
    expect(status()).toBe("Recalled prompt 1 of 1");
    await textarea().trigger("keydown", { key: "ArrowDown" });
    expect(store.state.sessions[sid].composer.text).toBe("half a thought");
  });

  it("moves the caret instead of recalling from line 2 (CT-11 AC 4)", async () => {
    localStorage.setItem(
      "o2.assistant.recall:k1",
      JSON.stringify([{ text: "older", chips: [], at: 1 }]),
    );
    const { textarea, store, sid } = setup();
    await type(textarea(), "line one\nline two");
    const end = textarea().element.value.length;
    textarea().element.setSelectionRange(end, end);
    await textarea().trigger("keydown", { key: "ArrowUp" });
    expect(store.state.sessions[sid].composer.text).toBe("line one\nline two");
  });

  it("focuses the last removable chip on Backspace in an empty textbox, removing nothing (CT-08 AC 5)", async () => {
    const { textarea, host } = setup();
    await textarea().trigger("keydown", { key: "Backspace" });
    expect(document.activeElement).toBe(
      host.querySelector('[data-test="assistant-context-chip-button"]'),
    );
  });

  it("opens the mention menu only at a word boundary (CT-05 AC 1, 7)", async () => {
    const { textarea } = setup();
    await type(textarea(), "ops@acme.com");
    expect(textarea().attributes("aria-controls")).toBeUndefined();
    textarea().element.focus();
    await type(textarea(), "look at @che");
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    expect(textarea().attributes("aria-expanded")).toBeUndefined();
    expect(document.activeElement).toBe(textarea().element);
    await textarea().trigger("keydown", { key: "Escape" });
    expect(textarea().attributes("aria-controls")).toBeUndefined();
    expect(textarea().element.value).toBe("look at @che");
  });
});

describe("ghost and prefill (IW-06, `70` §5)", () => {
  const ghost = {
    label: raw("Why errors?"),
    text: "Why did errors spike?",
    chips: [ROW],
    kind: "page" as const,
  };

  it("accepts the ghost with Right Arrow, stages text and chips, sends nothing", async () => {
    const { wrapper, textarea, store, sid, send, status } = setup({ ghost });
    expect(wrapper.get('[data-test="assistant-ghost"]').text()).toBe('Try: "Why errors?"');
    expect(textarea().attributes("aria-describedby")).toBeTruthy();
    await textarea().trigger("keydown", { key: "ArrowRight" });
    await flushPromises();
    expect(store.state.sessions[sid].composer).toMatchObject({ text: "Why did errors spike?" });
    expect(store.state.sessions[sid].composer.chips.map((c: ContextChip) => c.id)).toEqual([
      "row-1",
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(status()).toBe("Suggestion inserted");
    expect(wrapper.find('[data-test="assistant-ghost"]').exists()).toBe(false);
    expect(trackAssistant).toHaveBeenCalledWith("ai_welcome_starter", {
      starter_kind: "page",
      index: 0,
      via: "ghost",
    });
  });

  it("asks Replace · Append · Cancel over a long draft, and Cancel keeps it", async () => {
    const { wrapper, textarea, store, sid } = setup();
    const long = "x".repeat(PREFILL_CHOICE_CHARS + 1);
    await type(textarea(), long);
    (wrapper.vm as unknown as { prefill(p: { text: string; chips: ContextChip[] }): void }).prefill(
      { text: "starter", chips: [] },
    );
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-prefill-choice"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-prefill-choice-cancel"]').trigger("click");
    expect(store.state.sessions[sid].composer.text).toBe(long);
    (wrapper.vm as unknown as { prefill(p: { text: string; chips: ContextChip[] }): void }).prefill(
      { text: "starter", chips: [] },
    );
    await flushPromises();
    await wrapper.get('[data-test="assistant-prefill-choice-append"]').trigger("click");
    expect(store.state.sessions[sid].composer.text).toBe(`${long}\nstarter`);
  });

  it("cancels the prefill choice on Escape inside it, through ladder rung c (`10` §6.3)", async () => {
    const { wrapper, textarea, store, sid } = setup();
    const long = "y".repeat(PREFILL_CHOICE_CHARS + 1);
    await type(textarea(), long);
    (wrapper.vm as unknown as { prefill(p: { text: string; chips: ContextChip[] }): void }).prefill(
      { text: "starter", chips: [] },
    );
    await flushPromises();
    const replace = wrapper.get('[data-test="assistant-prefill-choice-replace"]')
      .element as HTMLElement;
    const handled = runEscapeLadder(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handled).toBe(false);
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(event, "target", { value: replace });
    expect(runEscapeLadder(event)).toBe(true);
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-prefill-choice"]').exists()).toBe(false);
    expect(store.state.sessions[sid].composer.text).toBe(long);
    expect(document.activeElement).toBe(textarea().element);
  });
});

describe("drafts (CT-06)", () => {
  it("announces a restored draft once and names the images a reload dropped (AC 3)", async () => {
    fake.current = null;
    const { wrapper, store, sid, status } = setup();
    vi.spyOn(store, "takeRestoredDraft").mockReturnValueOnce({ imageCount: 2 });
    await wrapper.setProps({ sid: null });
    await wrapper.setProps({ sid });
    await flushPromises();
    expect(status()).toBe("Draft restored");
    expect(wrapper.get('[data-test="assistant-composer-helper"]').text()).toBe(
      "2 images weren't kept across the reload",
    );
  });

  it("shows New chat's Draft cleared with an Undo for 10 s that restores into the new chat (AC 5)", async () => {
    const { wrapper, store, sid } = setup();
    const undo = vi.spyOn(store, "undoClear");
    noteDraftCleared(sid, { token: "t1", at: Date.now() });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer-cleared"]').text()).toContain(
      "Draft cleared",
    );
    await wrapper.get('[data-test="assistant-composer-undo"]').trigger("click");
    expect(undo).toHaveBeenCalledWith(sid, "t1");
    expect(composerUi(sid).cleared).toBeNull();
    expect(trackAssistant).toHaveBeenCalledWith("ai_composer_cleared", {
      reason: "new_chat",
      undone: true,
    });
  });

  it("clears the old org's draft on an org switch, without an Undo (AC 6, D21)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    await type(textarea(), "org A draft");
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("");
    expect(wrapper.get('[data-test="assistant-composer-cleared"]').text()).toBe(
      "Draft from default cleared",
    );
    expect(wrapper.find('[data-test="assistant-composer-undo"]').exists()).toBe(false);
    expect(textarea().element.value).toBe("");
  });
});

describe("images (CT-10)", () => {
  const png = (name: string, size = 10) =>
    new File([new Uint8Array(size)], name, { type: "image/png" });

  it("names pasted shots uniquely and removes the one asked for (AC 1–2)", async () => {
    const { wrapper, textarea, store, sid, status } = setup();
    for (let i = 0; i < 2; i++) {
      await textarea().trigger("paste", {
        clipboardData: { files: [png("image.png")], getData: () => "" },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await flushPromises();
    const names = () =>
      store.state.sessions[sid].composer.images.map((i: { filename: string }) => i.filename);
    expect(names()).toEqual(["pasted-image-1.png", "pasted-image-2.png"]);
    const removes = wrapper.findAll('[data-test="assistant-image-remove"]');
    expect(removes[1].attributes("aria-label")).toBe("Remove pasted-image-2.png");
    await removes[1].trigger("click");
    expect(names()).toEqual(["pasted-image-1.png"]);
    expect(status()).toBe("pasted-image-2.png removed from context");
  });

  it("states the type cap where the control is, never as a toast (AC 5)", async () => {
    const { textarea, sid } = setup();
    const gif = new File([new Uint8Array(4)], "a.gif", { type: "image/gif" });
    await textarea().trigger("paste", { clipboardData: { files: [gif], getData: () => "" } });
    await flushPromises();
    expect(composerUi(sid).cap?.text).toBe("Only PNG and JPEG images can be attached");
    expect(trackAssistant).toHaveBeenCalledWith("ai_composer_cap_hit", { cap: "type" });
  });
});

describe("focusInput", () => {
  it("puts the caret at the end (CT-08 AC 9)", async () => {
    const { wrapper, textarea } = setup();
    await type(textarea(), "hello");
    (wrapper.vm as unknown as { focusInput(caret?: "end" | number): void }).focusInput("end");
    expect(document.activeElement).toBe(textarea().element);
    expect(textarea().element.selectionStart).toBe(5);
  });

  it("starts a chat on the first keystroke when there is none, never on mount", async () => {
    const { store, textarea } = setup({}, false);
    expect(Object.keys(store.state.sessions)).toEqual([]);
    await type(textarea(), "h");
    expect(
      Object.values(store.state.sessions).map(
        (s: { composer: { text: string } }) => s.composer.text,
      ),
    ).toEqual(["h"]);
  });
});

describe("round 2 (U7–U9, U12, U16, U18–U19, F5, F8)", () => {
  it("hides the predicted credits line only under a credits refusal, never under another refused code", async () => {
    const { wrapper, store, sid } = setup();
    store.state.capability.creditMode = "exhausted";
    const refused = (code: string) =>
      ({
        state: "refused",
        error: { code, phase: "pre_admission", retryable: false, action: "none" },
      }) as never;
    const helper = () => wrapper.find('[data-test="assistant-composer-helper"]');
    store.state.sessions[sid].turn = refused("rate_limited");
    await flushPromises();
    expect(helper().text()).toContain("AI credits are used up for");
    store.state.sessions[sid].turn = refused("credits_exhausted");
    await flushPromises();
    expect(helper().exists() && helper().text()).not.toContain("AI credits are used up for");
    store.state.capability.creditMode = undefined;
  });

  it("keeps the used-up credits line while the chat's history is unavailable", async () => {
    const { wrapper, store, sid } = setup();
    store.state.capability.creditMode = "exhausted";
    store.state.sessions[sid].record.historyUnavailable = true;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer-helper"]').text()).toContain(
      "AI credits are used up for",
    );
    store.state.capability.creditMode = undefined;
  });

  it("drops the swallowed-Enter reason once the answer ends and once the card resolves (U8)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "next");
    await textarea().trigger("keydown", { key: "Enter" });
    expect(wrapper.find('[data-test="assistant-composer-helper"]').text()).toContain(
      "Wait for this answer",
    );
    store.state.sessions[sid].turn = { state: "done", saved: "server" };
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-composer-helper"]').exists()).toBe(false);
  });

  it("ends the Undo offer on the first keystroke in the new chat, so Undo never replaces new work (U9)", async () => {
    const { wrapper, sid, textarea } = setup();
    noteDraftCleared(sid, { token: "t1", at: Date.now() });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-composer-cleared"]').exists()).toBe(true);
    await type(textarea(), "a new question");
    expect(wrapper.find('[data-test="assistant-composer-cleared"]').exists()).toBe(false);
  });

  it("names the ghost button by its visible text and keeps the hint in the textbox description (U12)", () => {
    const { wrapper, textarea } = setup({
      ghost: { label: raw("Why errors?"), text: "Why errors?", chips: [] },
    });
    expect(wrapper.get('[data-test="assistant-ghost"]').attributes("aria-label")).toBeUndefined();
    const hintId = textarea().attributes("aria-describedby")!.split(" ").at(-1)!;
    expect(document.getElementById(hintId)?.textContent).toContain("Press Right Arrow to use it");
  });

  it("gives the informative placeholder secondary-text contrast (U16)", () => {
    const { textarea } = setup();
    expect(textarea().classes()).toContain("placeholder:text-text-secondary");
  });

  it("says why an empty Enter does nothing, once per run (U18)", async () => {
    const { textarea, status } = setup();
    await textarea().trigger("keydown", { key: "Enter" });
    expect(status()).toBe("Type a message or add context to send");
  });

  it("moves focus to Append when the prefill choice appears (U19)", async () => {
    const { wrapper, textarea } = setup();
    await type(textarea(), "w".repeat(PREFILL_CHOICE_CHARS + 1));
    (wrapper.vm as unknown as { prefill(p: { text: string; chips: ContextChip[] }): void }).prefill(
      { text: "s", chips: [] },
    );
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-prefill-choice-append"]').element,
    );
  });

  it("speaks the mention result count once the query settles (U7)", async () => {
    seedMentionGroups();
    vi.useFakeTimers();
    const { textarea, status } = setup();
    textarea().element.focus();
    await type(textarea(), "@");
    await vi.advanceTimersByTimeAsync(500);
    expect(status()).toMatch(/^\d+ suggestions?\. Up and Down to choose, Enter to add\.$/);
    vi.useRealTimers();
  });

  it("keeps the mention menu open on an Escape that ends an IME composition (U17)", async () => {
    const { textarea } = setup();
    textarea().element.focus();
    await type(textarea(), "look at @ch");
    await textarea().trigger("keydown", { key: "Escape", isComposing: true });
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    await textarea().trigger("keydown", { key: "Escape" });
    expect(textarea().attributes("aria-controls")).toBeUndefined();
  });

  it("returns focus to Recent prompts when its sheet is dismissed (U20)", async () => {
    breakpoint.md = false;
    const { wrapper } = setup();
    const state = (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$
      .setupState;
    state.recallEntries = [{ text: "earlier question", chips: [], at: 1 }];
    await flushPromises();
    const button = wrapper.find('[data-test="assistant-recall-open"]');
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    await flushPromises();
    (
      document.body.querySelector('[data-test="assistant-recall-sheet-close"]') as HTMLElement
    ).click();
    await flushPromises();
    expect(document.activeElement).toBe(button.element);
  });

  it("closes the mention menu when the textbox loses focus (V2)", async () => {
    const { textarea } = setup();
    textarea().element.focus();
    await type(textarea(), "look at @ch");
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    await textarea().trigger("blur");
    expect(textarea().attributes("aria-controls")).toBeUndefined();
  });

  it("keeps the menu in place while a press is down, so the pressed control does not move (V2)", async () => {
    const { textarea } = setup();
    textarea().element.focus();
    await type(textarea(), "look at @ch");
    document.dispatchEvent(new Event("pointerdown"));
    await textarea().trigger("blur");
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    document.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(new Event("pointerup"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    expect(textarea().attributes("aria-controls")).toBeUndefined();
  });

  it("follows the caret: a click before the @ closes the menu (V2)", async () => {
    const { textarea } = setup();
    textarea().element.focus();
    await type(textarea(), "hello @da");
    textarea().element.setSelectionRange(2, 2);
    await textarea().trigger("click");
    expect(textarea().attributes("aria-controls")).toBeUndefined();
  });

  it("never edits the draft when Enter picks with the caret before the @ (V2)", async () => {
    const { textarea, store, sid } = setup();
    textarea().element.focus();
    await type(textarea(), "hello @");
    textarea().element.setSelectionRange(2, 2);
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("hello @");
  });

  it("waits for loading groups before it speaks the count (V3)", async () => {
    seedMentionGroups();
    queryClient.removeQueries({ queryKey: streamKeys.nameList("default", "logs") });
    void queryClient.prefetchQuery({
      queryKey: streamKeys.nameList("default", "logs"),
      queryFn: () => new Promise(() => {}),
    });
    vi.useFakeTimers();
    const { textarea, status } = setup();
    textarea().element.focus();
    await type(textarea(), "@");
    await vi.advanceTimersByTimeAsync(500);
    expect(status()).toBe("");
    vi.useRealTimers();
  });

  it("speaks a swallowed Enter's reason once, not again when the debounce fires (V3)", async () => {
    seedMentionGroups();
    vi.useFakeTimers();
    const { textarea, sid } = setup();
    textarea().element.focus();
    await type(textarea(), "@zzzzqqq");
    await vi.advanceTimersByTimeAsync(500);
    await type(textarea(), "@zzzzqqqx");
    await textarea().trigger("keydown", { key: "Enter" });
    const seq = composerUi(sid).status?.seq;
    await vi.advanceTimersByTimeAsync(500);
    expect(composerUi(sid).status?.seq).toBe(seq);
    vi.useRealTimers();
  });

  it("shows Bring it here when a notice without an action is replaced by a New chat notice (V6)", async () => {
    const { wrapper, store, sid } = setup();
    const other = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.setActive(sid);
    noteDraftCleared(sid, { token: null, org: "acme", at: Date.now() });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-composer-undo"]').exists()).toBe(false);
    noteDraftCleared(sid, { token: null, from: other, at: Date.now() + 1 });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer-undo"]').text()).toBe("Bring it here");
  });

  it("lets Enter send untouched after a caret move the menu never saw (W1)", async () => {
    const { textarea, store, sid, send } = setup();
    textarea().element.focus();
    await type(textarea(), "check @da logs");
    textarea().element.setSelectionRange(9, 9);
    await textarea().trigger("click");
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    textarea().element.setSelectionRange(14, 14);
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(textarea().attributes("aria-controls")).toBeUndefined();
    expect(store.state.sessions[sid].composer.chips).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.state.sessions[sid].composer.text).toBe("check @da logs");
  });

  it("replaces the whole @ token when the caret is inside it (W1)", async () => {
    seedMentionGroups();
    const { textarea, store, sid } = setup();
    textarea().element.focus();
    await type(textarea(), "look @che more");
    textarea().element.setSelectionRange(8, 8);
    await textarea().trigger("click");
    await flushPromises();
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("look  more");
    expect(store.state.sessions[sid].composer.chips.map((c: ContextChip) => c.kind)).toEqual([
      "stream",
    ]);
  });

  it("defers the blur close only for an open menu and drops it on pointercancel (F11)", async () => {
    const { textarea } = setup();
    const add = vi.spyOn(window, "addEventListener");
    textarea().element.focus();
    await type(textarea(), "plain text");
    document.dispatchEvent(new Event("pointerdown"));
    await textarea().trigger("blur");
    expect(add.mock.calls.filter(([name]) => name === "pointerup")).toHaveLength(0);
    textarea().element.focus();
    await type(textarea(), "look at @ch");
    await textarea().trigger("blur");
    await textarea().trigger("blur");
    expect(add.mock.calls.filter(([name]) => name === "pointercancel")).toHaveLength(2);
    window.dispatchEvent(new Event("pointercancel"));
    document.dispatchEvent(new Event("pointercancel"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    expect(textarea().attributes("aria-controls")).toBeUndefined();
    const remove = vi.spyOn(window, "removeEventListener");
    window.dispatchEvent(new Event("pointerup"));
    expect(remove).not.toHaveBeenCalled();
    add.mockRestore();
    remove.mockRestore();
  });

  it("clears the old org's draft even when no composer is visible (F8)", async () => {
    const { store, sid, textarea, wrapper } = setup({ visible: false });
    await type(textarea(), "org A draft");
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("");
    wrapper.unmount();
  });
});

describe("WP-06: Go to answer and the stalled Stop", () => {
  it("sends Ctrl+↑ or ⌘↑ to the latest answer only from the first line, never while composing (X-28)", async () => {
    const { registerAssistantFocusTarget, resetAssistantShortcutsForTests } =
      await import("@/composables/assistant/shortcuts");
    resetAssistantShortcutsForTests();
    const answer = vi.fn(() => true);
    const off = registerAssistantFocusTarget("answer", answer);
    const { textarea } = setup();
    await type(textarea(), "line one\nline two");
    const el = textarea().element;
    el.setSelectionRange(el.value.length, el.value.length);
    await textarea().trigger("keydown", { key: "ArrowUp", ctrlKey: true });
    expect(answer).not.toHaveBeenCalled();
    el.setSelectionRange(3, 3);
    await textarea().trigger("keydown", { key: "ArrowUp", ctrlKey: true, isComposing: true });
    expect(answer).not.toHaveBeenCalled();
    await textarea().trigger("keydown", { key: "ArrowUp", metaKey: true });
    expect(answer).toHaveBeenCalledTimes(1);
    await textarea().trigger("keydown", { key: "ArrowUp", ctrlKey: true });
    expect(answer).toHaveBeenCalledTimes(2);
    off();
  });

  it("emphasises Stop once 30 s pass without a frame (HT-01 AC 3)", async () => {
    vi.useFakeTimers({ now: 100_000 });
    try {
      const { wrapper, store, sid } = setup();
      const session = store.state.sessions[sid];
      session.turn = { state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" };
      session.turnMeta.startedAt = 100_000;
      session.turnMeta.lastFrameAt = 100_000;
      await flushPromises();
      const stop = () => wrapper.get('[data-test="assistant-stop"]');
      expect(stop().classes().join(" ")).not.toContain("secondary");
      await vi.advanceTimersByTimeAsync(31_000);
      expect(stop().attributes("class")).toMatch(/bg-button-secondary|secondary/);
    } finally {
      vi.useRealTimers();
    }
  });
});
