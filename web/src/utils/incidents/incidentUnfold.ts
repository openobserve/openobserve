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
import type {
  Incident,
  IncidentAlert,
  IncidentAlertDefinition,
  IncidentTopology,
} from "@/services/incidents";
import type {
  UnfoldCard,
  UnfoldFoldedCard,
  UnfoldHistogram,
  UnfoldTone,
} from "@/components/autoobserve/unfold.types";
import { getIntlLocale } from "@/locales";
import { formatTimestampInTimezone } from "@/utils/date";
import { resolveBrowserTimezone } from "@/utils/timezone";
import { getCronIntervalInMinutes } from "@/utils/queryUtils";
import { isErrorOutcome } from "@/utils/alerts/runOutcome";
import { isFiringNow } from "@/utils/alerts/firingAlerts";
import { userLocalPart } from "./rcaCell";

/** Alerts in different lanes that start this many minutes apart share a column. */
export const COLUMN_MINUTES = 5;

const MINUTE_US = 60_000_000;
const DAY_US = 24 * 60 * MINUTE_US;
const LONG_RUNNING_MINUTES = 120;
const LIVE_CHECKS = 2;
const STRIP_BUCKET_MINUTES = 15;
const STRIP_MINUTES = 24 * 60;
const CHIP_LIMIT = 8;
const FOLD_ABOVE = 12;
const FOLD_KEEP = 2;
const LANE_LIMIT = 8;
const LIST_NAMES = 5;
const HISTOGRAM_BUCKETS = 192;
const HISTOGRAM_BUCKET_SIZES: { minutes: number; label: I18nKey }[] = [
  { minutes: 15, label: "alerts.incidents.unfold.bucket.minutes15" },
  { minutes: 30, label: "alerts.incidents.unfold.bucket.minutes30" },
  { minutes: 60, label: "alerts.incidents.unfold.bucket.hour" },
  { minutes: 180, label: "alerts.incidents.unfold.bucket.hours3" },
  { minutes: 360, label: "alerts.incidents.unfold.bucket.hours6" },
  { minutes: 24 * 60, label: "alerts.incidents.unfold.bucket.day" },
];

export interface IncidentUnfoldInput {
  status: Incident["status"];
  /** Timestamps are microseconds, as the incident API sends them. */
  firstAlertAt: number;
  resolvedAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  triggers: (Pick<IncidentAlert, "alert_id" | "alert_name" | "alert_fired_at"> &
    Partial<Pick<IncidentAlert, "correlation_reason" | "alert_kind" | "source_url">>)[];
  alerts?: IncidentAlertDefinition[];
  topology?: IncidentTopology | null;
  now: number;
  /** The alert the analysis's root cause names; none names one today. */
  causeAlertId?: string;
  /** The alert list's rows, for each alert's state now. */
  alertRows?: IncidentAlertRow[];
  /** The incident's events; unset while they load. */
  events?: IncidentEventLike[];
  /** Lanes the viewer unfolded; they keep every alert. */
  expandedLanes?: readonly string[];
  /** Number and list formatting; the app's locale when unset. */
  locale?: string;
  /** The app's configured IANA time zone; the browser's when unset. */
  timezone?: string;
}

/** The alert list's fields this page reads; times are microseconds. */
export interface IncidentAlertRow {
  alert_id: string;
  enabled?: boolean;
  last_outcome?: string | null;
  last_outcome_since?: number | null;
  last_satisfied_at?: number | null;
  firing_started_at?: number | null;
  groups_firing?: number | null;
  folder_id?: string;
  folder_name?: string;
  trigger_condition?: {
    frequency?: number;
    frequency_type?: string;
    cron?: string;
    silence?: number;
  } | null;
  is_real_time?: boolean;
}

export interface IncidentEventLike {
  timestamp: number;
  type: string;
  data?: { user_id?: string | null } | null;
}

export type AlertLiveKind = "firing" | "quiet" | "error" | "disabled";

export interface AlertLiveState {
  state: AlertLiveKind;
  firing: boolean;
}

/** How many of the incident's alerts fire now; `unknown` counts alerts the list lacks or can't run. */
export interface IncidentLive {
  firing: number;
  quiet: number;
  unknown: number;
  total: number;
  /** The incident's own latest firing, microseconds. */
  lastFiring?: number;
}

/** One alert of the incident, as the side panel reads it. */
export interface IncidentAlertSummary {
  alertKind?: IncidentAlert["alert_kind"];
  sourceUrl?: string | null;
  alertId: string;
  name: string;
  tone: UnfoldTone;
  tag?: I18nKey;
  count: number;
  first: number;
  last: number;
  /** Fire times in the app zone, dated when not today, up to 8 firings. */
  times?: string[];
  medianInterval?: number;
  longestGap?: number;
  histogram?: UnfoldHistogram;
  groupedBy?: I18nText;
}

export interface IncidentUnfold {
  cards: UnfoldCard[];
  /** Keyed by card id. */
  alerts: Record<string, IncidentAlertSummary>;
  /** Total firings, locale formatted. */
  firings: string;
  firingCount: number;
  alertCount: number;
  /** First to last firing, or null within one minute. */
  span: I18nText | null;
}

interface AlertRun {
  alertKind?: IncidentAlert["alert_kind"];
  sourceUrl?: string | null;
  id: string;
  name: string;
  /** Distinct firing times; one evaluation can write several trigger rows. */
  times: number[];
  lane: string;
  /** The alert's first topology node, which orders same-time firings as the backend does. */
  node: number;
  reason?: IncidentAlert["correlation_reason"];
}

interface Clock {
  start: number;
  end: number;
  lastFiring: number;
  open: boolean;
  longRunning: boolean;
  zone: string;
  now: number;
}

/** Folding every service past the lane limit; expanding it keeps this key as the count changes. */
export const MORE_SERVICES_KEY = "fold-services";

/** The app's configured IANA zone, else the browser's. */
export const incidentZone = (timezone?: string) =>
  resolveBrowserTimezone(timezone ?? "") ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  "UTC";
const dateTime = (zone: string, us: number, format = "MMM D, HH:mm:ss") =>
  formatTimestampInTimezone(us, format, zone);
/** "HH:mm", dated when it falls on a later day than `since`. */
const clock = (zone: string, us: number, since = us) => {
  const sameDay = dateTime(zone, us, "YYYY-MM-DD") === dateTime(zone, since, "YYYY-MM-DD");
  return dateTime(zone, us, sameDay ? "HH:mm" : "MMM D, HH:mm");
};
const minuteOf = (us: number) => Math.floor(us / MINUTE_US);
/** "HH:mm" today, else "MMM D, HH:mm". */
export const incidentTime = (zone: string, us: number, now: number) => clock(zone, us, now);

// Spreading a data array into Math.max/min throws RangeError past ~100,000 items.
export const maxOf = (values: readonly number[], initial = -Infinity) =>
  values.reduce((max, value) => (value > max ? value : max), initial);
export const minOf = (values: readonly number[], initial = Infinity) =>
  values.reduce((min, value) => (value < min ? value : min), initial);

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const intervalsOf = (times: number[]) => times.slice(1).map((at, i) => at - times[i]);

/** "45 s", "25 min", "3 h 5 min" or "2 d 4 h", from microseconds. */
export function unfoldDuration(t: TranslateFn, us: number): I18nText {
  const seconds = Math.max(0, Math.round(us / 1_000_000));
  if (seconds < 60) return t("alerts.incidents.unfold.duration.seconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("alerts.incidents.unfold.duration.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest
      ? t("alerts.incidents.unfold.duration.hoursMinutes", { hours, minutes: rest })
      : t("alerts.incidents.unfold.duration.hours", { hours });
  }
  const rest = hours % 24;
  const days = Math.floor(hours / 24);
  return rest
    ? t("alerts.incidents.unfold.duration.daysHours", { days, hours: rest })
    : t("alerts.incidents.unfold.duration.days", { days });
}

// Service discovery reports "unknown" when it found none; that lane falls back to the stream.
const isNamedService = (service: string) => !!service.trim() && service.trim() !== "unknown";

const laneOf = (
  t: TranslateFn,
  trigger: IncidentUnfoldInput["triggers"][number],
  input: IncidentUnfoldInput,
): string => {
  const node = input.topology?.nodes.find(
    (n) => n.alert_id === trigger.alert_id && isNamedService(n.service_name),
  );
  // The display name is the unified service identity, so keys that resolve to one service share its lane.
  if (node) return node.display_name?.trim() || node.service_name.trim();
  // Names repeat across streams: the id decides, and a name stands in only when one definition has it.
  const named = input.alerts?.filter((a) => a.name === trigger.alert_name) ?? [];
  const definition =
    input.alerts?.find((a) => a.id && a.id === trigger.alert_id) ??
    (named.length === 1 ? named[0] : undefined);
  return definition?.stream_name
    ? t("alerts.incidents.unfold.streamLane", { stream: definition.stream_name })
    : t("alerts.incidents.unfold.noService");
};

const nodeOf = (alertId: string, topology?: IncidentTopology | null) => {
  const index = topology?.nodes.findIndex((n) => n.alert_id === alertId) ?? -1;
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};

const runsOf = (t: TranslateFn, input: IncidentUnfoldInput): AlertRun[] => {
  const byId = new Map<string, AlertRun & { seen: Set<number> }>();
  for (const trigger of input.triggers) {
    const run = byId.get(trigger.alert_id);
    if (run) run.seen.add(trigger.alert_fired_at);
    else
      byId.set(trigger.alert_id, {
        id: trigger.alert_id,
        alertKind: trigger.alert_kind,
        sourceUrl: trigger.source_url,
        name: trigger.alert_name,
        times: [],
        seen: new Set([trigger.alert_fired_at]),
        node: nodeOf(trigger.alert_id, input.topology),
        lane: laneOf(t, trigger, input),
        reason: trigger.correlation_reason,
      });
  }
  const runs = [...byId.values()].map(({ seen, ...run }) => ({
    ...run,
    times: [...seen].sort((a, b) => a - b),
  }));
  return runs.sort(
    (a, b) => a.times[0] - b.times[0] || a.node - b.node || a.name.localeCompare(b.name),
  );
};

const clockOf = (input: IncidentUnfoldInput, runs: AlertRun[]): Clock => {
  const open = input.status !== "resolved";
  const lastFiring = maxOf(runs.map((r) => r.times[r.times.length - 1]));
  const start = minOf(
    runs.map((r) => r.times[0]),
    input.firstAlertAt,
  );
  const end = open ? input.now : (input.resolvedAt ?? lastFiring);
  return {
    start,
    end,
    lastFiring,
    open,
    longRunning: end - start >= LONG_RUNNING_MINUTES * MINUTE_US,
    zone: incidentZone(input.timezone),
    now: input.now,
  };
};

const bucketsOf = (times: number[], from: number, to: number, minutes = STRIP_BUCKET_MINUTES) => {
  const size = minutes * MINUTE_US;
  const counts = Array.from({ length: Math.max(1, Math.ceil((to - from) / size)) }, () => 0);
  for (const at of times) {
    if (at < from) continue;
    counts[Math.min(counts.length - 1, Math.floor((at - from) / size))] += 1;
  }
  return counts;
};

const histogramBucket = (time: Clock) =>
  HISTOGRAM_BUCKET_SIZES.find(
    (b) => Math.ceil((time.end - time.start) / (b.minutes * MINUTE_US)) <= HISTOGRAM_BUCKETS,
  ) ?? HISTOGRAM_BUCKET_SIZES[HISTOGRAM_BUCKET_SIZES.length - 1];

const histogramOf = (t: TranslateFn, run: AlertRun, time: Clock): UnfoldHistogram => {
  const bucket = histogramBucket(time);
  const { zone } = time;
  const to = time.open
    ? t("alerts.incidents.unfold.nowAt", { time: dateTime(zone, time.end, "MMM D, HH:mm") })
    : raw(dateTime(zone, time.end, "MMM D, HH:mm"));
  // A range of days or more reads by date; a shorter one by time, dated when not today.
  const byDate = time.end - time.start >= 4 * DAY_US;
  const tick = (us: number) =>
    byDate ? dateTime(zone, us, "MMM D") : incidentTime(zone, us, time.now);
  return {
    points: bucketsOf(run.times, time.start, time.end, bucket.minutes),
    caption: t("alerts.incidents.unfold.histogramCaption", {
      bucket: t(bucket.label),
      from: dateTime(zone, time.start, "MMM D, HH:mm"),
      to,
    }),
    ticks: [
      raw(tick(time.start)),
      time.open
        ? t("alerts.incidents.unfold.nowAt", { time: tick(time.end) })
        : raw(tick(time.end)),
    ],
  };
};

const GROUPED_BY: Partial<Record<IncidentAlert["correlation_reason"], I18nKey>> = {
  alert_id: "alerts.incidents.unfold.grouped.sameAlert",
  service_discovery: "alerts.incidents.unfold.grouped.sameService",
  primary_match: "alerts.incidents.unfold.grouped.sameLabels",
  secondary_match: "alerts.incidents.unfold.grouped.relatedLabels",
};

// The range's end drops what its start already says: a same-day end is a time, a past day a date.
const untilOf = (run: AlertRun, time: Clock) => {
  const last = run.times[run.times.length - 1];
  if (run.times.length === 1) return undefined;
  const day = (us: number) => dateTime(time.zone, us, "YYYY-MM-DD");
  const sameDay = day(last) === day(run.times[0]) || day(last) === day(time.now);
  return dateTime(time.zone, last, sameDay ? "HH:mm" : "MMM D");
};

/** Minutes between checks; a cron alert's from its schedule, else its frequency. */
const checkMinutes = (row: IncidentAlertRow) => {
  const trigger = row.trigger_condition;
  if (row.is_real_time) return 1;
  if (trigger?.frequency_type === "cron" && trigger.cron) {
    try {
      return Math.max(1, getCronIntervalInMinutes(trigger.cron));
    } catch {
      return Math.max(1, trigger.frequency ?? 1);
    }
  }
  return Math.max(1, trigger?.frequency ?? 1);
};

/** Firing now by the alert list's own rule; with no outcome recorded, by 2 checks plus the silence. */
export function alertLiveState(row: IncidentAlertRow, now: number): AlertLiveState {
  if (row.enabled === false) return { state: "disabled", firing: false };
  if (isFiringNow(row)) return { state: "firing", firing: true };
  if (isErrorOutcome(row.last_outcome)) return { state: "error", firing: false };
  const last = row.last_satisfied_at ?? undefined;
  const silence = Math.max(0, row.trigger_condition?.silence ?? 0);
  const window = (LIVE_CHECKS * checkMinutes(row) + silence) * MINUTE_US;
  const firing = !row.last_outcome && last !== undefined && now - last <= window;
  return firing ? { state: "firing", firing } : { state: "quiet", firing };
}

/** The alert list's rows; null when their run state could not be read, since blank is not quiet. */
export const liveRowsOf = <Row extends IncidentAlertRow>(
  page: { list: Row[]; status_unavailable?: boolean } | null | undefined,
) => (page && !page.status_unavailable ? page.list : null);

/** The incident's alerts now; a missing or failing one is unknown. Null with no alert or no rows. */
export function incidentLiveSummary(
  alertIds: readonly string[],
  rows: readonly IncidentAlertRow[] | null,
  now: number,
  lastFiring?: number,
): IncidentLive | null {
  if (!rows || !alertIds.length) return null;
  const live: IncidentLive = { firing: 0, quiet: 0, unknown: 0, total: alertIds.length };
  for (const id of alertIds) {
    const row = rows.find((r) => r.alert_id === id);
    const state = row ? alertLiveState(row, now).state : "error";
    if (state === "firing") live.firing += 1;
    else if (state === "error") live.unknown += 1;
    else live.quiet += 1;
  }
  return lastFiring === undefined ? live : { ...live, lastFiring };
}

/** One sentence for the header chip and the facts row; null when no alert's state is known. */
export function incidentLiveWords(t: TranslateFn, live: IncidentLive, locale: string) {
  const n = (count: number) => count.toLocaleString(locale);
  if (live.firing > 0) {
    return {
      firing: true,
      label: t(
        "alerts.incidents.liveFiring",
        { firing: n(live.firing), total: n(live.total) },
        live.total,
      ),
    };
  }
  if (!live.unknown) return { firing: false, label: t("alerts.incidents.liveQuiet") };
  if (!live.quiet) return null;
  return {
    firing: false,
    label: t(
      "alerts.incidents.liveQuietSome",
      { quiet: n(live.quiet), total: n(live.total) },
      live.total,
    ),
  };
}

/** Distinct firings and alerts; one evaluation can write several trigger rows. */
export function incidentFiringCounts(triggers: IncidentUnfoldInput["triggers"]) {
  const firings = new Set(triggers.map((tr) => `${tr.alert_id}@${tr.alert_fired_at}`));
  return { firings: firings.size, alerts: new Set(triggers.map((tr) => tr.alert_id)).size };
}

const LIVE_WORDS: Record<AlertLiveKind, { label: I18nKey; tone: UnfoldTone; tooltip: I18nKey }> = {
  firing: {
    label: "alerts.incidents.unfold.firingNow",
    tone: "warning",
    tooltip: "alerts.incidents.unfold.liveRule",
  },
  quiet: {
    label: "alerts.incidents.unfold.quietNow",
    tone: "neutral",
    tooltip: "alerts.incidents.unfold.liveRule",
  },
  error: {
    label: "alerts.incidents.unfold.cantRun",
    tone: "danger",
    tooltip: "alerts.incidents.unfold.cantRunWhy",
  },
  disabled: {
    label: "alerts.incidents.unfold.disabled",
    tone: "neutral",
    tooltip: "alerts.incidents.unfold.disabledWhy",
  },
};

/** The alert's state now in words, its tone and why; one rule for card, panel and header. */
export function alertLiveWords(t: TranslateFn, state: AlertLiveState) {
  const words = LIVE_WORDS[state.state];
  return {
    firing: state.firing,
    state: state.state,
    tone: words.tone,
    label: t(words.label),
    tooltip: t(words.tooltip),
  };
}

// A resolved incident's cards carry no live state: the alert's state today is not the incident's.
const liveOf = (t: TranslateFn, run: AlertRun, input: IncidentUnfoldInput) => {
  if (input.status === "resolved") return undefined;
  const row = input.alertRows?.find((r) => r.alert_id === run.id);
  return row ? alertLiveWords(t, alertLiveState(row, input.now)) : undefined;
};

// The latest topology edge into an alert that fired before it; a service dependency draws dashed.
const linkOf = (run: AlertRun, runs: AlertRun[], topology?: IncidentTopology | null) => {
  if (!topology) return {};
  const sources = topology.edges
    .filter((e) => topology.nodes[e.to_node_index]?.alert_id === run.id)
    .map((e) => ({
      run: runs.find((r) => r.id === topology.nodes[e.from_node_index]?.alert_id),
      dependency: e.edge_type === "service_dependency",
    }))
    .filter((s): s is { run: AlertRun; dependency: boolean } => {
      const source = s.run;
      return !!source && source.id !== run.id && runs.indexOf(source) < runs.indexOf(run);
    })
    .sort((a, b) => b.run.times[0] - a.run.times[0]);
  return sources[0]
    ? { after: `alert-${sources[0].run.id}`, dependency: sources[0].dependency }
    : {};
};

// Every alert shares one tone; amber means firing now, and red only when the analysis names it.
const toneOf = (
  run: AlertRun,
  index: number,
  context: { runs: AlertRun[]; input: IncidentUnfoldInput; firing: boolean },
) => {
  if (run.id === context.input.causeAlertId) {
    return { tone: "danger" as const, tag: "autoobserve.unfold.likelyCause" as const };
  }
  return {
    tone: context.firing ? ("warning" as const) : ("info" as const),
    tag:
      index === 0 && context.runs.length > 1
        ? ("alerts.incidents.unfold.firstToFire" as const)
        : undefined,
  };
};

const summaryOf = (
  t: TranslateFn,
  run: AlertRun,
  card: Pick<UnfoldCard, "tone" | "tag">,
  time: Clock,
): IncidentAlertSummary => {
  const count = run.times.length;
  const intervals = intervalsOf(run.times);
  const reason = run.reason && GROUPED_BY[run.reason];
  return {
    alertId: run.id,
    alertKind: run.alertKind,
    sourceUrl: run.sourceUrl,
    name: run.name,
    tone: card.tone,
    tag: card.tag,
    count,
    first: run.times[0],
    last: run.times[count - 1],
    times:
      count <= CHIP_LIMIT
        ? run.times.map((at) => incidentTime(time.zone, at, time.now))
        : undefined,
    ...(count > 1 && { medianInterval: median(intervals), longestGap: maxOf(intervals) }),
    ...(count > CHIP_LIMIT && { histogram: histogramOf(t, run, time) }),
    groupedBy: reason ? t(reason) : undefined,
  };
};

const alertCard = (
  t: TranslateFn,
  run: AlertRun,
  index: number,
  context: { runs: AlertRun[]; time: Clock; input: IncidentUnfoldInput },
): UnfoldCard => {
  const { time, input } = context;
  const count = run.times.length;
  // A closed incident's strip ends at its last firing, so a late resolve never leaves it empty.
  const stripEnd = time.open ? time.end : time.lastFiring;
  const strip =
    time.longRunning && count > 1
      ? bucketsOf(run.times, Math.max(time.start, stripEnd - STRIP_MINUTES * MINUTE_US), stripEnd)
      : undefined;
  const live = liveOf(t, run, input);
  return {
    id: `alert-${run.id}`,
    kind: "alert",
    lane: run.lane,
    at: incidentTime(time.zone, run.times[0], time.now),
    until: untilOf(run, time),
    minute: minuteOf(run.times[0]),
    title: raw(run.name),
    detail: count === 1 ? t("alerts.incidents.unfold.firedOnce") : undefined,
    ...toneOf(run, index, { runs: context.runs, input, firing: !!live?.firing }),
    count: count > 1 ? count : undefined,
    live,
    strip,
    ...linkOf(run, context.runs, input.topology),
  };
};

/** "a, b, c, d, e, and 3 more", in the viewer's locale. */
const nameList = (t: TranslateFn, names: string[], locale: string) => {
  const shown = names.length > LIST_NAMES + 1 ? names.slice(0, LIST_NAMES) : names;
  const rest = names.length - shown.length;
  const items = rest
    ? [...shown, t("alerts.incidents.unfold.andMore", { count: rest.toLocaleString(locale) })]
    : shown;
  return raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(items));
};

interface Fold {
  id: string;
  lane: string;
  after?: string;
  folded: UnfoldCard[];
  /** What the fold card lists; its folded cards when unset. */
  items?: UnfoldFoldedCard[];
  /** Set for the services fold, whose card names services rather than alerts. */
  services?: boolean;
}

const foldCard = (t: TranslateFn, fold: Fold, locale: string): UnfoldCard => {
  const { folded } = fold;
  const first = folded[0];
  const lastAt = folded[folded.length - 1].at;
  const total = folded.reduce((sum, card) => sum + (card.count ?? 1), 0);
  const items =
    fold.items ?? folded.map((c) => ({ id: c.id, title: c.title, at: c.at, count: c.count ?? 1 }));
  return {
    id: fold.id,
    kind: "fold",
    lane: fold.lane,
    at: first.at === lastAt ? first.at : `${first.at}–${lastAt}`,
    minute: first.minute,
    title: fold.services
      ? t("alerts.incidents.unfold.moreServices", { count: items.length }, items.length)
      : t("alerts.incidents.unfold.moreAlerts", { count: folded.length }, folded.length),
    detail: nameList(
      t,
      items.map((item) => item.title),
      locale,
    ),
    tone: "info",
    count: total,
    after: fold.after,
    facts: [
      {
        key: "count",
        label: t("autoobserve.unfold.firings"),
        value: raw(total.toLocaleString(locale)),
      },
    ],
    folded: items,
    ...(fold.services && {
      expandKey: MORE_SERVICES_KEY,
      expandLabel: t("alerts.incidents.unfold.showEveryService"),
    }),
  };
};

// Replaces each fold's cards by its fold card; a link into a folded card ends on the fold instead.
const applyFolds = (t: TranslateFn, cards: UnfoldCard[], folds: Fold[], locale: string) => {
  if (!folds.length) return cards;
  const replaced = new Map<string, string>();
  folds.forEach((f) => f.folded.forEach((c) => replaced.set(c.id, f.id)));
  const remap = (card: UnfoldCard) =>
    card.after && replaced.has(card.after) ? { ...card, after: replaced.get(card.after) } : card;
  return [...cards.filter((c) => !replaced.has(c.id)), ...folds.map((f) => foldCard(t, f, locale))]
    .map(remap)
    .filter((c) => c.after !== c.id)
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
};

// The graph places cards in order, so a card must come after the card it links from.
const parentsFirst = (cards: UnfoldCard[]) => {
  const ids = new Set(cards.map((c) => c.id));
  const done = new Set<string>();
  const waiting = new Map<string, UnfoldCard[]>();
  const ordered: UnfoldCard[] = [];
  const add = (card: UnfoldCard) => {
    ordered.push(card);
    done.add(card.id);
    const children = waiting.get(card.id) ?? [];
    waiting.delete(card.id);
    children.forEach(add);
  };
  for (const card of cards) {
    if (card.after && ids.has(card.after) && !done.has(card.after)) {
      waiting.set(card.after, [...(waiting.get(card.after) ?? []), card]);
    } else add(card);
  }
  return [...ordered, ...[...waiting.values()].flat()];
};

const serviceLanes = (cards: UnfoldCard[]) =>
  [...new Set(cards.map((c) => c.lane))].filter((lane): lane is string => lane !== null);

/** The lane that stands for the services past the lane limit. */
const moreServicesLane = (t: TranslateFn, hidden: number) =>
  t("alerts.incidents.unfold.moreServices", { count: hidden }, hidden);

// Past 8 services, the 7 that fired first keep their lanes and one dashed lane lists the rest.
const foldServices = (
  t: TranslateFn,
  cards: UnfoldCard[],
  expanded: readonly string[],
  locale: string,
) => {
  const lanes = serviceLanes(cards);
  if (lanes.length <= LANE_LIMIT) return cards;
  const hidden = lanes.slice(LANE_LIMIT - 1);
  if (expanded.includes(MORE_SERVICES_KEY)) return cards;
  const lane = moreServicesLane(t, hidden.length);
  const folded = cards.filter((c) => c.lane !== null && hidden.includes(c.lane));
  const items = hidden.map((service) => {
    const inLane = folded.filter((c) => c.lane === service);
    return {
      id: inLane[0].id,
      title: raw(service),
      at: inLane[0].at,
      count: inLane.reduce((sum, c) => sum + (c.count ?? 1), 0),
    };
  });
  const before = cards.filter(
    (c) => !folded.includes(c) && (c.minute ?? 0) <= (folded[0].minute ?? 0),
  );
  const fold = {
    id: MORE_SERVICES_KEY,
    lane,
    after: before[before.length - 1]?.id,
    folded,
    items,
    services: true,
  };
  return applyFolds(t, cards, [fold], locale);
};

// Above the limit, each lane keeps its first alerts and one dashed card stands for the rest.
const foldLanes = (
  t: TranslateFn,
  cards: UnfoldCard[],
  expanded: readonly string[],
  locale: string,
) => {
  if (cards.length <= FOLD_ABOVE) return cards;
  const folds: Fold[] = [];
  for (const lane of serviceLanes(cards)) {
    if (expanded.includes(lane)) continue;
    const inLane = cards.filter((c) => c.lane === lane && c.kind === "alert");
    if (inLane.length - FOLD_KEEP < 2) continue;
    folds.push({
      id: `fold-${lane}`,
      lane,
      after: inLane[FOLD_KEEP - 1].id,
      folded: inLane.slice(FOLD_KEEP),
    });
  }
  return applyFolds(t, cards, folds, locale);
};

/** Each card's exact time; a fold takes its first folded card's. Minutes only lay cards out. */
const exactTimes = (cards: UnfoldCard[], runs: AlertRun[]) => {
  const times = new Map(runs.map((run) => [`alert-${run.id}`, run.times[0]]));
  for (const card of cards.filter((c) => c.kind === "fold")) {
    times.set(card.id, minOf((card.folded ?? []).map((item) => times.get(item.id) ?? Infinity)));
  }
  return times;
};

const alertBefore = (cards: UnfoldCard[], at: number, times: Map<string, number>) => {
  const time = (c: UnfoldCard) => times.get(c.id) ?? 0;
  const latest = cards
    .filter((c) => time(c) <= at)
    .reduce<UnfoldCard | undefined>((a, c) => (!a || time(c) >= time(a) ? c : a), undefined);
  return (latest ?? cards[0])?.id;
};

const lastEvent = (events: IncidentEventLike[] | undefined, type: string) =>
  events?.filter((e) => e.type === type).at(-1);

// Who acted comes from the events; until they load, a resolve names nobody rather than "No user".
const byLine = (t: TranslateFn, user: string | null | undefined, known: boolean) => {
  if (user) return t("alerts.incidents.unfold.by", { user: userLocalPart(user) });
  return known ? t("alerts.incidents.unfold.noUser") : undefined;
};

const teamCards = (
  t: TranslateFn,
  input: IncidentUnfoldInput,
  alerts: UnfoldCard[],
  time: Clock,
  times: Map<string, number>,
): UnfoldCard[] => {
  const cards: UnfoldCard[] = [];
  const ackEvent = lastEvent(input.events, "Acknowledged");
  const ackAt = ackEvent?.timestamp ?? input.acknowledgedAt;
  if (ackAt) {
    times.set("team-acknowledged", ackAt);
    cards.push({
      id: "team-acknowledged",
      kind: "outcome",
      outcome: "acknowledged",
      lane: null,
      at: incidentTime(time.zone, ackAt, time.now),
      minute: minuteOf(ackAt),
      title: t("alerts.incidents.unfold.acknowledged"),
      detail: ackEvent
        ? byLine(t, ackEvent.data?.user_id, true)
        : byLine(t, input.acknowledgedBy, input.events !== undefined),
      tone: "team",
      after: alertBefore(alerts, ackAt, times),
    });
  }
  const resolveEvent = lastEvent(input.events, "Resolved");
  const resolvedAt = resolveEvent?.timestamp ?? input.resolvedAt;
  if (!time.open && resolvedAt) {
    times.set("team-resolved", resolvedAt);
    cards.push({
      id: "team-resolved",
      kind: "outcome",
      outcome: "resolved",
      lane: null,
      at: incidentTime(time.zone, resolvedAt, time.now),
      minute: minuteOf(resolvedAt),
      title: t("autoobserve.unfold.outcome.resolved"),
      detail: byLine(t, resolveEvent?.data?.user_id, input.events !== undefined),
      tone: "success",
      after: alertBefore(alerts, resolvedAt, times),
    });
  }
  if (time.open) {
    times.set("team-open", input.now);
    cards.push({
      id: "team-open",
      kind: "outcome",
      outcome: "open",
      lane: null,
      at: t("alerts.incidents.unfold.now"),
      minute: minuteOf(input.now),
      title: t("alerts.incidents.unfold.open"),
      detail: ackAt
        ? t("alerts.incidents.unfold.openSince", {
            time: incidentTime(time.zone, time.start, time.now),
          })
        : t("alerts.incidents.unfold.notAcknowledged"),
      tone: "team",
      after: alertBefore(alerts, input.now, times),
    });
  }
  return cards;
};

/** The incident as AutoObserve "How it unfolded" cards: one per alert, then your team's lane. */
export function incidentUnfold(input: IncidentUnfoldInput, t: TranslateFn): IncidentUnfold {
  const locale = input.locale ?? getIntlLocale();
  const runs = runsOf(t, input);
  const firingCount = runs.reduce((sum, run) => sum + run.times.length, 0);
  if (!runs.length) {
    return {
      cards: [],
      alerts: {},
      firings: "0",
      firingCount: 0,
      alertCount: 0,
      span: null,
    };
  }
  const time = clockOf(input, runs);
  const alerts = runs.map((run, i) => alertCard(t, run, i, { runs, time, input }));
  const summaries = Object.fromEntries(
    runs.map((run, i) => [alerts[i].id, summaryOf(t, run, alerts[i], time)]),
  );
  const expanded = input.expandedLanes ?? [];
  const shown = foldLanes(t, foldServices(t, alerts, expanded, locale), expanded, locale);
  const times = exactTimes(shown, runs);
  const team = teamCards(t, input, shown, time, times);
  const exact = (c: UnfoldCard) => times.get(c.id) ?? 0;
  const cards = parentsFirst(
    [...shown, ...team].sort(
      (a, b) => exact(a) - exact(b) || Number(a.lane === null) - Number(b.lane === null),
    ),
  );
  const first = runs[0].times[0];
  const last = maxOf(runs.map((r) => r.times[r.times.length - 1]));
  return {
    cards,
    alerts: summaries,
    firings: firingCount.toLocaleString(locale),
    firingCount,
    alertCount: runs.length,
    span: last - first >= MINUTE_US ? unfoldDuration(t, last - first) : null,
  };
}
