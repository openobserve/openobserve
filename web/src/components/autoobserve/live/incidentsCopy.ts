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

import type { RouteLocationRaw } from "vue-router";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  AutoObserveFindingKind,
  AutoObserveIncidentItem,
  AutoObserveIncidentList,
} from "@/services/autoobserve";
import type { Incident } from "@/services/incidents";
import {
  NOT_RUN,
  OUTCOME,
  isLiveRca,
  isStoredNotRunReason,
  type RcaCellTone,
} from "@/utils/incidents/rcaCell";
import type { AiFinding } from "../insight/insightCta";
import { logsForFinding, PAGED_LEAD_US } from "../insight/targets/logsTargets";
import type { IssuesRange } from "../v2/fixtures";
import { agoText, dayKey, formatWhen } from "./liveCopy";

export interface AnalysisLine {
  label: I18nText;
  tone: RcaCellTone;
  detail: I18nText;
  spinner: boolean;
  hasRun: boolean;
  shared: I18nText;
}

export interface SharedAnalysis {
  text: I18nText;
  covers: (line: AnalysisLine) => boolean;
}

export interface IncidentRoute {
  name: "incidentDetail" | "incidentList";
  params?: { id: string };
  query: { org_identifier: string; tab?: "incidentAnalysis" };
}

// Three rows keep the card short above the rail's suggestion cards (RAIL_CAP = 5).
export const PAGED_CAP = 3;

// The main column shows what the fixture problem list showed per step (ThisWeek's STEP = 10).
export const MAIN_PAGED_CAP = 10;

// The rail card's single placeholder row stays; a longer card holds three, its few-rows shape.
export const MAX_SKELETON_ROWS = 3;

// The incident list's poll while a run on its page is live (RCA_LIVE_POLL_MS).
export const PAGED_POLL_MS = 30_000;

// AutoObserve pages are rare (paging is per-org opt-in), so the newest 500 cover any range.
export const ISSUES_CAP = 500;

export const ISSUES_PAGE_SIZE = 100;

const DAY_MS = 86_400_000;

const FINDING_KEY: Record<AutoObserveFindingKind, I18nKey> = {
  stream_silence: "autoobserveLive.incidents.finding.stream_silence",
  stream_drop: "autoobserveLive.incidents.finding.stream_drop",
  stream_rise: "autoobserveLive.incidents.finding.stream_rise",
};

const GROUP_KEY: Record<AutoObserveFindingKind, I18nKey> = {
  stream_silence: "insight.kind.paged.stream_silence.headline",
  stream_drop: "insight.kind.paged.stream_drop.headline",
  stream_rise: "insight.kind.paged.stream_rise.headline",
};

const FINDING_AI_KEY: Record<AutoObserveFindingKind, I18nKey> = {
  stream_silence: "insight.ai.paged.stream_silence",
  stream_drop: "insight.ai.paged.stream_drop",
  stream_rise: "insight.ai.paged.stream_rise",
};

const STATUS_KEY: Record<Incident["status"], I18nKey> = {
  open: "alerts.incidents.statusOpen",
  acknowledged: "alerts.incidents.statusAcknowledged",
  resolved: "alerts.incidents.statusResolved",
};

const RANGE_DAYS: Record<IssuesRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

const RANGE_WITHIN: Record<IssuesRange, I18nKey> = {
  "7d": "autoobserve2.issuesPage.within.week",
  "30d": "autoobserve2.issuesPage.within.month",
  "90d": "autoobserve2.issuesPage.within.quarter",
};

const SHARED_NOT_RUN: Record<keyof typeof NOT_RUN, I18nKey> = {
  rca_disabled: "autoobserveLive.issues.shared.rcaDisabled",
  ai_unavailable: "autoobserveLive.issues.shared.aiUnavailable",
  quota_exceeded: "autoobserveLive.issues.shared.quotaExceeded",
  cooling_down: "autoobserveLive.issues.shared.coolingDown",
  start_failed: "autoobserveLive.issues.shared.startFailed",
};

const EMPTY = raw("");

const line = (
  label: I18nText,
  tone: RcaCellTone,
  hasRun: boolean,
  detail: I18nText = EMPTY,
  spinner = false,
): AnalysisLine => ({ label, tone, detail, spinner, hasRun, shared: EMPTY });

const sharedAs = (analysis: AnalysisLine, shared: I18nText): AnalysisLine => ({
  ...analysis,
  shared,
});

const isFindingKind = (kind: string | null): kind is AutoObserveFindingKind =>
  kind !== null && Object.prototype.hasOwnProperty.call(FINDING_KEY, kind);

// A group reads as the home card's headline; an unknown kind or unreadable stream falls back to the server's English title.
export const findingSentence = (t: TranslateFn, item: AutoObserveIncidentItem): I18nText => {
  const { kind, stream_name, stream_type } = item.finding;
  const members = item.members?.length ?? 0;
  if (members > 1 && isFindingKind(kind)) return t(GROUP_KEY[kind], { count: members });
  if (!isFindingKind(kind) || !stream_name || !stream_type) return raw(item.incident.title);
  return t(FINDING_KEY[kind], { stream: raw(stream_name), type: raw(stream_type) });
};

/** The lead stream, plus how many more streams the group holds. */
export const issuesStreamLabel = (
  t: TranslateFn,
  item: AutoObserveIncidentItem,
): I18nText | null => {
  const lead = item.finding.stream_name;
  if (!lead) return null;
  const more = (item.members?.length ?? 0) - 1;
  return more > 0
    ? t("autoobserveLive.issues.streamMore", { stream: raw(lead), count: more })
    : raw(lead);
};

/** Every stream name an incident holds, for search. */
export const issuesStreamNames = (item: AutoObserveIncidentItem): string[] => [
  ...(item.finding.stream_name ? [item.finding.stream_name] : []),
  ...(item.members ?? []).flatMap((m) => m.stream_name ?? []),
];

export interface PageCell {
  text: I18nText;
  tone: "neutral" | "warning" | "error";
}

/** Who an incident paged, in the words of the home card; null when the server recorded nothing. */
export const issuesPageCell = (t: TranslateFn, item: AutoObserveIncidentItem): PageCell | null => {
  switch (item.page?.outcome) {
    case "paged":
      return {
        tone: "neutral",
        text: item.page.team_name
          ? t("insight.kind.paged.page.paged", { team: raw(item.page.team_name) })
          : t("insight.kind.paged.page.pagedTeam"),
      };
    case "unrouted":
      return { tone: "warning", text: t("autoobserveLive.issues.page.unrouted") };
    case "failed":
      return { tone: "error", text: t("autoobserveLive.issues.page.failed") };
    case "pending":
      return { tone: "neutral", text: t("autoobserveLive.issues.page.pending") };
    default:
      return null;
  }
};

/** What Ask AI hands the chat for a paged finding; null when the finding is unreadable. */
export const findingAi = (
  t: TranslateFn,
  item: AutoObserveIncidentItem,
  zone: { locale: string; timeZone: string },
  now: number,
): AiFinding | null => {
  const { kind, stream_name, stream_type, first_seen_at } = item.finding;
  if (!isFindingKind(kind) || !stream_name || !stream_type) return null;
  const time = formatWhen(first_seen_at / 1000, zone.locale, zone.timeZone, now);
  return {
    kind,
    subject: `${stream_name} (${stream_type})`,
    request: t(FINDING_AI_KEY[kind], {
      stream: raw(stream_name),
      type: raw(stream_type),
      time,
    }),
    facts: [
      ["Stream", stream_name],
      ["Stream type", stream_type],
      ["Started", String(time)],
      ["Incident", item.incident.title],
    ],
  };
};

/** The paged stream in Logs; null for metrics, an unreadable finding or a build without AutoObserve. */
export const findingLogs = (
  item: AutoObserveIncidentItem,
  now: number,
): RouteLocationRaw | null => {
  const { stream_name, stream_type, first_seen_at } = item.finding;
  if (!stream_name || !stream_type) return null;
  // Only Logs searches several streams at once, so a group opens every member of the lead's type there.
  const peers =
    stream_type === "logs"
      ? (item.members ?? []).filter((m) => m.stream_type === stream_type && m.stream_name)
      : [];
  const streams = [...new Set([stream_name, ...peers.map((m) => m.stream_name as string)])];
  const signalAt = Math.min(first_seen_at, ...peers.map((m) => m.first_seen_at));
  return logsForFinding(
    { stream_type, stream_name: streams.join(","), signal_at: signalAt, lead_us: PAGED_LEAD_US },
    now * 1000,
  );
};

const notRunLine = (
  t: TranslateFn,
  item: AutoObserveIncidentItem,
  rcaEnabled: boolean,
): AnalysisLine => {
  const reason = item.investigation.not_run_reason;
  if (reason === "l0_off") {
    const detail = t("alerts.incidents.aiAnalysis.noAiSreFor", {
      severity: raw(String(item.incident.severity).toUpperCase()),
    });
    return sharedAs(line(t("alerts.incidents.aiAnalysis.rcaOff"), "muted", false, detail), detail);
  }
  if (isStoredNotRunReason(reason)) {
    const notRun = NOT_RUN[reason];
    return sharedAs(
      line(t(notRun.label), notRun.tone, false, t(notRun.detail)),
      t(SHARED_NOT_RUN[reason]),
    );
  }
  if (reason)
    return sharedAs(
      line(
        t("alerts.incidents.aiAnalysis.rcaOff"),
        "muted",
        false,
        t("autoobserveLive.incidents.analysis.offOther"),
      ),
      t("autoobserveLive.issues.shared.offOther"),
    );
  if (!rcaEnabled)
    return sharedAs(
      line(
        t("alerts.incidents.aiAnalysis.rcaDisabled"),
        "muted",
        false,
        t("autoobserveLive.incidents.analysis.disabledDetail"),
      ),
      t("autoobserveLive.issues.shared.disabled"),
    );
  return sharedAs(
    line(
      t("alerts.incidents.aiAnalysis.notAnalyzed"),
      "muted",
      false,
      t("autoobserveLive.incidents.analysis.notRunDetail"),
    ),
    t("autoobserveLive.issues.shared.notRun"),
  );
};

// A failed run's detail is a server error that can name agent URLs, so the row shows a fixed sentence.
export const analysisLine = (
  t: TranslateFn,
  item: AutoObserveIncidentItem,
  rcaEnabled: boolean,
): AnalysisLine => {
  const { state, outcome, summary } = item.investigation;
  switch (state) {
    case "running":
      return line(t("alerts.incidents.aiAnalysis.investigating"), "muted", true, EMPTY, true);
    case "waiting_input":
      return line(
        t("alerts.incidents.aiAnalysis.blocked"),
        "warn-strong",
        true,
        raw(summary?.detail ?? ""),
      );
    case "completed": {
      const known = outcome ? OUTCOME[outcome] : undefined;
      if (!known) return line(t("alerts.incidents.aiAnalysis.analyzed"), "ok", true);
      // A blocked run names what it needs, as the incident list does.
      const detail = outcome === "blocked" ? raw(summary?.detail ?? "") : EMPTY;
      return line(t(known.key), known.tone, true, detail);
    }
    case "failed":
      return sharedAs(
        line(
          t("alerts.incidents.aiAnalysis.failed"),
          "err",
          true,
          t("autoobserveLive.incidents.analysis.failedDetail"),
        ),
        t("autoobserveLive.issues.shared.failed"),
      );
    case "cancelled":
      return line(t("alerts.incidents.rcaRun.state.cancelled"), "err", true);
    default:
      return notRunLine(t, item, rcaEnabled);
  }
};

// Two or more rows with one reason state it once, so the same sentence never repeats down the table.
export const sharedAnalysis = (
  t: TranslateFn,
  lines: readonly AnalysisLine[],
): SharedAnalysis | null => {
  const keyOf = (l: AnalysisLine) =>
    l.shared ? `${l.label}\u0000${l.detail}\u0000${l.shared}` : "";
  const counts = new Map<string, number>();
  for (const l of lines) {
    const key = keyOf(l);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: { key: string; count: number } | null = null;
  for (const [key, count] of counts) if (!best || count > best.count) best = { key, count };
  if (!best || best.count < 2) return null;
  const key = best.key;
  const line = lines.find((l) => keyOf(l) === key) as AnalysisLine;
  // When other states sit beside it, the state's chip label says which rows the sentence is about.
  const text =
    best.count === lines.length
      ? line.shared
      : t("autoobserveLive.incidents.sharedFor", { label: line.label, reason: line.shared });
  return { text, covers: (l) => keyOf(l) === key };
};

// The server's error text can name internal hosts, so the details give only the status and the time.
export const failedDetail = (
  t: TranslateFn,
  locale: string,
  timeZone: string,
  status: unknown,
  at: number,
  now = Date.now(),
): I18nText => {
  const time = formatWhen(at, locale, timeZone, now);
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? t("autoobserveLive.incidents.failedDetail.status", { status: raw(String(status)), time })
    : t("autoobserveLive.incidents.failedDetail.noResponse", { time });
};

export const statusLabel = (t: TranslateFn, status: Incident["status"]): I18nText =>
  t(STATUS_KEY[status]);

export const openedText = (
  t: TranslateFn,
  locale: string,
  item: AutoObserveIncidentItem,
  now: number,
): I18nText =>
  t("autoobserveLive.incidents.opened", {
    when: agoText(
      t,
      locale,
      Math.max(0, Math.floor((now - item.incident.created_at / 1000) / 60_000)),
    ),
  });

export const pagingNote = (t: TranslateFn): I18nText => t("autoobserveLive.incidents.pagingNote");

const count = (locale: string, n: number): I18nText => raw(new Intl.NumberFormat(locale).format(n));

export const newFindingsText = (t: TranslateFn, locale: string, n: number): I18nText =>
  t("autoobserveLive.incidents.newFindings", { count: count(locale, n) }, n);

export const moreText = (t: TranslateFn, locale: string, cap = PAGED_CAP): I18nText =>
  t("autoobserveLive.incidents.more", { count: count(locale, cap) });

export const skeletonRows = (cap: number): number =>
  cap > PAGED_CAP ? Math.min(cap, MAX_SKELETON_ROWS) : 1;

// The card's fixed words, so the component holds no key of its own.
export const pagedCopy = (t: TranslateFn) => ({
  title: t("autoobserveLive.incidents.title"),
  subtitle: t("autoobserveLive.incidents.subtitleWho"),
  routing: t("autoobserveLive.incidents.routing"),
  openIncident: t("autoobserveLive.incidents.openIncident"),
  viewAnalysis: t("autoobserveLive.incidents.viewAnalysis"),
  showNew: t("autoobserveLive.incidents.showNew"),
  seeAll: t("autoobserveLive.incidents.seeAll"),
  seeAllIssues: t("autoobserveLive.incidents.seeAllIssues"),
  emptyTitle: t("autoobserveLive.incidents.empty.title"),
  emptyDesc: t("autoobserveLive.incidents.empty.desc"),
  offTitle: t("autoobserveLive.incidents.emptyOff.title"),
  offDesc: t("autoobserveLive.incidents.emptyOff.desc"),
});

export const incidentLink = (org: string, id: string): IncidentRoute => ({
  name: "incidentDetail",
  params: { id },
  query: { org_identifier: org },
});

// The incident page reads `tab` once and drops it, so Back and reload keep the user's own tab.
export const analysisLink = (org: string, id: string): IncidentRoute => ({
  name: "incidentDetail",
  params: { id },
  query: { org_identifier: org, tab: "incidentAnalysis" },
});

export const incidentListLink = (org: string): IncidentRoute => ({
  name: "incidentList",
  query: { org_identifier: org },
});

export const anyLive = (list: AutoObserveIncidentList | undefined): boolean =>
  !!list?.items.some((item) => isLiveRca(item.investigation));

// Range start in microseconds, the unit of `first_seen_at`.
export const issuesRangeStart = (range: IssuesRange, nowMs: number): number =>
  (nowMs - RANGE_DAYS[range] * DAY_MS) * 1000;

const loadedCount = (pages: readonly AutoObserveIncidentList[]): number =>
  pages.reduce((n, page) => n + page.items.length, 0);

// The list runs newest first, so a page whose oldest row predates the range is the last one needed.
export const nextIssuesOffset = (
  pages: readonly AutoObserveIncidentList[],
  startUs: number,
  cap = ISSUES_CAP,
): number | undefined => {
  const last = pages.at(-1);
  const oldest = last?.items.at(-1);
  const loaded = loadedCount(pages);
  if (!last?.has_more || !oldest || loaded >= cap || oldest.finding.first_seen_at < startUs)
    return undefined;
  return loaded;
};

// Capped only when the cap cut off rows that may still fall inside the range.
export const issuesCapped = (
  pages: readonly AutoObserveIncidentList[],
  startUs: number,
  cap = ISSUES_CAP,
): boolean => {
  const loaded = loadedCount(pages);
  const more = loaded > cap || (loaded === cap && !!pages.at(-1)?.has_more);
  const oldest = pages.flatMap((page) => page.items)[cap - 1];
  return more && !!oldest && oldest.finding.first_seen_at >= startUs;
};

// The Issues table's fixed words, so the component holds no key of its own.
export const issuesCopy = (t: TranslateFn) => ({
  searchLabel: t("autoobserve.issues.searchLabel"),
  searchPlaceholder: t("autoobserveLive.issues.searchPlaceholder"),
  priorityLabel: t("autoobserve2.recent.priorityLabel"),
  allPriorities: t("autoobserve2.recent.all"),
  open: t("autoobserveLive.issues.filterOpen"),
  resolved: t("autoobserve.issues.recent"),
  allStatuses: t("autoobserve.issues.all"),
  colIncident: t("autoobserveLive.issues.columns.incident"),
  colSeverity: t("autoobserveLive.issues.columns.severity"),
  colStatus: t("autoobserveLive.issues.columns.status"),
  colStream: t("autoobserveLive.issues.columns.stream"),
  colPage: t("autoobserveLive.issues.columns.page"),
  colOpened: t("autoobserveLive.issues.columns.opened"),
  colAnalysis: t("autoobserveLive.issues.columns.analysis"),
  clearSearch: t("autoobserve.issues.clearSearch"),
  emptyDesc: t("autoobserveLive.incidents.empty.desc"),
  offTitle: t("autoobserveLive.incidents.emptyOff.title"),
  offDesc: t("autoobserveLive.incidents.emptyOff.desc"),
  filterEmptyTitle: t("autoobserve.issues.emptyTitle"),
  filterEmptyDesc: t("autoobserve.issues.emptyDescription"),
});

export const issuesEmptyTitle = (t: TranslateFn, range: IssuesRange): I18nText =>
  t("autoobserveLive.issues.emptyRange", { within: t(RANGE_WITHIN[range]) });

export const issuesNoMatch = (t: TranslateFn, term: string): I18nText =>
  t("autoobserve.issues.noMatch", { query: raw(term) });

export const issuesMatchText = (t: TranslateFn, n: number): I18nText =>
  t("autoobserve.issues.matchCount", { count: n }, n);

export const issuesCountText = (t: TranslateFn, locale: string, n: number): I18nText =>
  t("autoobserveLive.issues.count", { count: count(locale, n) }, n);

export const capNote = (t: TranslateFn, locale: string, cap = ISSUES_CAP): I18nText =>
  t("autoobserveLive.issues.capNote", { count: count(locale, cap) });

// A "+" says more rows exist than were loaded, so the count is a floor.
export const openBadge = (locale: string, n: number, more: boolean): I18nText =>
  raw(`${new Intl.NumberFormat(locale).format(n)}${more ? "+" : ""}`);

export const issuesOpenedText = (
  t: TranslateFn,
  locale: string,
  createdMs: number,
  now: number,
): I18nText => agoText(t, locale, Math.max(0, Math.floor((now - createdMs) / 60_000)));

export const issuesStreamType = (t: TranslateFn, type: string | null): I18nText | undefined =>
  type ? t("autoobserveLive.issues.streamType", { type: raw(type) }) : undefined;

export const issuesDayKey = (us: number, timeZone: string): string => dayKey(us / 1000, timeZone);

export const issuesDayLabel = (
  t: TranslateFn,
  locale: string,
  timeZone: string,
  us: number,
  now: number,
): I18nText => {
  const key = issuesDayKey(us, timeZone);
  if (key === dayKey(now, timeZone)) return t("autoobserveLive.issues.today");
  if (key === dayKey(now - DAY_MS, timeZone)) return t("autoobserveLive.issues.yesterday");
  const sameYear = key.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  return raw(
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: sameYear ? undefined : "numeric",
      timeZone,
    }).format(new Date(us / 1000)),
  );
};
