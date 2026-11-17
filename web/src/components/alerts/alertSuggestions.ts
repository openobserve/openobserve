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
import type { AlertSectionId } from "./alertFormSections";
import type { AlertKind, AlertQueryShape, AlertSettingId } from "./alertSettingTiers";

export type AlertSuggestionId =
  "ruleExpression" | "holdFor" | "recovery" | "oncall" | "keepFiring" | "priority";

/** What the last 24 h check found; null until a check has finished. */
export interface BacktestSignal {
  checks: number;
  alerts: number;
  singleCheckSpikes: number;
  refires: number;
  frequencyMinutes: number;
}

// Correctness first, then noise, then reach.
export const ALERT_SUGGESTION_ORDER: Record<AlertSectionId, readonly AlertSuggestionId[]> = {
  watch: [],
  condition: ["ruleExpression", "holdFor"],
  notify: ["recovery", "oncall", "keepFiring"],
  schedule: [],
  details: ["priority"],
};

export const RESOLVING_PLATFORMS = ["pagerduty", "opsgenie", "servicenow"] as const;

export interface SuggestionContext {
  shape: AlertQueryShape;
  kind: AlertKind;
  promql: string;
  ruleMode: boolean;
  backtest: BacktestSignal | null;
  /** Names of the chosen destinations whose platform can resolve an alert. */
  resolvingDestinations: string[];
  createsIncident: boolean;
  oncallSet: boolean;
  available(id: AlertSettingId): boolean;
  isSet(id: AlertSettingId): boolean;
}

export interface ActiveSuggestion {
  id: AlertSuggestionId;
  text: I18nText;
  actionLabel: I18nText;
  queued: number;
  anchor: "query" | "end";
}

// Fewer would-be alerts than this say nothing about spikes.
const MIN_ALERTS_FOR_HOLD = 3;

/** The comparison operators a PromQL query applies itself, ignoring label matchers and strings. */
export function promqlComparisons(q: string): string[] {
  const bare = q
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, "")
    .replace(/\{[^}]*\}/g, "");
  return [...new Set(bare.match(/==|!=|>=|<=|>|</g) ?? [])];
}

export function promqlCompares(q: string): boolean {
  return promqlComparisons(q).length > 0;
}

export function suggestionQualifies(id: AlertSuggestionId, ctx: SuggestionContext): boolean {
  if (!ctx.available(id) || ctx.isSet(id)) return false;
  switch (id) {
    case "ruleExpression":
      return ctx.shape === "promql" && !ctx.ruleMode && promqlCompares(ctx.promql);
    case "holdFor":
      return (
        !!ctx.backtest &&
        ctx.backtest.alerts >= MIN_ALERTS_FOR_HOLD &&
        ctx.backtest.singleCheckSpikes * 2 > ctx.backtest.alerts
      );
    case "keepFiring":
      return (ctx.backtest?.refires ?? 0) > 0;
    case "recovery":
      return ctx.resolvingDestinations.length > 0 || ctx.createsIncident;
    case "oncall":
      return ctx.createsIncident || ctx.isSet("priority");
    case "priority":
      return ctx.createsIncident || ctx.oncallSet;
  }
}

/** The one suggestion a section shows, and how many more qualify behind it. */
export function pickSuggestion(
  section: AlertSectionId,
  ctx: SuggestionContext,
  dismissed: ReadonlySet<AlertSuggestionId>,
): { id: AlertSuggestionId; queued: number } | null {
  const open = ALERT_SUGGESTION_ORDER[section].filter(
    (id) => !dismissed.has(id) && suggestionQualifies(id, ctx),
  );
  return open.length ? { id: open[0], queued: open.length - 1 } : null;
}
