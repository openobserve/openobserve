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
import { computed, nextTick, ref, shallowRef } from "vue";

import type { InlineHostAdapter } from "@/composables/assistant/pure";
import i18n from "@/locales";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";

const { fake, helper, controller, openAssistant, track, toast, rung, usage } = vi.hoisted(() => ({
  fake: { current: null as any },
  helper: { current: null as any },
  controller: { current: null as any },
  openAssistant: vi.fn(async () => ({ ok: true })),
  track: vi.fn(),
  toast: vi.fn(),
  rung: { current: null as null | ((event: KeyboardEvent) => boolean) },
  usage: { current: null as null | { resetsAt?: number } },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useTurnLock: () => computed(() => null),
  useAssistantCredits: () => ({ usage: computed(() => usage.current) }),
  proposalFor: () => controller.current,
  registerEscapeRung: (_key: string, fn: (event: KeyboardEvent) => boolean) => {
    rung.current = fn;
    return () => (rung.current = null);
  },
  openAssistant,
}));
vi.mock("@/composables/assistant/pure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant/pure")>()),
  validateProposal: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("./useInlineHelperSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useInlineHelperSession")>()),
  useInlineHelperSession: () => helper.current,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast,
  useToast: () => ({ toast }),
}));

import { wireContextOf } from "@/composables/assistant/context/serialize";

import InlineQueryHelper from "./InlineQueryHelper.vue";
import { HELPER_SUPPRESSED_PAGE_KEYS } from "./useInlineHelperSession";

function fakeSession() {
  const state = ref<any>({ kind: "idle" });
  return {
    sid: computed(() => "h1"),
    state: computed(() => state.value),
    send: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    recall: vi.fn(() => null),
    reset: vi.fn(),
    set: (next: any) => (state.value = next),
  };
}

function fakeController() {
  const pending = shallowRef<any>(null);
  return {
    pending,
    label: shallowRef(null),
    propose: vi.fn(async () => {
      pending.value = { id: 7, reject: vi.fn() };
      return { decision: new Promise(() => undefined) };
    }),
    annotate: vi.fn(),
    discard: vi.fn(),
    clear: vi.fn(),
    revert: vi.fn(),
  };
}

function mountHelper(host: Partial<InlineHostAdapter> = {}, props: Record<string, unknown> = {}) {
  fake.current = fakeAssistant();
  helper.current = fakeSession();
  controller.current = fakeController();
  const adapter: InlineHostAdapter = {
    id: "logs",
    language: "sql",
    getBuffer: () => "",
    previewInsert: vi.fn(),
    focusEditor: vi.fn(),
    stream: "default",
    ...host,
  };
  return mount(InlineQueryHelper, {
    props: { host: adapter, open: true, ...props },
    attachTo: document.body,
    global: { plugins: [i18n, fakeRouter(), fakeVuex()] },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("InlineQueryHelper", () => {
  it("is a named group that focuses its prompt and keeps the prompt after a send", async () => {
    const wrapper = mountHelper({ getBuffer: () => 'SELECT * FROM "default"' });
    await flushPromises();
    const group = wrapper.get('[data-test="inline-helper"]');
    expect(group.attributes("role")).toBe("group");
    expect(group.attributes("aria-label")).toBe("Ask AI");
    expect(group.attributes("data-dd-privacy")).toBe("mask");
    const prompt = wrapper.get('[data-test="inline-helper-prompt"] textarea');
    expect(document.activeElement).toBe(prompt.element);
    await prompt.setValue("only errors");
    await prompt.trigger("keydown", { key: "Enter" });
    expect(helper.current.send).toHaveBeenCalledWith(
      "only errors",
      expect.objectContaining({ current: 'SELECT * FROM "default"' }),
    );
    expect((prompt.element as HTMLTextAreaElement).value).toBe("only errors");
    wrapper.unmount();
  });

  it("never sends on Shift+Enter or while an IME is composing", async () => {
    const wrapper = mountHelper();
    const prompt = wrapper.get('[data-test="inline-helper-prompt"] textarea');
    await prompt.setValue("errors per service");
    await prompt.trigger("keydown", { key: "Enter", shiftKey: true });
    await prompt.trigger("keydown", { key: "Enter", isComposing: true });
    expect(helper.current.send).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("names what Accept will do to the editor with the mode chip", async () => {
    const plain = mountHelper({ getBuffer: () => "show me errors please" });
    expect(plain.get('[data-test="inline-helper-chip-mode"]').text()).toBe("Replaces current text");
    plain.unmount();
    const query = mountHelper({ getBuffer: () => "SELECT 1" });
    const chip = query.get('[data-test="inline-helper-chip-mode"]');
    expect(chip.text()).toBe("Edits current query");
    expect(chip.attributes("aria-pressed")).toBe("false");
    await chip.trigger("click");
    expect(chip.text()).toBe("Replaces current query");
    await query.get('[data-test="inline-helper-prompt"] textarea').setValue("x y z");
    await query.get('[data-test="inline-helper-send"]').trigger("click");
    expect(helper.current.send).toHaveBeenCalledWith(
      "x y z",
      expect.objectContaining({ current: null }),
    );
    query.unmount();
  });

  it("keeps Send focusable but inert with the reason when the host has no stream", async () => {
    const wrapper = mountHelper({ stream: "" });
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("errors");
    const send = wrapper.get('[data-test="inline-helper-send"]');
    expect(send.attributes("aria-disabled")).toBe("true");
    expect(wrapper.text()).toContain("Select a stream to ask the assistant");
    await send.trigger("click");
    expect(helper.current.send).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("swaps Send for Stop while running, and Stop cancels the turn", async () => {
    const wrapper = mountHelper();
    helper.current.set({
      kind: "running",
      turn: { state: "responding.writing" },
      meta: { turnId: "t", ownedByThisTab: true, startedAt: Date.now() },
    });
    await nextTick();
    expect(wrapper.find('[data-test="inline-helper-send"]').exists()).toBe(false);
    await wrapper.get('[data-test="inline-helper-stop"]').trigger("click");
    expect(helper.current.stop).toHaveBeenCalled();
    helper.current.set({ kind: "stopped" });
    await nextTick();
    expect(wrapper.get('[data-test="inline-helper-status"]').text()).toContain(
      "Stopped. Nothing changed.",
    );
    wrapper.unmount();
  });

  it("puts the helper's stream on the wire in place of the page's suppressed one", async () => {
    const wrapper = mountHelper({ stream: "ta_composer_logs", streamType: "logs" });
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("count per service");
    await wrapper.get('[data-test="inline-helper-send"]').trigger("click");
    const chips = helper.current.send.mock.calls[0][1].chips;
    const wire = wireContextOf(
      { currentPage: "logs", selectedStreams: ["ta_approvals_rca_logs"], streamType: "logs" },
      { chips, timeOverride: null, removedPageKeys: [...HELPER_SUPPRESSED_PAGE_KEYS] },
      { org: "default", now: 1_000_000 },
    );
    expect(wire.selectedStreams).toEqual(["ta_composer_logs"]);
    expect(wire.streamType).toBe("logs");
    wrapper.unmount();
  });

  it("proposes as a diff, checks it, and reports it without a toast", async () => {
    const wrapper = mountHelper();
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("errors");
    await wrapper.get('[data-test="inline-helper-send"]').trigger("click");
    helper.current.set({ kind: "proposal", text: "SELECT 1" });
    await flushPromises();
    expect(controller.current.propose).toHaveBeenCalledWith(
      "SELECT 1",
      expect.objectContaining({ mode: "replace", checks: { state: "checking" } }),
    );
    expect(controller.current.annotate).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ state: "ok" }),
    );
    expect(track).toHaveBeenCalledWith("ai_nl_proposal", expect.anything());
    expect(toast).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("carries a pending proposal into the chat with the Query builder instead of losing it", async () => {
    const wrapper = mountHelper();
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("count per service");
    await wrapper.get('[data-test="inline-helper-send"]').trigger("click");
    helper.current.set({ kind: "proposal", text: "SELECT service, count(*) FROM default" });
    await flushPromises();
    controller.current.pending.value = {
      ...controller.current.pending.value,
      before: "",
      after: "SELECT service, count(*) FROM default",
    };
    await wrapper.get('[data-test="inline-helper-handoff"]').trigger("click");
    await flushPromises();
    const call = openAssistant.mock.calls[0] as unknown as [
      {
        agent?: string;
        seed?: { user: { text: string }; frames: Record<string, unknown>[] }[];
        payload: {
          text?: string;
          title?: unknown;
          chips: { kind: string }[];
          transcript?: { text: string }[];
        };
      },
    ];
    expect(call[0].agent).toBe("generate-query");
    expect(call[0].payload.text).toBeUndefined();
    expect(String(call[0].payload.title)).toBe("count per service");
    expect(call[0].payload.transcript).toBeUndefined();
    expect(call[0].seed).toHaveLength(1);
    expect(call[0].seed![0].user.text).toBe("count per service");
    expect(call[0].seed![0].frames.find((frame) => frame.type === "query")).toMatchObject({
      language: "sql",
      text: "SELECT service, count(*) FROM default",
    });
    expect(call[0].payload.chips.map((chip) => chip.kind)).toContain("query");
    wrapper.unmount();
  });

  it("hands the chat the stream and window it wrote the SQL for, so the card states the range", async () => {
    const wrapper = mountHelper({
      stream: "k8s_logs",
      timeRange: { from: 1_000, to: 2_000, period: "15m" },
    } as Partial<InlineHostAdapter>);
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("count per service");
    await wrapper.get('[data-test="inline-helper-send"]').trigger("click");
    helper.current.set({ kind: "proposal", text: "SELECT service, count(*) FROM k8s_logs" });
    await flushPromises();
    controller.current.pending.value = {
      ...controller.current.pending.value,
      before: "",
      after: "SELECT service, count(*) FROM k8s_logs",
    };
    await wrapper.get('[data-test="inline-helper-handoff"]').trigger("click");
    await flushPromises();
    const [args] = openAssistant.mock.calls[0] as unknown as [
      { seed: { turn_id: string; frames: Record<string, unknown>[] }[] },
    ];
    const frames = args.seed[0].frames;
    expect(frames[0]).toEqual({
      type: "turn_started",
      turn_id: args.seed[0].turn_id,
      agent_type: "generate-query",
    });
    expect(frames.find((frame) => frame.type === "query")).toMatchObject({
      stream: "k8s_logs",
      time_range: { from: 1_000, to: 2_000 },
    });
    wrapper.unmount();
  });

  it("drops a SQL answer that lands after the editor switched to PromQL", async () => {
    const wrapper = mountHelper();
    const toPromql = () =>
      wrapper.setProps({ host: { ...wrapper.props("host"), language: "promql" } });
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("errors");
    await wrapper.get('[data-test="inline-helper-send"]').trigger("click");
    await toPromql();
    await flushPromises();
    helper.current.set({ kind: "proposal", text: "SELECT * FROM logs WHERE level = 'error'" });
    await flushPromises();
    expect(controller.current.propose).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="inline-helper-status"]').text()).toContain(
      "Proposal discarded.",
    );
    wrapper.unmount();
  });

  it("discards a pending proposal when the editor switches language", async () => {
    const wrapper = mountHelper();
    const toPromql = () =>
      wrapper.setProps({ host: { ...wrapper.props("host"), language: "promql" } });
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("errors");
    await wrapper.get('[data-test="inline-helper-send"]').trigger("click");
    helper.current.set({ kind: "proposal", text: "SELECT 1" });
    await flushPromises();
    expect(controller.current.propose).toHaveBeenCalledTimes(1);
    controller.current.discard.mockClear();
    await toPromql();
    await flushPromises();
    expect(controller.current.discard).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("hands an answer that needs the chat over with the prompt, chips and transcript", async () => {
    const wrapper = mountHelper({ timeRange: { from: 1, to: 2, period: "15m" } });
    await wrapper.get('[data-test="inline-helper-prompt"] textarea').setValue("why is it slow");
    helper.current.set({ kind: "needs_chat", line: "This is long.", answer: "This is long." });
    await nextTick();
    await wrapper.get('[data-test="inline-helper-open-chat"]').trigger("click");
    await flushPromises();
    expect(openAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        entryKind: "nl_toggle",
        entryVerb: "ask",
        objectKind: "none",
        intent: "stage",
        payload: expect.objectContaining({
          text: "why is it slow",
          transcript: [{ role: "assistant", text: "This is long." }],
        }),
      }),
    );
    const call = openAssistant.mock.calls[0] as unknown as [
      { payload: { chips: { kind: string }[] } },
    ];
    expect(call[0].payload.chips.map((chip) => chip.kind)).toEqual(["time", "stream"]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    wrapper.unmount();
  });

  it("says one honest line for a failure, with a way to write it by hand", async () => {
    const wrapper = mountHelper();
    helper.current.set({
      kind: "failed",
      refused: false,
      elapsedMs: 10,
      error: { code: "offline", phase: "pre_admission", retryable: true, action: "retry" },
    });
    await nextTick();
    expect(wrapper.get('[data-test="inline-helper-error"]').text()).toContain(
      "You're offline. Nothing was sent.",
    );
    expect(wrapper.find('[data-test="inline-helper-write-myself"]').exists()).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("says when used-up credits reset, from the usage read, and no date without one", async () => {
    const failed = (code: string) => ({
      kind: "failed",
      refused: true,
      elapsedMs: 10,
      error: { code, phase: "pre_admission", retryable: false, action: "manage_usage" },
    });
    usage.current = { resetsAt: Date.UTC(2026, 10, 1, 12) };
    const wrapper = mountHelper();
    helper.current.set(failed("credits_exhausted"));
    await nextTick();
    expect(wrapper.get('[data-test="inline-helper-error"]').text()).toMatch(
      /^AI credits are used up for this organization\. They reset Nov 1\./,
    );
    helper.current.set(failed("subscription_required"));
    await nextTick();
    const line = wrapper.get('[data-test="inline-helper-error"]').text();
    expect(line).toMatch(/^AI credits are used up for this organization\./);
    expect(line).not.toContain("reset");
    usage.current = null;
    wrapper.unmount();
  });

  it("Escape rejects an open proposal first, then closes and returns to the editor", async () => {
    const focusEditor = vi.fn();
    const wrapper = mountHelper({ focusEditor });
    const prompt = wrapper.get('[data-test="inline-helper-prompt"] textarea');
    const reject = vi.fn();
    controller.current.pending.value = { id: 1, reject };
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(event, "target", { value: prompt.element });
    expect(rung.current?.(event)).toBe(true);
    expect(reject).toHaveBeenCalled();
    controller.current.pending.value = null;
    expect(rung.current?.(event)).toBe(true);
    await flushPromises();
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(focusEditor).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("reads the editor live: an edit after open moves the mode chip and the next send carries it", async () => {
    const buffer = ref("show me errors please");
    const wrapper = mountHelper({ getBuffer: () => buffer.value });
    const chip = () => wrapper.get('[data-test="inline-helper-chip-mode"]').text();
    expect(chip()).toBe("Replaces current text");
    buffer.value = "SELECT 1";
    await nextTick();
    expect(chip()).toBe("Edits current query");
    const prompt = wrapper.get('[data-test="inline-helper-prompt"] textarea');
    await prompt.setValue("only errors");
    await prompt.trigger("keydown", { key: "Enter" });
    expect(helper.current.send).toHaveBeenLastCalledWith(
      "only errors",
      expect.objectContaining({ current: "SELECT 1" }),
    );
    // What Accept wrote is the buffer the follow-up refines.
    buffer.value = "SELECT 1 WHERE level = 'error'";
    await prompt.setValue("per service");
    await prompt.trigger("keydown", { key: "Enter" });
    expect(helper.current.send).toHaveBeenLastCalledWith(
      "per service",
      expect.objectContaining({ current: "SELECT 1 WHERE level = 'error'" }),
    );
    wrapper.unmount();
  });

  it("sends the Time and Stream its chips show", async () => {
    const wrapper = mountHelper({
      stream: "k8s_logs",
      timeRange: { from: 1_000, to: 2_000, period: "15m" },
    } as Partial<InlineHostAdapter>);
    const chips = wrapper.text();
    expect(chips).toContain("k8s_logs");
    const prompt = wrapper.get('[data-test="inline-helper-prompt"] textarea');
    await prompt.setValue("errors");
    await prompt.trigger("keydown", { key: "Enter" });
    const [, opts] = helper.current.send.mock.calls[0];
    expect(opts.window).toMatchObject({ from: 1_000, to: 2_000, period: "15m" });
    expect(opts.chips.map((chip: { label: string }) => String(chip.label))).toEqual([
      expect.stringContaining("k8s_logs"),
    ]);
    wrapper.unmount();
  });

  it("has exactly one live region", async () => {
    const wrapper = mountHelper();
    helper.current.set({
      kind: "running",
      turn: { state: "responding.writing" },
      meta: { turnId: "t", ownedByThisTab: true, startedAt: Date.now() },
    });
    await nextTick();
    const exposed = wrapper
      .findAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]')
      .filter((region) => !region.element.closest('[aria-hidden="true"]'));
    expect(exposed).toHaveLength(1);
    expect(wrapper.find('[data-test="inline-helper-announce"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
