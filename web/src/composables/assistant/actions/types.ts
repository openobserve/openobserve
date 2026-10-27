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

import type { I18nText } from "@/types/i18n";

import type { ApprovalDecision, AssistantError, DockHostId, Sid } from "../assistantStore.types";
import type { ContextChip } from "../context/types";

export interface QueryRef {
  language: "sql" | "promql" | "vrl" | "regex";
  text: string;
  stream?: string;
  streamType?: string;
  from?: number;
  to?: number;
  /** The session's captured org, never tool args (round 2 E-16). */
  org: string;
}

export interface RouteTarget {
  name: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export type AssistantAction =
  | { kind: "open_in_explorer"; query: QueryRef; explorer: "logs" | "metrics" | "traces" }
  | { kind: "run_query"; query: QueryRef; blockId: string }
  | { kind: "stop_query"; blockId: string }
  | { kind: "copy"; text: string; what: "query" | "answer" | "markdown" | "chat_id" | "details" }
  | {
      kind: "insert_into_editor";
      text: string;
      language: QueryRef["language"];
      hostId: DockHostId | "inline";
      mode: "replace" | "append";
      provenance: { prompt: string; stream?: string; range?: { from: number; to: number } };
    }
  | { kind: "add_to_dashboard_draft"; query: QueryRef; turnId?: string }
  | { kind: "create_alert_draft"; query: QueryRef; threshold?: unknown; turnId?: string }
  | { kind: "open_step"; callId: string }
  | { kind: "rerun_now"; turnId: string }
  | { kind: "navigate"; target: RouteTarget; newTab?: boolean; label: I18nText }
  | { kind: "approval"; decision: ApprovalDecision; approvalId: string }
  | { kind: "undo"; ledgerId: string }
  | { kind: "retry" }
  | { kind: "stop" }
  | { kind: "continue" }
  | { kind: "ask_again" }
  | { kind: "regenerate"; turnId: string }
  | { kind: "edit_resend"; messageId: string; text: string; chips: ContextChip[] }
  | { kind: "retry_save"; turnId: string }
  | {
      kind: "feedback";
      messageId: string;
      vote: "up" | "down";
      reason?: string;
      comment?: string;
    }
  | {
      kind: "share";
      op: "create" | "update" | "revoke" | "copy_link" | "download" | "refresh" | "manage";
    }
  | { kind: "fork"; token: string }
  | { kind: "export"; sid: Sid; format: "markdown" | "json" };

export type ActionResult =
  | { ok: true; detail?: unknown }
  | {
      ok: false;
      reason:
        "gated" | "needs_host" | "host_too_narrow" | "guard_declined" | "failed" | "other_org";
      error?: AssistantError;
    };
