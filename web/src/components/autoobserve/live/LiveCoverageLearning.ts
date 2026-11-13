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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { AutoObserveLearning } from "@/services/autoobserve";
import { learningEmpty, learningLine } from "./liveCopy";

export type LearningReason = "young" | "usage_history_short" | "retention_short" | "no_usage";

/** A coverage stream with the warm-start fields; older servers send none of them. */
export interface LearningStream {
  type: string;
  name: string;
  learning_until?: number | null;
  history_days_found?: number | null;
  reason?: LearningReason | string | null;
}

export interface LearningView extends AutoObserveLearning {
  history_days_found_max?: number | null;
  /** Learning streams per reason; `no_usage` is listed, possibly at 0, whenever usage is off. */
  reasons?: Partial<Record<string, number>> | null;
}

type Zone = { locale: string; timeZone: string };

interface ReasonGroups {
  gathering: LearningStream[];
  retention: LearningStream[];
  noUsage: LearningStream[];
}

const fmt = (locale: string, n: number): I18nText => raw(new Intl.NumberFormat(locale).format(n));

// Ready dates fall within weeks, so they read as month and day like the other learning lines.
const shortDay = (us: number, zone: Zone): I18nText =>
  raw(
    new Intl.DateTimeFormat(zone.locale, {
      month: "short",
      day: "numeric",
      timeZone: zone.timeZone,
    }).format(us / 1000),
  );

const isLearning = (s: LearningStream, nowMs: number) =>
  typeof s.learning_until === "number" && s.learning_until / 1000 > nowMs;

// Short retention or missing usage never finishes learning on its own, so it has no ready date.
const STUCK: ReadonlySet<string> = new Set(["retention_short", "no_usage"]);

const uniqueStreams = (streams: readonly LearningStream[]) => [
  ...new Map(streams.map((s) => [`${s.type}/${s.name}`, s])).values(),
];

/** A service is learning while any stream still gathers history or cannot, and it is no gap. */
export const serviceLearning = (streams: readonly LearningStream[], nowMs: number): boolean =>
  streams.some((s) => isLearning(s, nowMs) || STUCK.has(s.reason ?? ""));

export const hasReasons = (
  learning: LearningView | null | undefined,
  streams: readonly LearningStream[],
) =>
  typeof learning?.history_days_found_max === "number" ||
  !!learning?.reasons ||
  streams.some((s) => typeof s.reason === "string" || typeof s.history_days_found === "number");

// The engine reports usage off for the whole org, even before any stream is listed.
const usageOff = (learning: LearningView | null | undefined, streams: readonly LearningStream[]) =>
  (!!learning?.reasons && "no_usage" in learning.reasons) ||
  streams.some((s) => s.reason === "no_usage");

const groupsOf = (streams: readonly LearningStream[], nowMs: number): ReasonGroups => {
  const all = uniqueStreams(streams);
  return {
    gathering: all.filter((s) => !STUCK.has(s.reason ?? "") && isLearning(s, nowMs)),
    retention: all.filter((s) => s.reason === "retention_short"),
    noUsage: all.filter((s) => s.reason === "no_usage"),
  };
};

const firstReady = (list: readonly LearningStream[]) =>
  Math.min(...list.map((s) => s.learning_until ?? Infinity));

const gatheringText = (
  t: TranslateFn,
  zone: Zone,
  list: LearningStream[],
  needed: number,
): I18nText => {
  const n = list.length;
  const found = Math.max(0, ...list.map((s) => s.history_days_found ?? 0));
  return t(
    "autoobserve.coverageLive.learning.found",
    {
      count: fmt(zone.locale, n),
      found: fmt(zone.locale, found),
      needed: fmt(zone.locale, needed),
      date: shortDay(firstReady(list), zone),
    },
    n,
  );
};

// Without usage no stream can be learned, so it is the only reason worth saying.
const reasonParts = (
  t: TranslateFn,
  zone: Zone,
  needed: number,
  off: boolean,
  streams: readonly LearningStream[],
  nowMs: number,
): I18nText[] => {
  const groups = groupsOf(streams, nowMs);
  if (off) {
    const n = groups.noUsage.length;
    return [
      n
        ? t("autoobserve.coverageLive.learning.noUsage", { count: fmt(zone.locale, n) }, n)
        : t("autoobserve.coverageLive.learning.noUsageAll"),
    ];
  }
  const parts: I18nText[] = [];
  if (groups.gathering.length) parts.push(gatheringText(t, zone, groups.gathering, needed));
  const kept = groups.retention.length;
  if (kept) parts.push(retentionText(t, zone, kept, needed));
  return parts;
};

const retentionText = (t: TranslateFn, zone: Zone, n: number, needed: number): I18nText =>
  t(
    "autoobserve.coverageLive.learning.retention",
    { count: fmt(zone.locale, n), needed: fmt(zone.locale, needed) },
    n,
  );

const listedParts = (
  t: TranslateFn,
  zone: Zone,
  learning: LearningView | null | undefined,
  streams: readonly LearningStream[],
  nowMs: number,
): I18nText[] =>
  hasReasons(learning, streams)
    ? reasonParts(
        t,
        zone,
        learning?.history_days_needed ?? 14,
        usageOff(learning, streams),
        streams,
        nowMs,
      )
    : [];

// The org-wide date and found days span short-retention streams too, so they are said only when every learner gathers.
const orgGathering = (
  t: TranslateFn,
  zone: Zone,
  learning: LearningView,
  n: number,
  dated: boolean,
) => {
  const needed = learning.history_days_needed ?? 14;
  const at = dated ? learning.next_ready_at : null;
  const found = learning.history_days_found_max ?? 0;
  const count = fmt(zone.locale, n);
  if (typeof at !== "number") return t("autoobserve.coverageLive.learning.gathering", { count }, n);
  const date = shortDay(at, zone);
  if (found > 0 && found < needed) {
    const days = { found: fmt(zone.locale, found), needed: fmt(zone.locale, needed) };
    return t("autoobserve.coverageLive.learning.found", { count, date, ...days }, n);
  }
  return t("autoobserve.coverageLive.learning.until", { count, date }, n);
};

// Coverage may list none of the learning streams, so the home falls back to the org-wide reason counts.
const orgParts = (t: TranslateFn, zone: Zone, learning: LearningView | null | undefined) => {
  const reasons = learning?.reasons;
  if (!learning || !reasons || !(learning.streams_learning > 0)) return [];
  const kept = reasons.retention_short ?? 0;
  const n = (reasons.young ?? 0) + (reasons.usage_history_short ?? 0);
  const parts: I18nText[] = [];
  if (n) parts.push(orgGathering(t, zone, learning, n, !kept));
  if (kept) parts.push(retentionText(t, zone, kept, learning.history_days_needed ?? 14));
  return parts;
};

const join = (parts: readonly I18nText[]): I18nText | null =>
  parts.length ? raw(parts.map(String).join(" ")) : null;

/** Why streams are still learning, one sentence per reason; null when nothing is learning or the server sends no reasons. */
export const learningReasonText = (
  t: TranslateFn,
  zone: Zone,
  learning: LearningView | null | undefined,
  streams: readonly LearningStream[],
  nowMs: number,
): I18nText | null => {
  if (!hasReasons(learning, streams)) return null;
  const parts = listedParts(t, zone, learning, streams, nowMs);
  const learned = learning?.history_days_found_max ?? 0;
  if (!parts.length && learned > 0)
    return t("autoobserve.coverageLive.learning.learned", { days: fmt(zone.locale, learned) });
  return join(parts);
};

/** The coverage summary's learning sentence over the services' own streams, so it counts what the page lists. */
export const coverageLearningText = (
  t: TranslateFn,
  zone: Zone,
  learning: LearningView | null | undefined,
  streams: readonly LearningStream[],
  nowMs: number,
): I18nText | null => {
  const reason = learningReasonText(t, zone, learning, streams, nowMs);
  if (reason) return reason;
  const list = groupsOf(streams, nowMs).gathering;
  if (!list.length) return null;
  return t(
    "autoobserve.coverageLive.learning.until",
    {
      count: fmt(zone.locale, list.length),
      date: shortDay(firstReady(list), zone),
    },
    list.length,
  );
};

/** The home's line: the listed streams' reasons, else the org-wide reasons, else the dated fallback lines. */
export const learningSummary = (
  t: TranslateFn,
  zone: Zone,
  learning: LearningView | null | undefined,
  streams: readonly LearningStream[],
  nowMs: number,
): I18nText | null =>
  join(listedParts(t, zone, learning, streams, nowMs)) ??
  join(orgParts(t, zone, learning)) ??
  coverageLearningText(t, zone, learning, streams, nowMs) ??
  learningLine(t, zone, learning);

/** The home's place of an empty list while nothing can be judged yet; usage off says what to turn on. */
export const learningWaiting = (
  t: TranslateFn,
  zone: Zone,
  learning: LearningView | null | undefined,
  streams: readonly LearningStream[],
  nowMs: number,
): { title: I18nText; desc: I18nText } | null => {
  const reasons = hasReasons(learning, streams);
  if (reasons && usageOff(learning, streams))
    return {
      title: t("autoobserve.coverageLive.learning.noUsageTitle"),
      desc: t("autoobserve.coverageLive.learning.noUsageDesc"),
    };
  const today = learningEmpty(t, zone, learning);
  if (!today || !reasons) return today;
  const desc =
    join(listedParts(t, zone, learning, streams, nowMs)) ?? join(orgParts(t, zone, learning));
  return desc ? { title: today.title, desc } : today;
};

/** One stream's own reason, for the coverage drawer; null on an older server. */
export const streamReasonText = (
  t: TranslateFn,
  zone: Zone,
  stream: LearningStream,
  needed: number,
  nowMs: number,
): I18nText | null => {
  if (stream.reason === "retention_short")
    return t("autoobserve.coverageLive.learning.streamRetention", {
      needed: fmt(zone.locale, needed),
    });
  if (stream.reason === "no_usage") return t("autoobserve.coverageLive.learning.streamNoUsage");
  if (!isLearning(stream, nowMs) || typeof stream.history_days_found !== "number") return null;
  return t("autoobserve.coverageLive.learning.streamFound", {
    found: fmt(zone.locale, stream.history_days_found),
    needed: fmt(zone.locale, needed),
    date: shortDay(stream.learning_until ?? 0, zone),
  });
};

/** A service's learning streams, soonest first: one sentence for a single stream, else a list with each one's reason or date. */
export const streamLearningList = (
  t: TranslateFn,
  zone: Zone,
  streams: readonly LearningStream[],
  needed: number,
  nowMs: number,
): { summary: I18nText; rows: { key: string; stream: string; text: I18nText }[] } | null => {
  // A stream that can't finish has no real ready date, so it goes after every dated one.
  const readyAt = (s: LearningStream) =>
    STUCK.has(s.reason ?? "") ? Infinity : (s.learning_until ?? Infinity);
  const list = uniqueStreams(streams)
    .filter((s) => isLearning(s, nowMs) || STUCK.has(s.reason ?? ""))
    .sort((a, b) => readyAt(a) - readyAt(b));
  if (!list.length) return null;
  const label = (s: LearningStream) => `${s.name} (${s.type})`;
  const reason = (s: LearningStream) => streamReasonText(t, zone, s, needed, nowMs);
  const until = (s: LearningStream) =>
    t("autoobserveLive.learning.streamUntil", { date: shortDay(s.learning_until ?? 0, zone) });
  if (list.length === 1) {
    const [only] = list;
    const why = reason(only);
    return {
      summary: why
        ? t("autoobserve.coverageLive.learning.one", { reason: why, stream: raw(label(only)) })
        : t("autoobserveLive.learning.until", {
            date: shortDay(only.learning_until ?? 0, zone),
            streams: raw(label(only)),
          }),
      rows: [],
    };
  }
  const parts = hasReasons(null, list)
    ? reasonParts(t, zone, needed, usageOff(null, list), list, nowMs)
    : [];
  return {
    summary:
      join(parts) ??
      t("autoobserveLive.learning.streams", { count: fmt(zone.locale, list.length) }, list.length),
    rows: list.map((s) => ({
      key: `${s.type}/${s.name}`,
      stream: label(s),
      text: reason(s) ?? until(s),
    })),
  };
};
