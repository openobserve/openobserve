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

import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { gt } from "@/types/i18n";
import {
  periodMinutesFromRange,
  sanitizeAlertNamePart,
  warn,
  type PrefillTimeRange,
} from "../alertPrefill";
import {
  funnelAlertSql,
  type AnalyticsScope,
  type FunnelDef,
  type IdentitySql,
} from "@/utils/rum/productAnalyticsQueries";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";

export const RUM_STREAM = "_rumdata";

export interface RumFunnelPrefillInput {
  scope: AnalyticsScope;
  id: IdentitySql | null;
  def: FunnelDef;
  events: NamedEvent[];
  /** Fire when the first-to-last-step conversion, in percent, falls below this. */
  belowPct: number;
  timeRange?: PrefillTimeRange | null;
}

/** Product Analytics funnel → AlertPrefill that fires when the funnel's conversion drops. */
export const buildPrefillFromRumFunnel = (input: RumFunnelPrefillInput): AlertPrefill => {
  // The alert keeps the compiled SQL, so later edits to the funnel or its named events never reach it.
  const warnings = [warn("rumFunnelSnapshot", "info")];
  const ready = input.def.steps.length > 1;
  if (!ready) warnings.push(warn("rumFunnelSteps", "blocking"));
  const period = periodMinutesFromRange(input.timeRange);
  const app = input.scope.app;
  return {
    version: ALERT_PREFILL_VERSION,
    source: "rumfunnel",
    sourceLabel: app
      ? gt("rum.analytics.funnel.alertSource", { app })
      : gt("rum.analytics.funnel.alertSourceNoApp"),
    name: sanitizeAlertNamePart(`rum_funnel_${app}_conversion`, "rum_funnel_conversion"),
    streamType: "logs",
    streamName: RUM_STREAM,
    queryType: "sql",
    sql: ready
      ? funnelAlertSql(input.scope, input.id, input.def, input.belowPct, {
          events: input.events,
          sample: 1,
        })
      : "",
    periodMinutes: period.minutes,
    frequencyMinutes: Math.min(60, period.minutes),
    thresholdShape: "count",
    warnings: [...warnings, ...period.warnings],
    meta: {
      app,
      steps: input.def.steps.length,
      unit: input.def.unit,
      window: input.def.window,
      belowPct: input.belowPct,
    },
  };
};
