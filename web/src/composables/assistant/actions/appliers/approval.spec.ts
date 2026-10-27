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

vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: vi.fn() }));

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { approvalOf } from "../../reducer";
import { makeEnv } from "../__tests__/actionEnv";
import { applyAction, createActionDispatcher } from "../registry";
import {
  approvalAnnotationKey,
  approvalResultOf,
  canAlwaysAllow,
  confirmBodyOf,
  registerApprovalAppliers,
} from "./approval";

const BATCH = {
  type: "confirmation_required",
  tool: "o2_delete",
  call_id: "c9",
  message: "Delete these?",
  args: {
    items: [
      { resource_type: "alert", name: "checkout-latency-old", id: "a1" },
      { resource_type: "alert", name: "payments-5xx-staging", id: "a2" },
    ],
  },
};

function withCard(frame: Record<string, unknown> = BATCH) {
  const approval = approvalOf(frame);
  const answer: ChatMessage = {
    role: "assistant",
    content: raw(""),
    contentBlocks: [{ type: "approval", approval }],
  };
  const setup = makeEnv({ messages: [{ role: "user", content: raw("clean up") }, answer] });
  const session = setup.store.state.sessions[setup.sid];
  session.pendingApproval = {
    ...approval,
    sessionId: setup.sid,
    turnId: "t1",
    askedIn: "here",
    expiresAt: 5_000_000,
  };
  registerApprovalAppliers();
  const dispatcher = createActionDispatcher(setup.env);
  return { ...setup, session, approval, dispatcher };
}

describe("approval applier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is reached only through the approvals runtime's own dispatch", async () => {
    const { sid, env, dispatcher } = withCard();
    const action = {
      kind: "approval" as const,
      approvalId: "c9",
      decision: { approved: true as const, scope: "once" as const },
    };
    await expect(applyAction(sid, action)).resolves.toEqual({ ok: false, reason: "gated" });
    await expect(dispatcher.apply(sid, action)).resolves.toEqual({ ok: false, reason: "gated" });
    expect(env.confirm).not.toHaveBeenCalled();
    await expect(dispatcher.approvals(sid, action)).resolves.toMatchObject({ ok: true });
    expect(env.confirm).toHaveBeenCalledTimes(1);
  });

  it("refuses an approve on a chat of another org, but a deny always goes out", async () => {
    const { sid, env, dispatcher } = withCard();
    env.currentOrg.mockReturnValue("org2");
    const approve = { approved: true as const, scope: "once" as const };
    await expect(
      dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve }),
    ).resolves.toEqual({ ok: false, reason: "other_org" });
    const deny = { approved: false as const, reason: "deny" as const };
    await expect(
      dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: deny }),
    ).resolves.toMatchObject({ ok: true });
    expect(env.confirm).toHaveBeenCalledWith("org1", sid, { approved: false }, expect.any(Number));
  });

  it("reads 'Sending your decision…' until /confirm answers, never a result before it", async () => {
    const { sid, env, store, dispatcher } = withCard();
    let answer: (value: unknown) => void = () => undefined;
    env.confirm.mockImplementation(() => new Promise((resolve) => (answer = resolve as never)));
    const done = dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: true, scope: "once" },
    });
    await Promise.resolve();
    const key = approvalAnnotationKey("c9");
    expect(store.state.sessions[sid].annotations[key]).toEqual({
      approvalOutcome: expect.objectContaining({ state: "sending" }),
    });
    answer({
      approved: true,
      deleted: true,
      count: 2,
      total: 2,
      results: [
        {
          resource: "checkout-latency-old",
          resource_type: "alert",
          deleted: true,
          status_code: 200,
        },
        {
          resource: "payments-5xx-staging",
          resource_type: "alert",
          deleted: true,
          status_code: 200,
        },
      ],
    });
    await done;
    const annotation = store.state.sessions[sid].annotations[key];
    expect(annotation.approvalOutcome?.state).toBe("done");
    expect(annotation.approvalResult?.items.map((item) => [item.id, item.status])).toEqual([
      ["a1", "done"],
      ["a2", "done"],
    ]);
  });

  it("maps a partial answer item by item and keeps each in the chat's action ledger", () => {
    const card = approvalOf(BATCH);
    const result = approvalResultOf(
      card,
      {
        results: [
          {
            resource: "checkout-latency-old",
            resource_type: "alert",
            deleted: false,
            status_code: 403,
            detail: "forbidden",
          },
          {
            resource: "payments-5xx-staging",
            resource_type: "alert",
            deleted: true,
            status_code: 200,
          },
        ],
      },
      "a@b.c",
      1,
    );
    expect(result).toEqual({
      status: "partial",
      items: [
        {
          id: "a1",
          type: "alert",
          name: "checkout-latency-old",
          status: "failed",
          code: "403",
          message: "forbidden",
        },
        { id: "a2", type: "alert", name: "payments-5xx-staging", status: "done" },
      ],
      resolvedBy: "a@b.c",
      resolvedAt: 1,
    });
  });

  it("adds the answered items to the ledger, with Undo only under the server's own ledger id", async () => {
    const { sid, env, session, dispatcher } = withCard();
    env.confirm.mockResolvedValue({
      results: [
        {
          resource: "checkout-latency-old",
          resource_type: "alert",
          deleted: true,
          undoable: true,
          ledger_id: "led-1",
        },
        { resource: "payments-5xx-staging", resource_type: "alert", deleted: true, undoable: true },
      ],
    });
    await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: true, scope: "once" },
    });
    expect(session.ledger.map((entry) => [entry.id, entry.op, entry.undoable])).toEqual([
      ["led-1", "delete", true],
      ["c9:1", "delete", false],
    ]);
    expect(session.annotations[approvalAnnotationKey("c9")].ledger).toHaveLength(2);
  });

  it("never shows a success for an approve the server refused or answered with no rows", async () => {
    const { sid, env, store, dispatcher } = withCard();
    const approve = { approved: true as const, scope: "once" as const };
    const stateOf = () =>
      store.state.sessions[sid].annotations[approvalAnnotationKey("c9")].approvalOutcome?.state;
    env.confirm.mockResolvedValueOnce({ approved: false });
    await dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve });
    expect(stateOf()).toBe("failed");
    env.confirm.mockResolvedValueOnce({ results: [] });
    await dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve });
    expect(stateOf()).toBe("unconfirmed");
  });

  it("reads an approve answered 5xx as unknown, never as nothing changed, and a decline answered 5xx as undelivered", async () => {
    const { sid, env, store, dispatcher } = withCard();
    env.confirm.mockRejectedValue({ response: { status: 502 } });
    const result = await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: true, scope: "once" },
    });
    expect(result).toMatchObject({ ok: false, error: { httpStatus: 502 } });
    const annotation = () => store.state.sessions[sid].annotations[approvalAnnotationKey("c9")];
    expect(annotation().approvalOutcome).toMatchObject({ state: "unconfirmed", httpStatus: 502 });
    expect(annotation().approvalResult).toBeUndefined();
    await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: false, reason: "deny" },
    });
    expect(annotation().approvalOutcome).toMatchObject({
      state: "delivery_failed",
      httpStatus: 502,
    });
  });

  it("never waits on an approve longer than the proxy's own read timeout", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      resource_type: "alert",
      name: `a${i}`,
      id: `x${i}`,
    }));
    const { sid, env, dispatcher } = withCard({ ...BATCH, args: { items } });
    await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: true, scope: "once" },
    });
    expect(env.confirm.mock.calls[0][3]).toBe(110_000);
  });

  it("never claims nothing ran after a 404 or no answer, offers a 409 again, and reads a 403 as a failed decision", async () => {
    const { sid, env, store, dispatcher } = withCard();
    const approve = { approved: true as const, scope: "once" as const };
    const stateOf = () =>
      store.state.sessions[sid].annotations[approvalAnnotationKey("c9")].approvalOutcome?.state;
    env.confirm.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(
      dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve }),
    ).resolves.toMatchObject({ error: { code: "approval_expired" } });
    expect(stateOf()).toBe("unconfirmed");
    env.confirm.mockRejectedValueOnce({ response: { status: 409 } });
    await dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve });
    expect(stateOf()).toBe("delivery_failed");
    env.confirm.mockRejectedValueOnce(new Error("timeout of 15000ms exceeded"));
    await dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve });
    expect(stateOf()).toBe("unconfirmed");
    env.confirm.mockRejectedValueOnce({ response: { status: 403 } });
    await dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve });
    expect(
      store.state.sessions[sid].annotations[approvalAnnotationKey("c9")].approvalOutcome,
    ).toMatchObject({ state: "failed", httpStatus: 403 });
  });

  it("reads a decline whose answer was lost as the decline it was, never as an unknown result", async () => {
    const { sid, env, store, dispatcher } = withCard();
    env.confirm.mockRejectedValueOnce({ response: { status: 404 } });
    const reply = { approved: false as const, reason: "reply" as const, reply: "keep it" };
    await expect(
      dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: reply }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      store.state.sessions[sid].annotations[approvalAnnotationKey("c9")].approvalOutcome?.state,
    ).toBe("replied");
  });

  it("reads a permission approve that never unblocked the agent as failed", async () => {
    const { sid, env, store, dispatcher } = withCard();
    env.confirm.mockResolvedValueOnce({ approved: true, replied: false });
    const approve = { approved: true as const, scope: "once" as const };
    await dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: approve });
    expect(
      store.state.sessions[sid].annotations[approvalAnnotationKey("c9")].approvalOutcome?.state,
    ).toBe("failed");
  });

  it("waits past the 60 s relay for a deny, and longer for an approve the more items it acts on", async () => {
    const { sid, env, dispatcher } = withCard();
    await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: true, scope: "once" },
    });
    await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: false, reason: "deny" },
    });
    expect(env.confirm.mock.calls.map((call) => call[3])).toEqual([67_000, 65_000]);
  });

  it("never grants a card whose tool deletes, whatever kind the wire names", () => {
    const card = approvalOf({
      type: "confirmation_required",
      kind: "permission",
      tool: "o2_delete",
      grantable: true,
      args: { items: [{ resource_type: "alert", name: "a" }] },
    });
    expect(card).toMatchObject({ kind: "permission", destructive: true, grantable: false });
    const always = { approved: true as const, scope: "tool" as const };
    expect(canAlwaysAllow({ ...card, grantable: true, destructive: false })).toBe(false);
    expect(confirmBodyOf(always, { ...card, grantable: true, destructive: false })).toEqual({
      approved: true,
    });
  });

  it("sends scope and a subset only to a server that sent a typed card", () => {
    const base = {
      destructive: false,
      kind: "update" as const,
      tool: "o2_UpdateAlert",
      operation: "",
    };
    const untyped = { ...base, typed: false, grantable: false };
    const typed = { ...base, typed: true, grantable: true };
    const subset = { approved: true as const, scope: "chat" as const, items: ["a1"] };
    expect(confirmBodyOf(subset, untyped)).toEqual({ approved: true });
    expect(confirmBodyOf(subset, typed)).toEqual({ approved: true, scope: "chat", items: ["a1"] });
    const reply = { approved: false as const, reason: "reply" as const, reply: "keep it" };
    expect(confirmBodyOf(reply, untyped)).toEqual({ approved: false });
    expect(confirmBodyOf(reply, typed)).toEqual({ approved: false, reply: "keep it" });
  });

  it("never sends a scope for a delete, even one the server called grantable and non-destructive", async () => {
    const lax = approvalOf({ ...BATCH, kind: "delete", destructive: false, grantable: true });
    expect(lax).toMatchObject({ destructive: true, grantable: false });
    const always = { approved: true as const, scope: "tool" as const };
    expect(confirmBodyOf(always, { ...lax, grantable: true, destructive: false })).toEqual({
      approved: true,
    });
    const { sid, env, dispatcher } = withCard();
    await expect(
      dispatcher.approvals(sid, { kind: "approval", approvalId: "c9", decision: always }),
    ).resolves.toEqual({ ok: false, reason: "gated" });
    expect(env.confirm).not.toHaveBeenCalled();
  });

  it("posts on the session the card was asked in", async () => {
    const { sid, env, session, dispatcher } = withCard();
    session.pendingApproval!.sessionId = "origin-sid";
    await dispatcher.approvals(sid, {
      kind: "approval",
      approvalId: "c9",
      decision: { approved: false, reason: "deny" },
    });
    expect(env.confirm).toHaveBeenCalledWith(
      "org1",
      "origin-sid",
      { approved: false },
      expect.any(Number),
    );
  });
});
