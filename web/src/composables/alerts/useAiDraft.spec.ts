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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { z } from "zod";

const chat = vi.hoisted(() => ({
  fetchAiChat: vi.fn(),
  cancelAiChat: vi.fn(() => Promise.resolve()),
  confirmAiTool: vi.fn(),
  getStructuredContext: vi.fn(),
}));

vi.mock("@/composables/useAiChat", () => ({ default: () => chat }));
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "org1" } } },
}));

import { useAiDraft, type AiDraft, type AiDraftHost } from "./useAiDraft";
import type { I18nText } from "@/types/i18n";

type Args = { name: string };
/** A stream part, or one that waits for the confirm call and depends on its answer. */
type Part = string | ((approved: boolean) => string);

const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const proposal = (name: string) =>
  sse(
    { type: "status", message: "Reading the stream" },
    { type: "message_delta", content: "Errors on nginx, more than 5%." },
    {
      type: "confirmation_required",
      tool: "CreateAlert",
      args: { org_id: "org1", request_body: { name } },
      message: "Create?",
    },
  );
const VIEW = { resource_type: "alert", action: "navigate_direct", label: "View Alert" };
const afterAnswer: Part = (approved) =>
  approved
    ? sse(
        { type: "tool_result", tool: "CreateAlert", success: true },
        { type: "navigation_action", ...VIEW, target: { alert_id: "a1", name: "nginx_5xx" } },
        { type: "complete" },
      )
    : sse({ type: "message_delta", content: "Nothing was created." }, { type: "complete" });
const createFails: Part = () => sse({ type: "error", error: "alert name already exists" });
const question = sse(
  { type: "message_delta", content: "Which field marks an error?" },
  { type: "complete", history: [{ role: "assistant", content: "Which field marks an error?" }] },
);

// The confirm call may land before or after the reader waits for it.
let answered: boolean | null = null;
let waiter: ((approved: boolean) => void) | null = null;
const answer = (approved: boolean) => {
  if (waiter) waiter(approved);
  else answered = approved;
  waiter = null;
};
const nextAnswer = () =>
  answered !== null
    ? Promise.resolve(answered).finally(() => (answered = null))
    : new Promise<boolean>((resolve) => (waiter = resolve));

const stream = (...parts: Part[]) => ({
  ok: true,
  status: 200,
  body: {
    getReader: () => ({
      read: async () => {
        const part = parts.shift();
        if (part === undefined) return { done: true };
        const text = typeof part === "string" ? part : part(await nextAnswer());
        return { done: false, value: new TextEncoder().encode(text) };
      },
    }),
  },
});

const run = (host: Partial<AiDraftHost<Args>> = {}) => {
  let api!: AiDraft<Args>;
  mount(
    defineComponent({
      setup() {
        api = useAiDraft<Args>({
          kind: "alert",
          tool: "CreateAlert",
          schema: z.object({ name: z.string().min(3) }),
          ...host,
        });
        return () => null;
      },
    }),
  );
  return api;
};

const sent = (call: number) => chat.fetchAiChat.mock.calls[call];
const lastMessage = (call: number) => sent(call)[0][sent(call)[0].length - 1];
const answers = () => chat.confirmAiTool.mock.calls.map((c) => c[2]);

describe("useAiDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chat.fetchAiChat.mockReset();
    answered = null;
    waiter = null;
    chat.confirmAiTool.mockImplementation(async (_org, _session, approved: boolean) => {
      answer(approved);
      return { ok: true, status: 200, body: {} };
    });
    chat.getStructuredContext.mockResolvedValue({ currentPage: "alerts", incident_id: "inc-1" });
  });

  it("holds a valid proposal for approval, and approving reports it created", async () => {
    chat.fetchAiChat.mockResolvedValueOnce(stream(proposal("nginx_5xx"), afterAnswer));
    const ai = run();
    void ai.start("nginx 5xx above 5%");
    await flushPromises();
    expect([ai.phase.value, ai.result.value?.draft, ai.text.value]).toEqual([
      "ready",
      { name: "nginx_5xx" },
      "Errors on nginx, more than 5%.",
    ]);

    await ai.approve();
    expect([ai.phase.value, answers(), ai.createdRoute.value?.query.alert_id]).toEqual([
      "created",
      [true],
      "a1",
    ]);
    const context = sent(0)[4];
    expect([
      context.confirm_before_create,
      context.confirm_timeout_secs,
      context.incident_id,
    ]).toEqual([true, 600, undefined]);
  });

  it("keeps the prose across tool calls, a paragraph per step, and marks a paused tail unfinished", async () => {
    // The agent separates its steps with a blank line; the pause holds back the last words.
    chat.fetchAiChat.mockResolvedValueOnce(
      stream(
        sse(
          { type: "message_delta", content: "I need to see the streams before " },
          { type: "tool_call", tool: "StreamList", message: "Listing streams" },
          { type: "tool_result", tool: "StreamList", success: true },
          { type: "usage", usage: { llm_calls: 1 } },
          {
            type: "message_delta",
            content: "creating the alert.\n\n`k8s_events` has `object.Type`",
          },
          { type: "message_delta", content: " and `k8s_cluster`.\n\n" },
          { type: "tool_call", tool: "SearchSQL", message: "Querying logs" },
          { type: "message_delta", content: "Query syntax valid; the recent window " },
          {
            type: "confirmation_required",
            tool: "CreateAlert",
            args: { request_body: { name: "k8s_warnings" } },
          },
        ),
        afterAnswer,
      ),
    );
    const ai = run();
    void ai.start("k8s warnings above 100 in 5 minutes");
    await flushPromises();
    expect([ai.phase.value, ai.text.value]).toEqual([
      "ready",
      "I need to see the streams before creating the alert.\n\n`k8s_events` has `object.Type` and `k8s_cluster`.\n\nQuery syntax valid; the recent window…",
    ]);
  });

  it("an agent that creates without asking leaves the saved-itself state, never a proposal", async () => {
    chat.fetchAiChat.mockResolvedValueOnce(
      stream(
        sse(
          { type: "message_delta", content: "Created the alert." },
          { type: "tool_result", tool: "CreateAlert", success: true },
          { type: "navigation_action", ...VIEW, target: { alert_id: "a1", name: "nginx_5xx" } },
          { type: "complete" },
        ),
      ),
    );
    const ai = run();
    await ai.start("nginx 5xx above 5%");
    expect([ai.phase.value, ai.result.value, ai.createdRoute.value?.query.alert_id]).toEqual([
      "saved",
      null,
      "a1",
    ]);
  });

  it("a create that fails after approval says why and keeps the proposal for the form", async () => {
    chat.fetchAiChat.mockResolvedValueOnce(stream(proposal("nginx_5xx"), createFails));
    const ai = run();
    void ai.start("nginx 5xx above 5%");
    await flushPromises();

    await expect(ai.approve()).rejects.toThrow();
    expect([ai.phase.value, ai.failure.value, ai.result.value?.draft]).toEqual([
      "failed",
      { kind: "notCreated", detail: "alert name already exists" },
      { name: "nginx_5xx" },
    ]);
  });

  it.each([
    {
      name: "a refusal the agent still waits on",
      reason: "No destination named x",
      phase: "ready",
    },
    { name: "any other failure", reason: null, phase: "failed" },
  ])("a refused approval: $name", async (c) => {
    chat.fetchAiChat.mockResolvedValueOnce(stream(proposal("nginx_5xx"), afterAnswer));
    const ai = run({ readRefusal: () => c.reason as I18nText | null });
    void ai.start("nginx 5xx above 5%");
    await flushPromises();
    chat.confirmAiTool.mockResolvedValueOnce({ ok: false, status: 422, body: {} });

    await expect(ai.approve({ destinations: ["x"] })).rejects.toThrow();
    expect({
      phase: ai.phase.value,
      refused: ai.refused.value,
      sent: chat.confirmAiTool.mock.calls[0].slice(2),
    }).toEqual({ phase: c.phase, refused: c.reason, sent: [true, { destinations: ["x"] }] });
  });

  it("declining stops the turn and answers no", async () => {
    chat.fetchAiChat.mockResolvedValueOnce(stream(proposal("nginx_5xx"), afterAnswer));
    const ai = run();
    void ai.start("nginx 5xx above 5%");
    await flushPromises();
    await ai.decline();
    await flushPromises();
    expect([answers(), ai.result.value?.draft]).toEqual([[false], { name: "nginx_5xx" }]);
  });

  it("a question ends the turn in words, and the reply continues the same session", async () => {
    chat.fetchAiChat
      .mockResolvedValueOnce(stream(question))
      .mockResolvedValueOnce(stream(proposal("err_rate"), afterAnswer));
    const ai = run();
    await ai.start("too many errors");
    expect([ai.phase.value, ai.text.value]).toEqual(["reply", "Which field marks an error?"]);

    void ai.reply("level = error");
    await flushPromises();
    expect(ai.phase.value).toBe("ready");
    expect(lastMessage(1)).toEqual({ role: "user", content: "level = error" });
    expect(sent(1)[5]).toBe(sent(0)[5]);
  });

  it.each([
    {
      name: "invalid, then valid",
      turns: [stream(proposal("x"), afterAnswer), stream(proposal("good_name"), afterAnswer)],
      phase: "ready",
      failure: null,
    },
    {
      name: "invalid twice",
      turns: [stream(proposal("x"), afterAnswer), stream(proposal("y"), afterAnswer)],
      phase: "failed",
      failure: "invalid",
    },
  ])("an invalid proposal is declined and sent back once: $name", async (c) => {
    c.turns.forEach((turn) => chat.fetchAiChat.mockResolvedValueOnce(turn));
    const ai = run();
    void ai.start("errors");
    await flushPromises();

    expect({
      phase: ai.phase.value,
      failure: ai.failure.value?.kind ?? null,
      calls: chat.fetchAiChat.mock.calls.length,
      firstAnswer: answers()[0],
    }).toEqual({ phase: c.phase, failure: c.failure, calls: 2, firstAnswer: false });
    expect(lastMessage(1).content).toContain("- name:");
    expect(sent(1)[5]).toBe(sent(0)[5]);
  });

  it.each([
    {
      name: "an error event",
      reply: stream(sse({ type: "error", error: "agent down" })),
      failure: "stream",
    },
    {
      name: "no credits",
      reply: { ok: false, status: 402, json: async () => ({}) },
      failure: "quota",
    },
    {
      name: "no service",
      reply: { ok: false, status: 503, json: async () => ({}) },
      failure: "unavailable",
    },
    { name: "an empty turn", reply: stream(sse({ type: "complete" })), failure: "noProposal" },
  ])("fails in one line on $name", async (c) => {
    chat.fetchAiChat.mockResolvedValueOnce(c.reply);
    const ai = run();
    await ai.start("errors");
    expect([ai.phase.value, ai.failure.value?.kind, ai.result.value]).toEqual([
      "failed",
      c.failure,
      null,
    ]);
  });

  it("cancel aborts the stream and stops the server's turn", async () => {
    let signal!: AbortSignal;
    chat.fetchAiChat.mockImplementationOnce((_m, _model, _org, s: AbortSignal) => {
      signal = s;
      return new Promise((resolve) =>
        s.addEventListener("abort", () => resolve({ cancelled: true })),
      );
    });
    const ai = run();
    const started = ai.start("disk fills up");
    await flushPromises();
    ai.cancel();
    await started;

    expect([signal.aborted, ai.phase.value]).toEqual([true, "idle"]);
    expect(chat.cancelAiChat).toHaveBeenCalledWith("org1", ai.sessionId.value);
  });
});
