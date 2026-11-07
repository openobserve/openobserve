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

import type { ContextProvider, PageContext } from "./types";

export const ALERT_DETAIL_CONTEXT_KEY = "alertDetail";

/** What the alert status page knows when the assistant reads it. */
export interface AlertDetailSource {
  alertId: string;
  /** The alert as the single-alert GET returns it; `null` while it loads. */
  alert: any;
  /** "firing", "ok", "disabled", or "" while unknown. */
  state: string;
}

/** The context of the alert status page: which alert, what it watches, its condition and state. */
export function createAlertDetailContextProvider(
  read: () => AlertDetailSource,
  store: any,
): ContextProvider {
  return {
    getContext(): PageContext {
      const { alertId, alert, state } = read();
      const context: PageContext = {
        currentPage: "Alerts",
        alertId,
        organization_identifier: store?.state?.selectedOrganization?.identifier || "",
        user_intent: "investigate alert",
        request_timestamp: Date.now() * 1000,
      };
      if (!alert) return context;
      if (alert.name) context.alertName = String(alert.name);
      if (alert.stream_name) {
        context.selectedStreams = [String(alert.stream_name)];
        context.streamType = String(alert.stream_type || "logs");
      }
      const condition = conditionText(alert);
      if (condition) context.alertCondition = condition;
      if (state) context.alertState = state;
      context.isRealTime = alert.is_real_time === true;
      return context;
    },
  };
}

// The single-alert GET calls it `query_condition`, the list endpoint `condition`.
function conditionText(alert: any): string {
  const query = alert.query_condition ?? alert.condition ?? {};
  const trigger = alert.trigger_condition ?? {};
  const source =
    query.type === "promql" ? query.promql : query.type === "sql" ? query.sql : customText(query);
  const threshold =
    trigger.operator && trigger.threshold !== undefined
      ? `${trigger.operator} ${trigger.threshold}`
      : "";
  return [source, threshold, periodText(trigger.period)].filter(Boolean).join(" · ");
}

function customText(query: any): string {
  const conditions = query.conditions;
  if (!conditions || (Array.isArray(conditions) && conditions.length === 0)) return "";
  return JSON.stringify(conditions);
}

function periodText(period: unknown): string {
  return typeof period === "number" && period > 0 ? `${period} min window` : "";
}
