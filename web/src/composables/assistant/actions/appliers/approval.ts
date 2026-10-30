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

import { CONFIRM_TIMEOUT_MS, type ConfirmBody, type ConfirmResponse } from "@/services/assistant";

import { ERROR_LEDGER } from "../../assistantErrors";
import type {
  ActionLedgerEntry,
  ApprovalDecision,
  ApprovalOutcome,
  ApprovalResult,
  ApprovalResultItem,
  AssistantError,
  AssistantSession,
  PendingApproval,
  Sid,
} from "../../assistantStore.types";
import { isDeleteCard, type ApprovalBlockData } from "../../reducer";
import { registerApplier, type ActionEnv } from "../registry";
import type { ActionResult, AssistantAction } from "../types";

/** The record an approval leaves (`approvalOutcome`, `approvalResult`, its `ledger` entries), kept in this browser across a reload. */
export const APPROVAL_ANNOTATION_PREFIX = "approval:";

// A response is server data: its rows are capped like every other list on a card.
const MAX_RESULT_ITEMS = 200;

const MAX_MESSAGE_CHARS = 200;

// The record quotes the reply; the reply itself goes in full as the next turn.
const MAX_REPLY_CHARS = 500;

/** A chat's timeline keeps its latest entries only. */
export const MAX_LEDGER = 200;

// o2-ai deletes a batch item by item inside `/confirm`, so an approve waits longer the more it acts on.
const CONFIRM_MS_PER_ITEM = 1_000;

// Under the OpenObserve proxy's own 120 s read timeout, so this tab's "unknown" comes before the proxy's 500.
const MAX_CONFIRM_MS = 110_000;

const DENIED_STATE: Record<
  Extract<ApprovalDecision, { approved: false }>["reason"],
  ApprovalOutcome["state"]
> = {
  deny: "declined",
  escape: "declined",
  new_chat: "new_chat",
  reply: "replied",
  expired: "expired",
  withdrawn: "withdrawn",
  edited: "editing",
};

const OP_OF_KIND: Record<PendingApproval["kind"], ActionLedgerEntry["op"]> = {
  delete: "delete",
  update: "update",
  create: "create",
  run_command: "run_command",
  permission: "run_command",
};

/** What a decision came to: the record's state and, for an approve answered item by item, its rows. */
export interface ApprovalDetail {
  outcome: ApprovalOutcome;
  result?: ApprovalResult;
}

/** Registers the `approval` applier; only the approvals runtime's dispatch reaches it. */
export function registerApprovalAppliers(): void {
  registerApplier("approval", approvalApplier);
}

/** The annotation key of an approval's record. */
export function approvalAnnotationKey(approvalId: string): string {
  return `${APPROVAL_ANNOTATION_PREFIX}${approvalId}`;
}

/** The card an approval id names: the block the transcript kept, with the pending card's session ids while it waits. */
export function approvalCardOf(
  session: AssistantSession | undefined,
  approvalId: string,
): (ApprovalBlockData & { sessionId?: string; turnId?: string }) | null {
  if (!session) return null;
  const pending = session.pendingApproval?.id === approvalId ? session.pendingApproval : null;
  let block: ApprovalBlockData | undefined;
  for (let i = session.messages.length - 1; i >= 0 && !block; i--)
    block = session.messages[i].contentBlocks?.find((b) => b.approval?.id === approvalId)?.approval;
  if (!block && !pending) return null;
  const base: ApprovalBlockData = block ?? { ...pending!, typed: false };
  return { ...base, ...(pending && { sessionId: pending.sessionId, turnId: pending.turnId }) };
}

/** The `/confirm` body of a decision; scope and a subset go only to a server that sent a typed card, and never a scope for a destructive one. */
export function confirmBodyOf(
  decision: ApprovalDecision,
  card: Pick<
    ApprovalBlockData,
    "typed" | "grantable" | "destructive" | "kind" | "tool" | "operation"
  >,
): ConfirmBody {
  if (!decision.approved)
    return decision.reason === "reply" && decision.reply && card.typed
      ? { approved: false, reply: decision.reply }
      : { approved: false };
  return {
    approved: true,
    ...(canAlwaysAllow(card) && decision.scope !== "once" && { scope: decision.scope }),
    ...(card.typed && decision.items && { items: decision.items }),
  };
}

/** Whether a card may be approved for more than this once; a destructive kind never is, whatever the server says. */
export function canAlwaysAllow(
  card: Pick<ApprovalBlockData, "grantable" | "destructive" | "kind" | "tool" | "operation">,
): boolean {
  return card.grantable && !card.destructive && !isDeleteCard(card);
}

/** The rows of a `/confirm` answer; `null` when it answers no items (a permission or CLI approval). */
export function approvalResultOf(
  card: Pick<ApprovalBlockData, "targets">,
  response: ConfirmResponse,
  resolvedBy: string,
  resolvedAt: number,
): ApprovalResult | null {
  if (!Array.isArray(response.results) || response.results.length === 0) return null;
  const items = response.results.slice(0, MAX_RESULT_ITEMS).map((raw) => itemOf(raw, card));
  const done = items.filter((item) => item.status === "done").length;
  const status = done === items.length ? "done" : done === 0 ? "failed" : "partial";
  return { status, items, resolvedBy, resolvedAt };
}

async function approvalApplier(
  sid: Sid,
  action: Extract<AssistantAction, { kind: "approval" }>,
  env: ActionEnv,
): Promise<ActionResult> {
  const store = env.store();
  const session = store.state.sessions[sid];
  const card = approvalCardOf(session, action.approvalId);
  if (!session || !card) return { ok: false, reason: "failed" };
  const key = approvalAnnotationKey(card.id);
  const decision = action.decision;
  if (decision.approved && decision.scope !== "once" && !canAlwaysAllow(card))
    return { ok: false, reason: "gated" };
  // Never green before the answer: the record reads "Sending your decision…" until `/confirm` returns.
  store.annotate(sid, key, { approvalOutcome: { state: "sending", at: env.now(), decision } });
  try {
    const items = decision.approved
      ? (decision.items?.length ?? card.total ?? card.targets.length)
      : 0;
    const timeoutMs = Math.min(CONFIRM_TIMEOUT_MS + items * CONFIRM_MS_PER_ITEM, MAX_CONFIRM_MS);
    const response = await env.confirm(
      session.org,
      card.sessionId || sid,
      confirmBodyOf(decision, card),
      timeoutMs,
    );
    const detail = detailOf(decision, card, response, env);
    const ledger = detail.result ? appendLedger(session, card, detail.result) : [];
    store.annotate(sid, key, {
      approvalOutcome: detail.outcome,
      ...(detail.result && { approvalResult: detail.result }),
      ...(ledger.length && { ledger }),
    });
    return { ok: true, detail };
  } catch (err) {
    const httpStatus = httpStatusOf(err);
    const error = deliveryError(httpStatus);
    const state = httpFailed(httpStatus, decision.approved);
    // A decline that may have landed changed nothing either way, so it reads as what it was.
    if (!decision.approved && state === "unconfirmed") {
      const detail = detailOf(decision, card, {}, env);
      store.annotate(sid, key, { approvalOutcome: detail.outcome });
      return { ok: true, detail };
    }
    store.annotate(sid, key, {
      approvalOutcome: {
        state,
        at: env.now(),
        decision,
        ...(httpStatus !== undefined && { httpStatus }),
      },
    });
    return { ok: false, reason: "failed", error };
  }
}

function detailOf(
  decision: ApprovalDecision,
  card: ApprovalBlockData,
  response: ConfirmResponse,
  env: ActionEnv,
): ApprovalDetail {
  const at = env.now();
  if (!decision.approved) {
    const kept = decision.reply
      ? { ...decision, reply: decision.reply.slice(0, MAX_REPLY_CHARS) }
      : decision;
    return { outcome: { state: DENIED_STATE[decision.reason], at, decision: kept } };
  }
  // A refusal of the server's own is never a success, and an answer with no rows confirms nothing.
  const rows = response.results;
  const refused =
    response.approved === false ||
    response.replied === false ||
    (!Array.isArray(rows) && response.deleted === false);
  if (refused) return { outcome: { state: "failed", at, decision } };
  if (Array.isArray(rows) && rows.length === 0)
    return { outcome: { state: "unconfirmed", at, decision } };
  const result = approvalResultOf(card, response, env.currentUser(), at);
  const state = result ? result.status : "approved";
  return { outcome: { state, at, decision }, ...(result && { result }) };
}

function itemOf(raw: unknown, card: Pick<ApprovalBlockData, "targets">): ApprovalResultItem {
  const item = (raw ?? {}) as Record<string, unknown>;
  const name = text(item.resource ?? item.name).slice(0, 200);
  const type =
    text(item.resource_type ?? item.type)
      .slice(0, 40)
      .toLowerCase() || "object";
  const done = item.deleted === true || item.success === true || item.status === "done";
  const target = card.targets.find((t) => t.name === name && (t.type === type || !t.type));
  const status = typeof item.status_code === "number" ? item.status_code : undefined;
  const ledgerId = typeof item.ledger_id === "string" ? item.ledger_id.slice(0, 200) : "";
  return {
    type,
    name,
    status: done ? "done" : "failed",
    ...(target?.id && { id: target.id }),
    ...(!done && status !== undefined && { code: String(status) }),
    ...(!done &&
      item.detail !== undefined && { message: text(item.detail).slice(0, MAX_MESSAGE_CHARS) }),
    // Only the server's own ledger can restore an object, so Undo needs the id it issued.
    ...(item.undoable === true && ledgerId && { undoable: true, ledgerId }),
  };
}

function appendLedger(
  session: AssistantSession,
  card: ApprovalBlockData & { turnId?: string },
  result: ApprovalResult,
): ActionLedgerEntry[] {
  const entries = result.items.map<ActionLedgerEntry>((item, index) => ({
    id: item.ledgerId ?? `${card.id}:${index}`,
    approvalId: card.id,
    turnId: card.turnId ?? session.turnMeta.turnId ?? "",
    tool: card.tool,
    op: OP_OF_KIND[card.kind],
    resource: { type: item.type, name: item.name, ...(item.id && { id: item.id }) },
    status: item.status === "done" ? "done" : "failed",
    undoable: item.status === "done" && item.undoable === true,
    at: result.resolvedAt,
  }));
  const known = new Set(entries.map((entry) => entry.id));
  session.ledger = [...session.ledger.filter((e) => !known.has(e.id)), ...entries].slice(
    -MAX_LEDGER,
  );
  return entries;
}

// 404 is "no pending confirmation": the replica restarted or the server's TTL already declined it.
function deliveryError(httpStatus: number | undefined): AssistantError {
  const code = httpStatus === 404 ? "approval_expired" : "approval_delivery_failed";
  return {
    code,
    ...ERROR_LEDGER[code],
    phase: "post_admission",
    ...(httpStatus !== undefined && { httpStatus }),
  };
}

// A refusal the server explained failed and o2-ai's 409 consumed nothing; the proxy answers 500 for every other failure, which an approve may have run past.
function httpFailed(httpStatus: number | undefined, approved: boolean): ApprovalOutcome["state"] {
  if (httpStatus === 402 || httpStatus === 403 || httpStatus === 412) return "failed";
  if (httpStatus === 409) return "delivery_failed";
  return !approved && httpStatus !== undefined && httpStatus >= 500
    ? "delivery_failed"
    : "unconfirmed";
}

function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? status : undefined;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === undefined || value === null
      ? ""
      : String(value);
}
