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

export const FORECAST_METHODS = ["linear", "smoothed"] as const;
export type ForecastMethod = (typeof FORECAST_METHODS)[number];

export const FORECAST_HORIZON_SECONDS = {
  "1h": 3600,
  "6h": 21_600,
  "1d": 86_400,
  "1w": 604_800,
} as const;
export type ForecastHorizon = keyof typeof FORECAST_HORIZON_SECONDS;

/** Smoothing and trend factors, fixed: users cannot tune them. */
const HOLT_WINTERS_SF = 0.3;
const HOLT_WINTERS_TF = 0.1;
/** Holt-Winters smooths over this many trailing steps, so the fit still follows recent changes in level. */
const SMOOTHING_STEPS = 10;
const DEFAULT_HORIZON_FRACTION = 0.25;

export const isForecastMethod = (value: unknown): value is ForecastMethod =>
  FORECAST_METHODS.includes(value as ForecastMethod);

export const isForecastHorizon = (value: unknown): value is ForecastHorizon =>
  typeof value === "string" && Object.hasOwn(FORECAST_HORIZON_SECONDS, value);

/** The presets the visible range can train: the model is fitted on that range only. */
export const forecastHorizonOptions = (rangeSeconds: number): ForecastHorizon[] =>
  (Object.keys(FORECAST_HORIZON_SECONDS) as ForecastHorizon[]).filter(
    (preset) => FORECAST_HORIZON_SECONDS[preset] <= rangeSeconds,
  );

export const forecastHorizonSeconds = (
  preset: ForecastHorizon | null | undefined,
  rangeSeconds: number,
): number =>
  preset && forecastHorizonOptions(rangeSeconds).includes(preset)
    ? FORECAST_HORIZON_SECONDS[preset]
    : Math.round(rangeSeconds * DEFAULT_HORIZON_FRACTION);

/** The fit at T and at T + H, both as instant queries at the range end T. */
export const buildForecastQueries = (
  expr: string,
  method: ForecastMethod,
  rangeSeconds: number,
  stepSeconds: number,
  horizonSeconds: number,
): [string, string] => {
  const input =
    method === "smoothed"
      ? `holt_winters((${expr})[${SMOOTHING_STEPS * stepSeconds}s:${stepSeconds}s], ${HOLT_WINTERS_SF}, ${HOLT_WINTERS_TF})`
      : `(${expr})`;
  const fit = (ahead: number) =>
    `predict_linear(${input}[${rangeSeconds}s:${stepSeconds}s], ${ahead})`;
  return [fit(0), fit(horizonSeconds)];
};

const labelSetKey = (metric: Record<string, string> = {}) =>
  JSON.stringify(Object.entries(metric).sort(([a], [b]) => a.localeCompare(b)));

const fitValue = (series: any): number => Number((series?.value ?? series?.values?.at(-1))?.[1]);

/** The fitted line from T to T + H, sampled on the step grid; seconds throughout. */
export const forecastSeries = (
  fitAtT: any,
  fitAtTH: any,
  T: number,
  H: number,
  step: number,
): { resultType: "matrix"; result: any[] } => {
  const ahead = new Map<string, number>(
    (fitAtTH?.result ?? []).map((series: any) => [labelSetKey(series.metric), fitValue(series)]),
  );
  const times = Array.from({ length: Math.floor(H / step) + 1 }, (_, k) => T + k * step);
  if (times.at(-1) !== T + H) times.push(T + H);

  const result = (fitAtT?.result ?? []).flatMap((series: any) => {
    const start = fitValue(series);
    const end = ahead.get(labelSetKey(series.metric));
    if (!Number.isFinite(start) || end === undefined || !Number.isFinite(end)) return [];
    const values = times.map((t) => [t, String(start + ((end - start) * (t - T)) / H)]);
    return [{ metric: series.metric, values }];
  });
  return { resultType: "matrix", result };
};
