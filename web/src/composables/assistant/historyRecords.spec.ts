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

import { afterEach, describe, expect, it, vi } from "vitest";

import assistantService, {
  parseChatDetail,
  type ChatActivityRow,
  type ChatDetail,
} from "@/services/assistant";
import { raw } from "@/types/i18n";
import type { ChatMessage } from "@/ts/interfaces/chat";

import { decisionsAfterProposal } from "@/components/ai-assistant/approvals/approvalPlacement";

import { parseFrame } from "./frames";
import type { HistoryCtx } from "./historyContext";
import {
  grantedLedger,
  joinGrantedLedger,
  ledgerFromActivity,
  shownTurns,
  withGrantedRecords,
  withTargetResults,
} from "./historyRecords";
import { reduce, type StreamState } from "./reducer";
import { projectRecord, type StoredTurn } from "./record";

// The chat read the server answered for a reopened chat whose update was skipped as changed since asked.
const DETAIL = join(__dirname, "__fixtures__/history/decided-approval.json");
const CARD_ID = "apr_010996298bcfefd727f5";
const ALERT_ID = "3LrpP3S4OgYZjmWhBm5Isxoi8vI";

function readDetail(): ChatDetail {
  return parseChatDetail(JSON.parse(readFileSync(DETAIL, "utf8")));
}

// The same chat had the approve written: the row says approved with no skip, and the gated call succeeded.
function doneDetail(): ChatDetail {
  const raw = JSON.parse(readFileSync(DETAIL, "utf8"));
  delete raw.approvals[0].resolved.outcome;
  delete raw.approvals[0].resolved.code;
  delete raw.approvals[0].resolved.detail;
  const gated = raw.turns[0].frames.find((f: any) => f.approval_id === CARD_ID);
  Object.assign(gated, { success: true, message: "UpdateAlert completed successfully" });
  delete gated.error_type;
  return parseChatDetail(raw);
}

function reopened(detail: ChatDetail) {
  const turns = shownTurns(detail, detail.turns as StoredTurn[]);
  return projectRecord(turns, "owner", { timezone: "UTC", approvals: detail.approvals });
}

function answerBlocks(detail: ChatDetail) {
  return reopened(detail).find((m) => m.role === "assistant")?.contentBlocks ?? [];
}

describe("historyRecords: decided approvals after a reload (N1)", () => {
  it("keeps the server row's outcome, code and detail on the parsed approval", () => {
    const row = readDetail().approvals?.[0];
    expect(row?.status).toBe("approved");
    expect(row?.resolved).toEqual({
      outcome: "skipped",
      code: "changed_since",
      detail:
        "The alert changed after you were asked. Nothing was changed; review the new version and ask again.",
      scope: "once",
    });
    expect(row?.at).toBe(1794226329111);
  });

  it("rebuilds the decided card from the row, so the record names what it changed", () => {
    const blocks = answerBlocks(readDetail());
    const card = blocks.find((b) => b.approval?.id === CARD_ID)?.approval;
    expect(card?.kind).toBe("update");
    expect(card?.targets).toEqual([
      { type: "alert", name: "ta_approvals_rca_update_target", id: ALERT_ID },
    ]);
    expect(card?.before).toBeDefined();
    expect(card?.after).toBeDefined();
  });

  it("reads a skipped change as skipped with its code, never as a plain approve", () => {
    const resolved = answerBlocks(readDetail()).find((b) => b.resolved?.id === CARD_ID)?.resolved;
    expect(resolved).toMatchObject({
      approved: true,
      outcome: "skipped",
      code: "changed_since",
      recorded: true,
    });
    expect(resolved?.detail).toMatch(/^The alert changed after you were asked/);
  });

  it("puts the card and its record before the call it gated, as the live stream showed them", () => {
    const blocks = answerBlocks(readDetail());
    const types = blocks.map((b) => b.type);
    const cardAt = blocks.findIndex((b) => b.approval?.id === CARD_ID);
    expect(types.filter((type) => type === "approval_result")).toHaveLength(1);
    expect(blocks[cardAt + 1]?.resolved?.id).toBe(CARD_ID);
    const prose = blocks.findIndex((b) => b.type === "text" && /I proposed/.test(b.text ?? ""));
    expect(cardAt).toBeLessThan(prose);
  });

  it("gives an approved write its ledger entry back from the activity row, with Undo while the server allows it", () => {
    const messages = reopened(doneDetail());
    const rows: ChatActivityRow[] = [
      {
        id: "3LryNxUOqxGh6hVK5RQVTKVQg6M",
        at: 1794226330684027,
        target: { type: "alert", id: ALERT_ID, name: "ta_approvals_rca_update_target" },
        result: { state: "done" },
        undo: { available: true, until: 1794312844684027 },
        chat_id: "01a1c038-b326-7736-aa53-8351c1610de4",
      },
    ];
    const [entry, ...rest] = ledgerFromActivity(messages, rows);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      id: "3LryNxUOqxGh6hVK5RQVTKVQg6M",
      approvalId: CARD_ID,
      turnId: "01a1c038-bd45-777a-8025-425b736fd044",
      op: "update",
      status: "done",
      undoable: true,
      resource: { type: "alert", id: ALERT_ID, name: "ta_approvals_rca_update_target" },
    });
  });

  it("offers no Undo once the server says the window closed, and matches no row from before the decision", () => {
    const messages = reopened(doneDetail());
    const late: ChatActivityRow = {
      id: "late",
      at: 1794226330684027,
      target: { type: "alert", id: ALERT_ID, name: "ta_approvals_rca_update_target" },
      result: { state: "done" },
      undo: { available: false, reason: "expired" },
    };
    const early: ChatActivityRow = { ...late, id: "early", at: 1794220000000000 };
    const entries = ledgerFromActivity(messages, [early, late]);
    expect(entries.map((e) => [e.id, e.undoable])).toEqual([["late", false]]);
  });

  it("writes no ledger entry for a skipped change, which wrote nothing", () => {
    const messages = reopened(readDetail());
    const row: ChatActivityRow = {
      id: "skip",
      at: 1794226330684027,
      target: { type: "alert", id: ALERT_ID },
      result: { state: "skipped" },
      undo: { available: false, reason: "changed_since" },
    };
    expect(ledgerFromActivity(messages, [row])).toEqual([]);
  });
});

// A gathered pause of two alerts, approved "Always", where one alert was already muted: the real chat read and its ledger rows.
const MULTI = join(__dirname, "__fixtures__/history/multi-target-approval.json");
const MULTI_ID = "apr_1e36dce0a948709edf81";

function readMulti(): { detail: ChatDetail; rows: ChatActivityRow[] } {
  const raw = JSON.parse(readFileSync(MULTI, "utf8"));
  return { detail: parseChatDetail(raw.detail), rows: raw.activity };
}

describe("historyRecords: a multi-target record after a reload (P2-3, P3-2)", () => {
  it("puts the record after the gated calls, so it follows the proposal text", () => {
    const { detail } = readMulti();
    const blocks = decisionsAfterProposal(answerBlocks(detail));
    const proposal = blocks.findIndex((b) => b.type === "text" && /I proposed/.test(b.text ?? ""));
    const record = blocks.findIndex((b) => b.resolved?.id === MULTI_ID);
    expect(proposal).toBeGreaterThanOrEqual(0);
    expect(record).toBeGreaterThan(proposal);
    expect(blocks.filter((b) => b.approval?.id === MULTI_ID)).toHaveLength(1);
  });

  it("keeps the stored scope and partial outcome on the resolution", () => {
    const resolved = answerBlocks(readMulti().detail).find((b) => b.resolved?.id === MULTI_ID);
    expect(resolved?.resolved).toMatchObject({
      approved: true,
      outcome: "partial",
      scope: "always",
    });
  });

  it("gives each target its own ledger entry, verb and Undo, and each target row its result", () => {
    const { detail, rows } = readMulti();
    const messages = reopened(detail);
    const entries = ledgerFromActivity(messages, rows);
    expect(
      entries.map((e) => [e.resource.name, e.status, e.undoable, e.verb, e.approvalId]),
    ).toEqual([
      ["ta_approvals_rca_checkout_5xx", "done", true, "pause", MULTI_ID],
      ["ta_approvals_rca_update_target", "failed", false, "pause", MULTI_ID],
    ]);
    withTargetResults(messages, entries);
    const resolved = messages
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.resolved?.id === MULTI_ID);
    expect(resolved?.resolved?.items).toEqual([
      {
        type: "alert",
        name: "ta_approvals_rca_checkout_5xx",
        id: "3Lrp9Mt5h7UGo5tNt6sEKkxWzRX",
        status: "done",
        ledgerId: "3Ls8LHD41Ey9cHB2aTMc11YXwMj",
        undoable: true,
      },
      {
        type: "alert",
        name: "ta_approvals_rca_update_target",
        id: "3LrpP3S4OgYZjmWhBm5Isxoi8vI",
        status: "failed",
        message: "The call answered 409",
        ledgerId: "3Ls8LLt87C7RmPWauAJz7d3KK5u",
      },
    ]);
  });
});

// A reopened chat whose pause ran under an Always grant: the real chat read and its `standing` ledger row.
const STANDING = join(__dirname, "__fixtures__/history/standing-grant-write.json");
const GRANT_ID = "3LsFZCR8P0P3phihr81MOm7u4HX";

function readStanding(done: boolean): { detail: ChatDetail; rows: ChatActivityRow[] } {
  const raw = JSON.parse(readFileSync(STANDING, "utf8"));
  const row = raw.rows[0];
  // The live row was written while the grant was active and the alert already paused.
  row.approval.grant_id = GRANT_ID;
  if (done) {
    row.result = { state: "done" };
    row.undo = { available: true, until: row.at + 3_600_000_000 };
  }
  return { detail: parseChatDetail(raw.detail), rows: raw.rows };
}

describe("historyRecords: a write an Always grant let run, after a reload (P2-2)", () => {
  it("rebuilds the standing record after the gated step, with the grant to revoke and its ledger entry", () => {
    const { detail, rows } = readStanding(true);
    const messages = reopened(detail);
    const entries = withGrantedRecords(messages, rows);
    const blocks = messages.find((m) => m.role === "assistant")?.contentBlocks ?? [];
    const step = blocks.findIndex((b) => b.type === "tool_call" && b.tool === "MuteAlert");
    expect(blocks[step + 1]).toEqual({
      type: "approval_result",
      resolved: {
        id: `grant_${rows[0].id}`,
        approved: true,
        by: "grant",
        at: Math.floor(rows[0].at / 1000),
        grant: {
          id: GRANT_ID,
          tool: "MuteAlert",
          operation: "update",
          targets: [
            {
              type: "alert",
              name: "3LrpP6aNCNvoXFqPf6yNtzimvPx",
              id: "3LrpP6aNCNvoXFqPf6yNtzimvPx",
            },
          ],
        },
      },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        approvalId: `grant_${rows[0].id}`,
        tool: "MuteAlert",
        verb: "pause",
        status: "done",
        undoable: true,
      }),
    ]);
    expect(withGrantedRecords(messages, rows)).toEqual([]);
  });

  it("keeps a failed standing write failed and offers no Revoke once the grant is gone", () => {
    const { detail, rows } = readStanding(false);
    delete rows[0].approval!.grant_id;
    const messages = reopened(detail);
    withGrantedRecords(messages, rows);
    const resolved = messages
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.resolved?.by === "grant")?.resolved;
    expect(resolved).toMatchObject({ outcome: "failed", detail: "The call answered 409" });
    expect(resolved?.grant?.id).toBeUndefined();
  });

  it("names the paused alert as the server stored it and keeps the grant's scope (P2-2 gaps 2, 3)", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "__fixtures__/history/standing-grant-named.json"), "utf8"),
    );
    const messages = reopened(parseChatDetail(raw.detail));
    const [entry] = withGrantedRecords(messages, raw.rows);
    const resolved = messages
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.resolved?.by === "grant")?.resolved;
    expect(resolved?.scope).toBe("always");
    expect(resolved?.grant?.targets).toEqual([
      { type: "alert", name: "ta_approvals_rca_update_target", id: "3LrpP3S4OgYZjmWhBm5Isxoi8vI" },
    ]);
    expect(entry.resource.name).toBe("ta_approvals_rca_update_target");

    raw.rows[0].approval.scope = "chat";
    const chatScoped = reopened(parseChatDetail(raw.detail));
    withGrantedRecords(chatScoped, raw.rows);
    const chatResolved = chatScoped
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.resolved?.by === "grant")?.resolved;
    expect(chatResolved?.scope).toBe("chat");
  });

  it("adds no record for an approved or unrelated row", () => {
    const { detail, rows } = readStanding(true);
    const messages = reopened(detail);
    const approved = { ...rows[0], approval: { kind: "approved", by: "root@example.com" } };
    const otherTool = { ...rows[0], id: "x", tool: "UpdateDashboard" };
    expect(withGrantedRecords(messages, [approved, otherTool])).toEqual([]);
    expect(messages.flatMap((m) => m.contentBlocks ?? []).some((b) => b.resolved)).toBe(false);
  });
});

// The live stream of a pause an Always grant let run, and the ledger row it wrote, as the browser got them.
const LIVE = join(__dirname, "__fixtures__/history/granted-write-live.json");

function liveGrantedWrite(): { messages: ChatMessage[]; rows: ChatActivityRow[]; frame: any } {
  const wire = JSON.parse(readFileSync(LIVE, "utf8"));
  const state: StreamState = {
    messages: [
      { role: "user", content: raw("Pause the alert"), turnId: "t1" },
      { role: "assistant", content: raw(""), contentBlocks: [] },
    ],
    activeToolCall: null,
    textSegment: "",
    streamingMsg: "",
    title: undefined,
    lastTraceId: null,
    ownerUnavailable: false,
    pendingConfirmation: null,
    messageComplete: false,
    halted: false,
  };
  const ctx = {
    isActive: false,
    autoNavigationEnabled: false,
    phase: "live" as const,
    t: ((key: string) => key) as any,
    generateNavigation: () => null,
  };
  for (const data of wire.frames) {
    const parsed = parseFrame(JSON.stringify(data));
    reduce(state, parsed.type === "unknown" ? data : parsed, ctx);
  }
  const frame = wire.frames.find((f: any) => f.by === "grant");
  return { messages: state.messages, rows: wire.rows, frame };
}

describe("historyRecords: a write an Always grant let run, live (P2-2 gap 1)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("joins the live record to its ledger row by the approval id they share, so Undo shows", () => {
    const { messages, rows, frame } = liveGrantedWrite();
    expect(grantedLedger(messages, rows)).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        approvalId: frame.id,
        turnId: "t1",
        tool: "MuteAlert",
        status: "done",
        undoable: true,
        resource: {
          type: "alert",
          name: "ta_approvals_rca_update_target",
          id: "3LrpP3S4OgYZjmWhBm5Isxoi8vI",
        },
      }),
    ]);
    const other = { ...rows[0], approval: { ...rows[0].approval!, id: "grant_other~00" } };
    expect(grantedLedger(messages, [other])).toEqual([]);
  });

  it("reads the chat's ledger once from just before the grant frame and adds the entry once", async () => {
    const { messages, rows, frame } = liveGrantedWrite();
    const session = { org: "default", messages, ledger: [] as any[] };
    const read = vi.spyOn(assistantService, "chatActivity").mockResolvedValue(rows);
    const ctx = { session: () => session } as unknown as HistoryCtx;
    await joinGrantedLedger("s1" as any, ctx);
    expect(read).toHaveBeenCalledWith("default", "s1", (frame.at - 60_000) * 1000);
    expect(session.ledger).toEqual([expect.objectContaining({ approvalId: frame.id })]);
    await joinGrantedLedger("s1" as any, ctx);
    expect(read).toHaveBeenCalledTimes(1);
    expect(session.ledger).toHaveLength(1);
  });
});
