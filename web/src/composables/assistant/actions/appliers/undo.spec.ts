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

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

import type { ActionLedgerEntry } from "../../assistantStore.types";
import { makeEnv } from "../__tests__/actionEnv";
import { applyAction, createActionDispatcher } from "../registry";
import { canUndo, registerUndoAppliers } from "./undo";

const entry = (over: Partial<ActionLedgerEntry> = {}): ActionLedgerEntry => ({
  id: "c9:0",
  approvalId: "c9",
  turnId: "t1",
  tool: "o2_delete",
  op: "delete",
  resource: { type: "alert", id: "a1", name: "checkout-latency-old" },
  status: "done",
  undoable: true,
  at: 1,
  ...over,
});

function setup(entries: ActionLedgerEntry[]) {
  const env = makeEnv();
  env.store.state.sessions[env.sid].ledger = entries;
  registerUndoAppliers();
  return { ...env, dispatcher: createActionDispatcher(env.env) };
}

describe("undo applier", () => {
  beforeEach(() => track.mockReset());

  it("offers Undo only for a done entry the server said it can restore", () => {
    expect(canUndo(entry())).toBe(true);
    expect(canUndo(entry({ undoable: false }))).toBe(false);
    expect(canUndo(entry({ status: "failed" }))).toBe(false);
    expect(canUndo(entry({ status: "undone" }))).toBe(false);
  });

  it("never invents an undo: an entry without the server's restore is refused untouched", async () => {
    const { sid, env, dispatcher } = setup([entry({ undoable: false })]);
    await expect(dispatcher.approvals(sid, { kind: "undo", ledgerId: "c9:0" })).resolves.toEqual({
      ok: false,
      reason: "gated",
    });
    expect(env.undo).not.toHaveBeenCalled();
  });

  it("is refused from a click, and goes through the approvals runtime only", async () => {
    const { sid, env } = setup([entry()]);
    await expect(applyAction(sid, { kind: "undo", ledgerId: "c9:0" })).resolves.toEqual({
      ok: false,
      reason: "gated",
    });
    expect(env.undo).not.toHaveBeenCalled();
  });

  it("restores through the server and records the entry as undone, with the restored id", async () => {
    const { sid, env, store, dispatcher } = setup([entry()]);
    env.undo.mockResolvedValue({ id: "a1-restored" });
    await expect(
      dispatcher.approvals(sid, { kind: "undo", ledgerId: "c9:0" }),
    ).resolves.toMatchObject({ ok: true });
    expect(env.undo).toHaveBeenCalledWith("org1", "c9:0");
    expect(store.state.sessions[sid].ledger[0]).toMatchObject({
      status: "undone",
      resource: { id: "a1-restored" },
    });
    expect(track).toHaveBeenCalledWith("ai_undo", {
      op: "delete",
      resource_kind: "alert",
      succeeded: true,
    });
  });

  it("keeps the entry as it was when the restore fails", async () => {
    const { sid, env, store, dispatcher } = setup([entry()]);
    env.undo.mockRejectedValue(new Error("nope"));
    await expect(
      dispatcher.approvals(sid, { kind: "undo", ledgerId: "c9:0" }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(store.state.sessions[sid].ledger[0].status).toBe("done");
  });
});
