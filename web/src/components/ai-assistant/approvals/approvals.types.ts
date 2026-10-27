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

import type { InjectionKey } from "vue";

import type {
  ActionResult,
  ApprovalBlockData,
  ApprovalDecision,
  ApprovalOutcome,
  ApprovalResult,
  PendingApproval,
  Sid,
} from "@/composables/assistant/pure";

/** The card as its component renders it: the transcript's block, plus the pending card's ids and expiry while it waits. */
export type ApprovalCardView = ApprovalBlockData &
  Partial<Pick<PendingApproval, "sessionId" | "turnId" | "expiresAt" | "askedIn">>;

/** Every state a record renders; `waiting_elsewhere` is a card another tab of this browser holds. */
export type ApprovalResultState = ApprovalOutcome["state"] | "waiting_elsewhere";

/** What a record shows: its state, the decision's own record and, for an approve, the rows `/confirm` answered. */
export interface ApprovalResultView {
  state: ApprovalResultState;
  outcome: ApprovalOutcome | null;
  result: ApprovalResult | null;
}

/** A decision the card emits with the id of the card it was made on; the container posts it through the store. */
export interface ApprovalCardDecision {
  decision: ApprovalDecision;
  approvalId: string;
}

/** What a live record asks of the approvals runtime; a shared page provides none, so its records never act. */
export interface AssistantApprovalsHost {
  /** The card this tab holds for the session, which renders in the container instead of the record. */
  pendingId(sid: Sid): string | null;
  currentUser(): string;
  sendAgain(sid: Sid, approvalId: string): void;
  askAgain(sid: Sid, approvalId: string): void;
  /** Stop on a turn another tab is waiting on. */
  stop(sid: Sid): void;
  undo(sid: Sid, ledgerId: string): Promise<ActionResult>;
}

/** Provided by the shell beside the evidence host. */
export const assistantApprovalsHostKey: InjectionKey<AssistantApprovalsHost> =
  /* @__PURE__ */ Symbol("assistantApprovalsHost");
