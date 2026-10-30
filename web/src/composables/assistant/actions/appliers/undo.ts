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

import { trackAssistant, type ApprovalOp } from "@/services/assistantAnalytics";

import { ERROR_LEDGER } from "../../assistantErrors";
import type { ActionLedgerEntry, Sid } from "../../assistantStore.types";
import { registerApplier, type ActionEnv } from "../registry";
import { approvalAnnotationKey } from "./approval";
import type { ActionResult, AssistantAction } from "../types";

/** Registers the `undo` applier; only the approvals runtime's dispatch reaches it. */
export function registerUndoAppliers(): void {
  registerApplier("undo", undoApplier);
}

/** Whether an entry offers Undo: only the server's own ledger can restore an object, one undo at a time. */
export function canUndo(entry: ActionLedgerEntry): boolean {
  return entry.undoable && entry.status === "done" && !entry.undoing && !entry.undoUnconfirmed;
}

// The object comes back only through the server's restore of its stored copy; the client never re-creates anything itself.
async function undoApplier(
  sid: Sid,
  action: Extract<AssistantAction, { kind: "undo" }>,
  env: ActionEnv,
): Promise<ActionResult> {
  const store = env.store();
  const session = store.state.sessions[sid];
  const entry = session?.ledger.find((candidate) => candidate.id === action.ledgerId);
  if (!session || !entry || !canUndo(entry)) return { ok: false, reason: "gated" };
  const op = opOf(entry);
  const update = (patch: Partial<ActionLedgerEntry>) => {
    session.ledger = session.ledger.map((candidate) =>
      candidate.id === entry.id ? { ...candidate, ...patch } : candidate,
    );
    if (entry.approvalId)
      store.annotate(sid, approvalAnnotationKey(entry.approvalId), {
        ledger: session.ledger.filter((candidate) => candidate.approvalId === entry.approvalId),
      });
  };
  update({ undoing: true, undoFailed: false });
  try {
    const restored = await env.undo(session.org, entry.id);
    update({
      status: "undone",
      undoing: false,
      undoneAt: env.now(),
      ...(restored.id && { resource: { ...entry.resource, id: restored.id } }),
    });
    trackAssistant("ai_undo", { op, resource_kind: entry.resource.type, succeeded: true });
    return { ok: true, detail: { restoredId: restored.id ?? null } };
  } catch (err) {
    const answered =
      typeof (err as { response?: { status?: unknown } })?.response?.status === "number";
    update(
      answered ? { undoing: false, undoFailed: true } : { undoing: false, undoUnconfirmed: true },
    );
    trackAssistant("ai_undo", { op, resource_kind: entry.resource.type, succeeded: false });
    const error = { code: "unknown" as const, ...ERROR_LEDGER.unknown, phase: "mutation" as const };
    return { ok: false, reason: "failed", error };
  }
}

function opOf(entry: ActionLedgerEntry): ApprovalOp {
  return entry.op === "run_command" ? "run" : entry.op;
}
