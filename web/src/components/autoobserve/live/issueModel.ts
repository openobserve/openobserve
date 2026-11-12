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
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import type {
  IncidentAlert,
  IncidentEvent,
  RcaBand,
  RcaHypothesisStatus,
  RcaSummarySuspectChange,
} from "@/services/incidents";
import type {
  Analysis,
  HypothesisVerdict,
  Issue,
  TimelineEntry,
  UnfoldCard,
  UnfoldKind,
  UnfoldOutcome,
} from "../aoTypes";
import type { InsightZone } from "../insight/insightCopy";
import { pagedFindingCopy } from "../insight/kindCopy";
import type { AoSparkMarker, AoSparkPoint } from "./aoSparkline";
import { usualBetween, type IssueBaseline } from "./issueBaseline";
import { findingSentence } from "./incidentsCopy";
import { issueWindow, type IssueSeries, type IssueStream, type IssueWindow } from "./issueSeries";
import { PAGED_LEAD_US } from "../insight/targets/logsTargets";
import { actorName, durationText, formatWhen } from "./liveCopy";

export interface IssueStreamInfo extends IssueStream {
  firstSeenUs: number;
  recoveredUs: number | null;
  lead: boolean;
}

export type LiveIssueTab = "overview" | "analysis" | "graph" | "firings" | "activity" | "logs";

export interface IssueTimelineView {
  entries: TimelineEntry[];
  more: number;
}

interface TimedEntry {
  us: number;
  entry: TimelineEntry;
}

/** What the analysis tab reads, from a fixture issue or a live incident. */
export type AnalysisSubject = Pick<
  Issue,
  "id" | "severity" | "services" | "evidence" | "unfold" | "nextStep" | "analysis"
> & { confidence?: RcaBand | null };

export type ComparisonRows = NonNullable<Analysis["comparison"]>["rows"];

const FINDING_TITLE: Record<string, I18nKey> = {
  stream_silence: "alerts.incidents.findingKind.stream_silence",
  stream_drop: "alerts.incidents.findingKind.stream_drop",
  stream_rise: "alerts.incidents.findingKind.stream_rise",
};

const CARD_KIND: Record<string, UnfoldKind> = { logs: "log", traces: "trace", metrics: "metric" };

const PAGE_CARD: Record<
  string,
  { outcome: UnfoldOutcome; key: I18nKey; tone: UnfoldCard["tone"] }
> = {
  paged: { outcome: "paged", key: "autoobserve.unfold.outcome.paged", tone: "danger" },
  unrouted: {
    outcome: "notified",
    key: "autoobserve.issueLive.page.unrouted",
    tone: "warning",
  },
  failed: { outcome: "fixFailed", key: "autoobserve.issueLive.page.failed", tone: "danger" },
  pending: { outcome: "open", key: "autoobserve.issueLive.page.pending", tone: "neutral" },
};

const EVENT_ENTRY: Record<string, { key: I18nKey; variant: TimelineEntry["variant"] }> = {
  Created: { key: "autoobserve.issueLive.timeline.opened", variant: "primary" },
  Acknowledged: { key: "autoobserve.issueLive.timeline.acknowledged", variant: "info" },
  Resolved: { key: "autoobserve.issueLive.timeline.resolved", variant: "success" },
  Reopened: { key: "autoobserve.issueLive.timeline.reopened", variant: "destructive" },
  ai_analysis_complete: { key: "autoobserve.issueLive.timeline.analyzed", variant: "primary" },
  ai_analysis_failed: { key: "autoobserve.issueLive.timeline.analysisFailed", variant: "muted" },
};

const VERDICT_OF: Partial<Record<RcaHypothesisStatus, HypothesisVerdict>> = {
  root_cause: "confirmed",
  likely: "confirmed",
  ruled_out: "ruled_out",
};

// More stream rows than this read as one line, so a big group never floods the timeline.
const TIMELINE_GROUP = 3;
export const TIMELINE_CAP = 8;
export const COMPARISON_CAP = 4;
// Lanes past this push the team lane out of view, so the rest stay in the blast radius list.
export const UNFOLD_STREAM_CAP = 6;

const usToMs = (us: number) => Math.floor(us / 1000);

const clock = (ms: number, zone: InsightZone, sameDayAs: number): I18nText =>
  formatWhen(ms, zone.locale, zone.timeZone, sameDayAs);

const count = (locale: string, n: number) =>
  raw(new Intl.NumberFormat(locale, { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n));

/** The lead stream first, then every other member once. */
export const issueStreams = (item: AutoObserveIncidentItem): IssueStreamInfo[] => {
  const { stream_type, stream_name, first_seen_at } = item.finding;
  const out: IssueStreamInfo[] = [];
  const seen = new Set<string>();
  const add = (s: IssueStreamInfo) => {
    const key = `${s.type}/${s.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  const lead = (item.members ?? []).find(
    (m) => m.stream_name === stream_name && m.stream_type === stream_type,
  );
  if (stream_type && stream_name)
    add({
      type: stream_type,
      name: stream_name,
      firstSeenUs: first_seen_at,
      recoveredUs: lead?.recovered_at ?? null,
      lead: true,
    });
  for (const m of item.members ?? [])
    if (m.stream_type && m.stream_name)
      add({
        type: m.stream_type,
        name: m.stream_name,
        firstSeenUs: m.first_seen_at,
        recoveredUs: m.recovered_at,
        lead: false,
      });
  return out;
};

export const issueLead = (item: AutoObserveIncidentItem): IssueStream | null => {
  const { stream_type, stream_name } = item.finding;
  return stream_type && stream_name ? { type: stream_type, name: stream_name } : null;
};

/** The ksuid's head, like a short commit hash; the full id stays in the title and search. */
export const issueShortId = (id: string) => id.slice(0, 8);

/** When every stream is back, the last one's return; null while any is out or none was recorded. */
export const issueEndUs = (item: AutoObserveIncidentItem): number | null => {
  const streams = issueStreams(item);
  if (!streams.length || streams.some((s) => s.recoveredUs == null)) return null;
  return Math.max(...streams.map((s) => s.recoveredUs as number));
};

/** The chart window every view of one incident shares, so they share one query per stream. */
export const issueItemWindow = (item: AutoObserveIncidentItem, nowMs: number): IssueWindow =>
  issueWindow(
    item.finding.first_seen_at,
    nowMs,
    issueEndUs(item),
    item.incident.status !== "resolved",
  );

export const issueSpan = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
): I18nText => {
  const startMs = usToMs(item.finding.first_seen_at);
  const start = clock(startMs, zone, startMs);
  const endUs = issueEndUs(item);
  if (endUs !== null)
    return t("autoobserve.issues.span", { start, end: clock(usToMs(endUs), zone, startMs) });
  return item.incident.status === "resolved" ? start : t("autoobserve.issues.spanOpen", { start });
};

/** The meta line's parts: span, duration and grouping; who was paged and the analysis render beside them. */
export const issueMeta = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  nowMs: number,
): I18nText[] => {
  const startMs = usToMs(item.finding.first_seen_at);
  const endUs = issueEndUs(item);
  const open = item.incident.status !== "resolved";
  const endMs = endUs !== null ? usToMs(endUs) : open ? nowMs : null;
  const parts: I18nText[] = [issueSpan(t, zone, item)];
  if (endMs !== null)
    parts.push(durationText(zone.locale, Math.max(1, Math.round((endMs - startMs) / 60_000))));
  const streams = issueStreams(item).length;
  if (streams > 1)
    parts.push(t("autoobserve.issueLive.grouped", { count: count(zone.locale, streams) }, streams));
  return parts;
};

/** What the engine saw, in the home card's words; the server's title when the finding is unreadable. */
export const issueCause = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  nowMs: number,
): I18nText => pagedFindingCopy(t, zone, item, nowMs).why ?? findingSentence(t, item);

export const issueNext = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  nowMs: number,
): I18nText =>
  pagedFindingCopy(t, zone, item, nowMs).next ?? t("autoobserve.issueLive.nextResolved");

// Before detection, buckets ahead of the first stored row are a gap: nothing says the stream was quiet then.
export const issueSparkPoints = (series: IssueSeries): AoSparkPoint[] => {
  const known = Math.min(series.firstRowIndex ?? series.detectedIndex, series.detectedIndex);
  return series.points.map((v, i) => ({
    t: series.startMs + i * series.stepMs,
    v: i < known ? null : v,
  }));
};

/** True when no row was stored before detection, so the chart and the comparison have no before. */
export const issueNoRowsBefore = (series: IssueSeries) =>
  series.usual === null && series.detectedIndex > 0;

/** The streams the Logs link opens: every member of the lead's type, lead first. */
export const issueLogStreams = (item: AutoObserveIncidentItem): string[] =>
  issueStreams(item)
    .filter((s) => s.type === item.finding.stream_type)
    .map((s) => s.name);

/** Logs end an hour after the incident ended, or at now while it is still open. */
export const issueLogsEndMs = (endUs: number | null, nowMs: number) =>
  endUs === null ? nowMs : Math.min(nowMs, Math.floor((endUs + PAGED_LEAD_US) / 1000));

/** The detection dot, a dot per stream back, and a live dot at the newest bucket while open. */
export const issueSparkMarkers = (
  t: TranslateFn,
  zone: InsightZone,
  series: IssueSeries,
  stream: IssueStreamInfo | null,
  active: boolean,
): AoSparkMarker[] => {
  const detected = stream
    ? usToMs(stream.firstSeenUs)
    : series.startMs + series.detectedIndex * series.stepMs;
  const markers: AoSparkMarker[] = [];
  // A window past seven days keeps its end, so the detection can fall before its start.
  if (detected >= series.startMs)
    markers.push({
      t: detected,
      kind: "detected",
      label: t("autoobserve.issueLive.spark.detected", { time: clock(detected, zone, detected) }),
    });
  if (stream?.recoveredUs)
    markers.push({
      t: usToMs(stream.recoveredUs),
      kind: "recovered",
      label: t("autoobserve.issueLive.spark.recovered", {
        time: clock(usToMs(stream.recoveredUs), zone, detected),
      }),
    });
  if (active && series.endsNow)
    markers.push({
      t: series.startMs + (series.points.length - 1) * series.stepMs,
      kind: "live",
      label: t("autoobserve.issueLive.spark.live"),
    });
  return markers;
};

export const issueSparkCaption = (t: TranslateFn, locale: string, series: IssueSeries): I18nText =>
  t("autoobserve.issueLive.spark.caption", { peak: count(locale, series.peak) });

export const issueSparkLabel = (
  t: TranslateFn,
  locale: string,
  stream: IssueStream,
  series: IssueSeries,
): I18nText =>
  series.usual === null
    ? t("autoobserve.issueLive.spark.labelNoBefore", {
        stream: raw(stream.name),
        since: count(locale, series.since),
      })
    : t("autoobserve.issueLive.spark.label", {
        stream: raw(stream.name),
        usual: count(locale, series.usual),
        since: count(locale, series.since),
      });

const streamEntries = (
  t: TranslateFn,
  zone: InsightZone,
  streams: IssueStreamInfo[],
  pick: (s: IssueStreamInfo) => number | null,
  keys: { one: I18nKey; many: I18nKey },
  variant: TimelineEntry["variant"],
  dayMs: number,
): TimedEntry[] => {
  const hit = streams.filter((s) => pick(s) !== null);
  if (!hit.length) return [];
  if (hit.length > TIMELINE_GROUP) {
    const first = Math.min(...hit.map((s) => pick(s) as number));
    return [
      {
        us: first,
        entry: {
          at: String(clock(usToMs(first), zone, dayMs)),
          title: t(keys.many, { count: count(zone.locale, hit.length) }, hit.length),
          detail: raw(""),
          variant,
        },
      },
    ];
  }
  return hit.map((s) => ({
    us: pick(s) as number,
    entry: {
      at: String(clock(usToMs(pick(s) as number), zone, dayMs)),
      title: t(keys.one, { stream: raw(s.name) }),
      detail: t("autoobserve.issueLive.streamType", { type: raw(s.type) }),
      variant,
    },
  }));
};

/** Engine and incident events in time order, capped so many events end in "and N more". */
export const issueTimeline = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  events: readonly IncidentEvent[],
): IssueTimelineView => {
  const dayMs = usToMs(item.finding.first_seen_at);
  const streams = issueStreams(item);
  const rows: TimedEntry[] = [];
  const at = (us: number) => String(clock(usToMs(us), zone, dayMs));
  rows.push({
    us: item.finding.first_seen_at,
    entry: {
      at: at(item.finding.first_seen_at),
      title: t("autoobserve.issueLive.timeline.detected"),
      detail: findingSentence(t, item),
      variant: "destructive",
    },
  });
  rows.push(
    ...streamEntries(
      t,
      zone,
      streams.filter((s) => !s.lead),
      (s) => s.firstSeenUs,
      {
        one: "autoobserve.issueLive.timeline.alsoStopped",
        many: "autoobserve.issueLive.timeline.alsoStoppedMany",
      },
      "destructive",
      dayMs,
    ),
    ...streamEntries(
      t,
      zone,
      streams,
      (s) => s.recoveredUs,
      {
        one: "autoobserve.issueLive.timeline.back",
        many: "autoobserve.issueLive.timeline.backMany",
      },
      "success",
      dayMs,
    ),
  );
  for (const event of events) {
    const known = EVENT_ENTRY[event.type];
    if (!known || !event.timestamp) continue;
    const user = event.data?.user_id;
    rows.push({
      us: event.timestamp,
      entry: {
        at: at(event.timestamp),
        title: t(known.key),
        detail: user
          ? t("autoobserve.issueLive.timeline.by", { user: actorName(t, user) })
          : raw(""),
        variant: known.variant,
      },
    });
  }
  rows.sort((a, b) => a.us - b.us);
  const entries = rows.map((r) => r.entry);
  if (item.incident.status !== "resolved")
    entries.push({
      at: String(t("autoobserve.issueLive.timeline.now")),
      title: t("autoobserve.unfold.outcome.open"),
      detail: raw(""),
      variant: "muted",
    });
  return {
    entries: entries.slice(0, TIMELINE_CAP),
    more: Math.max(0, entries.length - TIMELINE_CAP),
  };
};

const minuteOf = (us: number) => Math.floor(us / 60_000_000);

const streamCardId = (s: IssueStream) => `stream:${s.type}/${s.name}`;

const changeCard = (
  t: TranslateFn,
  zone: InsightZone,
  lane: string,
  change: RcaSummarySuspectChange,
  dayMs: number,
): UnfoldCard => ({
  id: "change",
  kind: "change",
  lane,
  at: String(clock(usToMs(change.occurred_at), zone, dayMs)),
  minute: minuteOf(change.occurred_at),
  title: raw(change.reference),
  detail: t("autoobserve.issueLive.unfold.suspected"),
  tag: "autoobserve.unfold.likelyCause",
  tone: "info",
});

const streamCards = (
  t: TranslateFn,
  zone: InsightZone,
  kind: string | null,
  s: IssueStreamInfo,
  dayMs: number,
): UnfoldCard[] => {
  const id = streamCardId(s);
  const cards: UnfoldCard[] = [
    {
      id,
      kind: CARD_KIND[s.type] ?? "log",
      lane: s.name,
      at: String(clock(usToMs(s.firstSeenUs), zone, dayMs)),
      minute: minuteOf(s.firstSeenUs),
      title: t(FINDING_TITLE[kind ?? ""] ?? "alerts.incidents.findingKind.other"),
      detail: t("autoobserve.issueLive.streamType", { type: raw(s.type) }),
      tone: "danger",
    },
  ];
  if (s.recoveredUs !== null)
    cards.push({
      id: `back:${s.type}/${s.name}`,
      kind: "outcome",
      outcome: "resolved",
      lane: s.name,
      at: String(clock(usToMs(s.recoveredUs), zone, dayMs)),
      minute: minuteOf(s.recoveredUs),
      title: t("autoobserve.issueLive.unfold.back"),
      detail: t("autoobserve.issueLive.streamType", { type: raw(s.type) }),
      tone: "success",
      after: id,
    });
  return cards;
};

const alertCards = (
  zone: InsightZone,
  lane: string,
  triggers: readonly IncidentAlert[],
  dayMs: number,
): UnfoldCard[] => {
  const groups = new Map<string, IncidentAlert[]>();
  for (const tr of triggers) {
    if (tr.alert_kind === "autoobserve") continue;
    groups.set(tr.alert_id, [...(groups.get(tr.alert_id) ?? []), tr]);
  }
  return [...groups.entries()].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => a.alert_fired_at - b.alert_fired_at);
    return {
      id: `alert:${id}`,
      kind: "metric",
      lane,
      at: String(clock(usToMs(sorted[0].alert_fired_at), zone, dayMs)),
      minute: minuteOf(sorted[0].alert_fired_at),
      title: raw(sorted[0].alert_name),
      tone: "warning",
      count: sorted.length,
      times: sorted.map((tr) => String(clock(usToMs(tr.alert_fired_at), zone, dayMs))),
    };
  });
};

const teamCards = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  events: readonly IncidentEvent[],
  leadId: string | undefined,
  dayMs: number,
): UnfoldCard[] => {
  const openedMs = usToMs(item.incident.created_at);
  const page = item.page ? PAGE_CARD[item.page.outcome] : undefined;
  // The page goes out as the incident opens, so one card carries both, in the overview's words.
  const cards: UnfoldCard[] = [
    {
      id: "page",
      kind: "outcome",
      outcome: page?.outcome ?? "open",
      lane: null,
      at: String(clock(openedMs, zone, dayMs)),
      minute: minuteOf(item.incident.created_at),
      title: t("autoobserve.issueLive.timeline.opened"),
      detail: pagedFindingCopy(t, zone, item, openedMs).page?.text,
      tone: page?.tone ?? "info",
      after: leadId,
    },
  ];
  for (const event of events) {
    if (!event.timestamp) continue;
    const outcome: UnfoldOutcome | null =
      event.type === "Acknowledged" ? "notified" : event.type === "Resolved" ? "resolved" : null;
    if (!outcome) continue;
    cards.push({
      id: `event:${event.type}:${event.timestamp}`,
      kind: "outcome",
      outcome,
      lane: null,
      at: String(clock(usToMs(event.timestamp), zone, dayMs)),
      minute: minuteOf(event.timestamp),
      title: t(EVENT_ENTRY[event.type].key),
      detail: event.data?.user_id ? actorName(t, event.data.user_id) : undefined,
      tone: outcome === "resolved" ? "success" : "info",
    });
  }
  return cards;
};

const RANK: Record<string, number> = { change: 0, outcome: 2 };

/** Lanes from the streams we have: suspected change, each stream's stop and return, other alerts, then the team. */
export const issueUnfoldCards = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  triggers: readonly IncidentAlert[],
  events: readonly IncidentEvent[],
  change: RcaSummarySuspectChange | null,
): UnfoldCard[] => {
  const dayMs = usToMs(item.finding.first_seen_at);
  const streams = issueStreams(item);
  const lead = streams[0];
  if (!lead) return [];
  const cards = [
    ...(change ? [changeCard(t, zone, lead.name, change, dayMs)] : []),
    ...streams
      .slice(0, UNFOLD_STREAM_CAP)
      .flatMap((s) => streamCards(t, zone, item.finding.kind, s, dayMs)),
    ...alertCards(zone, lead.name, triggers, dayMs),
    ...teamCards(t, zone, item, events, streamCardId(lead), dayMs),
  ];
  // One time order for every lane, so a team card sits in the column of its minute.
  return cards.sort(
    (a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (RANK[a.kind] ?? 1) - (RANK[b.kind] ?? 1),
  );
};

/** The stream a card's chart reads; a card with no stream of its own reads the lead's. */
export const unfoldCardStream = (
  card: UnfoldCard | undefined,
  streams: IssueStreamInfo[],
): IssueStreamInfo | null => {
  const id = card?.id.replace(/^(stream|back):/, "") ?? "";
  return streams.find((s) => `${s.type}/${s.name}` === id) ?? streams[0] ?? null;
};

const meanOf = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

type ComparisonRow = ComparisonRows[number];

export interface ComparedStream {
  stream: IssueStreamInfo;
  series: IssueSeries;
  baseline?: IssueBaseline | null;
}

/** Each stream's usual level (or rows before it), rows while it was out, and rows after the incident ended. */
export const issueComparisonRows = (
  t: TranslateFn,
  locale: string,
  pairs: ComparedStream[],
  endUs: number | null,
): ComparisonRows =>
  pairs.flatMap(({ stream, series, baseline }) => {
    const name = raw(stream.name);
    const bar = (key: I18nKey, value: number | null, kind: ComparisonRow["kind"]) =>
      value === null
        ? []
        : [{ label: t(key, { stream: name }), value, shown: count(locale, value), kind }];
    const index = (us: number) => Math.floor((usToMs(us) - series.startMs) / series.stepMs);
    const back = stream.recoveredUs == null ? null : index(stream.recoveredUs);
    const during = series.points.slice(series.detectedIndex, back ?? undefined);
    // Only buckets after the whole incident ended count as healthy, never a stream's early return.
    const after = endUs === null ? [] : series.points.slice(Math.max(index(endUs) + 1, 0));
    const outMs = {
      from: series.startMs + series.detectedIndex * series.stepMs,
      to:
        back === null
          ? series.startMs + series.points.length * series.stepMs
          : usToMs(stream.recoveredUs as number),
    };
    const usual = baseline ? usualBetween(baseline, outMs.from, outMs.to) : null;
    return [
      ...(usual !== null
        ? bar("autoobserve.issueLive.compare.usual", usual, "healthy")
        : bar("autoobserve.issueLive.compare.before", series.usual, "healthy")),
      ...bar(
        back === null
          ? "autoobserve.issueLive.compare.since"
          : "autoobserve.issueLive.compare.during",
        meanOf(during) ?? 0,
        "affected",
      ),
      ...bar("autoobserve.issueLive.compare.after", meanOf(after), "healthy"),
    ];
  });

/** The compared streams that failed or were denied, named once, so missing bars never pass for complete. */
export const issueComparisonMissing = (
  t: TranslateFn,
  locale: string,
  failed: string[],
  denied: string[],
  usualFailed = false,
): I18nText | null => {
  const list = (names: string[]) =>
    raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(names));
  const parts = [
    failed.length
      ? t("autoobserve.issueLive.compare.partialFailed", { streams: list(failed) }, failed.length)
      : null,
    denied.length
      ? t("autoobserve.issueLive.compare.partialDenied", { streams: list(denied) }, denied.length)
      : null,
    usualFailed ? t("autoobserve.issueLive.compare.usualFailed") : null,
  ].filter((x): x is I18nText => x !== null);
  return parts.length ? raw(parts.map(String).join(" ")) : null;
};

/** The compared streams with no stored row before they started, named once in one list. */
export const issueComparisonNote = (
  t: TranslateFn,
  locale: string,
  pairs: ComparedStream[],
): I18nText | null => {
  const names = pairs
    .filter((p) => !p.baseline?.expected.length && issueNoRowsBefore(p.series))
    .map((p) => p.stream.name);
  if (!names.length) return null;
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  return t("autoobserve.issueLive.compare.noBefore", { streams: raw(list) }, names.length);
};

export const hypothesisVerdict = (status: RcaHypothesisStatus): HypothesisVerdict =>
  VERDICT_OF[status] ?? "open";
