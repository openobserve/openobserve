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

import { shallowRef } from "vue";

import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { streamTypeOf } from "@/utils/assistant/explorerRoutes";

import { registerApplier, type Applier, type DashboardDraft } from "../registry";
import type { AssistantAction, QueryRef } from "../types";

// Telemetry and the form's summary read these; nothing in the prefill is saved by the assistant.
const ASSISTANT_ORIGIN = "assistant";

const MINUTE_MS = 60_000;

const DRAFTABLE_LANGUAGES: ReadonlySet<QueryRef["language"]> = new Set(["sql", "promql"]);

/** The one dashboard draft open now; the shell's draft host renders the native picker for it. */
export const assistantDashboardDraft = /* @__PURE__ */ shallowRef<DashboardDraft | null>(null);

/** Add to dashboard: the native picker opens with the query; the user's own Save is the only write. */
export const dashboardDraftApplier: Applier<
  Extract<AssistantAction, { kind: "add_to_dashboard_draft" }>
> = (sid, action, env) => {
  const session = env.store().state.sessions[sid];
  if (!session || !draftable(action.query)) return { ok: false, reason: "failed" };
  env.requestDashboard({
    query: { ...action.query, org: session.org },
    originTurnId: action.turnId ?? session.turnMeta.turnId,
  });
  return { ok: true };
};

/** Create alert draft: the alert confirm dialog, prefilled and stamped with its origin; it saves nothing. */
export const alertDraftApplier: Applier<
  Extract<AssistantAction, { kind: "create_alert_draft" }>
> = (sid, action, env) => {
  const session = env.store().state.sessions[sid];
  if (!session || !draftable(action.query)) return { ok: false, reason: "failed" };
  env.requestAlert(
    alertPrefillOf(
      action.query,
      String(env.t("assistant.name")),
      action.turnId ?? session.turnMeta.turnId,
    ),
  );
  return { ok: true };
};

/** Opens the dashboard picker; a second request replaces the first, as the alert dialog does. */
export function requestDashboardDraft(draft: DashboardDraft): void {
  assistantDashboardDraft.value = draft;
}

export function clearDashboardDraft(): void {
  assistantDashboardDraft.value = null;
}

export function registerDraftAppliers(): void {
  registerApplier("add_to_dashboard_draft", dashboardDraftApplier);
  registerApplier("create_alert_draft", alertDraftApplier);
}

// The alert prefill of a query block; the period is the block's window in minutes.
function alertPrefillOf(
  query: QueryRef,
  sourceLabel: string,
  originTurnId: string | null,
): AlertPrefill {
  const promql = query.language === "promql";
  const minutes =
    query.from && query.to
      ? Math.max(1, Math.round((query.to - query.from) / MINUTE_MS))
      : undefined;
  return {
    version: ALERT_PREFILL_VERSION,
    source: ASSISTANT_ORIGIN,
    sourceLabel,
    streamType: streamTypeOf(query.streamType) ?? (promql ? "metrics" : "logs"),
    streamName: query.stream ?? "",
    queryType: promql ? "promql" : "sql",
    ...(promql ? { promql: query.text } : { sql: query.text }),
    ...(minutes !== undefined && { periodMinutes: minutes }),
    warnings: [],
    meta: { origin: ASSISTANT_ORIGIN, origin_turn_id: originTurnId },
  };
}

function draftable(query: QueryRef): boolean {
  return DRAFTABLE_LANGUAGES.has(query.language) && !!query.text.trim();
}
