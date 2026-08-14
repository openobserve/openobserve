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

/**
 * The metric-family model.
 *
 * OpenObserve ingestion writes Prometheus/OTLP metadata (help, unit, type) to
 * the *base* family stream, while histogram/summary records go to the derived
 * `X_bucket` / `X_sum` / `X_count` streams. The derived streams therefore
 * usually carry only fallback metadata — `help` equal to their own name, an
 * empty `unit`, and a type coerced to `counter` (src/service/stream.rs:198) —
 * while the rich metadata sits on a base stream that may itself hold no data
 * at all.
 *
 * So the explorer joins family metadata to sub-streams client-side: group the
 * flat stream list into OpenMetrics families, propagate the family's help/unit/
 * type onto each member, and suppress the metadata-only "phantom" base streams
 * that would otherwise render as empty cards.
 *
 * Cards stay one-per-stream. The family model governs metadata joining, card
 * kind assignment and phantom suppression — not card merging.
 */

import {
  CARD_KIND,
  baseNameOf,
  familySuffixOf,
  getMetricDefaults,
  resolveCardKind,
  TYPE_FILTER_BUCKET,
} from "./metricDefaults";

/** A metrics stream as it arrives from `GET /api/{org}/streams?type=metrics`. */
export interface MetricStream {
  name: string;
  stream_type?: string;
  metrics_meta?: {
    metric_type?: string;
    metric_family_name?: string;
    help?: string;
    unit?: string;
  };
  stats?: { doc_num?: number };
  /** Present only on a `fetchSchema=true` load. */
  schema?: Array<{ name: string; type: string }>;
}

/** The OpenMetrics member slots a family can fill. */
export interface FamilyMembers {
  base?: string;
  total?: string;
  created?: string;
  info?: string;
  bucket?: string;
  sum?: string;
  count?: string;
  gsum?: string;
  gcount?: string;
}

export interface MetricFamily {
  familyName: string;
  /** The family's declared metric type, lowercased. `""` when unknown. */
  familyType: string;
  /** Whether the family's metadata came from ingestion or the backend fallback. */
  metadataSource: "authoritative" | "fallback";
  help: string;
  /** The family's declared unit. Propagated only where semantically valid. */
  unit: string;
  members: FamilyMembers;
  perMemberHasData: Record<string, boolean>;
  /** Filled by the deferred `fetchSchema=true` load; absent on the landing path. */
  perMemberLabels?: Record<string, string[]>;
}

/** One card in the grid. Queries are resolved separately, per filter state. */
export interface MetricCard {
  name: string;
  familyName: string;
  familyType: string;
  cardKind: string;
  typeFilterBucket: string;
  /** Family help text, or "" when it merely repeats the metric name. */
  help: string;
  /** Family unit, already filtered for semantic validity by the rule set. */
  unit: string;
  /**
   * The RAW declared unit the family join resolved (`s`, `By`, `Cel`, …) — not the
   * canonical id in `unit`. Carried so a caller re-deriving the rule set for this
   * metric can hand back the same input `buildMetricCards` used; passing the
   * canonical id instead would either fail the alias lookup (silently falling back
   * to name inference) or, for a counter, re-rate an already-rated unit.
   */
  declaredUnit: string;
  hasData: boolean;
  unsupported: boolean;
  configurable: boolean;
  footerLabel: string;
  chartType: string;
  labels?: string[];
}

/** Non-schema fields OpenObserve adds to every record; never user labels. */
const INTERNAL_FIELDS = new Set([
  "_timestamp",
  "value",
  "__hash__",
  "exemplars",
  "aggregation_temporality",
  "is_monotonic",
  "start_time",
  "flag",
]);

const lower = (v?: string) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * The backend's fallback metadata sets `help` to the stream's own name and
 * leaves `unit` empty. Anything richer than that came from a real exporter.
 */
function isAuthoritative(stream: MetricStream): boolean {
  const meta = stream.metrics_meta;
  if (!meta) return false;
  const helpIsReal = !!meta.help && meta.help !== stream.name;
  const unitIsReal = !!meta.unit;
  return helpIsReal || unitIsReal;
}

/**
 * The family a stream belongs to.
 *
 * A stream with authoritative metadata is believed: its `metric_family_name`
 * wins. Otherwise the family is derived from the name by stripping the
 * OpenMetrics member suffix. This is what keeps a coincidentally-named pair —
 * an unrelated `X` and `X_count` whose real family names differ — from being
 * fused into one family.
 */
function familyNameOf(stream: MetricStream): string {
  const declared = stream.metrics_meta?.metric_family_name;
  if (isAuthoritative(stream) && declared) return declared;
  return baseNameOf(stream.name);
}

/** Which member slot a stream fills within its family. */
function memberSlotOf(stream: MetricStream, familyName: string): keyof FamilyMembers {
  const suffix = familySuffixOf(stream.name);
  if (!suffix) return "base";
  // A suffixed stream whose authoritative family name equals its own name is a
  // metric that just happens to end in `_total` etc. — it is its own base.
  if (stream.name === familyName) return "base";
  return suffix as keyof FamilyMembers;
}

const DERIVED_SLOTS: Array<keyof FamilyMembers> = [
  "total",
  "created",
  "info",
  "bucket",
  "sum",
  "count",
  "gsum",
  "gcount",
];

/** Label names a stream carries, from a `fetchSchema=true` load. */
export function labelsOf(stream: MetricStream): string[] | undefined {
  if (!Array.isArray(stream.schema)) return undefined;
  return stream.schema
    .map((f) => f.name)
    .filter((n) => n && !INTERNAL_FIELDS.has(n) && !n.startsWith("__"));
}

/**
 * Groups a flat metrics-stream list into families.
 */
export function buildMetricFamilies(streams: MetricStream[]): {
  families: Map<string, MetricFamily>;
  familyOfStream: Map<string, MetricFamily>;
} {
  const grouped = new Map<string, MetricStream[]>();
  for (const stream of streams ?? []) {
    if (!stream?.name) continue;
    const family = familyNameOf(stream);
    const bucket = grouped.get(family);
    if (bucket) bucket.push(stream);
    else grouped.set(family, [stream]);
  }

  const families = new Map<string, MetricFamily>();
  const familyOfStream = new Map<string, MetricFamily>();

  for (const [familyName, members] of grouped) {
    const slots: FamilyMembers = {};
    const perMemberHasData: Record<string, boolean> = {};
    const perMemberLabels: Record<string, string[]> = {};
    let anyLabels = false;

    for (const stream of members) {
      slots[memberSlotOf(stream, familyName)] = stream.name;
      perMemberHasData[stream.name] = (stream.stats?.doc_num ?? 0) > 0;
      const labels = labelsOf(stream);
      if (labels) {
        perMemberLabels[stream.name] = labels;
        anyLabels = true;
      }
    }

    // Metadata comes from the base stream when it has any, else from whichever
    // member carries real metadata (partial ingestion, RBAC-hidden base, ...).
    const baseStream = members.find((s) => s.name === slots.base);
    const authoritative =
      (baseStream && isAuthoritative(baseStream) ? baseStream : undefined) ??
      members.find(isAuthoritative);

    const source = authoritative ?? baseStream ?? members[0];

    families.set(familyName, {
      familyName,
      familyType: lower(source?.metrics_meta?.metric_type),
      metadataSource: authoritative ? "authoritative" : "fallback",
      help: authoritative?.metrics_meta?.help ?? "",
      unit: authoritative?.metrics_meta?.unit ?? "",
      members: slots,
      perMemberHasData,
      perMemberLabels: anyLabels ? perMemberLabels : undefined,
    });
  }

  for (const family of families.values()) {
    for (const name of Object.values(family.members)) {
      if (name) familyOfStream.set(name, family);
    }
  }

  return { families, familyOfStream };
}

/**
 * Whether a family's base stream is a metadata-only phantom.
 *
 * Ingestion writes `prom_metadata` to the base family stream even when every
 * record lands in a derived stream, so a histogram's base name can appear in
 * the stream list holding nothing. Suppressed iff it has derived siblings AND
 * carries no documents. A base stream WITH data always renders — a summary
 * base holding quantile series is a real, queryable metric.
 */
export function isPhantomBase(family: MetricFamily): boolean {
  const base = family.members.base;
  if (!base) return false;
  const hasDerivedSiblings = DERIVED_SLOTS.some((slot) => !!family.members[slot]);
  if (!hasDerivedSiblings) return false;

  // A histogram base holds no series of its own *by construction* — every
  // observation is written to X_bucket/X_sum/X_count. So suppress it whenever
  // the family really is a histogram and the buckets exist, without trusting
  // `doc_num`: stream stats have been observed to be non-zero (or simply
  // absent) on these metadata-only streams, and a base that slips through
  // renders as a confidently-empty `avg()` gauge card.
  //
  // Summaries are NOT covered by this: a summary base legitimately carries the
  // quantile series, so it stays on the doc_num rule below.
  const HISTOGRAM_TYPES = ["histogram", "exponentialhistogram", "gaugehistogram"];
  if (HISTOGRAM_TYPES.includes(family.familyType) && family.members.bucket) {
    return true;
  }

  return family.perMemberHasData[base] === false;
}

/**
 * Turns the stream list into the grid's card list: one card per stream, with
 * family metadata joined in and phantom base streams suppressed.
 *
 * The family's declared unit is handed to the rule set as the *declared* unit;
 * the rule set is what decides where it may legitimately propagate (a `_total`
 * converts it through the rated mapping, a `_count` never inherits it at all).
 */
export function buildMetricCards(streams: MetricStream[]): MetricCard[] {
  const context = buildCardContext(streams);

  const cards: MetricCard[] = [];
  for (const stream of streams ?? []) {
    const card = cardFor(stream, context);
    if (card) cards.push(card);
  }

  return cards;
}

/**
 * The card for ONE stream.
 *
 * Same rules as `buildMetricCards`, without paying for the whole list to answer
 * about a single metric. The panel-editor seed asks this question several times
 * per stream selection (see `metricPanelSeed`), and running the rule set over
 * every metric in the org each time — thousands of `getMetricDefaults` calls to
 * find one card — is work with nothing to show for it.
 *
 * The family grouping is still list-wide, because it has to be: whether a stream
 * is a phantom base, and what its help/unit/type are, are facts about its
 * FAMILY. But that pass is cheap; the rule set is not, and it now runs once.
 */
export function buildMetricCardFor(streams: MetricStream[], name: string): MetricCard | undefined {
  if (!name) return undefined;
  const stream = (streams ?? []).find((s) => s?.name === name);
  if (!stream) return undefined;
  return cardFor(stream, buildCardContext(streams));
}

interface CardContext {
  familyOfStream: Map<string, MetricFamily>;
  streamNames: Set<string>;
  suppressed: Set<string>;
}

/**
 * The card context for a stream list, memoized on the LIST ITSELF.
 *
 * `buildMetricCardFor` answers about ONE metric, but it has to build the whole
 * family model to do it — a metric's card kind depends on which siblings exist
 * (`foo_sum` is a mean pair only if `foo_count` is there too), so the question
 * cannot be answered from the stream in isolation. Every seed decision therefore
 * paid a full pass over every metric in the org, and a single stream change asks
 * that question four to six times over, through different watchers. On an org
 * with thousands of metrics, picking one from the dropdown rebuilt the entire
 * model several times before the panel settled.
 *
 * Keyed on the array's IDENTITY, which is exactly the right granularity here:
 * `meta.stream.streamResults` is REPLACED when the stream list changes, never
 * mutated in place, so a new list is a new array and misses. A `WeakMap` also
 * means the entry dies with the list it describes.
 */
const cardContextCache = new WeakMap<object, CardContext>();

function buildCardContext(streams: MetricStream[]): CardContext {
  const cached = streams && cardContextCache.get(streams as unknown as object);
  if (cached) return cached;

  const context = computeCardContext(streams);
  if (streams) cardContextCache.set(streams as unknown as object, context);
  return context;
}

function computeCardContext(streams: MetricStream[]): CardContext {
  const { families, familyOfStream } = buildMetricFamilies(streams);

  const suppressed = new Set<string>();
  for (const family of families.values()) {
    if (isPhantomBase(family) && family.members.base) {
      suppressed.add(family.members.base);
    }
  }

  return {
    familyOfStream,
    streamNames: new Set((streams ?? []).map((s) => s?.name).filter(Boolean) as string[]),
    suppressed,
  };
}

function cardFor(
  stream: MetricStream,
  { familyOfStream, streamNames, suppressed }: CardContext,
): MetricCard | undefined {
  if (!stream?.name || suppressed.has(stream.name)) return undefined;

  const family = familyOfStream.get(stream.name);
  const labels = family?.perMemberLabels?.[stream.name] ?? labelsOf(stream);

  const declaredUnit = family?.unit || stream.metrics_meta?.unit || "";

  const defaults = getMetricDefaults(stream.name, stream.metrics_meta?.metric_type, declaredUnit, {
    streamNames,
    familyType: family?.familyType,
    labels,
  });

  // The backend's fallback help is the stream's own name; showing it would
  // just repeat the card title.
  const help = family?.help && family.help !== stream.name ? family.help : "";

  return {
    name: stream.name,
    familyName: family?.familyName ?? stream.name,
    familyType: family?.familyType ?? "",
    cardKind: defaults.cardKind,
    typeFilterBucket: defaults.typeFilterBucket,
    help,
    unit: defaults.unit,
    declaredUnit,
    hasData: (stream.stats?.doc_num ?? 0) > 0,
    unsupported: defaults.unsupported,
    configurable: defaults.configurable,
    footerLabel: defaults.footerLabel,
    chartType: defaults.chartType,
    labels,
  };
}

/**
 * Every stream a card's effective variant actually reads.
 *
 * A mean pair reads `X_sum` AND `X_count`; the exponential-histogram fallback
 * reads `X_count` rather than the card's own `X_bucket`. Label-filter
 * eligibility must be checked against all of them — a filter honoured by one
 * operand but silently ignored by the other would render a ratio of filtered
 * and unfiltered data.
 */
export function operandStreamsOf(card: MetricCard): string[] {
  const base = baseNameOf(card.name);
  switch (card.cardKind) {
    case CARD_KIND.MEAN_PAIR:
      return [card.name, `${base}_count`];
    case CARD_KIND.EXP_HISTOGRAM_FALLBACK:
      return [`${base}_count`];
    default:
      return [card.name];
  }
}

/**
 * The type-filter bucket (counter / gauge / histogram / summary / other) for every
 * stream, and nothing else.
 *
 * `buildMetricCards` answers this too, but it pays for the WHOLE rule set on the
 * way — every variant, every PromQL expression, every legend and unit for every
 * metric in the org — to reach one word per stream. A type badge in a dropdown
 * does not need any of that. This runs the family model (cheap) and the card-kind
 * dispatch (cheap) and stops.
 *
 * Every stream gets an entry, including the metadata-only family bases that
 * `buildMetricCards` suppresses — the dropdown still lists them, so they still
 * need a badge.
 */
export function buildTypeFilterBuckets(streams: MetricStream[]): Record<string, string> {
  const { familyOfStream } = buildMetricFamilies(streams);
  const streamNames = new Set((streams ?? []).map((s) => s?.name).filter(Boolean) as string[]);

  const buckets: Record<string, string> = {};
  for (const stream of streams ?? []) {
    if (!stream?.name) continue;
    const family = familyOfStream.get(stream.name);
    const declaredType = stream.metrics_meta?.metric_type;

    const cardKind = resolveCardKind(stream.name, declaredType, {
      streamNames,
      familyType: family?.familyType,
    });

    buckets[stream.name] =
      TYPE_FILTER_BUCKET[cardKind] === "other" && cardKind === CARD_KIND.OTHER
        ? (declaredBucketOf(family?.familyType || declaredType) ?? "other")
        : (TYPE_FILTER_BUCKET[cardKind] ?? "other");
  }
  return buckets;
}

/**
 * The type-filter bucket a stream's DECLARED type implies, or null when it implies
 * nothing we badge.
 *
 * Only consulted for a stream whose card kind is `other` — i.e. one we do not build
 * a card for at all. The obvious case is a histogram family's metadata-only BASE:
 * it has no card (a histogram base holds no series of its own), so its card kind is
 * `other`, and badging it "Other" in the stream dropdown told the user the metric
 * was of an unknown type when it is plainly a Histogram — and says so in its own
 * metadata. The dropdown lists it, so it needs an honest badge.
 *
 * Deliberately narrow. `gaugehistogram` is absent because v1 really does treat it as
 * Other, and `_created`/info cards keep "other" because their card kinds
 * are `timestamp`/`info`, not `other`, so they never reach this.
 */
function declaredBucketOf(type: string | undefined): string | null {
  switch ((type ?? "").trim().toLowerCase()) {
    case "histogram":
    case "exponentialhistogram":
      return "histogram";
    case "summary":
      return "summary";
    case "counter":
      return "counter";
    case "gauge":
      return "gauge";
    default:
      return null;
  }
}
