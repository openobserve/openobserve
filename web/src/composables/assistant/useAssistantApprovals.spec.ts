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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { approvalAnnotationKey, registerApprovalAppliers } from "./actions/appliers/approval";
import { registerUndoAppliers } from "./actions/appliers/undo";
import { makeEnv, t } from "./actions/__tests__/actionEnv";
import { createActionDispatcher } from "./actions/registry";
import type { AssistantHint } from "./assistantStore.types";
import type { ConfirmationRequiredFrame } from "./frames";
import { approvalOf, reduce, type ReducerCtx, type StreamState } from "./reducer";
import { foldTurns } from "./record";
import {
  DELETE_TTL_MS,
  MAX_CARD_MS,
  PERMISSION_TTL_MS,
  UNCONFIRMED_REREAD_MS,
  approvalEntity,
  approvalHeading,
  approvalOutcomeOf,
  createApprovalsRuntime,
} from "./useAssistantApprovals";

// Today's delete batch carries no id; the reducer gives it the turn's id and its place in the chat.
const DELETE: ConfirmationRequiredFrame = {
  type: "confirmation_required",
  id: "turn-1:1",
  tool: "o2_delete",
  message: 'Do you really want to delete the "checkout-latency-old" alert?',
  args: { items: [{ resource_type: "alert", name: "checkout-latency-old", id: "2Yx9alert" }] },
};

const PERMISSION: ConfirmationRequiredFrame = {
  type: "confirmation_required",
  tool: "bash",
  call_id: "per_1",
  message: "The assistant wants to run: kubectl get pods",
  args: { permission_id: "per_1", detail: "kubectl get pods" },
};

let now = 1_760_000_000_000;

function makeState(over: Partial<StreamState> = {}): StreamState {
  return {
    messages: [],
    activeToolCall: null,
    textSegment: "",
    streamingMsg: "",
    title: undefined,
    lastTraceId: null,
    ownerUnavailable: false,
    pendingConfirmation: null,
    messageComplete: false,
    halted: false,
    ...over,
  };
}

const liveCtx = (): ReducerCtx => ({
  isActive: true,
  autoNavigationEnabled: false,
  phase: "live",
  t,
  generateNavigation: () => null,
});

// An approve always names its card; the specs name the one the session holds.
let held: (sid: string) => string | undefined = () => undefined;

function cardMessage(frame: ConfirmationRequiredFrame): ChatMessage {
  return {
    role: "assistant",
    content: raw(""),
    contentBlocks: [{ type: "approval", approval: approvalOf(frame) }],
  };
}

function setup(frame: ConfirmationRequiredFrame = DELETE, extendable = false) {
  const block = approvalOf(frame);
  const messages: ChatMessage[] = [{ role: "user", content: raw("clean up") }, cardMessage(frame)];
  const ctx = makeEnv({ messages, deps: { now: () => now } });
  ctx.env.now = () => now;
  registerApprovalAppliers();
  registerUndoAppliers();
  const dispatcher = createActionDispatcher(ctx.env);
  const handlers = new Map<string, (hint: AssistantHint) => void>();
  const engine = { approvalDecided: vi.fn(), approvalExtended: vi.fn(), approvalSending: vi.fn() };
  const resend = vi.fn(async () => undefined);
  const extend = vi.fn(async () => ({ expires_at: now + 300_000 }));
  const changed = vi.fn();
  const approvals = createApprovalsRuntime({
    state: () => ctx.store.state,
    annotate: (sid, key, patch) => ctx.store.annotate(sid, key, patch),
    resend,
    engine: () => engine,
    dispatch: dispatcher.approvals,
    extend,
    extendable: () => extendable,
    changed,
    hints: {
      on: (type, handler) => {
        handlers.set(type, handler as (hint: AssistantHint) => void);
        return () => handlers.delete(type);
      },
    },
    now: () => now,
    lastKeydownAt: () => Number.NEGATIVE_INFINITY,
    t,
  });
  ctx.deps.approvals = approvals;
  approvals.onConfirmationRequired(ctx.sid, frame);
  held = (sid) => ctx.store.state.sessions[sid]?.pendingApproval?.id;
  const session = ctx.store.state.sessions[ctx.sid];
  const outcome = () => session.annotations[approvalAnnotationKey(block.id)]?.approvalOutcome;
  return { ...ctx, approvals, engine, resend, extend, changed, handlers, session, block, outcome };
}

describe("useAssistantApprovals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_760_000_000_000;
    track.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("holds a delete batch ten minutes, a permission 25 s, and takes the server's own expiry", () => {
    expect(setup(DELETE).session.pendingApproval).toMatchObject({
      id: "turn-1:1",
      kind: "delete",
      destructive: true,
      askedIn: "here",
      expiresAt: now + DELETE_TTL_MS,
      targets: [{ type: "alert", id: "2Yx9alert", name: "checkout-latency-old" }],
    });
    expect(setup(PERMISSION).session.pendingApproval).toMatchObject({
      kind: "permission",
      destructive: false,
      expiresAt: now + PERMISSION_TTL_MS,
    });
    const typed = setup({ ...PERMISSION, expires_at: (now + 90_000) / 1000 });
    expect(typed.session.pendingApproval?.expiresAt).toBe(now + 90_000);
    expect(track).toHaveBeenCalledWith(
      "ai_approval_shown",
      expect.objectContaining({ op: "delete", resource_kind: "alert", destructive: true }),
      expect.anything(),
    );
  });

  it("posts a decision on the session the card was asked in, after a chat switch", async () => {
    const { store, sid, env, approvals } = setup();
    const other = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    store.setActive(other);
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: true }, expect.any(Number));
    expect(env.confirm).not.toHaveBeenCalledWith(
      "org1",
      other,
      expect.anything(),
      expect.anything(),
    );
  });

  it("declines with new_chat, and the new chat starts without a card", async () => {
    const { store, sid, env, session, outcome } = setup();
    await store.decideApproval(sid, { approved: false, reason: "new_chat" });
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
    expect(session.pendingApproval).toBeNull();
    expect(outcome()?.state).toBe("new_chat");
    const next = store.createSession({
      origin: { entryKind: "thread_new", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    expect(store.state.sessions[next].pendingApproval).toBeNull();
  });

  it("keeps the card, its buttons disabled, until /confirm answers; a delete answers item by item", async () => {
    const { sid, env, approvals, session, outcome, engine } = setup();
    let answer: (value: unknown) => void = () => undefined;
    env.confirm.mockImplementation(() => new Promise((resolve) => (answer = resolve as never)));
    const done = approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    await Promise.resolve();
    expect(session.pendingApproval).not.toBeNull();
    expect(outcome()?.state).toBe("sending");
    answer({
      results: [{ resource: "checkout-latency-old", resource_type: "alert", deleted: true }],
    });
    await expect(done).resolves.toMatchObject({ status: "done" });
    expect(session.pendingApproval).toBeNull();
    expect(outcome()?.state).toBe("done");
    expect(engine.approvalDecided).toHaveBeenCalledWith(sid);
  });

  it("sends one decision per card, however often Approve is pressed", async () => {
    const { sid, env, approvals } = setup();
    await Promise.all([
      approvals.decide(sid, { approved: true, scope: "once" }, held(sid)),
      approvals.decide(sid, { approved: true, scope: "once" }, held(sid)),
    ]);
    expect(env.confirm).toHaveBeenCalledTimes(1);
  });

  it("declines at the client expiry and leaves the expired record", async () => {
    const { env, session, outcome, sid } = setup(PERMISSION);
    await vi.advanceTimersByTimeAsync(PERMISSION_TTL_MS);
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
    expect(session.pendingApproval).toBeNull();
    expect(outcome()?.state).toBe("expired");
    expect(track).toHaveBeenCalledWith(
      "ai_approval_expired",
      { op: "run", resource_kind: "object" },
      expect.anything(),
    );
  });

  it("withdraws a card when a new turn starts, and the record says the conversation moved on", async () => {
    const { store, sid, env, outcome } = setup();
    store.state.sessions[sid].composer.text = "and now?";
    await store.send(sid);
    await vi.runAllTimersAsync();
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
    expect(outcome()?.state).toBe("withdrawn");
  });

  it("declines before the cancel on Stop, and the record says the answer was stopped", async () => {
    const { store, sid, env, deps, outcome } = setup();
    const order: string[] = [];
    env.confirm.mockImplementation(async () => (order.push("confirm"), {}));
    deps.engine.stop = vi.fn(async () => void order.push("stop"));
    await store.stop(sid);
    await vi.runAllTimersAsync();
    expect(order).toEqual(["confirm", "stop"]);
    expect(outcome()?.state).toBe("stopped");
  });

  it("reads an approve answered 5xx as unknown with nothing to send again, and lets a declined one go again", async () => {
    const approved = setup();
    approved.env.confirm.mockRejectedValueOnce({ response: { status: 503 } });
    await approved.approvals.decide(
      approved.sid,
      { approved: true, scope: "once" },
      held(approved.sid),
    );
    expect(approved.outcome()?.state).toBe("unconfirmed");
    await approved.approvals.sendAgain(approved.sid, "turn-1:1");
    expect(approved.env.confirm).toHaveBeenCalledTimes(1);
    const { sid, env, approvals, session, outcome } = setup();
    env.confirm.mockRejectedValueOnce({ response: { status: 503 } });
    await approvals.decide(sid, { approved: false, reason: "deny" });
    expect(session.pendingApproval).toBeNull();
    expect(outcome()?.state).toBe("delivery_failed");
    env.confirm.mockResolvedValueOnce({ approved: false });
    await approvals.sendAgain(sid, "turn-1:1");
    expect(env.confirm).toHaveBeenNthCalledWith(
      2,
      "org1",
      sid,
      { approved: false },
      expect.any(Number),
    );
    expect(outcome()?.state).toBe("declined");
    expect(track).toHaveBeenCalledWith(
      "ai_approval_result",
      { status: "undelivered", succeeded_count: 0, failed_count: 0 },
      expect.anything(),
    );
  });

  it("drops the card on a sign-out elsewhere without posting anything", () => {
    const { env, session, handlers } = setup();
    handlers.get("signed_out")?.({ v: 1, type: "signed_out", at: now });
    expect(session.pendingApproval).toBeNull();
    expect(env.confirm).not.toHaveBeenCalled();
  });

  it("resolves a card another tab answered (confirmation_resolved) without a post", () => {
    const { sid, env, approvals, session, outcome, engine } = setup();
    approvals.onResolved(sid, {
      type: "confirmation_resolved",
      id: "turn-1:1",
      approved: true,
      by: "priya@example.com",
      at: 42,
    });
    expect(session.pendingApproval).toBeNull();
    expect(outcome()).toMatchObject({
      state: "approved_elsewhere",
      by: "priya@example.com",
      at: 42,
    });
    expect(env.confirm).not.toHaveBeenCalled();
    expect(engine.approvalDecided).toHaveBeenCalledWith(sid);
  });

  it("declines with the reply, then sends it as the next turn naming the card once the turn ends", async () => {
    const { sid, approvals, resend, outcome, session } = setup(PERMISSION);
    session.turn = { state: "awaiting_approval", callId: "per_1" };
    await approvals.decide(sid, { approved: false, reason: "reply", reply: "use staging" });
    expect(outcome()?.state).toBe("replied");
    expect(resend).not.toHaveBeenCalled();
    session.turn = { state: "done", saved: "server" };
    await nextTick();
    await vi.runAllTimersAsync();
    expect(resend).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ text: "use staging", chips: [] }),
      "typed",
      { replyToApproval: "per_1" },
    );
  });

  it("asks for a narrowed batch again when the server takes no subset: the batch is declined and the kept items re-proposed", async () => {
    const batch = {
      ...DELETE,
      args: {
        items: [
          { resource_type: "alert", name: "a", id: "1" },
          { resource_type: "alert", name: "b", id: "2" },
          { resource_type: "alert", name: "c", id: "3" },
        ],
      },
    };
    const { sid, env, approvals, resend, outcome } = setup(batch);
    await approvals.decide(sid, { approved: true, scope: "once", items: ["1", "3"] }, held(sid));
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
    expect(outcome()?.state).toBe("narrowed");
    await vi.runAllTimersAsync();
    expect(resend).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ text: expect.stringContaining('"names":"a, c"') }),
      "typed",
      { replyToApproval: "turn-1:1" },
    );
  });

  it("keeps the card when the registry refuses an approve on another org's chat, and posts nothing", async () => {
    const { sid, env, approvals, session } = setup();
    env.currentOrg.mockReturnValue("org2");
    await expect(
      approvals.decide(sid, { approved: true, scope: "once" }, held(sid)),
    ).resolves.toMatchObject({
      status: "failed",
    });
    expect(env.confirm).not.toHaveBeenCalled();
    expect(session.pendingApproval).not.toBeNull();
  });

  it("tells the engine nothing when the server answered the decision with a 5xx", async () => {
    const { sid, env, approvals, engine } = setup();
    env.confirm.mockRejectedValueOnce({ response: { status: 503 } });
    await approvals.decide(sid, { approved: false, reason: "deny" });
    expect(engine.approvalDecided).not.toHaveBeenCalled();
  });

  it("asks for more time only when the server allows it, and moves the expiry to the server's", async () => {
    const plain = setup(PERMISSION);
    await expect(plain.approvals.extend(plain.sid)).resolves.toBe(false);
    const more = setup(PERMISSION, true);
    await expect(more.approvals.extend(more.sid)).resolves.toBe(true);
    expect(more.extend).toHaveBeenCalledWith("org1", more.sid, "per_1");
    expect(more.session.pendingApproval?.expiresAt).toBe(now + 300_000);
  });

  it("asks again in one short turn naming the expired card", async () => {
    const { sid, approvals, resend } = setup();
    await approvals.askAgain(sid, "turn-1:1");
    expect(resend).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({
        text: expect.stringContaining("assistant.approval.askAgainPrompt"),
      }),
      "retry",
      { replyToApproval: "turn-1:1" },
    );
  });

  it("tracks the decision with its latency and input, never content", async () => {
    const { sid, approvals } = setup();
    now += 4_000;
    await approvals.decide(sid, { approved: false, reason: "escape" });
    expect(track).toHaveBeenCalledWith(
      "ai_approval_decided",
      { decision: "escape", items_count: 0, latency_ms: 4_000, input: "click" },
      expect.anything(),
    );
  });

  it("never lets Send again answer a card that arrived after the failed one", async () => {
    const { sid, env, approvals, session } = setup(PERMISSION);
    env.confirm.mockRejectedValueOnce({ response: { status: 502 } });
    await approvals.decide(sid, { approved: false, reason: "deny" }, held(sid));
    const next = { ...PERMISSION, call_id: "per_2", args: { command: "rm b" } };
    session.messages.push(cardMessage(next));
    approvals.onConfirmationRequired(sid, next);
    await approvals.sendAgain(sid, "per_1");
    expect(env.confirm).toHaveBeenCalledTimes(1);
    expect(session.pendingApproval?.id).toBe("per_2");
  });

  it("refuses Always allow on a delete whatever the server says, and posts nothing", async () => {
    const lax = { ...DELETE, kind: "delete", destructive: false, grantable: true };
    const { sid, env, approvals, session } = setup(lax);
    expect(session.pendingApproval).toMatchObject({ destructive: true, grantable: false });
    await approvals.decide(sid, { approved: true, scope: "tool" }, held(sid));
    expect(env.confirm).not.toHaveBeenCalled();
    expect(session.pendingApproval).not.toBeNull();
  });

  it("clamps a far-off server expiry, so the card is not declined at once", async () => {
    const { session, env } = setup({ ...PERMISSION, expires_at: now + 40 * 24 * 3_600_000 });
    expect(session.pendingApproval?.expiresAt).toBe(now + MAX_CARD_MS);
    await vi.advanceTimersByTimeAsync(5);
    expect(env.confirm).not.toHaveBeenCalled();
    expect(session.pendingApproval).not.toBeNull();
  });

  it("keeps two delete batches of one chat apart: each its own record and ledger entries", async () => {
    const { sid, env, approvals, session } = setup();
    env.confirm.mockResolvedValueOnce({
      results: [{ resource: "checkout-latency-old", resource_type: "alert", deleted: true }],
    });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    const second = {
      ...DELETE,
      id: "turn-2:2",
      args: { items: [{ resource_type: "dashboard", name: "old board", id: "B1" }] },
    };
    session.messages.push(cardMessage(second));
    approvals.onConfirmationRequired(sid, second);
    env.confirm.mockResolvedValueOnce({
      results: [{ resource: "old board", resource_type: "dashboard", deleted: true }],
    });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    expect(session.ledger.map((entry) => entry.resource.name)).toEqual([
      "checkout-latency-old",
      "old board",
    ]);
    const nameOf = (id: string) =>
      session.annotations[approvalAnnotationKey(id)]?.approvalResult?.items.map((i) => i.name);
    expect(nameOf("turn-1:1")).toEqual(["checkout-latency-old"]);
    expect(nameOf("turn-2:2")).toEqual(["old board"]);
  });

  it("posts each session's own decision when two sessions hold cards with the same id", async () => {
    const { store, sid, env, approvals } = setup();
    const other = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    store.state.sessions[other].messages.push(cardMessage(DELETE));
    approvals.onConfirmationRequired(other, DELETE);
    await Promise.all([
      approvals.decide(sid, { approved: false, reason: "deny" }),
      approvals.decide(other, { approved: false, reason: "deny" }),
    ]);
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
    expect(env.confirm).toHaveBeenCalledWith(
      "org1",
      other,
      { approved: false },
      expect.any(Number),
    );
  });

  it("refuses a decision made on a card that is no longer the pending one", async () => {
    const { sid, env, approvals, session } = setup();
    await approvals.decide(sid, { approved: true, scope: "once" }, "turn-0:9");
    expect(env.confirm).not.toHaveBeenCalled();
    expect(session.pendingApproval).not.toBeNull();
  });

  it("lets an older card go without a post when a new one replaces it", () => {
    const { sid, env, approvals, session, outcome } = setup(PERMISSION);
    const next = { ...PERMISSION, call_id: "per_2" };
    approvals.onConfirmationRequired(sid, next);
    expect(env.confirm).not.toHaveBeenCalled();
    expect(session.pendingApproval?.id).toBe("per_2");
    expect(outcome()?.state).toBe("withdrawn");
  });

  it("keeps the stopped record when the deny lands after the turn was cancelled", async () => {
    const { store, sid, env, deps, outcome } = setup();
    const order: string[] = [];
    env.confirm.mockImplementation(async () => {
      order.push("confirm");
      throw { response: { status: 404 } };
    });
    deps.engine.stop = vi.fn(async () => void order.push("stop"));
    await store.stop(sid);
    expect(order).toEqual(["confirm", "stop"]);
    expect(outcome()?.state).toBe("stopped");
  });

  it("takes the card with a turn that ended under it, without a post; a late batch on a done answer stays", async () => {
    const { env, session, outcome } = setup(PERMISSION);
    session.turn = { state: "done", saved: "server" };
    await nextTick();
    expect(session.pendingApproval).not.toBeNull();
    session.turn = { state: "stopped", steps: 0, partial: false };
    await nextTick();
    expect(session.pendingApproval).toBeNull();
    expect(outcome()?.state).toBe("stopped");
    expect(env.confirm).not.toHaveBeenCalled();
  });

  it("moves the turn's own timer with More time", async () => {
    const { sid, approvals, engine } = setup(PERMISSION, true);
    await approvals.extend(sid);
    expect(engine.approvalExtended).toHaveBeenCalledWith(sid);
  });

  it("is unconfirmed when /confirm times out: the turn stops waiting, nothing goes again and no list re-reads", async () => {
    const { sid, env, approvals, outcome, engine, changed } = setup();
    env.confirm.mockRejectedValueOnce({ code: "ECONNABORTED" });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    expect(outcome()?.state).toBe("unconfirmed");
    expect(engine.approvalDecided).toHaveBeenCalledWith(sid);
    expect(changed).not.toHaveBeenCalled();
    await approvals.sendAgain(sid, "turn-1:1");
    expect(env.confirm).toHaveBeenCalledTimes(1);
  });

  it("refuses an approve that names no card, while a decline without one still goes out", async () => {
    const { sid, env, approvals, session } = setup();
    await approvals.decide(sid, { approved: true, scope: "once" });
    expect(env.confirm).not.toHaveBeenCalled();
    expect(session.pendingApproval).not.toBeNull();
    await approvals.decide(sid, { approved: false, reason: "deny" });
    expect(env.confirm).toHaveBeenCalledTimes(1);
  });

  it("still sends a reply as the next turn when its decline's answer was lost", async () => {
    const { sid, env, approvals, resend, session } = setup(PERMISSION);
    env.confirm.mockRejectedValueOnce({ response: { status: 404 } });
    session.turn = { state: "awaiting_approval", callId: "per_1" };
    await approvals.decide(
      sid,
      { approved: false, reason: "reply", reply: "use staging" },
      "per_1",
    );
    session.turn = { state: "done", saved: "server" };
    await nextTick();
    await vi.runAllTimersAsync();
    expect(resend).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ text: "use staging" }),
      "typed",
      { replyToApproval: "per_1" },
    );
  });

  it("keeps an undo whose answer never came as unconfirmed, and never offers it again", async () => {
    const { sid, env, approvals, session } = setup();
    env.confirm.mockResolvedValueOnce({
      results: [
        {
          resource: "checkout-latency-old",
          resource_type: "alert",
          deleted: true,
          undoable: true,
          ledger_id: "srv-led-1",
        },
      ],
    });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    env.undo.mockRejectedValueOnce(new Error("timeout of 15000ms exceeded"));
    await expect(approvals.undo(sid, "srv-led-1")).resolves.toMatchObject({ ok: false });
    expect(session.ledger[0]).toMatchObject({ undoUnconfirmed: true, undoing: false });
    await expect(approvals.undo(sid, "srv-led-1")).resolves.toMatchObject({ reason: "gated" });
    expect(env.undo).toHaveBeenCalledTimes(1);
  });

  it("refreshes the open lists of what an approve changed", async () => {
    const { sid, env, approvals, changed } = setup();
    env.confirm.mockResolvedValueOnce({
      results: [{ resource: "checkout-latency-old", resource_type: "alert", deleted: true }],
    });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    expect(changed).toHaveBeenCalledWith(["alert"]);
  });

  it("undoes with the server's ledger id, once however often Undo is pressed", async () => {
    const { sid, env, approvals, session, changed } = setup();
    env.confirm.mockResolvedValueOnce({
      results: [
        {
          resource: "checkout-latency-old",
          resource_type: "alert",
          deleted: true,
          undoable: true,
          ledger_id: "srv-led-1",
        },
      ],
    });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    expect(session.ledger[0]).toMatchObject({ id: "srv-led-1", undoable: true });
    let release: (value: unknown) => void = () => undefined;
    env.undo.mockImplementation(() => new Promise((resolve) => (release = resolve as never)));
    const first = approvals.undo(sid, "srv-led-1");
    const second = approvals.undo(sid, "srv-led-1");
    await expect(second).resolves.toMatchObject({ ok: false, reason: "gated" });
    release({});
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(env.undo.mock.calls).toEqual([["org1", "srv-led-1"]]);
    expect(session.ledger[0].status).toBe("undone");
    expect(changed).toHaveBeenLastCalledWith(["alert"]);
  });

  it("keeps the turn's own expiry from cancelling while a decision is on its way, and puts it back when it never landed", async () => {
    const { sid, env, approvals, engine, session } = setup(PERMISSION);
    const until = session.pendingApproval?.expiresAt;
    env.confirm.mockImplementationOnce(async () => {
      expect(engine.approvalSending).toHaveBeenCalledWith(sid);
      throw { response: { status: 502 } };
    });
    await approvals.decide(sid, { approved: false, reason: "deny" }, held(sid));
    expect(engine.approvalExtended).toHaveBeenCalledWith(sid, until);
  });

  it("re-arms the card's expiry when a Send again fails again", async () => {
    const { sid, env, approvals, engine, session } = setup(PERMISSION);
    const until = session.pendingApproval?.expiresAt;
    env.confirm.mockRejectedValueOnce({ response: { status: 502 } });
    await approvals.decide(sid, { approved: false, reason: "deny" }, held(sid));
    expect(session.pendingApproval).toBeNull();
    engine.approvalExtended.mockClear();
    env.confirm.mockRejectedValueOnce({ response: { status: 502 } });
    await approvals.sendAgain(sid, "per_1");
    expect(env.confirm).toHaveBeenCalledTimes(2);
    expect(until).toBeTypeOf("number");
    expect(engine.approvalExtended).toHaveBeenCalledWith(sid, until);
  });

  it("re-reads the open lists once, later, after an approve whose outcome is unknown", async () => {
    const { sid, env, approvals, changed } = setup();
    env.confirm.mockRejectedValueOnce({ code: "ECONNABORTED" });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UNCONFIRMED_REREAD_MS);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(["alert"]);
    await vi.advanceTimersByTimeAsync(UNCONFIRMED_REREAD_MS * 4);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("attaches a live card's record and ledger entries to the same card after a history fold", async () => {
    const frame = { ...DELETE, id: undefined };
    const live = makeState({
      messages: [
        { role: "user", content: raw("clean up"), turnId: "turn-1" },
        { role: "assistant", content: raw(""), contentBlocks: [], turnId: "turn-1" },
      ],
    });
    const effects = reduce(live, frame, liveCtx());
    const sent = effects.find((effect) => effect.kind === "approval");
    const { sid, env, approvals, session } = setup(sent!.frame as ConfirmationRequiredFrame);
    env.confirm.mockResolvedValueOnce({
      results: [
        {
          resource: "checkout-latency-old",
          resource_type: "alert",
          deleted: true,
          undoable: true,
          ledger_id: "srv-led-1",
        },
      ],
    });
    await approvals.decide(sid, { approved: true, scope: "once" }, held(sid));
    const folded = foldTurns(
      [
        { turn_id: "turn-1", user: { text: "clean up" }, frames: [frame], status: "completed" },
      ] as never,
      t,
      "owner",
      "replay",
    ).messages;
    const card = folded.flatMap((m) => m.contentBlocks ?? []).find((b) => b.approval)!.approval!;
    expect(approvalOutcomeOf(session, card.id).outcome?.state).toBe("done");
    expect(session.ledger.filter((entry) => entry.approvalId === card.id)).toEqual([
      expect.objectContaining({ id: "srv-led-1", undoable: true }),
    ]);
  });

  it("names the heading by kind and entity, never by a tool-name prefix", () => {
    expect(approvalEntity(approvalOf(DELETE))).toBe("alert");
    expect(approvalHeading(t, approvalOf(DELETE), 1)).toContain(
      "assistant.approval.heading.delete",
    );
    expect(approvalHeading(t, approvalOf({ ...PERMISSION, tool: "DeleteStream" }), 1)).toContain(
      "assistant.approval.heading.permission",
    );
    expect(
      approvalHeading(
        t,
        approvalOf({ type: "confirmation_required", tool: "acme", args: { command: "ls" } }),
        1,
      ),
    ).toContain("assistant.approval.heading.runCommand");
  });
});

describe("useAssistantApprovals restore after a reload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_760_000_000_000;
    track.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  // The card a reload lost: the session no longer holds it, the transcript block still does.
  function reloaded(expiresAt?: number) {
    const frame = { ...PERMISSION, ...(expiresAt && { expires_at: expiresAt / 1000 }) };
    const ctx = setup(frame);
    ctx.session.pendingApproval = null;
    track.mockReset();
    return { ...ctx, card: approvalOf(frame) };
  }

  it("holds the card again until its stored expiry, never a client default, and counts no second show", async () => {
    const { approvals, sid, session, card, env, outcome } = reloaded(now + 90_000);
    now += 30_000;
    expect(approvals.restore(sid, card)).toBe(true);
    expect(session.pendingApproval).toMatchObject({ id: "per_1", expiresAt: card.expiresAt });
    expect(track).not.toHaveBeenCalledWith(
      "ai_approval_shown",
      expect.anything(),
      expect.anything(),
    );
    await vi.advanceTimersByTimeAsync(59_000);
    expect(env.confirm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
    expect(outcome()?.state).toBe("expired");
  });

  it("never restores a card past its expiry or without one", () => {
    const expired = reloaded(now + 1_000);
    now += 1_000;
    expect(expired.approvals.restore(expired.sid, expired.card)).toBe(false);
    expect(expired.session.pendingApproval).toBeNull();
    const untimed = reloaded();
    expect(untimed.approvals.restore(untimed.sid, untimed.card)).toBe(false);
    expect(untimed.session.pendingApproval).toBeNull();
  });

  it("lets a restored card go with the server's ending, without a POST", () => {
    const { approvals, sid, session, card, env, outcome } = reloaded(now + 90_000);
    approvals.restore(sid, card);
    approvals.release(sid, "other", "approved_elsewhere");
    expect(session.pendingApproval).not.toBeNull();
    approvals.release(sid, card.id, "approved_elsewhere");
    expect(session.pendingApproval).toBeNull();
    expect(outcome()?.state).toBe("approved_elsewhere");
    expect(env.confirm).not.toHaveBeenCalled();
  });

  it("lets a restored card go with no outcome when the server shows no decision", () => {
    const { approvals, sid, session, card, env, outcome } = reloaded(now + 90_000);
    approvals.restore(sid, card);
    approvals.release(sid, card.id, "unknown");
    expect(session.pendingApproval).toBeNull();
    expect(outcome()).toBeUndefined();
    expect(env.confirm).not.toHaveBeenCalled();
  });
});
