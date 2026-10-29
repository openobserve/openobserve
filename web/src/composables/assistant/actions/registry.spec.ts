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

import { makeEnv } from "./__tests__/actionEnv";
import type * as Registry from "./registry";
import type { QueryRef } from "./types";

const query: QueryRef = { language: "sql", text: "SELECT 1", stream: "default", org: "org1" };

// The registry keeps its appliers and app at module scope, so each spec loads a fresh copy.
let applyAction: typeof Registry.applyAction;
let createActionDispatcher: typeof Registry.createActionDispatcher;
let registerApplier: typeof Registry.registerApplier;

describe("action registry", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ applyAction, createActionDispatcher, registerApplier } = await import("./registry"));
    track.mockReset();
  });

  it("refuses approval and undo from a click, as only the approvals runtime may land them", async () => {
    const applier = vi.fn(() => ({ ok: true as const }));
    registerApplier("approval", applier);
    registerApplier("undo", applier);
    createActionDispatcher(makeEnv().env);
    await expect(
      applyAction("s", { kind: "approval", approvalId: "a", decision: "approve" } as never),
    ).resolves.toEqual({ ok: false, reason: "gated" });
    await expect(applyAction("s", { kind: "undo", ledgerId: "a" })).resolves.toEqual({
      ok: false,
      reason: "gated",
    });
    expect(applier).not.toHaveBeenCalled();
  });

  it.each([
    ["open_in_explorer", { kind: "open_in_explorer", query, explorer: "logs" }],
    ["navigate", { kind: "navigate", target: { name: "logs" }, label: "x" }],
    ["run_query", { kind: "run_query", query, blockId: "b" }],
    ["add_to_dashboard_draft", { kind: "add_to_dashboard_draft", query }],
    ["create_alert_draft", { kind: "create_alert_draft", query }],
    ["rerun_now", { kind: "rerun_now", turnId: "t" }],
    ["regenerate", { kind: "regenerate", turnId: "t" }],
  ])("refuses %s while the page is on another org than the session", async (kind, action) => {
    const { env, sid } = makeEnv();
    env.currentOrg.mockReturnValue("org2");
    const applier = vi.fn(() => ({ ok: true as const }));
    registerApplier(kind as never, applier);
    createActionDispatcher(env);
    await expect(applyAction(sid, action as never)).resolves.toEqual({
      ok: false,
      reason: "other_org",
    });
    expect(applier).not.toHaveBeenCalled();
  });

  it("lets copy and open_step through on another org, as they leave the page alone", async () => {
    const { env, sid } = makeEnv();
    env.currentOrg.mockReturnValue("org2");
    registerApplier("copy", () => ({ ok: true }));
    createActionDispatcher(env);
    await expect(applyAction(sid, { kind: "copy", text: "x", what: "query" })).resolves.toEqual({
      ok: true,
    });
  });

  it("answers needs_host for Insert while no editor applier is registered", async () => {
    createActionDispatcher(makeEnv().env);
    await expect(
      applyAction("s", {
        kind: "insert_into_editor",
        text: "x",
        language: "sql",
        hostId: "inline",
        mode: "replace",
        provenance: { prompt: "" },
      }),
    ).resolves.toEqual({ ok: false, reason: "needs_host" });
  });

  it("refuses a turn-starting action while the gate is closed, before its applier runs", async () => {
    const { env } = makeEnv();
    env.capability.mockReturnValue({ ...env.capability(), gate: "no_permission" });
    const applier = vi.fn(() => ({ ok: true as const }));
    registerApplier("rerun_now", applier);
    createActionDispatcher(env);
    await expect(applyAction("s", { kind: "rerun_now", turnId: "t" })).resolves.toEqual({
      ok: false,
      reason: "gated",
    });
    expect(applier).not.toHaveBeenCalled();
  });

  it("refuses a turn-starting action while another tab locks the chat, before its applier runs", async () => {
    const { env } = makeEnv();
    const store = env.store();
    vi.spyOn(store, "turnLockOf").mockImplementation((sid) =>
      sid === "s" ? "approval_elsewhere" : null,
    );
    const applier = vi.fn(() => ({ ok: true as const }));
    registerApplier("rerun_now", applier);
    createActionDispatcher(env);
    await expect(applyAction("s", { kind: "rerun_now", turnId: "t" })).resolves.toEqual({
      ok: false,
      reason: "gated",
    });
    expect(applier).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith("ai_evidence_action", expect.anything());
  });

  it("turns a throwing applier into failed", async () => {
    registerApplier("copy", () => {
      throw new Error("boom");
    });
    createActionDispatcher(makeEnv().env);
    await expect(applyAction("s", { kind: "copy", text: "x", what: "query" })).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("tracks each evidence action by name and enums only", async () => {
    registerApplier("run_query", () => ({ ok: true }));
    registerApplier("open_in_explorer", () => ({ ok: true }));
    registerApplier("navigate", () => ({ ok: false, reason: "guard_declined" }));
    registerApplier("rerun_now", () => ({ ok: true }));
    createActionDispatcher(makeEnv().env);
    await applyAction("s", { kind: "run_query", query, blockId: "b" });
    await applyAction("s", { kind: "open_in_explorer", query, explorer: "logs" });
    await applyAction("s", { kind: "navigate", target: { name: "logs" }, label: "x" as any });
    await applyAction("s", { kind: "rerun_now", turnId: "t" });
    expect(track.mock.calls).toEqual([
      ["ai_evidence_action", { action: "run_inline", block_kind: "query", language: "sql" }],
      ["ai_navigation", { mode: "link_card", taken: true, blocked_unsaved: false }],
      ["ai_evidence_action", { action: "open_explorer", block_kind: "query", language: "sql" }],
      ["ai_navigation", { mode: "link_card", taken: false, blocked_unsaved: true }],
      ["ai_evidence_action", { action: "rerun_now", block_kind: "footer" }],
    ]);
    expect(JSON.stringify(track.mock.calls)).not.toContain("SELECT");
  });

  it("tracks ai_feedback only on success and scoped to the voted turn", async () => {
    registerApplier("feedback", () => ({ ok: true, detail: { turnId: "t1" } }));
    createActionDispatcher(makeEnv().env);
    await applyAction("s1", {
      kind: "feedback",
      messageId: "t1",
      vote: "down",
      reason: "wrong_query",
    });
    expect(track).toHaveBeenCalledWith(
      "ai_feedback",
      { value: "down", reason: "wrong_query", outcome: "done" },
      { sid: "s1", turnId: "t1" },
    );
  });
});
