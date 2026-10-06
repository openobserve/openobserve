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

// A forecast alert is plain PromQL returning each series' days until U reaches T, alerted on `value <= H`.

export type ForecastDirection = "rises" | "falls";

/** History the trend is fitted on: short presets, because each evaluation reads all of it. */
export const FORECAST_WINDOWS = ["6h", "1d", "2d", "7d"] as const;
export type ForecastWindow = (typeof FORECAST_WINDOWS)[number];

export const FORECAST_MIN_DAYS = 1;
export const FORECAST_MAX_DAYS = 30;
/** The query reads W of history whatever the period, so a longer period only adds cost. */
export const FORECAST_PERIOD_MINUTES = 5;
/** Each evaluation reads W of raw samples per series, so it runs at most this often by default. */
export const FORECAST_FREQUENCY_MINUTES = 30;

/** Far above any allowed horizon, so a series with no crossing stays in the result. */
const NEVER_DAYS = 36500;
/** About this many subquery steps over the history window. */
const WINDOW_STEPS = 192;

const WINDOW_SECONDS: Record<ForecastWindow, number> = {
  "6h": 6 * 3600,
  "1d": 86400,
  "2d": 2 * 86400,
  "7d": 7 * 86400,
};

export interface ForecastAlertQuery {
  /** The PromQL expression to forecast. */
  U: string;
  /** The threshold it is forecast to reach. */
  T: number;
  direction: ForecastDirection;
  W: ForecastWindow;
}

export interface ForecastAlert extends ForecastAlertQuery {
  /** The horizon, in whole days. */
  H: number;
}

export const isForecastHorizonValid = (H: number): boolean =>
  Number.isInteger(H) && H >= FORECAST_MIN_DAYS && H <= FORECAST_MAX_DAYS;

export const buildForecastAlertPromql = ({ U, T, direction, W }: ForecastAlertQuery): string => {
  const stepMinutes = Math.round(WINDOW_SECONDS[W] / WINDOW_STEPS / 60);
  const crossed = direction === "rises" ? ">=" : "<=";
  const towards = direction === "rises" ? ">" : "<";
  // Days rounded UP to one decimal, so `<= H` never fires early; 1e-6 absorbs float noise in the fit.
  return (
    `((${U}) ${crossed} ${T}) * 0` +
    ` or clamp_min(ceil((${T} - (${U})) / (deriv((${U})[${W}:${stepMinutes}m]) ${towards} 0) / 8640 - 1e-6) / 10, 0)` +
    ` or ((${U}) * 0 + ${NEVER_DAYS})`
  );
};

/** The fields `buildForecastAlertPromql` made `text` from, or null for anything it did not make. */
export const parseForecastAlertPromql = (
  text: string | null | undefined,
  condition: { operator?: string; value?: unknown } | null | undefined,
): ForecastAlert | null => {
  const H = Number(condition?.value);
  if (condition?.operator !== "<=" || !isForecastHorizonValid(H)) return null;

  const trimmed = (text ?? "").trim();
  const tail = `) * 0 + ${NEVER_DAYS})`;
  if (!trimmed.startsWith("((") || !trimmed.endsWith(tail)) return null;

  // U is whatever makes the text start with "((U) " and end with " or ((U)" + tail.
  for (let end = 3; end < trimmed.length; end++) {
    const U = trimmed.slice(2, end);
    if (!trimmed.endsWith(` or ((${U}${tail}`) || trimmed[end] !== ")") continue;
    const match = /^\) ([<>]=) (\S+)\) \* 0 or /.exec(trimmed.slice(end));
    if (!match) continue;
    const T = Number(match[2]);
    const direction: ForecastDirection = match[1] === ">=" ? "rises" : "falls";
    const W = FORECAST_WINDOWS.find(
      (window) => buildForecastAlertPromql({ U, T, direction, W: window }) === trimmed,
    );
    if (W) return { U, T, direction, W, H };
  }
  return null;
};

/** Alert form values for Forecast mode; per-series alerting requires the `>= 1` count gate. */
export const forecastModeFields = (forecast: ForecastAlert): Record<string, unknown> => ({
  "query_condition.promql":
    forecast.U.trim() && Number.isFinite(forecast.T) ? buildForecastAlertPromql(forecast) : "",
  "query_condition.promql_condition": { column: "value", operator: "<=", value: forecast.H },
  "query_condition.promql_multi_alert": true,
  "trigger_condition.threshold": 1,
  "trigger_condition.operator": ">=",
});

/** The notification row; T is written in because no template variable carries it. */
export const forecastRowTemplate = (T: number): string => `reaches ${T} in {value} days`;
