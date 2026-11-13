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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

import type { ContextChip, PendingApproval } from "@/composables/assistant";
import { registerAssistantFocusTarget, runEscapeLadder } from "@/composables/assistant/shortcuts";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { fakeVoiceEngine } from "../__tests__/fakeVoice";
import { queryClient } from "@/composables/query/queryClient";
import { alertKeys } from "@/services/alerts.querykeys";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";
import AssistantComposer, {
  PREFILL_CHOICE_CHARS,
  type AssistantComposerProps,
} from "./AssistantComposer.vue";
import AssistantComposerPlusMenu, {
  type ComposerPlusAction,
} from "./AssistantComposerPlusMenu.vue";
import { composerUi, noteCap, noteDraftCleared, resetComposerUiForTests } from "./composerUi";
import { queuedOf, resetComposerQueueForTests } from "./useComposerQueue";
import { HOLD_MS, SILENCE_MS, resetVoiceForTests, setVoiceOptIn } from "./useAssistantVoice";
import AssistantDictateButton from "./AssistantDictateButton.vue";

const { fake, breakpoint } = vi.hoisted(() => ({
  fake: { current: null as any, member: false },
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

const mounted: VueWrapper[] = [];

const NOTICE = '[data-test="assistant-composer-notice"]';

const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

function setup(props: Partial<AssistantComposerProps> = {}, withSession = true) {
  fake.current = fakeAssistant();
  if (fake.member)
    fake.current.capability.value = { ...fake.current.capability.value, isAdmin: false };
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
  mounted.push(wrapper);
  const textarea = () => wrapper.get<HTMLTextAreaElement>('[data-test="assistant-composer-field"]');
  const status = () => wrapper.get('[data-test="assistant-composer-status"]').text();
  return { wrapper, store, sid: sid!, send, textarea, status, host };
}

async function answered(store: ReturnType<typeof setup>["store"], sid: string): Promise<void> {
  store.state.sessions[sid].messages.push({ role: "assistant", content: "Done" });
  await flushPromises();
}

function seedMentionGroups(): void {
  queryClient.clear();
  queryClient.setQueryData(streamKeys.nameList("default", "logs"), [{ name: "checkout" }]);
  queryClient.setQueryData(streamKeys.nameList("default", "metrics"), []);
  queryClient.setQueryData(streamKeys.nameList("default", "traces"), []);
  queryClient.setQueryData(alertKeys.list("default", "", undefined, undefined), []);
  queryClient.setQueryData(pipelineKeys.list("default"), []);
  queryClient.setQueryData(dashboardKeys.search("default", ""), []);
}

async function type(textarea: ReturnType<ReturnType<typeof setup>["textarea"]>, value: string) {
  await textarea.setValue(value);
  await flushPromises();
}

// The + menu's own spec covers its dropdown; here an item is picked as the menu reports it.
function plus(wrapper: VueWrapper, action: ComposerPlusAction): void {
  wrapper.findComponent(AssistantComposerPlusMenu).vm.$emit("select", action);
}

beforeEach(() => {
  breakpoint.md = true;
  fake.member = false;
  sessionStorage.clear();
  localStorage.clear();
  resetComposerUiForTests();
  resetComposerQueueForTests();
  vi.mocked(trackAssistant).mockClear();
});

afterEach(() => {
  // A live composer over a wiped body would throw inside the next flush and fail an unrelated test.
  for (const wrapper of mounted.splice(0)) if (wrapper.exists()) wrapper.unmount();
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

  it("asks anything and teaches @ in an empty chat, with no count (K4)", () => {
    const { textarea } = setup();
    expect(textarea().attributes("placeholder")).toBe("Ask anything · @ to add context");
  });

  it("asks for a follow-up once the chat has a turn", async () => {
    const { textarea, store, sid } = setup();
    await answered(store, sid);
    expect(textarea().attributes("placeholder")).toBe("Ask a follow-up · @ to add context");
  });

  it("names the chosen agent while it is not the default, and says the switch once", async () => {
    const { wrapper, textarea, store, sid } = setup();
    store.state.sessions[sid].nextAgentId = "sre";
    await flushPromises();
    expect(textarea().attributes("placeholder")).toBe("Ask Investigator…");
    expect(wrapper.get(NOTICE).attributes("title")).toBe(
      "Investigator answers from now on. Earlier answers stay.",
    );
  });
});

describe("rows (§1, S1)", () => {
  function wide(): void {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly changed: () => void) {}
        observe = () => this.changed();
        disconnect = () => undefined;
      },
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 960,
    } as DOMRect);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(940);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("draws one frame: no strip while empty, else the strip on top, the text, then the bar, all inside the border", async () => {
    wide();
    const { wrapper, textarea, store, sid } = setup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-composer-strip"]').exists()).toBe(false);
    store.addChip(sid, ROW);
    await flushPromises();
    const frame = textarea().element.parentElement!;
    const strip = wrapper.get('[data-test="assistant-composer-strip"]').element;
    const bar = wrapper.get('[data-test="assistant-composer-bar"]').element;
    expect(frame.contains(strip) && frame.contains(bar)).toBe(true);
    expect(strip.compareDocumentPosition(textarea().element) & FOLLOWING).toBeTruthy();
    expect(textarea().element.compareDocumentPosition(bar) & FOLLOWING).toBeTruthy();
    const classes = wrapper.get('[data-test="assistant-composer"]').classes();
    expect(classes).toContain("[&>div]:rounded-surface");
    expect(classes).toEqual(
      expect.arrayContaining([
        "[&>div]:focus-within:border-input-border-focus",
        "[&>div]:focus-within:ring-1",
        "[&>div]:motion-reduce:transition-none",
      ]),
    );
    expect(classes).not.toContain("[&>div]:focus-within:ring-3");
    expect(bar.classList.contains("border-t")).toBe(true);
  });

  it("never moves the bar or a shown strip on a keystroke, a new line or a notice (F2)", async () => {
    wide();
    const { wrapper, textarea, store, sid } = setup();
    store.addChip(sid, ROW);
    await flushPromises();
    const bar = () => wrapper.get('[data-test="assistant-composer-bar"]');
    const strip = () => wrapper.get('[data-test="assistant-composer-strip"]');
    const before = [bar().element, strip().element];
    const classes = [bar().classes().join(" "), strip().classes().join(" ")];
    await type(textarea(), "one\ntwo and a much longer second line than the frame holds");
    noteCap(sid, raw("Up to 4 images, 2 MB each"));
    await flushPromises();
    expect(wrapper.find(NOTICE).exists()).toBe(true);
    expect([bar().element, strip().element]).toEqual(before);
    expect([bar().classes().join(" "), strip().classes().join(" ")]).toEqual(classes);
    expect(strip().classes()).toEqual(expect.arrayContaining(["h-7", "overflow-hidden"]));
    // B-composer-11: on touch the strip is as tall as a chip's hit area, so nothing it holds is clipped.
    expect(strip().classes()).toEqual(
      expect.arrayContaining(["max-md:h-11", "pointer-coarse:h-11"]),
    );
  });

  it("puts + and the agent pill on the left and mic, Send on the right, with no @ button", async () => {
    resetVoiceForTests(fakeVoiceEngine());
    const { wrapper } = setup();
    setVoiceOptIn("k1", true);
    await flushPromises();
    const left = wrapper.get('[data-test="assistant-composer-bar-left"]');
    const right = wrapper.get('[data-test="assistant-composer-bar-right"]');
    expect(left.findAll("button, [data-test]").map((n) => n.attributes("data-test"))).toEqual([
      "assistant-composer-plus",
      "assistant-context-chip-time",
      "assistant-agent-pill",
    ]);
    expect(
      right.findAll('[data-test^="assistant-"]').map((n) => n.attributes("data-test")),
    ).toEqual(["assistant-dictate", "assistant-send"]);
    expect(wrapper.findComponent(AssistantComposerPlusMenu).props("actions")).toEqual([
      "attach",
      "context",
      "time",
    ]);
    expect(wrapper.find('[data-test="assistant-mention-button"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("@ ");
    resetVoiceForTests();
  });

  it("ends the strip with the ⓘ only beside chips, and nothing of the composer sits outside the frame", async () => {
    const { wrapper, store, sid } = setup();
    const sees = () => wrapper.find('[data-test="assistant-context-sees"]');
    expect(sees().exists()).toBe(false);
    store.addChip(sid, ROW);
    await flushPromises();
    const strip = wrapper.get('[data-test="assistant-composer-strip"]');
    expect(strip.element.contains(sees().element)).toBe(true);
    const frame = wrapper.get('[data-test="assistant-composer-frame"]').element;
    const outside = [...wrapper.element.children].filter(
      (child) =>
        !child.contains(frame) &&
        !child.classList.contains("sr-only") &&
        !child.classList.contains("hidden"),
    );
    expect(outside).toEqual([]);
  });

  it("puts the ⓘ after the tray in the strip", async () => {
    const wrapper = mount(AssistantComposer, {
      props: { sid: null },
      slots: { chips: '<div data-test="tray-stub">tray</div>' },
      global: { plugins: [fakeRouter(), fakeVuex()] },
    });
    mounted.push(wrapper);
    const store = fake.current.store;
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    await wrapper.setProps({ sid });
    store.addChip(sid, ROW);
    await flushPromises();
    const strip = wrapper.get('[data-test="assistant-composer-strip"]');
    expect(
      strip
        .get('[data-test="tray-stub"]')
        .element.compareDocumentPosition(
          strip.get('[data-test="assistant-context-sees"]').element,
        ) & FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the ⓘ while a notice holds the strip", async () => {
    const { wrapper, store, sid } = setup();
    store.addChip(sid, ROW);
    noteCap(sid, raw("Up to 4 images, 2 MB each"));
    await flushPromises();
    expect(wrapper.find(NOTICE).exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-context-sees"]').exists()).toBe(false);
  });

  it("plays the border sweep only on an opening, with L1's sweep utility", async () => {
    const { wrapper } = setup();
    const frame = () => wrapper.get('[data-test="assistant-composer-frame"]');
    expect(frame().classes()).not.toContain("assistant-sweep");
    await wrapper.setProps({ opening: true });
    expect(frame().classes()).toContain("assistant-sweep");
  });

  it("plays no sweep under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
    }));
    try {
      const { wrapper } = setup({ opening: true });
      expect(wrapper.get('[data-test="assistant-composer-frame"]').classes()).not.toContain(
        "assistant-sweep",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("refused sends (§1)", () => {
  const refuse = (store: ReturnType<typeof setup>["store"], sid: string, error: object) => {
    const session = store.state.sessions[sid];
    session.turn = { state: "refused", error } as never;
    session.turnMeta.endedAt = Date.now();
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a busy refusal down, keeps the draft, and turns Send on at 0", async () => {
    vi.useFakeTimers();
    const { wrapper, store, sid } = setup();
    store.setDraft(sid, { text: "why?" });
    refuse(store, sid, { code: "turn_limit", retryAfterMs: 2_000 });
    await vi.advanceTimersByTimeAsync(0);
    const row = () => wrapper.find(NOTICE);
    expect(row().attributes("title")).toBe("O2 Assistant is busy. Send again in 2 s.");
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBe("true");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(row().exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBeUndefined();
  });

  it("says Run limit reached in the strip, with the shipped sentence in title=, and hands Show running chats to the shell", async () => {
    const { wrapper, store, sid } = setup();
    store.setDraft(sid, { text: "why?" });
    refuse(store, sid, { code: "run_limit_member", limit: 3 });
    await flushPromises();
    const notice = wrapper.get('[data-notice="runLimit"]');
    expect(notice.attributes("title")).toBe(
      "3 chats are running or waiting for you. Your message wasn't sent.",
    );
    expect(wrapper.get('[data-test="assistant-composer-notice-title"]').text()).toBe(
      "Run limit reached",
    );
    await wrapper.get('[data-test="assistant-composer-notice-showRunning"]').trigger("click");
    expect(wrapper.emitted("show-running")).toHaveLength(1);
    expect(wrapper.get("textarea").element.value).toBe("why?");
  });

  it("says the org is busy with a Retry that retries the refused turn", async () => {
    const { wrapper, store, sid } = setup();
    const retry = vi.spyOn(store, "retry").mockResolvedValue(undefined as never);
    refuse(store, sid, { code: "run_limit_org" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer-notice-title"]').text()).toBe(
      "Assistant busy for your org",
    );
    await wrapper.get('[data-test="assistant-composer-notice-retry"]').trigger("click");
    expect(retry).toHaveBeenCalledWith(sid);
  });

  it("keeps the draft, locks Send and the mic, and says why when access is lost mid-session", async () => {
    const { wrapper, store, sid, send } = setup({ accessLost: true });
    store.setDraft(sid, { text: "Why did cart start returning 503?" });
    await flushPromises();
    expect(wrapper.get(NOTICE).attributes("title")).toBe(
      "You can read your chats. Starting or continuing one needs AI access.",
    );
    expect(wrapper.get('[data-test="assistant-composer-ask-admin"]').classes()).toEqual(
      expect.arrayContaining(["max-md:min-h-11!", "pointer-coarse:min-h-11!"]),
    );
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBe("true");
    expect(wrapper.get("textarea").element.value).toBe("Why did cart start returning 503?");
    await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
  });

  it("says the message wasn't sent when the service isn't reachable; Send is the retry", async () => {
    const { wrapper, store, sid } = setup();
    store.setDraft(sid, { text: "why?" });
    refuse(store, sid, { code: "unreachable" });
    await flushPromises();
    expect(wrapper.get(NOTICE).attributes("title")).toBe(
      "O2 Assistant isn't reachable right now. Your message wasn't sent.",
    );
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBeUndefined();
  });

  it("says the browser is offline, not that the agent is unreachable, when an offline send bounced", async () => {
    const { wrapper, store, sid } = setup();
    store.setDraft(sid, { text: "why?" });
    refuse(store, sid, { code: "offline" });
    await flushPromises();
    expect(wrapper.get(NOTICE).attributes("title")).toBe("You're offline. Draft kept.");
  });

  it("keeps the first chip and the ⓘ in the strip; the ⓘ says it is saved with the chat (B-composer-6)", async () => {
    const { wrapper, store, sid } = setup();
    localStorage.removeItem("o2.assistant.hints:k1");
    store.addChip(sid, ROW);
    await flushPromises();
    expect(wrapper.find(NOTICE).exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-composer-strip"]').text()).not.toContain(
      "Attachments are saved",
    );
    const strip = wrapper.get('[data-test="assistant-composer-strip"]');
    expect(strip.find('[data-test="assistant-context-sees"]').exists()).toBe(true);
    await strip.get('[data-test="assistant-context-sees"]').trigger("click");
    await flushPromises();
    expect(
      document.body
        .querySelector('[data-test="assistant-context-sees-disclosure"]')
        ?.textContent?.trim(),
    ).toBe("Sent to the assistant and saved with this chat.");
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
    expect(wrapper.get(NOTICE).attributes("title")).toBe(line);
    expect(status()).toContain(line);
    expect(store.state.sessions[sid].composer.text).toBe("why 5xx?");
    lock = null;
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("is inert under an approval card: the same box, every control off, the kept draft muted (K7)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    store.setDraft(sid, { text: "kept" });
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe("inert");
    expect(textarea().attributes("readonly")).toBeDefined();
    expect(textarea().attributes("aria-disabled")).toBe("true");
    expect(textarea().attributes("tabindex")).toBe("-1");
    expect(textarea().attributes("placeholder")).toBe("");
    expect(textarea().element.value).toBe("kept");
    expect(textarea().classes()).toContain("text-text-muted!");
    expect(wrapper.get('[data-notice="inert"]').text()).toContain("Decide above to continue");
    for (const id of ["assistant-composer-plus", "assistant-send"])
      expect(wrapper.get(`[data-test="${id}"]`).attributes("aria-disabled")).toBe("true");
    const pill = wrapper.get('[data-test="assistant-agent-pill"]');
    expect(pill.text()).toBe("O2 Assistant");
    expect(wrapper.find('[data-test="assistant-composer-notice-goToRequest"]').exists()).toBe(
      false,
    );
  });

  it("shows a disabled Send, not Stop, while the inert turn waits on the card (K7)", async () => {
    const { wrapper, store, sid } = setup();
    const session = store.state.sessions[sid];
    session.pendingApproval = { id: "c1" } as PendingApproval;
    session.turn = { state: "awaiting_approval", callId: "c1" };
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-stop"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBe("true");
  });

  it("states the decline above the frame in reply mode, with no context controls (CT-07 AC 4)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    store.startReply(sid, "c1");
    await flushPromises();
    expect(textarea().attributes("placeholder")).toBe("Reply to the assistant");
    expect(textarea().attributes("readonly")).toBeUndefined();
    expect(wrapper.get('[data-notice="reply"]').attributes("title")).toContain(
      "Reply declines the request",
    );
    expect(wrapper.find('[data-test="assistant-attach-image"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-agent-picker"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-label")).toBe("Send reply");
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

  it("keeps Send, never Stop, in reply mode while the turn waits on the card", async () => {
    const { wrapper, store, sid, textarea } = setup();
    const session = store.state.sessions[sid];
    session.pendingApproval = { id: "c1" } as PendingApproval;
    session.turn = { state: "awaiting_approval", callId: "c1" };
    const stop = vi.spyOn(store, "stop").mockResolvedValue();
    const decide = vi.spyOn(store, "decideApproval").mockImplementation(async () => {
      session.pendingApproval = null;
      return {} as never;
    });
    store.startReply(sid, "c1");
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-stop"]').exists()).toBe(false);
    await type(textarea(), "use staging");
    await wrapper.get('[data-test="assistant-send"]').trigger("click");
    await flushPromises();
    expect(decide).toHaveBeenCalledWith(
      sid,
      { approved: false, reason: "reply", reply: "use staging" },
      "c1",
    );
    expect(stop).not.toHaveBeenCalled();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-stop"]').exists()).toBe(true);
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

  it("words the composer for a question's own answer", async () => {
    const { store, sid, wrapper } = setup();
    store.state.sessions[sid].pendingApproval = { id: "q1", kind: "question" } as PendingApproval;
    store.startReply(sid, "q1");
    store.setDraft(sid, { text: "staging" });
    await flushPromises();
    expect(wrapper.get('[data-notice="reply"]').attributes("title")).toContain(
      "Answering the question above",
    );
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-label")).toBe(
      "Send answer",
    );
  });

  it("returns focus to Reply on Cancel", async () => {
    const { store, sid, wrapper } = setup();
    const shell = document.createElement("div");
    shell.setAttribute("data-assistant-root", "");
    document.body.append(shell);
    shell.append(wrapper.element);
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    store.startReply(sid, "c1");
    await flushPromises();
    const reply = document.createElement("button");
    reply.setAttribute("data-test", "assistant-approval-reply");
    shell.append(reply);
    await wrapper.get('[data-test="assistant-composer-notice-replyCancel"]').trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(reply);
  });

  it("leaves Reply with Cancel or Escape, the draft back and nothing sent", async () => {
    const { store, sid, textarea, wrapper } = setup();
    const session = store.state.sessions[sid];
    session.pendingApproval = { id: "c1" } as PendingApproval;
    store.setDraft(sid, { text: "my draft" });
    store.startReply(sid, "c1");
    const decide = vi.spyOn(store, "decideApproval");
    await flushPromises();
    await wrapper.get('[data-test="assistant-composer-notice-replyCancel"]').trigger("click");
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
    const { wrapper, store, sid } = setup();
    store.drafts.storageBlocked.value = true;
    await flushPromises();
    expect(wrapper.get('[data-notice="storage"]').attributes("title")).toBe(
      "Drafts won't be kept if you reload this page.",
    );
    store.addChip(sid, ROW);
    await flushPromises();
    expect(wrapper.find('[data-notice="storage"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-context-sees"]').trigger("click");
    await flushPromises();
    expect(
      document.body
        .querySelector('[data-test="assistant-composer-storage-blocked"]')
        ?.textContent?.trim(),
    ).toBe("Drafts won't be kept if you reload this page.");
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

  it("queues one message on Enter while answering, then refuses a second with both kept (CT-09 AC 4, B-composer-12)", async () => {
    const { wrapper, send, store, sid, textarea, status } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "next");
    expect(wrapper.get('[data-notice="answering"]').attributes("title")).toBe(
      "Answer running · Enter queues this",
    );
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(store.state.sessions[sid].composer.text).toBe("");
    expect(wrapper.get('[data-notice="queued"]').text()).toContain("1 queued");
    expect(status()).toBe("1 queued");
    await type(textarea(), "and another");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(store.state.sessions[sid].composer.text).toBe("and another");
    const notice = wrapper.get(NOTICE);
    expect(notice.attributes("data-notice")).toBe("queued");
    expect(wrapper.get('[data-test="assistant-composer-notice-title"]').text()).toBe("1 queued");
    expect(notice.attributes("title")).toMatch(/already queued|queuedAlreadySentence/);
    expect(wrapper.find('[data-test="assistant-composer-notice-editQueued"]').exists()).toBe(true);
    expect(wrapper.find('[data-notice="blocked"]').exists()).toBe(false);
    expect(status()).toMatch(/already queued|queuedAlreadySentence/);
    expect(trackAssistant).toHaveBeenCalledWith("ai_composer_enter_blocked", { reason: "running" });
  });

  it("Edit with text in the field swaps it with the queued message, never joining them (B-composer-12)", async () => {
    const { wrapper, store, sid, textarea, send } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "AAA first queued");
    await textarea().trigger("keydown", { key: "Enter" });
    await type(textarea(), "BBB second");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    await wrapper.get('[data-test="assistant-composer-notice-editQueued"]').trigger("click");
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("AAA first queued");
    expect(queuedOf(sid)?.text).toBe("BBB second");
    expect(wrapper.get('[data-notice="queued"]').attributes("title")).not.toMatch(/already/);
    expect(send).not.toHaveBeenCalled();
  });

  it("the queue stays one message: a refused Enter with an empty field changes nothing (B-composer-12)", async () => {
    const { wrapper, store, sid, textarea } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "only one");
    await textarea().trigger("keydown", { key: "Enter" });
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(queuedOf(sid)?.text).toBe("only one");
    expect(store.state.sessions[sid].composer.text).toBe("");
    expect(wrapper.find('[data-notice="blocked"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-composer-notice-editQueued"]').exists()).toBe(true);
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

  it("moves to the first and last option on Home and End, keeping the menu open", async () => {
    seedMentionGroups();
    queryClient.setQueryData(streamKeys.nameList("default", "logs"), [
      { name: "checkout" },
      { name: "payments" },
      { name: "search" },
    ]);
    const { textarea } = setup();
    textarea().element.focus();
    await type(textarea(), "@");
    const first = textarea().attributes("aria-activedescendant");
    expect(first).toBeTruthy();
    await textarea().trigger("keydown", { key: "End" });
    await flushPromises();
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    const last = textarea().attributes("aria-activedescendant");
    expect(last).toBeTruthy();
    expect(last).not.toBe(first);
    await textarea().trigger("keydown", { key: "Home" });
    await flushPromises();
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
    expect(textarea().attributes("aria-activedescendant")).toBe(first);
  });

  it("never sends a message that is only @", async () => {
    const { wrapper, textarea, send } = setup();
    textarea().element.focus();
    await type(textarea(), " @ ");
    await textarea().trigger("keydown", { key: "Escape" });
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBe("true");
    await textarea().trigger("keydown", { key: "Enter" });
    await wrapper.get('[data-test="assistant-send"]').trigger("click");
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("agent mention in a floating chat (MULTI-AGENT-02)", () => {
  it("changes the chat it was typed in, leaving the active sidebar chat alone", async () => {
    seedMentionGroups();
    fake.current = fakeAssistant("available", {
      agents: [
        { id: "o2-ai", pickable: true, available: true },
        { id: "sre", pickable: true, available: true },
      ],
    });
    const store = fake.current.store;
    const sidebar = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    const floating = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "window" },
      detached: true,
    });
    store.floatChat(floating, { focus: "none" });
    expect(store.state.shell.activeSid).toBe(sidebar);
    const wrapper = mount(AssistantComposer, {
      props: { sid: floating },
      global: { plugins: [fakeRouter(), fakeVuex()] },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    const field = wrapper.get<HTMLTextAreaElement>('[data-test="assistant-composer-field"]');
    field.element.focus();
    await type(field, "why @inv");
    await field.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(store.state.sessions[floating].agentId).toBe("sre");
    expect(store.state.sessions[sidebar].agentId).toBeUndefined();
  });
});

describe("prefill (IW-06, `70` §5)", () => {
  it("asks Replace · Append · Cancel over a long draft, and Cancel keeps it", async () => {
    const { wrapper, textarea, store, sid } = setup();
    const long = "x".repeat(PREFILL_CHOICE_CHARS + 1);
    await type(textarea(), long);
    (wrapper.vm as unknown as { prefill(p: { text: string; chips: ContextChip[] }): void }).prefill(
      { text: "starter", chips: [] },
    );
    await flushPromises();
    expect(wrapper.find('[data-notice="prefill"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-composer-notice-prefillCancel"]').trigger("click");
    expect(store.state.sessions[sid].composer.text).toBe(long);
    (wrapper.vm as unknown as { prefill(p: { text: string; chips: ContextChip[] }): void }).prefill(
      { text: "starter", chips: [] },
    );
    await flushPromises();
    await wrapper.get('[data-test="assistant-composer-notice-prefillAppend"]').trigger("click");
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
    const replace = wrapper.get('[data-test="assistant-composer-notice-prefillReplace"]')
      .element as HTMLElement;
    const handled = runEscapeLadder(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handled).toBe(false);
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(event, "target", { value: replace });
    expect(runEscapeLadder(event)).toBe(true);
    await flushPromises();
    expect(wrapper.find('[data-notice="prefill"]').exists()).toBe(false);
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
    expect(wrapper.get(NOTICE).attributes("title")).toBe("2 images weren't kept across the reload");
  });

  it("shows New chat's Draft cleared with an Undo for 10 s that restores into the new chat (AC 5)", async () => {
    const { wrapper, store, sid } = setup();
    const undo = vi.spyOn(store, "undoClear");
    noteDraftCleared(sid, { token: "t1", at: Date.now() });
    await flushPromises();
    expect(wrapper.get('[data-notice="cleared"]').attributes("title")).toContain("Draft cleared");
    await wrapper.get('[data-test="assistant-composer-notice-undo"]').trigger("click");
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
    expect(wrapper.get('[data-notice="cleared"]').attributes("title")).toBe(
      "Draft from default cleared",
    );
    expect(wrapper.find('[data-test="assistant-composer-undo"]').exists()).toBe(false);
    expect(textarea().element.value).toBe("");
  });
});

describe("images (CT-10)", () => {
  const png = (name: string, size = 10) =>
    new File([new Uint8Array(size)], name, { type: "image/png" });

  it("names pasted shots uniquely (AC 1)", async () => {
    const { textarea, store, sid } = setup();
    for (let i = 0; i < 2; i++) {
      await textarea().trigger("paste", {
        clipboardData: { files: [png("image.png")], getData: () => "" },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await flushPromises();
    const names = store.state.sessions[sid].composer.images.map(
      (i: { filename: string }) => i.filename,
    );
    expect(names).toEqual(["pasted-image-1.png", "pasted-image-2.png"]);
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

describe("boards 04–06: inert field, error row, Stop and Send (S3, S4, S6, S7)", () => {
  class FakeObserver {
    static last: FakeObserver | null = null;
    readonly targets: Element[] = [];
    constructor(private readonly changed: IntersectionObserverCallback) {
      FakeObserver.last = this;
    }
    observe = (target: Element) => void this.targets.push(target);
    disconnect = () => undefined;
    fire(shown: boolean): void {
      this.changed(
        this.targets.map((target) => ({ target, isIntersecting: shown })) as never,
        this as never,
      );
    }
  }

  const PICKABLE = [
    { id: "o2-ai", pickable: true, available: true },
    { id: "sre", pickable: true, available: true },
  ];

  function withCard(host: HTMLElement): void {
    const card = document.createElement("div");
    card.setAttribute("data-test", "assistant-approval-card");
    host.prepend(card);
  }

  afterEach(() => {
    FakeObserver.last = null;
    vi.unstubAllGlobals();
  });

  it("says Decide above to continue in the strip with the pause glyph, for an approval and for consent", async () => {
    const { wrapper, store, sid } = setup();
    const inert = () => wrapper.find('[data-notice="inert"]');
    expect(inert().exists()).toBe(false);
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    await flushPromises();
    expect(inert().findComponent(OIcon).props("name")).toBe("pause");
    expect(inert().attributes("title")).toBe("Decide above to continue");
    store.state.sessions[sid].pendingApproval = null;
    store.state.sessions[sid].pendingConsent = { id: "p1" } as never;
    await flushPromises();
    expect(inert().exists()).toBe(true);
    store.state.sessions[sid].pendingConsent = null;
    await flushPromises();
    expect(inert().exists()).toBe(false);
  });

  it("reads Answer above to continue under a question card, and says it on Enter", async () => {
    const { wrapper, store, sid, textarea, status } = setup();
    store.state.sessions[sid].pendingApproval = { id: "q1", kind: "question" } as PendingApproval;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe("inert");
    expect(wrapper.get('[data-notice="inert"]').attributes("title")).toBe(
      "Answer above to continue",
    );
    await textarea().trigger("keydown", { key: "Enter" });
    expect(status()).toBe("Answer above to continue");
  });

  it("offers Go to request only while the card is out of view, and it focuses the card", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { wrapper, store, sid, host } = setup();
    withCard(host);
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    await flushPromises();
    const goTo = () => wrapper.find('[data-test="assistant-composer-notice-goToRequest"]');
    expect(FakeObserver.last?.targets).toHaveLength(1);
    FakeObserver.last!.fire(true);
    await flushPromises();
    expect(goTo().exists()).toBe(false);
    FakeObserver.last!.fire(false);
    await flushPromises();
    expect(goTo().text()).toBe("Go to request");
    expect(goTo().classes()).toEqual(
      expect.arrayContaining(["max-md:min-h-11!", "pointer-coarse:min-h-11!"]),
    );
    const focusCard = vi.fn(() => true);
    const off = registerAssistantFocusTarget("card", focusCard);
    await goTo().trigger("click");
    off();
    expect(focusCard).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal as one strip line, never a banner, with the full sentence in title=", async () => {
    const { wrapper, store, sid } = setup();
    store.setDraft(sid, { text: "why?" });
    store.state.sessions[sid].turn = { state: "refused", error: { code: "unreachable" } } as never;
    store.state.sessions[sid].turnMeta.endedAt = Date.now();
    await flushPromises();
    const row = wrapper.get(NOTICE);
    expect(row.findComponent(OIcon).props("name")).toBe("warning");
    expect(row.classes().join(" ")).not.toMatch(/bg-|border/);
    expect(row.text().length).toBeGreaterThan(0);
    expect(wrapper.findAllComponents(OBanner)).toHaveLength(0);
  });

  it("makes Stop and the icon Send the 32 px md size", async () => {
    const { wrapper, store, sid } = setup();
    expect(wrapper.get('[data-test="assistant-send"]').attributes("data-size")).toBe("md");
    store.state.sessions[sid].turn = { state: "connecting" } as never;
    await flushPromises();
    const stop = wrapper.get('[data-test="assistant-stop"]');
    expect(stop.attributes("data-size")).toBe("md");
    expect(stop.classes()).toEqual(expect.arrayContaining(["h-8", "w-8", "rounded-full"]));
    expect(wrapper.find('[data-test="assistant-send"]').exists()).toBe(false);
    expect(stop.element.parentElement!.getAttribute("data-test")).toBe(
      "assistant-composer-bar-right",
    );
  });

  it("keeps Send one round icon and names the agent, a reply or an answer in its label", async () => {
    const { wrapper, store, sid } = setup();
    fake.current.capability.value = { ...fake.current.capability.value, agents: PICKABLE };
    await flushPromises();
    const send = () => wrapper.get('[data-test="assistant-send"]');
    expect(send().attributes("aria-label")).toBe("Send message");
    expect(send().classes()).toEqual(expect.arrayContaining(["h-8", "rounded-full"]));
    store.state.sessions[sid].nextAgentId = "sre";
    await flushPromises();
    expect(send().attributes("aria-label")).toBe("Send to Investigator");
    expect(wrapper.get('[data-test="assistant-agent-picker"]').text()).toBe("Investigator");
    store.state.sessions[sid].nextAgentId = null as never;
    store.state.sessions[sid].pendingApproval = { id: "c1" } as PendingApproval;
    store.startReply(sid, "c1");
    await flushPromises();
    expect(send().attributes("aria-label")).toBe("Send reply");
    store.state.sessions[sid].pendingApproval = { id: "c1", kind: "question" } as PendingApproval;
    await flushPromises();
    expect(send().attributes("aria-label")).toBe("Send answer");
  });
});

describe("one frame, the + menu and long pastes (D4 §3.1, §3.6, §3.9)", () => {
  const long = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
  const paste = (textarea: ReturnType<ReturnType<typeof setup>["textarea"]>, text: string) =>
    textarea.trigger("paste", { clipboardData: { files: [], getData: () => text } });

  it("holds the text and the controls inside the one bordered frame", () => {
    const { wrapper, textarea } = setup();
    const frame = textarea().element.parentElement!;
    expect(frame.className).toContain("border");
    expect(frame.querySelector('[data-test="assistant-composer-bar"]')).not.toBeNull();
    expect(frame.querySelector('[data-test="assistant-composer-plus"]')).not.toBeNull();
    expect(frame.querySelector('[data-test="assistant-send"]')).not.toBeNull();
    expect(wrapper.find('[data-test="assistant-composer-hints"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-add-context"]').exists()).toBe(false);
  });

  it("opens the file picker from the + menu's Attach Image", async () => {
    const { wrapper } = setup();
    expect(wrapper.get('[data-test="assistant-composer-plus"]').attributes("aria-label")).toBe(
      "Add to Message",
    );
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    plus(wrapper, "attach");
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLInputElement).type).toBe("file");
    click.mockRestore();
  });

  it("types an @ at the caret from the + menu's Add Context and opens the mention menu", async () => {
    const { wrapper, textarea } = setup();
    await type(textarea(), "why is checkout slow");
    textarea().element.setSelectionRange(6, 6);
    plus(wrapper, "context");
    await flushPromises();
    expect(textarea().element.value).toBe("why is @ checkout slow");
    expect(document.activeElement).toBe(textarea().element);
    expect(textarea().element.selectionStart).toBe(8);
    expect(textarea().attributes("aria-controls")).toMatch(/^assistant-mention-/);
  });

  it("opens the bottom time pill's picker from the + menu, and a pick changes the pill without a strip", async () => {
    fake.current = fakeAssistant();
    const sid = fake.current.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    const wrapper = mount(AssistantComposer, {
      props: { sid },
      global: { plugins: [fakeRouter(), fakeVuex()] },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    const pill = () => wrapper.get('[data-test="assistant-context-chip-time"]');
    expect(pill().text()).toBe("Last 15 min");
    plus(wrapper, "time");
    await flushPromises();
    expect(
      document.body.querySelector('[data-test="assistant-context-time-picker"]'),
    ).not.toBeNull();
    (
      document.body.querySelector('[data-test="assistant-context-time-24h"]') as HTMLElement
    ).click();
    await flushPromises();
    expect(pill().text()).toBe("Last 24 h");
    expect(fake.current.store.state.sessions[sid].composer.timeOverride).toMatchObject({
      period: "24h",
    });
    expect(wrapper.find('[data-test="assistant-composer-strip"]').exists()).toBe(false);
  });

  it("shows the agent as a pill, which opens the agent menu once there is a choice", async () => {
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-agent-picker"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-agent-pill"]').text()).toBe("O2 Assistant");
    fake.current.capability.value = {
      ...fake.current.capability.value,
      agents: [
        { id: "o2-ai", pickable: true, available: true },
        { id: "sre", pickable: true, available: true },
      ],
    };
    await flushPromises();
    const picker = wrapper.get('[data-test="assistant-agent-picker"]');
    expect(
      wrapper.get('[data-test="assistant-composer-bar-left"]').element.contains(picker.element),
    ).toBe(true);
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-label")).toBe(
      "Send message",
    );
  });

  it("turns a long paste into a Pasted text chip and offers it back as text until the next edit", async () => {
    const { wrapper, textarea, store, sid } = setup();
    await type(textarea(), "see ");
    textarea().element.setSelectionRange(4, 4);
    await paste(textarea(), long);
    await flushPromises();
    const chips = () => store.state.sessions[sid].composer.chips as ContextChip[];
    expect(chips().map((chip) => [chip.kind, chip.label, chip.data])).toEqual([
      ["pasted_text", "Pasted text · 25 lines", long],
    ]);
    expect(store.state.sessions[sid].composer.text).toBe("see ");
    expect(wrapper.get(NOTICE).attributes("title")).toBe("Long paste attached as text.");
    expect(wrapper.get('[data-test="assistant-composer-notice-title"]').text()).toBe(
      "Pasted 25 lines",
    );
    await wrapper.get('[data-test="assistant-composer-notice-pasteInline"]').trigger("click");
    await flushPromises();
    expect(chips()).toEqual([]);
    expect(store.state.sessions[sid].composer.text).toBe(`see ${long}`);
    await paste(textarea(), long);
    await flushPromises();
    await type(textarea(), "edited");
    expect(wrapper.find('[data-test="assistant-composer-notice-pasteInline"]').exists()).toBe(
      false,
    );
    expect(chips()).toHaveLength(1);
  });

  it("leaves a short paste, and one over the attached-data cap, to the textbox", async () => {
    const { textarea, store, sid } = setup();
    await paste(textarea(), "a\nb\nc");
    await paste(textarea(), "x".repeat(40 * 1024));
    await flushPromises();
    expect(store.state.sessions[sid].composer.chips).toEqual([]);
    expect(trackAssistant).toHaveBeenCalledWith("ai_composer_cap_hit", { cap: "bytes" });
  });

  it("keeps the pasted text chip in the stored draft (D4 §3.11)", async () => {
    vi.useFakeTimers();
    const { textarea, store, sid } = setup();
    await paste(textarea(), long);
    await vi.advanceTimersByTimeAsync(1_000);
    const stored = store.drafts.read(store.state.userOrgKey, sid);
    expect(stored?.chips.map((chip: ContextChip) => [chip.kind, chip.data])).toEqual([
      ["pasted_text", long],
    ]);
    vi.useRealTimers();
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
  it("is the credits-out composer: strip notice, Send held, draft kept, image and mic on (K7)", async () => {
    const { wrapper, store, sid, textarea, send, status } = setup();
    store.setDraft(sid, { text: "Which checkout pods restarted?" });
    store.state.capability.creditMode = "exhausted";
    await flushPromises();
    const notice = () => wrapper.get('[data-notice="credits"]');
    expect(wrapper.get('[data-test="assistant-composer-notice-title"]').text()).toBe(
      "AI credits used up",
    );
    expect(notice().attributes("title")).toBe("AI credits are used up for default.");
    expect(wrapper.get('[data-test="assistant-send"]').attributes("aria-disabled")).toBe("true");
    expect(
      wrapper.get('[data-test="assistant-composer-plus"]').attributes("aria-disabled"),
    ).toBeUndefined();
    await textarea().trigger("keydown", { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    expect(status()).toBe("AI credits are used up for default.");
    expect(textarea().element.value).toBe("Which checkout pods restarted?");
    store.state.capability.creditMode = undefined;
    store.state.sessions[sid].turn = {
      state: "refused",
      error: {
        code: "credits_exhausted",
        phase: "pre_admission",
        retryable: false,
        action: "none",
      },
    } as never;
    await flushPromises();
    expect(notice().attributes("title")).toBe(
      "AI credits are used up for default. Your message wasn't sent.",
    );
  });

  it("keeps the used-up credits line while the chat's history is unavailable", async () => {
    const { wrapper, store, sid } = setup();
    store.state.capability.creditMode = "exhausted";
    store.state.sessions[sid].record.historyUnavailable = true;
    await flushPromises();
    expect(wrapper.get(NOTICE).attributes("title")).toContain("AI credits are used up for");
    store.state.capability.creditMode = undefined;
  });

  it("sends the queued message when the answer ends, and drops the held reason (U8)", async () => {
    const { wrapper, store, sid, textarea, send } = setup();
    const resend = vi.spyOn(store, "resend").mockResolvedValue(undefined as never);
    const sent: string[] = [];
    send.mockImplementation(async (id) => {
      sent.push(store.state.sessions[id].composer.text);
      store.setDraft(id, { text: "" });
      return { state: "done", saved: "server" };
    });
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "next");
    await textarea().trigger("keydown", { key: "Enter" });
    await textarea().trigger("keydown", { key: "Enter" });
    store.state.sessions[sid].turn = { state: "done", saved: "server" };
    await flushPromises();
    expect(sent).toEqual(["next"]);
    expect(resend).not.toHaveBeenCalled();
    expect(store.state.sessions[sid].composer.text).toBe("");
    expect(wrapper.find('[data-notice="queued"]').exists()).toBe(false);
    expect(wrapper.find('[data-notice="blocked"]').exists()).toBe(false);
  });

  it("Q1: a queued message keeps its staged chip and time window, and the next draft does not inherit the chip", async () => {
    const { store, sid, textarea, send } = setup();
    const window = { from: 1_700_000_000_000_000, to: 1_700_000_900_000_000 };
    const sent: { text: string; chips: string[]; timeOverride: unknown }[] = [];
    send.mockImplementation(async (id) => {
      const { text, chips, timeOverride } = store.state.sessions[id].composer;
      sent.push({ text, chips: chips.map((chip) => chip.id), timeOverride });
      return { state: "done", saved: "server" };
    });
    store.state.sessions[sid].turn = { state: "responding" } as never;
    store.addChip(sid, ROW);
    store.setDraft(sid, { timeOverride: window });
    await type(textarea(), "why this row?");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.chips.map((chip) => chip.id)).not.toContain("row-1");
    expect(queuedOf(sid)?.snapshot.chips.map((chip) => chip.id)).toContain("row-1");
    store.state.sessions[sid].turn = { state: "done", saved: "server" };
    await flushPromises();
    expect(sent).toEqual([
      { text: "why this row?", chips: expect.arrayContaining(["row-1"]), timeOverride: window },
    ]);
  });

  it("Q3: a queued message waits in the field instead of sending while the chat's access is lost", async () => {
    const { store, sid, textarea, send, wrapper } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "next");
    await textarea().trigger("keydown", { key: "Enter" });
    await wrapper.setProps({ accessLost: true });
    store.state.sessions[sid].turn = { state: "done", saved: "server" };
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(store.state.sessions[sid].composer.text).toBe("next");
  });

  it("Edit takes the queued message back into the field", async () => {
    const { wrapper, store, sid, textarea, send } = setup();
    store.state.sessions[sid].turn = { state: "responding" } as never;
    await type(textarea(), "next");
    await textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    await wrapper.get('[data-test="assistant-composer-notice-editQueued"]').trigger("click");
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("next");
    store.state.sessions[sid].turn = { state: "done", saved: "server" };
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
  });

  it("ends the Undo offer on the first keystroke in the new chat, so Undo never replaces new work (U9)", async () => {
    const { wrapper, sid, textarea } = setup();
    noteDraftCleared(sid, { token: "t1", at: Date.now() });
    await flushPromises();
    expect(wrapper.find('[data-notice="cleared"]').exists()).toBe(true);
    await type(textarea(), "a new question");
    expect(wrapper.find('[data-notice="cleared"]').exists()).toBe(false);
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
      wrapper.get('[data-test="assistant-composer-notice-prefillAppend"]').element,
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

  it("offers Recent Prompts in the + menu on touch and returns focus to + when its sheet is dismissed (U20)", async () => {
    breakpoint.md = false;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("coarse") }));
    const { wrapper } = setup();
    vi.unstubAllGlobals();
    const state = (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$
      .setupState;
    state.recallEntries = [{ text: "earlier question", chips: [], at: 1 }];
    await flushPromises();
    expect(wrapper.findComponent(AssistantComposerPlusMenu).props("actions")).toContain("recall");
    plus(wrapper, "recall");
    await flushPromises();
    (
      document.body.querySelector('[data-test="assistant-recall-sheet-close"]') as HTMLElement
    ).click();
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-composer-plus"]').element,
    );
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
    expect(wrapper.find('[data-test="assistant-composer-notice-undo"]').exists()).toBe(false);
    noteDraftCleared(sid, { token: null, from: other, at: Date.now() + 1 });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-composer-notice-bringDraft"]').text()).toBe(
      "Bring it here",
    );
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

  it("keeps Stop the same control in the Send slot after 30 s without a frame (HT-01 AC 3)", async () => {
    vi.useFakeTimers({ now: 100_000 });
    try {
      const { wrapper, store, sid } = setup();
      const session = store.state.sessions[sid];
      session.turn = { state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" };
      session.turnMeta.startedAt = 100_000;
      session.turnMeta.lastFrameAt = 100_000;
      await flushPromises();
      const stop = () => wrapper.get('[data-test="assistant-stop"]');
      const before = [stop().element, stop().attributes("class")];
      await vi.advanceTimersByTimeAsync(31_000);
      expect([stop().element, stop().attributes("class")]).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dictation (WP-48)", () => {
  let engine: ReturnType<typeof fakeVoiceEngine>;

  const mic = (wrapper: ReturnType<typeof setup>["wrapper"]) =>
    wrapper.get('[data-test="assistant-dictate"]');
  const helper = (wrapper: ReturnType<typeof setup>["wrapper"]) => wrapper.find(NOTICE);

  function voiceSetup(props: Partial<AssistantComposerProps> = {}) {
    localStorage.setItem("o2.assistant.hints:k1", JSON.stringify({ dictate: true }));
    const ctx = setup(props);
    setVoiceOptIn("k1", true);
    return ctx;
  }

  async function listen(ctx: ReturnType<typeof setup>) {
    await flushPromises();
    await mic(ctx.wrapper).trigger("click");
    await flushPromises();
    engine.handlers!.onStart();
    await flushPromises();
  }

  beforeEach(() => {
    engine = fakeVoiceEngine();
    resetVoiceForTests(engine);
  });

  afterEach(() => {
    resetVoiceForTests();
    vi.useRealTimers();
  });

  it("renders no mic for a member while dictation is off in this browser (A5, A30)", async () => {
    fake.member = true;
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-dictate"]').exists()).toBe(false);
    setVoiceOptIn("k1", true);
    await flushPromises();
    expect(mic(wrapper).attributes("aria-label")).toBe("Dictate");
    expect(mic(wrapper).attributes("aria-pressed")).toBe("false");
  });

  it("offers an admin Turn on in the strip, which makes the mic live; nothing floats", async () => {
    const { wrapper } = setup();
    expect(wrapper.findComponent(AssistantDictateButton).findComponent(OIcon).props("name")).toBe(
      "mic",
    );
    await mic(wrapper).trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.get('[data-notice="voice"]').attributes("title")).toBe(
      "Dictation is off in this browser.",
    );
    await wrapper.get('[data-test="assistant-composer-notice-turnOn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-notice="voice"]').exists()).toBe(false);
    expect(engine.handlers).toBeNull();
    await mic(wrapper).trigger("click");
    await flushPromises();
    expect(engine.handlers).not.toBeNull();
  });

  it("renders the mic on Cloud by default", async () => {
    const { wrapper } = setup();
    fake.current.capability.value.edition = "cloud";
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-dictate"]').exists()).toBe(true);
  });

  it("renders no mic in a browser that cannot dictate", async () => {
    engine.isAvailable = false;
    const { wrapper } = voiceSetup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-dictate"]').exists()).toBe(false);
  });

  it("renders no Turn on for an admin in a browser that cannot dictate", async () => {
    engine.isAvailable = false;
    const { wrapper } = setup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-dictate"]').exists()).toBe(false);
  });

  it("renders no mic on a touch device below md (decision 21)", async () => {
    breakpoint.md = false;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { wrapper } = voiceSetup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-dictate"]').exists()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("starts the first dictation at once with no primer, and its placeholder teaches Enter once", async () => {
    const ctx = setup();
    setVoiceOptIn("k1", true);
    await listen(ctx);
    expect(document.body.querySelector('[data-test="assistant-dictate-primer"]')).toBeNull();
    expect(ctx.textarea().attributes("placeholder")).toBe("Listening… press ↵ to send");
    expect(JSON.parse(localStorage.getItem("o2.assistant.hints:k1")!).dictate).toBe(true);
    await mic(ctx.wrapper).trigger("click");
    await flushPromises();
    expect(ctx.textarea().attributes("placeholder")).toBe("Ask anything · @ to add context");
    await listen(ctx);
    expect(ctx.textarea().attributes("placeholder")).toBe("Ask anything · @ to add context");
  });

  it("shows the waiting line with the mic pressed, and a press cancels", async () => {
    engine.holdPrompt = true;
    const ctx = voiceSetup();
    await flushPromises();
    await mic(ctx.wrapper).trigger("click");
    await flushPromises();
    expect(ctx.wrapper.get('[data-notice="voice"]').attributes("title")).toBe(
      "Waiting for permission",
    );
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("true");
    expect(ctx.status()).toBe("Waiting for permission");

    await mic(ctx.wrapper).trigger("click");
    await flushPromises();
    expect(ctx.wrapper.find('[data-notice="voice"]').exists()).toBe(false);
    expect(ctx.status()).toBe("Dictation cancelled.");
  });

  it("shows listening in the bottom row just left of the mic, and says the start once", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("true");
    expect(mic(ctx.wrapper).attributes("aria-label")).toBe("Dictate");
    const wave = ctx.wrapper.get('[data-test="assistant-dictate-wave"]');
    expect(wave.findAll(".assistant-wave")).toHaveLength(14);
    expect(wave.get('[data-test="assistant-dictate-elapsed"]').text()).toBe("0:00");
    const right = ctx.wrapper.get('[data-test="assistant-composer-bar-right"]').element;
    expect(wave.element.parentElement).toBe(right);
    expect(wave.element.nextElementSibling).toBe(mic(ctx.wrapper).element);
    expect(ctx.textarea().classes()).not.toContain("pe-24!");
    expect(mic(ctx.wrapper).attributes("data-on")).toBeDefined();
    expect(mic(ctx.wrapper).element.parentElement).toBe(
      ctx.wrapper.get('[data-test="assistant-composer-bar-right"]').element,
    );
    expect(helper(ctx.wrapper).exists()).toBe(false);
    expect(ctx.status()).toBe("Listening. Press Enter, Escape or the mic to stop.");
    expect(ctx.textarea().attributes("data-test")).toBe("assistant-composer-field");
    expect(ctx.wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe(
      "listening",
    );
  });

  it("shows the tail in the box but never in the draft, and stays quiet per word", async () => {
    const ctx = voiceSetup();
    await type(ctx.textarea(), "why");
    await listen(ctx);
    const said = ctx.status();

    engine.handlers!.onResults([{ index: 0, text: "cart fail", final: false }]);
    await flushPromises();

    expect(ctx.textarea().element.value).toBe("why cart fail");
    expect(ctx.store.state.sessions[ctx.sid].composer.text).toBe("why");
    expect(ctx.wrapper.get('[data-test="assistant-dictate-tail"]').text()).toContain("cart fail");
    expect(ctx.status()).toBe(said);
  });

  it("takes a typed edit of the tail as settled, as shown", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    engine.handlers!.onResults([{ index: 0, text: "cart", final: false }]);
    await flushPromises();

    await type(ctx.textarea(), "carts");
    engine.handlers!.onResults([{ index: 0, text: "cart failed", final: true }]);
    await flushPromises();

    expect(ctx.store.state.sessions[ctx.sid].composer.text).toBe("carts");
  });

  it("makes Enter settle, not send, and the next Enter send (CT-17 AC 6)", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    engine.handlers!.onResults([{ index: 0, text: "two words", final: false }]);
    await flushPromises();

    await ctx.textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.store.state.sessions[ctx.sid].composer.text).toBe("two words");
    expect(helper(ctx.wrapper).attributes("title")).toBe("Press Enter again to send.");
    expect(ctx.status()).toBe("Dictation stopped. 2 words added. Press Enter to send.");

    await ctx.textarea().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(ctx.send).toHaveBeenCalledTimes(1);
  });

  it("makes Send settle first even from an empty draft", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    await ctx.wrapper.get('[data-test="assistant-send"]').trigger("click");
    await flushPromises();
    expect(ctx.send).not.toHaveBeenCalled();
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("false");
  });

  it("stops on Escape through rung a2, ahead of the container rungs", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(event, "target", { value: ctx.textarea().element });

    expect(runEscapeLadder(event)).toBe(true);
    await flushPromises();

    expect(ctx.status()).toBe("Dictation stopped. 0 words added.");
    expect(runEscapeLadder(event)).toBe(false);
  });

  it("settles in the original chat when the visible chat changes", async () => {
    const ctx = voiceSetup();
    await type(ctx.textarea(), "start");
    await listen(ctx);
    engine.handlers!.onResults([{ index: 0, text: "for chat one", final: false }]);
    await flushPromises();
    const other = ctx.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });

    await ctx.wrapper.setProps({ sid: other });
    await flushPromises();

    expect(other).not.toBe(ctx.sid);
    expect(ctx.store.state.sessions[ctx.sid].composer.text).toBe("start for chat one");
    expect(ctx.store.state.sessions[other].composer.text).toBe("");
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("false");
  });

  it("stops when a card arrives; the inert frame keeps the mic, crossed and off", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    ctx.store.state.sessions[ctx.sid].pendingConsent = { id: "c1" } as never;
    await flushPromises();
    expect(ctx.wrapper.get('[data-test="assistant-composer"]').attributes("data-state")).toBe(
      "inert",
    );
    expect(mic(ctx.wrapper).attributes("aria-disabled")).toBe("true");
    expect(engine.abort).toHaveBeenCalled();
  });

  it("stops when the composer is hidden, and on unmount", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    await ctx.wrapper.setProps({ visible: false });
    await flushPromises();
    expect(engine.abort).toHaveBeenCalledTimes(1);

    await ctx.wrapper.setProps({ visible: true });
    await listen(ctx);
    ctx.wrapper.unmount();
    expect(engine.abort).toHaveBeenCalledTimes(2);
  });

  it("settles before ↑ recalls", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    engine.handlers!.onResults([{ index: 0, text: "kept", final: false }]);
    await flushPromises();
    await ctx.textarea().trigger("keydown", { key: "ArrowUp" });
    await flushPromises();
    expect(ctx.store.state.sessions[ctx.sid].composer.text).toBe("kept");
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("false");
  });

  it("shows the blocked mic with How to allow it, and leaves typed text alone", async () => {
    engine.rejectMic = Object.assign(new Error("no"), { name: "NotAllowedError" });
    const ctx = voiceSetup();
    await type(ctx.textarea(), "typed");
    await flushPromises();
    await mic(ctx.wrapper).trigger("click");
    await flushPromises();

    expect(helper(ctx.wrapper).attributes("title")).toBe(
      "Microphone access is blocked for this site.",
    );
    expect(ctx.wrapper.get('[data-test="assistant-composer-notice-title"]').text()).toBe(
      "Microphone blocked",
    );
    expect(ctx.status()).toBe("Microphone access is blocked for this site.");
    expect(mic(ctx.wrapper).attributes("aria-disabled")).toBe("true");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await ctx.wrapper.get('[data-test="assistant-composer-notice-micHelp"]').trigger("click");
    expect(open.mock.calls[0]?.[0]).toMatch(/^https:\/\/support\.google\.com\//);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    open.mockRestore();
    expect(ctx.store.state.sessions[ctx.sid].composer.text).toBe("typed");
  });

  it("offers Retry for an unreachable service, naming the vendor", async () => {
    const ctx = voiceSetup();
    await listen(ctx);
    engine.handlers!.onError("network");
    await flushPromises();
    expect(helper(ctx.wrapper).attributes("title")).toBe("Couldn't reach Google's speech service.");
    await ctx.wrapper.get('[data-test="assistant-composer-notice-voiceRetry"]').trigger("click");
    await flushPromises();
    expect(helper(ctx.wrapper).exists() && helper(ctx.wrapper).attributes("title")).not.toBe(
      "Couldn't reach Google's speech service.",
    );
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("true");
  });

  it("keeps a disabled mic with the reason once the browser proved silent (B58)", async () => {
    vi.useFakeTimers();
    const ctx = voiceSetup();
    await vi.advanceTimersByTimeAsync(0);
    await mic(ctx.wrapper).trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    engine.handlers!.onStart();
    engine.meter.db = -30;
    await vi.advanceTimersByTimeAsync(SILENCE_MS);
    const line = "Your browser didn't turn speech into text. Reload to try again.";
    expect(helper(ctx.wrapper).attributes("title")).toBe(line);
    expect(mic(ctx.wrapper).attributes("aria-disabled")).toBe("true");
  });

  it("turns the mic off offline unless the engine runs on the device", async () => {
    const ctx = voiceSetup();
    await flushPromises();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    await flushPromises();
    expect(mic(ctx.wrapper).attributes("aria-disabled")).toBe("true");
    expect(helper(ctx.wrapper).attributes("title")).toBe("You're offline. Draft kept.");
    online.mockRestore();
    window.dispatchEvent(new Event("online"));
  });

  it("dictates on a held chord in the focused box, and stops on release", async () => {
    const ctx = voiceSetup();
    await flushPromises();
    vi.useFakeTimers();
    ctx.textarea().element.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true }));
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    engine.handlers!.onStart();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.wrapper.find('[data-test="assistant-dictate-wave"]').exists()).toBe(true);
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "i" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mic(ctx.wrapper).attributes("aria-pressed")).toBe("false");
  });

  it("takes a tap of the chord to the waiting request and starts nothing", async () => {
    const ctx = voiceSetup();
    ctx.store.state.sessions[ctx.sid].pendingApproval = { id: "c1" } as PendingApproval;
    await flushPromises();
    const focusCard = vi.fn(() => true);
    const off = registerAssistantFocusTarget("card", focusCard);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "i" }));
    off();
    expect(focusCard).toHaveBeenCalled();
    expect(engine.handlers).toBeNull();
  });

  it("does not dictate on a hold while a card holds the composer", async () => {
    const ctx = voiceSetup();
    ctx.store.state.sessions[ctx.sid].pendingConsent = { id: "c1" } as never;
    await flushPromises();
    vi.useFakeTimers();
    ctx.textarea().element.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true }));
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(engine.handlers).toBeNull();
  });

  it("does not start while an IME is composing", async () => {
    const ctx = voiceSetup();
    await flushPromises();
    ctx.textarea().element.dispatchEvent(new Event("compositionstart"));
    await mic(ctx.wrapper).trigger("click");
    await flushPromises();
    expect(engine.handlers).toBeNull();
  });

  it("keeps focus on a keyboard press and returns it to the box after a pointer press", async () => {
    const ctx = voiceSetup();
    await flushPromises();
    const button = mic(ctx.wrapper).element as HTMLElement;
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await flushPromises();
    expect(document.activeElement).toBe(button);
    engine.handlers!.onStart();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flushPromises();
    expect(document.activeElement).toBe(ctx.textarea().element);
  });
});
