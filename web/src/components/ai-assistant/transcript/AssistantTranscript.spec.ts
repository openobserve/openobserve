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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, reactive } from "vue";

import {
  assistantSessionSourceKey,
  assistantTranscriptHostKey,
  projectRecord,
  type AssistantSession,
  type AssistantTranscriptHost,
  type TurnState,
} from "@/composables/assistant/pure";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { composerUi } from "@/components/ai-assistant/composer/composerUi";

import AssistantTranscript from "./AssistantTranscript.vue";

vi.mock("./AssistantMessageActions.vue", () => ({
  __esModule: true,
  default: {
    name: "ActionsStub",
    props: ["mode"],
    template: "<div :data-test=\"`actions-stub-${mode ?? 'bar'}`\" />",
  },
}));

const COMPACTED = join(
  __dirname,
  "../../../composables/assistant/__fixtures__/record/compacted/frames.json",
);

const prompt = (text: string, turnId: string): ChatMessage => ({
  role: "user",
  content: raw(text),
  sentAt: 0,
  turnId,
});

const reply = (text: string, extra: ChatMessage["contentBlocks"] = []): ChatMessage => ({
  role: "assistant",
  content: raw(text),
  contentBlocks: [{ type: "text", text }, ...extra],
});

function liveSession(
  messages: ChatMessage[],
  turn: TurnState = { state: "done", saved: "server" },
) {
  return reactive({
    sid: "s1",
    org: "acme",
    messages,
    turn,
    turnMeta: {
      turnId: "t2",
      serverTurnId: null,
      ownedByThisTab: true,
      startedAt: 0,
      firstByteAt: null,
      traceId: null,
      lastSeq: null,
      usage: null,
      contextUsed: null,
      lastFrameAt: Date.now(),
    },
    ui: { expandedSteps: [], follow: true, unseen: 0, activeVersion: {} as Record<string, number> },
    scroll: { top: "bottom" },
  }) as unknown as AssistantSession;
}

function mountLive(session: AssistantSession, over: Partial<AssistantTranscriptHost> = {}) {
  const host: AssistantTranscriptHost = {
    session: () => session,
    setFollow: vi.fn(),
    setScroll: vi.fn(),
    selectVersion: vi.fn((_sid, turnId, n) => (session.ui.activeVersion[turnId] = n)),
    outcomeAction: vi.fn(),
    isAdmin: () => true,
    persistence: () => true,
    online: () => true,
    focusComposer: vi.fn(),
    canRetry: () => true,
    ...over,
  };
  const wrapper = mount(AssistantTranscript, {
    props: { sid: "s1" },
    global: {
      provide: {
        [assistantSessionSourceKey as symbol]: () => computed(() => session.messages),
        [assistantTranscriptHostKey as symbol]: host,
      },
    },
    attachTo: document.body,
  });
  return { wrapper, host };
}

const log = (wrapper: ReturnType<typeof mountLive>["wrapper"]) =>
  wrapper.get('[data-test="assistant-transcript"]');

describe("AssistantTranscript", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is the one named log, masked, focusable as a scroll region and silent (`95` §1, HT-10 AC 1)", () => {
    const { wrapper } = mountLive(liveSession([prompt("why 5xx?", "t1"), reply("Because.")]));
    const el = log(wrapper);
    expect(el.element.tagName).toBe("SECTION");
    expect(el.attributes()).toMatchObject({
      role: "log",
      "aria-live": "off",
      "aria-label": "Conversation with O2 Assistant",
      tabindex: "0",
      "data-dd-privacy": "mask",
    });
  });

  it("renders turns as articles keyed by turn id, the answer named and focusable (`30` §1.6, X-28)", () => {
    const { wrapper } = mountLive(
      liveSession([
        prompt("why 5xx?\nsecond line", "t1"),
        reply("Because."),
        prompt("and now?", "t2"),
        reply("Fine."),
      ]),
    );
    const turns = wrapper.findAll("article[data-turn-id]");
    expect(turns.map((turn) => turn.attributes("data-test"))).toEqual([
      "assistant-turn-t1",
      "assistant-turn-t2",
    ]);
    expect(turns[0].attributes("aria-label")).toBe("Turn 1: why 5xx?");
    const answer = wrapper.get('[data-test="assistant-answer-t1"]');
    expect(answer.attributes("tabindex")).toBe("-1");
    expect(answer.attributes("aria-label")).toBe("O2 Assistant, answer to why 5xx?");
    expect((wrapper.vm as unknown as { focusLatestAnswer(): boolean }).focusLatestAnswer()).toBe(
      true,
    );
    expect(document.activeElement).toBe(wrapper.get('[data-test="assistant-answer-t2"]').element);
  });

  it("is aria-busy with the status row under the running prompt, and drops both on every terminal (HT-10 AC 3)", async () => {
    const session = liveSession([prompt("why?", "t1")], { state: "connecting" });
    const { wrapper } = mountLive(session);
    expect(log(wrapper).attributes("aria-busy")).toBe("true");
    expect(wrapper.find('[data-test="assistant-turn-status"]').exists()).toBe(true);
    for (const turn of [
      {
        state: "failed",
        error: { code: "unknown", phase: "post_admission", retryable: true, action: "retry" },
      },
      { state: "stopped", steps: 0, partial: false },
      { state: "done", saved: "server" },
    ] as TurnState[]) {
      session.turn = turn;
      await flushPromises();
      expect(log(wrapper).attributes("aria-busy")).toBeUndefined();
      expect(wrapper.find('[data-test="assistant-turn-status"]').exists()).toBe(false);
    }
  });

  it("puts the live line inside the running answer, never as a row between prompt and answer (D3-b)", async () => {
    const session = liveSession([prompt("why?", "t1")], { state: "connecting" });
    const { wrapper } = mountLive(session);
    await flushPromises();
    const answer = wrapper.get('[data-test="assistant-turn-t1"] [data-answer]');
    expect(answer.find("[data-status-row]").exists()).toBe(true);
    session.messages.push(reply("partial"));
    session.turn = { state: "responding.writing" };
    await flushPromises();
    const rows = wrapper.findAll("[data-status-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].element.closest("[data-answer]")).not.toBeNull();
  });

  it("observes the status row of every running turn, not only the first (HT-01 AC 8)", async () => {
    const observed: Element[] = [];
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        cb: IntersectionObserverCallback;
        constructor(cb: IntersectionObserverCallback) {
          this.cb = cb;
        }
        observe(el: Element) {
          if (!el.matches("[data-status-row]")) return;
          observed.push(el);
          callbacks.push(this.cb);
        }
        disconnect() {}
      },
    );
    const session = liveSession([prompt("one", "t1")], { state: "connecting" });
    const { wrapper } = mountLive(session);
    await flushPromises();
    expect(observed).toHaveLength(1);
    session.turn = { state: "done", saved: "server" };
    session.messages.push(reply("first"));
    await flushPromises();
    session.messages.push(prompt("two", "t2"));
    session.turn = { state: "connecting" };
    await flushPromises();
    expect(observed).toHaveLength(2);
    expect(wrapper.get('[data-test="assistant-turn-t2"] [data-status-row]').element).toBe(
      observed[1],
    );
    callbacks[1](
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(wrapper.emitted("status-visible")?.at(-1)).toEqual([true]);
    vi.unstubAllGlobals();
  });

  it("observes the latest answer and reports when it leaves the view, so Go to answer shows only then", async () => {
    const observed: Element[] = [];
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          callbacks.push(cb);
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    const session = liveSession([prompt("one", "t1"), reply("first")], {
      state: "done",
      saved: "server",
    });
    const { wrapper } = mountLive(session);
    await flushPromises();
    session.messages.push(prompt("two", "t2"), reply("second"));
    await flushPromises();
    const latest = wrapper.get('[data-test="assistant-answer-t2"]').element;
    expect(observed.at(-1)).toBe(latest);
    const callback = callbacks.at(-1);
    callback?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(wrapper.emitted("answer-visible")?.at(-1)).toEqual([false]);
    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(wrapper.emitted("answer-visible")?.at(-1)).toEqual([true]);
    vi.unstubAllGlobals();
  });

  it("renders a stored outcome after its answer and routes its action to the host", async () => {
    const session = liveSession(
      [
        prompt("why?", "t1"),
        reply("partial", [
          {
            type: "turn_outcome",
            outcome: {
              kind: "failed",
              code: "stream_dropped",
              action: "retry",
              elapsedMs: 40_000,
              at: 0,
            },
          },
        ]),
      ],
      {
        state: "failed",
        error: {
          code: "stream_dropped",
          phase: "post_admission",
          retryable: true,
          action: "retry",
        },
      },
    );
    const { wrapper, host } = mountLive(session);
    const outcome = wrapper.get('[data-test="assistant-turn-outcome"]');
    expect(outcome.attributes("data-code")).toBe("stream_dropped");
    expect(outcome.text()).toContain("Connection lost. The answer above is incomplete.");
    await wrapper.get('[data-test="assistant-turn-outcome-action"]').trigger("click");
    expect(host.outcomeAction).toHaveBeenCalledWith(
      "s1",
      "retry",
      expect.objectContaining({ code: "stream_dropped" }),
    );
  });

  it("marks a compacted turn with a divider above its prompt, from the stored record", () => {
    const record = JSON.parse(readFileSync(COMPACTED, "utf8"));
    const messages = projectRecord(record.turns, "owner", { timezone: "UTC" });
    const { wrapper } = mountLive(liveSession(messages));
    const dividers = wrapper.findAll('[data-test="assistant-compaction-divider"]');
    expect(dividers).toHaveLength(1);
    expect(dividers[0].text()).toMatch(/^Earlier context was summarised by the assistant at /);
    const turn = wrapper.get('[data-test="assistant-turn-t-cmp-2"]');
    expect(turn.find('[data-test="assistant-compaction-divider"]').exists()).toBe(true);
  });

  it("claims kept findings only when answer text shows, never for steps alone (U6)", () => {
    const steps: ChatMessage = {
      role: "assistant",
      content: raw(""),
      contentBlocks: [
        { type: "tool_call", tool: "SearchSQL", stepState: "done" },
        { type: "turn_outcome", outcome: { kind: "stopped", steps: 2 } },
      ],
    };
    const { wrapper } = mountLive(liveSession([prompt("q", "t1"), steps]));
    expect(wrapper.get('[data-test="assistant-turn-outcome-title"]').text()).toBe(
      "Stopped after 2 steps, incomplete",
    );
  });

  it("says when the running turn gains an outcome, never for a chat that opens with one (U12)", async () => {
    const outcome = {
      type: "turn_outcome" as const,
      outcome: { kind: "failed" as const, code: "unknown" },
    };
    const opened = liveSession([prompt("q", "t1"), reply("x", [outcome])]);
    const first = mountLive(opened);
    await flushPromises();
    expect(first.wrapper.emitted("outcome-shown")).toBeUndefined();
    first.wrapper.unmount();
    const session = liveSession([prompt("q", "t1"), reply("partial")], { state: "connecting" });
    const { wrapper } = mountLive(session);
    await flushPromises();
    session.messages[1].contentBlocks!.push(outcome);
    session.turn = {
      state: "failed",
      error: { code: "unknown", phase: "post_admission", retryable: true, action: "retry" },
    };
    await flushPromises();
    expect(wrapper.emitted("outcome-shown")).toHaveLength(1);
  });

  it("adds the not-saved block to the last answer from the live state (HT-01 AC 6)", () => {
    const { wrapper } = mountLive(
      liveSession([prompt("q", "t1"), reply("a")], { state: "done", saved: "not_saved" }),
    );
    expect(wrapper.get('[data-test="assistant-turn-outcome"]').attributes("data-kind")).toBe(
      "doneNotSaved",
    );
  });

  it("shows the action bars only on a settled live chat, never while a turn runs", async () => {
    const session = liveSession([prompt("q", "t1"), reply("a")]);
    const { wrapper } = mountLive(session);
    await flushPromises();
    expect(wrapper.findAll('[data-test="actions-stub-bar"]')).toHaveLength(2);
    session.turn = { state: "responding.writing" };
    await flushPromises();
    expect(wrapper.findAll('[data-test="actions-stub-bar"]')).toHaveLength(0);
  });

  it("switches the shown attempt through the version picker (`30` §8.2)", async () => {
    const latest = reply("second try");
    latest.versions = [reply("first try")];
    const session = liveSession([prompt("q", "t1"), latest]);
    const { wrapper, host } = mountLive(session);
    expect(wrapper.get('[data-test="assistant-version-count"]').text()).toBe("2 of 2");
    await wrapper.get('[data-test="assistant-version-prev"]').trigger("click");
    expect(host.selectVersion).toHaveBeenCalledWith("s1", "t1", 1);
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-answer-t1"]').text()).toContain("first try");
    expect(composerUi("s1").status?.text).toBe("Version 1 of 2");
  });

  it("renders a record readonly: no status, no busy, no bars, outcomes as one line (`30` §11)", async () => {
    const wrapper = mount(AssistantTranscript, {
      props: {
        readonly: true,
        messages: [
          prompt("q", "t1"),
          reply("a", [{ type: "error", errorType: "agent_unavailable" }]),
        ],
      },
    });
    await flushPromises();
    expect(log(wrapper as never).attributes("data-readonly")).toBe("");
    expect(wrapper.find('[data-test^="actions-stub"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-turn-outcome"]').text()).toBe(
      "Failed: The assistant didn't respond. Nothing was changed.",
    );
  });

  it("mounts only the latest 40 turns above 150 blocks, and Show earlier adds 40 more (`30` §1.4)", async () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 100; i++) messages.push(prompt(`q${i}`, `t${i}`), reply(`a${i}`));
    const { wrapper } = mountLive(liveSession(messages));
    expect(wrapper.findAll("article[data-turn-id]")).toHaveLength(40);
    expect(wrapper.get('[data-test="assistant-transcript-window"]').text()).toContain(
      "120 earlier messages",
    );
    await wrapper.get('[data-test="assistant-transcript-earlier"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll("article[data-turn-id]")).toHaveLength(80);
  });
});

describe("AssistantTranscript: agents (MULTI-AGENT-03, 04, 05)", () => {
  const handedPrompt = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    ...prompt("look deeper", "t2"),
    agentId: "sre",
    handoffFrom: "o2-ai",
    ...over,
  });

  it("names each answer by its own turn's agent", () => {
    const session = liveSession([
      { ...prompt("first", "t1"), agentId: "o2-ai" },
      reply("one"),
      handedPrompt(),
      reply("two"),
    ]);
    const { wrapper } = mountLive(session);
    const metas = wrapper.findAll('[data-test="assistant-agent-identity"]');
    expect(metas.map((meta) => meta.attributes("data-agent"))).toEqual(["sre"]);
    expect(wrapper.get('[data-test="assistant-answer-t2"]').attributes("aria-label")).toBe(
      "Investigator, answer to look deeper",
    );
  });

  it("writes the marker before the handed turn with what was carried, and says to whom once", () => {
    const session = liveSession([
      prompt("first", "t1"),
      reply("one"),
      handedPrompt(),
      reply("two"),
    ]);
    const { wrapper } = mountLive(session);
    const turn = wrapper.get('[data-test="assistant-turn-t2"]');
    expect(turn.element.firstElementChild?.getAttribute("data-test")).toBe(
      "assistant-handoff-marker",
    );
    expect(wrapper.findAll('[data-test="assistant-handoff-marker"]')).toHaveLength(1);
    expect(turn.get('[data-test="assistant-handoff-given-panel"]').text()).toContain(
      "1 questions, 1 answers",
    );
    expect(turn.get('[data-test="assistant-message-meta"]').text()).toContain("· to Investigator");
  });

  it("renders no marker without the echo", () => {
    const session = liveSession([prompt("first", "t1"), reply("one")]);
    const { wrapper } = mountLive(session);
    expect(wrapper.find('[data-test="assistant-handoff-marker"]').exists()).toBe(false);
  });

  it("shows one failed row for a failed hand-off, in the marker's place", () => {
    const failed = handedPrompt({
      handoffFrom: undefined,
      agentId: "o2-ai",
      handoffFailed: { from: "o2-ai", to: "sre" },
    });
    const session = liveSession([prompt("first", "t1"), reply("one"), failed, reply("two")]);
    session.nextAgentId = "sre";
    const { wrapper } = mountLive(session);
    expect(wrapper.find('[data-test="assistant-handoff-marker"]').exists()).toBe(false);
    const row = wrapper.get('[data-code="handoff_failed"]');
    expect(row.text()).toContain("Couldn't hand this chat to Investigator.");
    expect(row.get('[data-test="assistant-turn-outcome-action"]').text()).toBe("Try again");
    expect(row.find('[data-test="assistant-turn-outcome-agent-fallback"]').exists()).toBe(true);
  });

  it("settles the failed row once Next is gone", () => {
    const failed = handedPrompt({
      handoffFrom: undefined,
      agentId: "o2-ai",
      handoffFailed: { from: "o2-ai", to: "sre" },
    });
    const session = liveSession([failed, reply("two")]);
    const { wrapper } = mountLive(session);
    expect(wrapper.get('[data-code="handoff_failed"]').attributes("data-readonly")).toBe("");
  });

  it("shows a live suggestion after the last answer only, and never on a readonly page", () => {
    const session = liveSession([prompt("first", "t1"), reply("one")]);
    session.turnMeta.handoffSuggestion = { agent: "sre", reason: "root cause" };
    const { wrapper } = mountLive(session);
    expect(
      wrapper
        .get('[data-test="assistant-turn-t1"]')
        .find('[data-test="assistant-handoff-suggestion"]')
        .exists(),
    ).toBe(true);
    const readonly = mount(AssistantTranscript, {
      props: { readonly: true, messages: session.messages },
    });
    expect(readonly.find('[data-test="assistant-handoff-suggestion"]').exists()).toBe(false);
  });
});
