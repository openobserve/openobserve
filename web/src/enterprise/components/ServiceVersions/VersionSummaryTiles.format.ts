import type { TranslateFn } from "@/types/i18n";
import { formatDeployClock, formatDeployTime, isNoiseChange } from "@/utils/serviceVersionsCopy";
import type {
  CompareResponse,
  MetricDelta,
  RumSampledMetric,
  Section,
  Signal,
} from "@/services/service_versions";

export type TileMetric =
  | "requests"
  | "error_rate"
  | "p95"
  | "p99"
  | "error_view_rate"
  | "lcp_p75"
  | "inp_p75"
  | "cls_p75"
  | "js_errors"
  | "sessions";
export type TileTone = "crit" | "warn" | "good" | "neutral" | "waiting";
export interface Tile {
  key: TileMetric;
  before: string;
  after: string;
  delta: string;
  detail: string;
  tone: TileTone;
}

export const SIGNAL_METRICS: Record<Signal, TileMetric[]> = {
  traces: ["requests", "error_rate", "p95", "p99"],
  rum: ["lcp_p75", "inp_p75", "cls_p75", "js_errors", "sessions"],
};
// Only these tiles have a before/after series, so only they switch the chart.
export const CHART_METRICS: Record<Signal, TileMetric[]> = {
  traces: ["requests", "error_rate", "p95", "p99"],
  rum: ["lcp_p75", "inp_p75", "cls_p75"],
};
// Per-metric sample floors (PR-16): no red or green before each arm reaches them.
export const FLOORS: Partial<Record<TileMetric, number>> = {
  error_rate: 100,
  error_view_rate: 100,
  js_errors: 100,
  p95: 500,
  p99: 1000,
};
// z for the two-sided 90% range every tile states (the legend's "ranges are 90%").
const Z90 = 1.6448536269514722;
const RATE_METRICS = new Set(["error_rate", "error_view_rate"]);
const MICROS_METRICS = new Set(["p50", "p95", "p99"]);
const MILLIS_METRICS = new Set(["inp_p75", "loading_time_p75"]);
const RUM_VIEW_METRICS = new Set<TileMetric>(["error_view_rate", "lcp_p75", "inp_p75", "cls_p75"]);
const ZERO_UNMEASURED = new Set<TileMetric>(["p95", "p99", "lcp_p75", "inp_p75"]);
const TEN_MINUTES = 600e6;

function number(value: number, digits: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
function signed(text: string, value: number) {
  return value > 0 ? `+${text}` : value < 0 ? `−${text.replace(/^-/, "")}` : text;
}
export function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10000 ? 1 : value < 10 ? 1 : 0,
  }).format(value);
}
export function formatMillis(ms: number, t: TranslateFn) {
  const abs = Math.abs(ms);
  if (abs >= 1000) return t("serviceVersions.compare.unit.s", { value: number(ms / 1000, 1) });
  return t("serviceVersions.compare.unit.ms", { value: number(ms, abs >= 10 || !abs ? 0 : 1) });
}
export function formatMetric(metric: string, value: number | null | undefined, t: TranslateFn) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (RATE_METRICS.has(metric))
    return t("serviceVersions.compare.unit.percent", { value: number(value * 100, 2) });
  if (MICROS_METRICS.has(metric)) return formatMillis(value / 1000, t);
  // LCP p75 travels in seconds, unlike INP.
  if (metric === "lcp_p75") return t("serviceVersions.compare.unit.s", { value: number(value, 2) });
  if (MILLIS_METRICS.has(metric)) return formatMillis(value, t);
  if (metric === "cls_p75") return number(value, 3);
  return formatCount(value);
}
// Mirrors formatMetric's rounding, so a delta computed from it matches the two numbers on screen.
function roundTo(value: number, step: number) {
  return Math.round(value / step) * step;
}
function roundMillis(ms: number) {
  const abs = Math.abs(ms);
  return abs >= 1000 ? roundTo(ms, 100) : abs >= 10 ? Math.round(ms) : roundTo(ms, 0.1);
}
/** The value as formatMetric prints it, so a stated change agrees with the before and after shown. */
export function displayed(metric: string, value: number) {
  if (RATE_METRICS.has(metric)) return roundTo(value, 0.0001);
  if (MICROS_METRICS.has(metric)) return roundMillis(value / 1000) * 1000;
  if (metric === "lcp_p75") return roundTo(value, 0.01);
  if (MILLIS_METRICS.has(metric)) return roundMillis(value);
  if (metric === "cls_p75") return roundTo(value, 0.001);
  return value;
}
/** One rounding for every change, percent or points: tenths below 100, whole numbers from 100. */
export function changeSize(size: number) {
  return number(size, Math.round(size * 10) / 10 >= 100 ? 0 : 1);
}
export function percentChange(value: number, base: number) {
  return signed(`${changeSize(Math.abs((value / base) * 100))}%`, value);
}
/** An error-rate change in percentage points, on every tile, table and strip. */
export function formatPoints(delta: number, t: TranslateFn) {
  return t("serviceVersions.compare.pointsShort", {
    value: signed(changeSize(Math.abs(delta * 100)), delta),
  });
}
export function change(metric: TileMetric, delta: number, base: number | null, t: TranslateFn) {
  if (RATE_METRICS.has(metric)) return formatPoints(delta, t);
  if (metric === "cls_p75") return signed(number(Math.abs(delta), 3), delta);
  if (!base) return "—";
  return percentChange(delta, base);
}
function bound(metric: TileMetric, value: number, base: number | null, t: TranslateFn) {
  return RATE_METRICS.has(metric)
    ? signed(changeSize(Math.abs(value * 100)), value)
    : change(metric, value, base, t);
}
// The backend's quantile floor is lower than the UI's, so its insufficient flag alone is not enough.
export function meetsFloor(key: TileMetric, have: number | null | undefined) {
  const need = FLOORS[key];
  return !need || (have != null && have >= need);
}
function samples(result: CompareResponse, key: TileMetric) {
  const counts =
    key === "error_view_rate"
      ? result.rum?.views
      : key === "js_errors"
        ? result.rum?.session_windows
        : result.traces?.requests;
  return counts ? Math.min(counts.a, counts.b) : undefined;
}
function toneOf(key: TileMetric, value: MetricDelta, watch: boolean, floor: boolean): TileTone {
  if (value.insufficient || !floor) return "waiting";
  if (isNoiseChange(key, value) || !value.delta) return "neutral";
  if (value.delta < 0) return "good";
  return watch ? "warn" : "crit";
}
function metricDelta(result: CompareResponse, key: TileMetric): MetricDelta | undefined {
  if (key === "requests") return undefined;
  if (key === "lcp_p75" || key === "inp_p75" || key === "cls_p75") return result.rum?.[key];
  if (key === "error_view_rate") return result.rum?.error_view_rate;
  if (key === "js_errors") return jsErrorsDelta(result);
  if (key === "sessions") return undefined;
  return result.traces?.[key];
}
// The producer sends JS error and session counts but no rate, so the Poisson range is formed here.
function jsErrorsDelta(result: CompareResponse): MetricDelta | undefined {
  const errors = result.rum?.errors;
  const sessions = result.rum?.session_windows;
  if (!errors || !sessions) return undefined;
  const insufficient = Boolean(result.rum?.insufficient) || !sessions.a || !sessions.b;
  if (insufficient)
    return { a: null, b: null, delta: null, lo: null, hi: null, ci_kind: "poisson", insufficient };
  const a = (errors.a / sessions.a) * 1000;
  const b = (errors.b / sessions.b) * 1000;
  const spread = Z90 * Math.sqrt((errors.a / sessions.a ** 2 + errors.b / sessions.b ** 2) * 1e6);
  const delta = a - b;
  return {
    a,
    b,
    delta,
    lo: delta - spread,
    hi: delta + spread,
    ci_kind: "poisson",
    insufficient: false,
    straddles_zero: delta - spread <= 0 && delta + spread >= 0,
  };
}
function waitingDetail(result: CompareResponse, key: TileMetric, t: TranslateFn) {
  const need = FLOORS[key];
  const have = key === "error_view_rate" || key === "js_errors" ? undefined : samples(result, key);
  if (!need || have == null) return t("serviceVersions.compare.tooEarly");
  return t("serviceVersions.compare.tile.progress", {
    have: formatCount(have),
    need: formatCount(need),
  });
}
/** True when the compare has a baseline arm; a first version has none. */
export function hasBaseline(result: CompareResponse) {
  return Boolean(result.arms.b.version);
}
/** True when a compare section timed out or failed, so none of its counts, zeros included, were measured. */
export function sectionFailed(section: Section | undefined) {
  return section?.status === "error" || section?.status === "timeout";
}
// A vital's own sample count is exact; a view or request count only says the arm had traffic.
function armCount(result: CompareResponse, key: TileMetric, arm: "a" | "b") {
  const own = result.rum?.samples?.[key as RumSampledMetric]?.[arm];
  if (own != null) return { count: own, exact: true };
  const counts =
    key === "js_errors"
      ? result.rum?.session_windows
      : RUM_VIEW_METRICS.has(key)
        ? result.rum?.views
        : result.traces?.requests;
  return { count: counts?.[arm], exact: false };
}
// The producer zeroes a quantile it could not compute, so only an exact sample count proves a real 0.
function measured(
  result: CompareResponse,
  key: TileMetric,
  arm: "a" | "b",
  value: number | null | undefined,
) {
  if (value == null) return null;
  const { count, exact } = armCount(result, key, arm);
  if (count != null && count <= 0) return null;
  if (!value && !exact && (count == null || ZERO_UNMEASURED.has(key))) return null;
  return value;
}
// A version with no baseline shows its own value alone: no arrow, change, range or floor.
function singleTile(key: TileMetric, value: number | null | undefined, t: TranslateFn): Tile {
  return {
    key,
    before: "",
    after: formatMetric(key, value, t),
    delta: "",
    detail: "",
    tone: "neutral",
  };
}
function requestsTile(result: CompareResponse, t: TranslateFn): Tile | undefined {
  const requests = result.traces?.requests;
  if (!requests) return undefined;
  if (!hasBaseline(result)) return singleTile("requests", requests.rate_a * 60, t);
  return countTile("requests", requests.rate_b * 60, requests.rate_a * 60);
}
function sessionsTile(result: CompareResponse, t: TranslateFn): Tile | undefined {
  const sessions = result.rum?.session_windows;
  if (!sessions) return undefined;
  if (!hasBaseline(result)) return singleTile("sessions", sessions.a, t);
  return countTile("sessions", sessions.b, sessions.a);
}
// A count is context for the rates beside it, never a verdict signal, so its change is never judged.
function countTile(key: TileMetric, before: number, after: number): Tile {
  return {
    key,
    before: formatCount(before),
    after: formatCount(after),
    delta: before ? percentChange(after - before, before) : "—",
    detail: "",
    tone: "neutral",
  };
}
export function buildTiles(
  result: CompareResponse,
  signal: Signal,
  t: TranslateFn,
  watch = false,
): Tile[] {
  return SIGNAL_METRICS[signal].flatMap((key) => {
    if (key === "requests") return requestsTile(result, t) ?? [];
    if (key === "sessions") return sessionsTile(result, t) ?? [];
    const value = metricDelta(result, key);
    if (!value) return [];
    if (!hasBaseline(result)) return singleTile(key, measured(result, key, "a", value.a), t);
    const tone = toneOf(key, value, watch, meetsFloor(key, samples(result, key)));
    const base = value.b;
    const range =
      value.lo != null && value.hi != null
        ? t("serviceVersions.compare.tile.range", {
            lo: bound(key, value.lo, base, t),
            hi: bound(key, value.hi, base, t),
          })
        : t("serviceVersions.compare.tile.noise");
    return [
      {
        key,
        before: formatMetric(key, measured(result, key, "b", value.b), t),
        after: formatMetric(key, measured(result, key, "a", value.a), t),
        delta:
          tone === "waiting"
            ? t("serviceVersions.compare.tile.waiting")
            : value.delta == null
              ? "—"
              : change(key, value.delta, base, t),
        detail:
          tone === "waiting"
            ? waitingDetail(result, key, t)
            : tone === "neutral"
              ? t("serviceVersions.compare.tile.noise")
              : range,
        tone,
      },
    ];
  });
}
export function formatTime(value: number, seconds = false) {
  return formatDeployClock(value, seconds);
}
/** A day-and-time stamp for moments that may be days old. */
export function formatStamp(value: number) {
  return formatDeployTime(value);
}
/** Windows shorter than ten minutes print seconds, so minute rounding never makes equal windows look unequal. */
export function shortWindow(
  ...windows: ({ start_time: number; end_time: number } | null | undefined)[]
) {
  return windows.some((window) => window && window.end_time - window.start_time < TEN_MINUTES);
}
export function formatWindow(
  start: number,
  end: number,
  t: TranslateFn,
  seconds = end - start < TEN_MINUTES,
) {
  return t("serviceVersions.compare.window", {
    start: formatTime(start, seconds),
    end: formatTime(end, seconds),
  });
}
function unit(value: number, name: string, unitDisplay: "long" | "narrow") {
  return new Intl.NumberFormat(undefined, { style: "unit", unit: name, unitDisplay }).format(value);
}
export function formatDuration(us: number) {
  const seconds = Math.max(0, Math.round(us / 1e6));
  if (seconds >= 86400) return unit(Math.floor(seconds / 86400), "day", "long");
  if (seconds >= 3600) return unit(Math.floor(seconds / 3600), "hour", "long");
  if (seconds >= 60) return unit(Math.floor(seconds / 60), "minute", "long");
  return unit(seconds, "second", "long");
}
export function formatSpan(us: number) {
  const seconds = Math.max(0, Math.round(us / 1e6));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  // Under ten minutes the seconds stay, so the span agrees with the second-precise window beside it.
  const parts = [
    hours && unit(hours, "hour", "narrow"),
    minutes && unit(minutes, "minute", "narrow"),
    (seconds < 60 || (seconds < 600 && rest)) && unit(rest, "second", "narrow"),
  ];
  return parts.filter(Boolean).join(" ");
}
