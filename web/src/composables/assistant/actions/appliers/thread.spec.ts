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

import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { makeEnv } from "../__tests__/actionEnv";
import { turnAnnotationKey } from "../../evidence";
import { feedbackApplier, openStepApplier, rerunApplier, turnOf } from "./thread";

const FROM = 1_760_000_000_000;
const TO = FROM + 15 * 60_000;

const prompt = (turnId: string, text = "why?"): ChatMessage => ({
  role: "user",
  content: raw(text),
  turnId,
  sentAt: 1,
  chips: [
    {
      id: "page:timeRange",
      kind: "time",
      label: raw("Time"),
      ref: { type: "time", org: "org1", from: FROM, to: TO },
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
});

const answer = (traceId: string, extra: ChatMessage["contentBlocks"] = []): ChatMessage => ({
  role: "assistant",
  content: raw("ok"),
  contentBlocks: [...extra, { type: "text", text: "ok" }, { type: "footer", footer: { traceId } }],
});

const query = {
  type: "tool_call" as const,
  tool: "SearchSQL",
  call_id: "c3",
  stepState: "done" as const,
  callArgs: {
    stream_name: "default",
    sql: "SELECT 1",
    start_time: FROM * 1000,
    end_time: TO * 1000,
  },
};

describe("thread appliers", () => {
  it("open_step expands the step once, never toggling it closed", () => {
    const { env, sid, store } = makeEnv();
    openStepApplier(sid, { kind: "open_step", callId: "c3" }, env);
    openStepApplier(sid, { kind: "open_step", callId: "c3" }, env);
    expect(store.state.sessions[sid].ui.expandedSteps).toEqual(["c3"]);
  });

  it("rerun_now sends the same text and chips with the window moved to end now, draft untouched", () => {
    const { env, sid, store } = makeEnv({ messages: [prompt("t1"), answer("tr", [query])] });
    store.setDraft(sid, { text: "half typed" });
    const resend = vi
      .spyOn(store, "resend")
      .mockResolvedValue({ state: "done", saved: "local" } as any);
    expect(rerunApplier(sid, { kind: "rerun_now", turnId: "t1" }, env)).toEqual({ ok: true });
    const [, snapshot, input] = resend.mock.calls[0];
    expect(input).toBe("rerun");
    expect(snapshot.text).toBe("why?");
    expect(snapshot.timeOverride).toEqual({ from: 2_000_000 - 15 * 60_000, to: 2_000_000 });
    expect(snapshot.chips.map((chip) => chip.kind)).toEqual(["time", "stream"]);
    expect(snapshot.chips[0].ref).toMatchObject({ from: 2_000_000 - 15 * 60_000, to: 2_000_000 });
    expect(store.state.sessions[sid].composer.text).toBe("half typed");
  });

  it("refuses Re-run while a turn runs, as the send would join that turn", () => {
    const { env, sid, store } = makeEnv({ messages: [prompt("t1"), answer("tr", [query])] });
    store.state.sessions[sid].turn = { state: "connecting" } as never;
    const resend = vi.spyOn(store, "resend");
    expect(rerunApplier(sid, { kind: "rerun_now", turnId: "t1" }, env)).toEqual({
      ok: false,
      reason: "gated",
    });
    expect(resend).not.toHaveBeenCalled();
  });

  it("re-runs over the stored asked window when the prompt had no time chip", () => {
    const bare = { ...prompt("t1"), chips: [] };
    const { env, sid, store } = makeEnv({ messages: [bare, answer("tr")] });
    store.annotate(sid, turnAnnotationKey("t1", "window"), { window: { from: FROM, to: TO } });
    const resend = vi
      .spyOn(store, "resend")
      .mockResolvedValue({ state: "done", saved: "local" } as any);
    expect(rerunApplier(sid, { kind: "rerun_now", turnId: "t1" }, env)).toEqual({ ok: true });
    expect(resend.mock.calls[0][1].timeOverride).toEqual({
      from: 2_000_000 - (TO - FROM),
      to: 2_000_000,
    });
  });

  it("feedback carries each turn's own trace id and position", async () => {
    const messages = [
      prompt("t1"),
      answer("trace-1"),
      { role: "assistant" as const, content: raw("more") },
      prompt("t2"),
      {
        ...answer("trace-2"),
        contentBlocks: [
          { type: "footer" as const, footer: { traceId: "trace-2", serverTurnId: "srv-2" } },
        ],
      },
    ];
    const { env, sid, store } = makeEnv({ messages });
    await feedbackApplier(
      sid,
      {
        kind: "feedback",
        messageId: "t1",
        vote: "down",
        reason: "wrong_query",
        comment: "used the wrong stream",
      },
      env,
    );
    await feedbackApplier(sid, { kind: "feedback", messageId: "t2", vote: "up" }, env);
    expect(env.feedback.mock.calls).toEqual([
      [
        "org1",
        sid,
        {
          feedback_type: "thumbs_down",
          query_index: 0,
          trace_id: "trace-1",
          turn_id: "t1",
          comment: "wrong_query: used the wrong stream",
        },
      ],
      [
        "org1",
        sid,
        { feedback_type: "thumbs_up", query_index: 1, trace_id: "trace-2", turn_id: "srv-2" },
      ],
    ]);
    expect(
      store.state.sessions[sid].annotations[turnAnnotationKey("t1", "feedback")].feedback,
    ).toEqual({
      rating: "down",
      reason: "wrong_query",
    });
  });

  it("stores nothing when the post fails, and refuses a vote on a turn that never completed", async () => {
    const { env, sid, store } = makeEnv({
      messages: [
        prompt("t1"),
        answer("tr"),
        prompt("t2"),
        { role: "assistant", content: raw("x"), contentBlocks: [] },
      ],
    });
    env.feedback.mockRejectedValueOnce(new Error("500"));
    await expect(
      feedbackApplier(sid, { kind: "feedback", messageId: "t1", vote: "up" }, env),
    ).resolves.toEqual({ ok: false, reason: "failed" });
    expect(
      store.state.sessions[sid].annotations[turnAnnotationKey("t1", "feedback")],
    ).toBeUndefined();
    await expect(
      feedbackApplier(sid, { kind: "feedback", messageId: "t2", vote: "up" }, env),
    ).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("keeps one vote in flight per turn", async () => {
    const { env, sid } = makeEnv({ messages: [prompt("t1"), answer("tr")] });
    let release!: () => void;
    env.feedback.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const first = feedbackApplier(sid, { kind: "feedback", messageId: "t1", vote: "up" }, env);
    await expect(
      feedbackApplier(sid, { kind: "feedback", messageId: "t1", vote: "down" }, env),
    ).resolves.toEqual({ ok: false, reason: "failed" });
    release();
    await expect(first).resolves.toEqual({ ok: true, detail: { turnId: "t1" } });
  });

  it("posts the findings outcome as a rating with no ai_feedback detail", async () => {
    const { env, sid } = makeEnv({ messages: [prompt("t1"), answer("tr")] });
    const result = await feedbackApplier(
      sid,
      { kind: "feedback", messageId: "t1", vote: "down", reason: "cause:no", comment: "dns" },
      env,
    );
    expect(result).toEqual({ ok: true, detail: {} });
    expect(env.feedback.mock.calls[0][2]).toMatchObject({
      feedback_type: "rating",
      value: 1,
      comment: "cause_no: dns",
    });
  });

  it("finds a turn's answer as the last assistant message before the next prompt", () => {
    const found = turnOf(
      { messages: [prompt("t1"), answer("a"), answer("b"), prompt("t2")] },
      "t1",
    );
    expect(found?.index).toBe(0);
    expect(found?.answer?.contentBlocks?.at(-1)?.footer?.traceId).toBe("b");
  });
});
