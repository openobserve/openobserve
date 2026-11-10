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

import type { AssistantError } from "./assistantStore.types";
import type { AssistantFrame } from "./frames";

/** One turn from Send to its single terminal state (honest-turns §0.1). */
export type TurnState =
  | { state: "idle" }
  | { state: "queued" }
  | { state: "connecting" }
  | { state: "responding.thinking" }
  | { state: "responding.writing" }
  | { state: "running_tool"; tool: string; target: string | null; callId: string }
  | { state: "awaiting_approval"; callId: string; question?: boolean }
  | { state: "awaiting_consent" }
  | { state: "reconnecting"; attempt: number }
  | { state: "stopping" }
  | { state: "stopped"; steps: number; partial: boolean }
  | { state: "failed"; error: AssistantError }
  | { state: "refused"; error: AssistantError }
  | { state: "done"; saved: "server" | "local" | "not_saved" };

export type TurnStateName = TurnState["state"];

export type TurnTerminal = Extract<TurnState, { state: "done" | "stopped" | "failed" | "refused" }>;

/** Client-side events the turn reducer consumes beside the wire frames (`00` §5.3). */
export type TurnClientEvent =
  | { type: "send"; turnId: string }
  | {
      type: "admitted";
      result: { ok: true; status: number } | { ok: false; error: AssistantError };
    }
  | { type: "first_byte" }
  | { type: "keepalive" }
  | { type: "stop" }
  | { type: "cancel_acked" }
  | { type: "consent_enable" }
  | { type: "consent_cancel" }
  | { type: "approval_decided"; callId: string; approved: boolean }
  | { type: "approval_expired"; callId: string }
  | { type: "tail_caught_up" }
  | { type: "eof"; hasTail: boolean }
  | { type: "fetch_error"; error: AssistantError }
  | { type: "signed_out" };

export type TurnEvent = AssistantFrame | TurnClientEvent;

const TERMINAL_STATES: ReadonlySet<TurnStateName> = new Set([
  "done",
  "stopped",
  "failed",
  "refused",
]);

export function isTerminal(turn: TurnState): turn is TurnTerminal {
  return TERMINAL_STATES.has(turn.state);
}

export function isRunning(turn: TurnState): boolean {
  return turn.state !== "idle" && !isTerminal(turn);
}

/** True when this tab saw the turn a list summary calls running end, so that summary is stale. */
export function endedHere(
  session: {
    turn: TurnState;
    turnMeta: {
      endedAt?: number | null;
      turnId?: string | null;
      serverTurnId?: string | null;
      ownedByThisTab?: boolean;
    };
    pendingApproval?: unknown;
  },
  summary: { at: number; turnId?: string | null },
): boolean {
  const { endedAt, turnId, serverTurnId, ownedByThisTab } = session.turnMeta;
  if (!ownedByThisTab || session.pendingApproval) return false;
  if (session.turn.state !== "idle" && !isTerminal(session.turn)) return false;
  if (summary.turnId) return summary.turnId === turnId || summary.turnId === serverTurnId;
  return typeof endedAt === "number" && endedAt >= summary.at;
}
