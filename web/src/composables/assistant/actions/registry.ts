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

import type { FeedbackBody } from "@/services/assistant";
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
  now(): number;
  t: TranslateFn;
  /** Opens a new tab with no `opener`; false when the browser blocked it. */
  openTab(href: string): boolean;
  copy(text: string): Promise<boolean>;
  search(request: SearchRequest): Promise<Record<string, unknown>>;
  feedback(org: string, sid: Sid, body: FeedbackBody): Promise<void>;
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

// Writes the assistant proposed land only through the approvals runtime, which no package registers yet.
const APPROVAL_KINDS: ReadonlySet<AssistantAction["kind"]> = new Set(["approval", "undo"]);

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
export async function applyAction(sid: Sid, action: AssistantAction): Promise<ActionResult> {
  const applier = appliers.get(action.kind);
  // Insert needs an editor host, which no package registers yet.
  if (!applier)
    return { ok: false, reason: action.kind === "insert_into_editor" ? "needs_host" : "failed" };
  if (!env) return { ok: false, reason: "failed" };
  if (APPROVAL_KINDS.has(action.kind)) return { ok: false, reason: "gated" };
  if (TURN_KINDS.has(action.kind) && env.capability().gate !== "available")
    return { ok: false, reason: "gated" };
  const session = env.store().state.sessions[sid];
  if (ORG_BOUND_KINDS.has(action.kind) && session && env.currentOrg() !== session.org) {
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

/** Wires the appliers to the app and returns the store's `deps.actions`. */
export function createActionDispatcher(next: ActionEnv): ActionDispatcher {
  env = next;
  return { apply: applyAction };
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
