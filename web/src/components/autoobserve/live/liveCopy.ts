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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  accessDeniedMessage,
  accessReason,
  permissionLabel,
  viewDenial,
} from "@/composables/useAccessStore";
import type { AutoObserveCellState } from "@/services/autoobserve";
import type { ChartRange } from "../coverageSeries";
import { LIVE_CHECKS, type CoverageCell, type LiveCheck } from "../fixtures";

export type LiveFailure = "denied" | "off" | "unavailable" | "failed";

export type LiveSurface = "coverage" | "suggestions" | "incidents";

export type LiveEmptySurface = "changes" | "history" | "settings";

export type LivePhase = "idle" | "loading" | "loaded";

export interface LiveNoticeView {
  title: I18nText;
  description: I18nText;
  severity: "error" | "neutral";
  retry: boolean;
  details: boolean;
  icon: IconName;
}

export interface LiveNotice extends LiveNoticeView {
  failure: LiveFailure;
}

export interface LiveSurfaceEmpty {
  notice: LiveNoticeView;
  action: I18nText;
}

export interface LiveScenarioNote {
  tag: I18nText;
  text: I18nText;
  action: I18nText;
}

export interface LiveStale {
  failedAt: number;
  dataAt: number;
}

export type CheckedView = { kind: "loading" } | { kind: "text"; text: I18nText } | { kind: "none" };

export const RAIL_CAP = 5;

export const DRAWER_PAGE = 25;

const NOTICE_KEY: Record<LiveSurface, Record<LiveFailure, { title: I18nKey; desc: I18nKey }>> = {
  coverage: {
    denied: {
      title: "autoobserveLive.notice.coverage.deniedTitle",
      desc: "autoobserveLive.notice.coverage.deniedDesc",
    },
    off: {
      title: "autoobserveLive.notice.offTitle",
      desc: "autoobserveLive.notice.coverage.offDesc",
    },
    unavailable: {
      title: "autoobserveLive.notice.coverage.unavailableTitle",
      desc: "autoobserveLive.notice.coverage.unavailableDesc",
    },
    failed: {
      title: "autoobserveLive.notice.coverage.failedTitle",
      desc: "autoobserveLive.notice.coverage.failedDesc",
    },
  },
  suggestions: {
    denied: {
      title: "autoobserveLive.notice.suggestions.deniedTitle",
      desc: "autoobserveLive.notice.suggestions.deniedDesc",
    },
    off: {
      title: "autoobserveLive.notice.offTitle",
      desc: "autoobserveLive.notice.suggestions.offDesc",
    },
    unavailable: {
      title: "autoobserveLive.notice.suggestions.unavailableTitle",
      desc: "autoobserveLive.notice.suggestions.unavailableDesc",
    },
    failed: {
      title: "autoobserveLive.notice.suggestions.failedTitle",
      desc: "autoobserveLive.notice.suggestions.failedDesc",
    },
  },
  incidents: {
    denied: {
      title: "autoobserveLive.notice.incidents.deniedTitle",
      desc: "autoobserveLive.notice.incidents.deniedDesc",
    },
    off: {
      title: "autoobserveLive.notice.offTitle",
      desc: "autoobserveLive.notice.incidents.offDesc",
    },
    unavailable: {
      title: "autoobserveLive.notice.incidents.unavailableTitle",
      desc: "autoobserveLive.notice.incidents.unavailableDesc",
    },
    failed: {
      title: "autoobserveLive.notice.incidents.failedTitle",
      desc: "autoobserveLive.notice.incidents.failedDesc",
    },
  },
};

const LOAD_KEY: Record<LiveSurface, Record<Exclude<LivePhase, "idle">, I18nKey>> = {
  coverage: {
    loading: "autoobserveLive.coverage.loading",
    loaded: "autoobserveLive.coverage.loaded",
  },
  suggestions: {
    loading: "autoobserveLive.suggestions.loading",
    loaded: "autoobserveLive.suggestions.loaded",
  },
  incidents: {
    loading: "autoobserveLive.incidents.loading",
    loaded: "autoobserveLive.incidents.loaded",
  },
};

const WHAT_KEY: Record<LiveSurface, I18nKey> = {
  coverage: "autoobserveLive.notice.what.coverage",
  suggestions: "autoobserveLive.notice.what.suggestions",
  incidents: "autoobserveLive.notice.what.incidents",
};

// A denial or a turned-off engine cannot change on a retry, so neither offers one.
const NOTICE_LOOK: Record<LiveFailure, Omit<LiveNotice, "failure" | "title" | "description">> = {
  denied: { severity: "error", retry: false, details: false, icon: "lock" },
  off: { severity: "neutral", retry: false, details: false, icon: "toggle-off" },
  unavailable: { severity: "error", retry: true, details: false, icon: "cloud-off" },
  failed: { severity: "error", retry: true, details: true, icon: "error-outline" },
};

const EMPTY_KEY: Record<LiveEmptySurface, { title: I18nKey; desc: I18nKey; action: I18nKey }> = {
  changes: {
    title: "autoobserveLive.surfaces.changes.title",
    desc: "autoobserveLive.surfaces.changes.desc",
    action: "autoobserveLive.surfaces.changes.action",
  },
  history: {
    title: "autoobserveLive.surfaces.history.title",
    desc: "autoobserveLive.surfaces.history.desc",
    action: "autoobserveLive.surfaces.history.action",
  },
  settings: {
    title: "autoobserveLive.surfaces.settings.title",
    desc: "autoobserveLive.surfaces.settings.desc",
    action: "autoobserveLive.surfaces.settings.action",
  },
};

const EMPTY_ICON: Record<LiveEmptySurface, IconName> = {
  changes: "history",
  history: "schedule",
  settings: "tune",
};

export const statusOf = (error: unknown) =>
  (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;

export const liveFailureOf = (error: unknown): LiveFailure => {
  const status = statusOf(error);
  if (status === 403) return "denied";
  if (status === 404) return "off";
  if (status === 503) return "unavailable";
  return "failed";
};

export const liveNotice = (
  t: TranslateFn,
  surface: LiveSurface,
  failure: LiveFailure,
): LiveNotice => {
  const keys = NOTICE_KEY[surface][failure];
  return { failure, title: t(keys.title), description: t(keys.desc), ...NOTICE_LOOK[failure] };
};

// A surface with no backend yet says what will appear and what to do now, never sample data.
export const liveSurfaceEmpty = (t: TranslateFn, surface: LiveEmptySurface): LiveSurfaceEmpty => {
  const keys = EMPTY_KEY[surface];
  return {
    notice: {
      title: t(keys.title),
      description: t(keys.desc),
      severity: "neutral",
      retry: false,
      details: false,
      icon: EMPTY_ICON[surface],
    },
    action: t(keys.action),
  };
};

// The demo scenario picker has no live meaning, so live mode says what is shown instead of hiding the spot.
export const liveScenarioNote = (t: TranslateFn): LiveScenarioNote => ({
  tag: t("autoobserveLive.surfaces.scenario.tag"),
  text: t("autoobserveLive.surfaces.scenario.text"),
  action: t("autoobserveLive.surfaces.scenario.action"),
});

export const liveLoadText = (t: TranslateFn, surface: LiveSurface, phase: LivePhase): I18nText =>
  phase === "idle" ? raw("") : t(LOAD_KEY[surface][phase]);

export const liveErrorDetail = (error: unknown): I18nText => {
  const e = error as { response?: { data?: { message?: unknown } }; message?: unknown } | null;
  const message = e?.response?.data?.message ?? e?.message;
  return raw(typeof message === "string" ? message : "");
};

// The app's timezone setting wins; a value Intl rejects falls back to the browser's zone.
export const userTimeZone = (setting: unknown): string => {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (typeof setting !== "string" || !setting) return browser;
  try {
    return Intl.DateTimeFormat("en-US", { timeZone: setting }).resolvedOptions().timeZone;
  } catch {
    return browser;
  }
};

const count = (locale: string, n: number): I18nText => raw(new Intl.NumberFormat(locale).format(n));

export const formatDay = (us: number, locale: string, timeZone: string): I18nText =>
  raw(
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(us / 1000)),
  );

export const dayKey = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone }).format(new Date(ms));

// A time from another day carries its date, so yesterday's data never reads as today's.
export const formatWhen = (
  ms: number,
  locale: string,
  timeZone: string,
  now = Date.now(),
): I18nText =>
  raw(
    new Intl.DateTimeFormat(
      locale,
      dayKey(ms, timeZone) === dayKey(now, timeZone)
        ? { timeStyle: "short", timeZone }
        : { dateStyle: "medium", timeStyle: "short", timeZone },
    ).format(new Date(ms)),
  );

const DURATION_UNITS = [
  ["day", 1440],
  ["hour", 60],
  ["minute", 1],
] as const;

export const durationText = (locale: string, minutes: number): I18nText => {
  const [unit, size] = DURATION_UNITS.find(([, s]) => minutes >= s) ?? DURATION_UNITS[2];
  return raw(
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(
      Math.floor(minutes / size),
    ),
  );
};

export const agoText = (t: TranslateFn, locale: string, minutes: number): I18nText =>
  minutes < 1
    ? t("autoobserveLive.time.justNow")
    : t("autoobserveLive.time.ago", { time: durationText(locale, minutes) });

export const todayText = (locale: string, timeZone: string, nowMs: number): I18nText =>
  raw(
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone,
    }).format(new Date(nowMs)),
  );

// A failed or denied coverage read has no pass to report, and its own notice says why.
export const checkedView = (
  t: TranslateFn,
  locale: string,
  source: { status: "loading" | "error" | "ready"; passMinutes: number | null },
): CheckedView => {
  if (source.status === "loading") return { kind: "loading" };
  if (source.status === "error") return { kind: "none" };
  if (source.passMinutes === null)
    return { kind: "text", text: t("autoobserveLive.topbar.firstCheck") };
  return {
    kind: "text",
    text: t("autoobserveLive.topbar.checked", { ago: agoText(t, locale, source.passMinutes) }),
  };
};

// A missing part is left out, never drawn as a dash; with neither part there is no location.
export const whereText = (
  t: TranslateFn,
  cluster: string | null | undefined,
  namespace: string | null | undefined,
): I18nText | null => {
  if (cluster && namespace)
    return t("autoobserveLive.where", { cluster: raw(cluster), namespace: raw(namespace) });
  const only = cluster || namespace;
  return only ? raw(only) : null;
};

export type LiveCoverageState = "watched" | "gap";

const COVERAGE_WORD: Record<LiveCoverageState, I18nKey> = {
  watched: "autoobserveLive.coverage.stateWatched",
  gap: "autoobserveLive.coverage.stateGap",
};

export const coverageWord = (t: TranslateFn, state: LiveCoverageState): I18nText =>
  t(COVERAGE_WORD[state]);

export type LiveCellLook = "covered" | "missing" | "problem";

const CELL_WORD: Record<AutoObserveCellState, I18nKey> = {
  covered: "autoobserveLive.states.covered",
  weak: "autoobserveLive.states.weak",
  silent: "autoobserveLive.states.silent",
  blind: "autoobserveLive.states.blind",
  unmapped: "autoobserveLive.states.unmapped",
  none: "autoobserveLive.cell.noMonitor",
};

export const liveCellLook = (state: AutoObserveCellState): LiveCellLook => {
  if (state === "covered") return "covered";
  return state === "none" ? "missing" : "problem";
};

export const liveCellWord = (t: TranslateFn, state: AutoObserveCellState): I18nText =>
  t(CELL_WORD[state]);

export const LIVE_DOT: Record<LiveCellLook, string> = {
  covered: "bg-status-positive",
  missing: "border border-status-warning-text",
  problem: "bg-status-warning-text",
};

// Weak, Silent, Blind and Unmapped share one amber dot, so a key names that dot with one word.
const LOOK_WORD: Record<LiveCellLook, I18nKey> = {
  covered: "autoobserveLive.states.covered",
  missing: "autoobserveLive.cell.noMonitor",
  problem: "autoobserveLive.cell.fallsShort",
};

export const liveLookWord = (t: TranslateFn, look: LiveCellLook): I18nText => t(LOOK_WORD[look]);

const CHECK_NAME: Record<LiveCheck, I18nKey> = {
  errors: "autoobserveLive.classes.errors",
  latency: "autoobserveLive.classes.latency",
  absence: "autoobserveLive.classes.absence",
};

export const detectorCountText = (t: TranslateFn, count: number): I18nText =>
  t("autoobserve.coverage.detectorCount", { count }, count);

export const liveCheckName = (t: TranslateFn, check: LiveCheck): I18nText => t(CHECK_NAME[check]);

export const liveCheckText = (
  t: TranslateFn,
  check: LiveCheck,
  state: AutoObserveCellState,
): I18nText =>
  t("autoobserve.coverage.chipAria", {
    signal: liveCheckName(t, check),
    state: liveCellWord(t, state),
  });

const CHECK_INLINE: Record<LiveCheck, I18nKey> = {
  errors: "autoobserveLive.classesInline.errors",
  latency: "autoobserveLive.classesInline.latency",
  absence: "autoobserveLive.classesInline.absence",
};

// Checks with no monitor share one sentence; a monitor that falls short keeps its own reason.
export const liveGapLines = (
  t: TranslateFn,
  locale: string,
  checks: Record<LiveCheck, CoverageCell>,
): I18nText[] => {
  const stateOf = (check: LiveCheck) => checks[check].engine?.stateKey ?? "none";
  const lines = LIVE_CHECKS.filter((c) => stateOf(c) !== "none" && stateOf(c) !== "covered").map(
    (c) => checks[c].reason ?? liveCellWord(t, stateOf(c)),
  );
  const missing = LIVE_CHECKS.filter((c) => stateOf(c) === "none").map((c) => t(CHECK_INLINE[c]));
  if (missing.length)
    lines.push(
      t("autoobserveLive.coverage.gapNone", {
        checks: raw(new Intl.ListFormat(locale, { type: "disjunction" }).format(missing)),
      }),
    );
  return lines;
};

export const emptyCoverageNotice = (
  t: TranslateFn,
  locale: string,
  passMinutes: number | null,
): LiveNoticeView & { action: I18nText } => {
  const base = { severity: "neutral" as const, retry: false, details: false };
  if (passMinutes === null)
    return {
      ...base,
      icon: "hourglass-empty",
      title: t("autoobserveLive.notice.coverage.noPassTitle"),
      description: t("autoobserveLive.notice.coverage.noPassDesc"),
      action: t("autoobserveLive.notice.coverage.noPassAction"),
    };
  return {
    ...base,
    icon: "search-off",
    title: t("autoobserveLive.notice.coverage.noServicesTitle"),
    description: t("autoobserveLive.notice.coverage.noServicesDesc", {
      when: agoText(t, locale, passMinutes),
    }),
    action: t("autoobserveLive.notice.coverage.noServicesAction"),
  };
};

export const coverageSentence = (
  t: TranslateFn,
  locale: string,
  totals: { total: number; gaps: number },
): I18nText | null => {
  const { total, gaps } = totals;
  if (total <= 0) return null;
  const watched = total - gaps;
  if (gaps <= 0)
    return t(
      "autoobserveLive.coverage.sentence.allWatched",
      { total: count(locale, total) },
      total,
    );
  if (watched <= 0)
    return t("autoobserveLive.coverage.sentence.allGaps", { total: count(locale, total) }, total);
  return t("autoobserveLive.coverage.sentence.mixed", {
    watching: t("autoobserveLive.coverage.sentence.watching", {
      watched: count(locale, watched),
      total: count(locale, total),
    }),
    gaps: t("autoobserveLive.coverage.sentence.gaps", { count: count(locale, gaps) }, gaps),
  });
};

export const refreshFailedText = (
  t: TranslateFn,
  locale: string,
  timeZone: string,
  surface: LiveSurface,
  stale: LiveStale,
  now = Date.now(),
): I18nText =>
  t("autoobserveLive.notice.refreshFailed", {
    failedAt: formatWhen(stale.failedAt, locale, timeZone, now),
    dataAt: formatWhen(stale.dataAt, locale, timeZone, now),
    what: t(WHAT_KEY[surface]),
  });

export const moreCount = (total: number, shown: number) => Math.max(0, total - shown);

export const moreText = (t: TranslateFn, locale: string, total: number, shown: number) => {
  const more = moreCount(total, shown);
  return more ? t("autoobserveLive.suggestions.more", { count: count(locale, more) }, more) : null;
};

export const seeAllText = (t: TranslateFn, locale: string, total: number) =>
  t("autoobserveLive.suggestions.seeAll", { total: count(locale, total) }, total);

export type ChartReasonKind =
  | "empty"
  | "noSpanStatus"
  | "noLevel"
  | "noDuration"
  | "noTraces"
  | "noMatch"
  | "failedQuery"
  | "failedMatch"
  | "deniedQuery"
  | "deniedMatch";

export interface ChartText {
  reason: I18nText;
  detail: I18nText | null;
}

const CHART_REASON: Record<
  | "noSpanStatus"
  | "noLevel"
  | "noDuration"
  | "noTraces"
  | "noMatch"
  | "failedQuery"
  | "failedMatch",
  I18nKey
> = {
  noSpanStatus: "autoobserveLive.charts.noSpanStatus",
  noLevel: "autoobserveLive.charts.noLevel",
  noDuration: "autoobserveLive.charts.noDuration",
  noTraces: "autoobserveLive.charts.noTraces",
  noMatch: "autoobserveLive.charts.noMatch",
  failedQuery: "autoobserveLive.charts.failedQuery",
  failedMatch: "autoobserveLive.charts.failedMatch",
};

const CHART_EMPTY: Record<ChartRange, I18nKey> = {
  "1h": "autoobserveLive.charts.empty1h",
  "24h": "autoobserveLive.charts.empty24h",
  "7d": "autoobserveLive.charts.empty7d",
};

const CHART_EMPTY_PARTIAL: Record<ChartRange, I18nKey> = {
  "1h": "autoobserveLive.charts.emptyPartial1h",
  "24h": "autoobserveLive.charts.emptyPartial24h",
  "7d": "autoobserveLive.charts.emptyPartial7d",
};

// A denial words itself through the shared access copy, so it reads like every other 403 in the app.
const deniedText = (t: TranslateFn, stream: string | null): ChartText => {
  if (stream == null) {
    const message = accessDeniedMessage([viewDenial("service_streams", "get")], t);
    const [group] = message.groups;
    return { reason: message.title, detail: group ? accessReason(group, t) : null };
  }
  const resource = raw(stream);
  return {
    reason: t("accessBoundary.denied.view", { resource }),
    detail: t("accessBoundary.denied.missing", {
      permission: permissionLabel("get", t),
      resource,
    }),
  };
};

export const chartText = (
  t: TranslateFn,
  kind: ChartReasonKind,
  vars: {
    service: string;
    stream: string;
    range: ChartRange;
    partial: boolean;
    message: string | null;
  },
): ChartText => {
  if (kind === "empty") {
    const keys = vars.partial ? CHART_EMPTY_PARTIAL : CHART_EMPTY;
    return { reason: t(keys[vars.range], { service: vars.service }), detail: null };
  }
  if (kind === "deniedMatch") return deniedText(t, null);
  if (kind === "deniedQuery") return deniedText(t, vars.stream);
  return {
    reason: t(CHART_REASON[kind], { service: vars.service, stream: vars.stream }),
    detail: vars.message ? raw(vars.message) : null,
  };
};
