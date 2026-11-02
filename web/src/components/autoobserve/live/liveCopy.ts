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
import type { AutoObserveCellState } from "@/services/autoobserve";
import { LIVE_CHECKS, type CoverageCell, type LiveCheck } from "../fixtures";

export type LiveFailure = "denied" | "off" | "unavailable" | "failed";

export type LiveSurface = "coverage" | "suggestions";

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

export interface LiveStale {
  failedAt: number;
  dataAt: number;
}

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
};

// A denial or a turned-off engine cannot change on a retry, so neither offers one.
const NOTICE_LOOK: Record<LiveFailure, Omit<LiveNotice, "failure" | "title" | "description">> = {
  denied: { severity: "error", retry: false, details: false, icon: "lock" },
  off: { severity: "neutral", retry: false, details: false, icon: "toggle-off" },
  unavailable: { severity: "error", retry: true, details: false, icon: "cloud-off" },
  failed: { severity: "error", retry: true, details: true, icon: "error-outline" },
};

const statusOf = (error: unknown) =>
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

export const liveLoadText = (t: TranslateFn, surface: LiveSurface, phase: LivePhase): I18nText => {
  if (phase === "idle") return raw("");
  if (surface === "coverage")
    return t(
      phase === "loading" ? "autoobserveLive.coverage.loading" : "autoobserveLive.coverage.loaded",
    );
  return t(
    phase === "loading"
      ? "autoobserveLive.suggestions.loading"
      : "autoobserveLive.suggestions.loaded",
  );
};

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

const dayKey = (ms: number, timeZone: string) =>
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
    what: t(
      surface === "coverage"
        ? "autoobserveLive.notice.what.coverage"
        : "autoobserveLive.notice.what.suggestions",
    ),
  });

export const moreCount = (total: number, shown: number) => Math.max(0, total - shown);

export const moreText = (t: TranslateFn, locale: string, total: number, shown: number) => {
  const more = moreCount(total, shown);
  return more ? t("autoobserveLive.suggestions.more", { count: count(locale, more) }, more) : null;
};

export const seeAllText = (t: TranslateFn, locale: string, total: number) =>
  t("autoobserveLive.suggestions.seeAll", { total: count(locale, total) }, total);
