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

import type { Router } from "vue-router";

import type {
  ConfirmBody,
  ConfirmResponse,
  FeedbackBody,
  UndoResponse,
} from "@/services/assistant";
import { trackAssistant, type AiEventProps } from "@/services/assistantAnalytics";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import type { TranslateFn } from "@/types/i18n";

import type { AssistantStoreInternal } from "../assistantStore";
import type {
  ActionDispatcher,
  AssistantCapability,
  HostRegistry,
  Sid,
} from "../assistantStore.types";
import type { ActionResult, AssistantAction, QueryRef } from "./types";

/** One applier per action family; it never asks for confirmation itself. */
export type Applier<A extends AssistantAction> = (
  sid: Sid,
  action: A,
  env: ActionEnv,
) => Promise<ActionResult> | ActionResult;

/** One search through the user's own permissions, the request Logs sends. */
export interface SearchRequest {
  org: string;
  sql: string;
  /** Microseconds, as the search API takes them. */
  startTime: number;
  endTime: number;
  streamType: string;
  size: number;
  signal: AbortSignal;
}

/** What the dashboard draft host renders: the query and the turn it came from. */
export interface DashboardDraft {
  query: QueryRef;
  originTurnId: string | null;
}

/** The app the appliers act on; `runtime.ts` provides it and specs pass fakes. */
export interface ActionEnv {
  store(): AssistantStoreInternal;
  router(): Pick<Router, "push" | "resolve"> | null;
  hosts: HostRegistry;
  capability(): AssistantCapability;
  currentOrg(): string | null;
  /** The signed-in user's email, recorded as who decided. */
  currentUser(): string;
  now(): number;
  t: TranslateFn;
  /** Opens a new tab with no `opener`; false when the browser blocked it. */
  openTab(href: string): boolean;
  copy(text: string): Promise<boolean>;
  search(request: SearchRequest): Promise<Record<string, unknown>>;
  feedback(org: string, sid: Sid, body: FeedbackBody): Promise<void>;
  /** `POST /ai/confirm/{sid}` on the session the card was asked in. */
  confirm(org: string, sid: Sid, body: ConfirmBody, timeoutMs?: number): Promise<ConfirmResponse>;
  /** The server's undo of one action-ledger entry. */
  undo(org: string, ledgerId: string): Promise<UndoResponse>;
  requestAlert(prefill: AlertPrefill): void;
  requestDashboard(draft: DashboardDraft): void;
}

type AnyApplier = Applier<AssistantAction>;

// Reads and the user's own clicks (Open, Run, drafts, Insert) are never carded; these start an agent turn.
const TURN_KINDS: ReadonlySet<AssistantAction["kind"]> = new Set([
  "rerun_now",
  "retry",
  "ask_again",
  "regenerate",
  "edit_resend",
]);

// Writes the assistant proposed land only through the approvals runtime's own dispatch, never from model output or another caller.
const APPROVAL_KINDS: ReadonlySet<AssistantAction["kind"]> = new Set(["approval", "undo"]);

// Held by this module and the dispatch it hands to the approvals runtime, so no other caller can present it.
const APPROVALS_RUNTIME = /* @__PURE__ */ Symbol("approvalsRuntime");

// A session of another org must never open, draft or start a turn while the page is on another org.
const ORG_BOUND_KINDS: ReadonlySet<AssistantAction["kind"]> = new Set([
  "open_in_explorer",
  "navigate",
  "run_query",
  "add_to_dashboard_draft",
  "create_alert_draft",
  "rerun_now",
  "retry",
  "ask_again",
  "regenerate",
  "edit_resend",
  "insert_into_editor",
]);

const appliers = new Map<AssistantAction["kind"], AnyApplier>();

let env: ActionEnv | null = null;

/** Registers the applier of one action kind; a later registration replaces it. */
export function registerApplier<K extends AssistantAction["kind"]>(
  kind: K,
  applier: Applier<Extract<AssistantAction, { kind: K }>>,
): void {
  appliers.set(kind, applier as AnyApplier);
}

/** Runs the confirmation rule, then the applier, then the action's telemetry. */
export async function applyAction(
  sid: Sid,
  action: AssistantAction,
  via?: symbol,
): Promise<ActionResult> {
  const applier = appliers.get(action.kind);
  // Insert needs an editor host; without its applier there is none to show the diff in.
  if (!applier)
    return { ok: false, reason: action.kind === "insert_into_editor" ? "needs_host" : "failed" };
  if (!env) return { ok: false, reason: "failed" };
  if (APPROVAL_KINDS.has(action.kind) && via !== APPROVALS_RUNTIME)
    return { ok: false, reason: "gated" };
  if (TURN_KINDS.has(action.kind) && env.capability().gate !== "available")
    return { ok: false, reason: "gated" };
  if (TURN_KINDS.has(action.kind) && env.store().turnLockOf(sid))
    return { ok: false, reason: "gated" };
  const session = env.store().state.sessions[sid];
  if (orgBound(action) && session && env.currentOrg() !== session.org) {
    return { ok: false, reason: "other_org" };
  }
  let result: ActionResult;
  try {
    result = await applier(sid, action, env);
  } catch {
    result = { ok: false, reason: "failed" };
  }
  trackAction(sid, action, result);
  return result;
}

/** Wires the appliers to the app and returns the store's `deps.actions`, plus the one dispatch the approvals runtime may decide with. */
export function createActionDispatcher(
  next: ActionEnv,
): ActionDispatcher & { approvals: ActionDispatcher["apply"] } {
  env = next;
  return {
    apply: (sid, action) => applyAction(sid, action),
    approvals: (sid, action) => applyAction(sid, action, APPROVALS_RUNTIME),
  };
}

// A deny always goes out, so the agent is never left waiting; an approval or an undo acts on the session's org only.
function orgBound(action: AssistantAction): boolean {
  if (action.kind === "approval") return action.decision.approved;
  return action.kind === "undo" || ORG_BOUND_KINDS.has(action.kind);
}

// Names, enums and ids only: no query, value, title or URL ever leaves.
function trackAction(sid: Sid, action: AssistantAction, result: ActionResult): void {
  const navigated = action.kind === "open_in_explorer" || action.kind === "navigate";
  if (navigated && (result.ok || result.reason === "guard_declined"))
    trackAssistant("ai_navigation", {
      mode: "link_card",
      taken: result.ok,
      blocked_unsaved: !result.ok,
    });
  if (!result.ok) return;
  switch (action.kind) {
    case "run_query":
      return evidence("run_inline", "query", action.query.language);
    case "open_in_explorer":
      return evidence("open_explorer", "query", action.query.language);
    case "copy":
      if (action.what === "query") evidence("copy_query", "query");
      return;
    case "add_to_dashboard_draft":
      return evidence("add_dashboard", "query", action.query.language);
    case "create_alert_draft":
      return evidence("create_alert", "query", action.query.language);
    case "rerun_now":
      return evidence("rerun_now", "footer");
    case "insert_into_editor": {
      const decision = (result.detail as { decision?: string } | undefined)?.decision;
      if (decision === "accepted") evidence("insert_diff", "query", action.language);
      else if (decision === "rejected") evidence("insert_rejected", "query", action.language);
      return;
    }
    case "open_step":
      return evidence("open_claim_step", "claim");
    case "feedback": {
      const turnId = (result.detail as { turnId?: string } | undefined)?.turnId;
      if (!turnId) return;
      trackAssistant(
        "ai_feedback",
        {
          value: action.vote,
          ...(isReason(action.reason) && { reason: action.reason }),
          outcome: "done",
        },
        { sid, turnId },
      );
      return;
    }
    default:
      return;
  }
}

function evidence(
  action: AiEventProps["ai_evidence_action"]["action"],
  blockKind: AiEventProps["ai_evidence_action"]["block_kind"],
  language?: QueryRef["language"],
): void {
  trackAssistant("ai_evidence_action", {
    action,
    block_kind: blockKind,
    ...(language && { language }),
  });
}

function isReason(
  reason: string | undefined,
): reason is "wrong_data" | "wrong_query" | "too_slow" | "wrong_action" | "other" {
  return (
    reason === "wrong_data" ||
    reason === "wrong_query" ||
    reason === "too_slow" ||
    reason === "wrong_action" ||
    reason === "other"
  );
}
