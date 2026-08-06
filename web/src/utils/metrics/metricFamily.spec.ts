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

import { describe, it, expect } from "vitest";
import {
  buildMetricCardFor,
  buildMetricCards,
  buildTypeFilterBuckets,
  buildMetricFamilies,
  isPhantomBase,
  operandStreamsOf,
  type MetricStream,
} from "./metricFamily";
import { CARD_KIND } from "./metricDefaults";

/** A stream carrying real exporter metadata (help differs from the name). */
const authoritative = (
  name: string,
  type: string,
  opts: { help?: string; unit?: string; family?: string; docs?: number } = {},
): MetricStream => ({
  name,
  stream_type: "metrics",
  metrics_meta: {
    metric_type: type,
    metric_family_name: opts.family ?? name,
    help: opts.help ?? `Help for ${name}.`,
    unit: opts.unit ?? "",
  },
  stats: { doc_num: opts.docs ?? 100 },
});

/**
 * A stream carrying the backend's fallback metadata: help = its own name, empty
 * unit, and `_bucket`/`_sum`/`_count` coerced to `counter`.
 */
const fallback = (name: string, docs = 100): MetricStream => {
  const coerced = name.endsWith("_bucket") || name.endsWith("_sum") || name.endsWith("_count");
  return {
    name,
    stream_type: "metrics",
    metrics_meta: {
      metric_type: coerced ? "Counter" : "",
      metric_family_name: name,
      help: name,
      unit: "",
    },
    stats: { doc_num: docs },
  };
};

const names = (cards: { name: string }[]) => cards.map((c) => c.name).sort();

describe("fixture 1: metadata-only histogram base + real bucket/sum/count", () => {
  const streams: MetricStream[] = [
    // Ingestion wrote prom_metadata here, but every record went to a derived
    // stream — so this base holds nothing.
    authoritative("http_duration_seconds", "Histogram", {
      help: "Request duration.",
      unit: "s",
      docs: 0,
    }),
    fallback("http_duration_seconds_bucket"),
    fallback("http_duration_seconds_sum"),
    fallback("http_duration_seconds_count"),
  ];

  it("suppresses the phantom base and keeps the three real sub-streams", () => {
    const cards = buildMetricCards(streams);
    expect(names(cards)).toEqual([
      "http_duration_seconds_bucket",
      "http_duration_seconds_count",
      "http_duration_seconds_sum",
    ]);
  });

  it("joins the family help and type onto every member", () => {
    const cards = buildMetricCards(streams);
    for (const card of cards) {
      expect(card.help).toBe("Request duration.");
      expect(card.familyType).toBe("histogram");
      expect(card.familyName).toBe("http_duration_seconds");
    }
  });

  it("routes each member by name despite the coerced counter type", () => {
    const byName = Object.fromEntries(buildMetricCards(streams).map((c) => [c.name, c]));
    expect(byName["http_duration_seconds_bucket"].cardKind).toBe(
      CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS,
    );
    expect(byName["http_duration_seconds_sum"].cardKind).toBe(CARD_KIND.MEAN_PAIR);
    expect(byName["http_duration_seconds_count"].cardKind).toBe(CARD_KIND.COUNTER_RATE);
  });

  it("propagates the family unit only where it is semantically valid", () => {
    const byName = Object.fromEntries(buildMetricCards(streams).map((c) => [c.name, c]));
    // Bucket bounds are in the observation unit.
    expect(byName["http_duration_seconds_bucket"].unit).toBe("seconds");
    // The mean pair's /s cancels, so it keeps the observation unit.
    expect(byName["http_duration_seconds_sum"].unit).toBe("seconds");
    // A count member counts events — never seconds, whatever the family declared.
    expect(byName["http_duration_seconds_count"].unit).toBe("count-per-sec");
  });
});

describe("fixture 2: summary base WITH quantile data", () => {
  const streams: MetricStream[] = [
    authoritative("rpc_latency_seconds", "Summary", {
      help: "RPC latency.",
      unit: "s",
      docs: 500,
    }),
    fallback("rpc_latency_seconds_sum"),
    fallback("rpc_latency_seconds_count"),
  ];

  it("renders the base: it has data, so it is not a phantom", () => {
    const { families } = buildMetricFamilies(streams);
    expect(isPhantomBase(families.get("rpc_latency_seconds")!)).toBe(false);
    expect(names(buildMetricCards(streams))).toContain("rpc_latency_seconds");
  });

  it("gives the base a quantile-series card", () => {
    const base = buildMetricCards(streams).find((c) => c.name === "rpc_latency_seconds")!;
    expect(base.cardKind).toBe(CARD_KIND.SUMMARY_QUANTILES);
  });
});

describe("fixture 3: unrelated X and X_count with different family names", () => {
  const streams: MetricStream[] = [
    authoritative("queue", "Gauge", { help: "Queue depth.", docs: 10 }),
    // A real metric that merely happens to end in `_count`, belonging elsewhere.
    authoritative("queue_count", "Gauge", {
      help: "Number of queues.",
      family: "queue_count",
      docs: 10,
    }),
  ];

  it("does not fuse them into one family", () => {
    const { families } = buildMetricFamilies(streams);
    expect(families.get("queue")!.members).toEqual({ base: "queue" });
    expect(families.get("queue_count")!.members).toEqual({ base: "queue_count" });
  });

  it("renders both, suppressing neither", () => {
    expect(names(buildMetricCards(streams))).toEqual(["queue", "queue_count"]);
  });

  it("keeps each metric's own help text", () => {
    const byName = Object.fromEntries(buildMetricCards(streams).map((c) => [c.name, c]));
    expect(byName["queue"].help).toBe("Queue depth.");
    expect(byName["queue_count"].help).toBe("Number of queues.");
  });
});

describe("fixture 4: base metadata missing entirely", () => {
  // RBAC or partial ingestion: no base stream at all, sub-streams carry only
  // their own fallback metadata.
  const streams: MetricStream[] = [
    fallback("job_duration_seconds_bucket"),
    fallback("job_duration_seconds_sum"),
    fallback("job_duration_seconds_count"),
  ];

  it("still groups them into one family by name derivation", () => {
    const { families } = buildMetricFamilies(streams);
    const family = families.get("job_duration_seconds")!;
    expect(family.metadataSource).toBe("fallback");
    expect(family.members).toEqual({
      bucket: "job_duration_seconds_bucket",
      sum: "job_duration_seconds_sum",
      count: "job_duration_seconds_count",
    });
  });

  it("suppresses nothing — there is no base to suppress", () => {
    expect(buildMetricCards(streams)).toHaveLength(3);
  });

  it("falls back to name-based unit inference with no family unit", () => {
    const bucket = buildMetricCards(streams).find((c) => c.name.endsWith("_bucket"))!;
    // `_bucket` looks back past the suffix and finds `seconds`.
    expect(bucket.unit).toBe("seconds");
    expect(bucket.help).toBe("");
  });
});

describe("phantom suppression predicate", () => {
  it("keeps a lone base stream with no data (nothing derived to replace it)", () => {
    const streams = [authoritative("lonely_gauge", "Gauge", { docs: 0 })];
    expect(buildMetricCards(streams)).toHaveLength(1);
  });

  it("suppresses a histogram base even when its stats claim it has data", () => {
    // A histogram base holds no series by construction — every observation goes
    // to _bucket/_sum/_count. Stream stats on these metadata-only streams have
    // been observed non-zero in the wild, and a base that slips through renders
    // as a confidently-empty `avg()` gauge card.
    const streams = [authoritative("m", "Histogram", { docs: 5 }), fallback("m_bucket")];
    const { families } = buildMetricFamilies(streams);
    expect(isPhantomBase(families.get("m")!)).toBe(true);
    expect(buildMetricCards(streams).map((c) => c.name)).toEqual(["m_bucket"]);
  });

  it("keeps a summary base with data — its quantile series are real", () => {
    const streams = [
      authoritative("s", "Summary", { docs: 5 }),
      fallback("s_sum"),
      fallback("s_count"),
    ];
    const { families } = buildMetricFamilies(streams);
    expect(isPhantomBase(families.get("s")!)).toBe(false);
  });

  it("never charts a bare histogram base that escapes suppression", () => {
    // Backstop: no bucket sibling in the list (RBAC, partial ingestion), so the
    // family model cannot see it is a histogram base.
    const card = buildMetricCards([authoritative("h", "Histogram", { docs: 0 })])[0];
    expect(card.unsupported).toBe(true);
    expect(card.chartType).toBe("none");
    expect(card.typeFilterBucket).toBe("other");
  });
});

describe("operandStreamsOf", () => {
  const streams: MetricStream[] = [
    authoritative("lat_seconds", "Histogram", { unit: "s", docs: 0 }),
    fallback("lat_seconds_bucket"),
    fallback("lat_seconds_sum"),
    fallback("lat_seconds_count"),
  ];
  const byName = Object.fromEntries(buildMetricCards(streams).map((c) => [c.name, c]));

  it("reports both operands of a mean pair", () => {
    // A filter honoured by X_sum but silently ignored by X_count would make the
    // ratio mix filtered and unfiltered data.
    expect(operandStreamsOf(byName["lat_seconds_sum"])).toEqual([
      "lat_seconds_sum",
      "lat_seconds_count",
    ]);
  });

  it("reports the count stream for an exponential-histogram fallback", () => {
    const exp = buildMetricCards([
      authoritative("exp_seconds", "ExponentialHistogram", { docs: 0 }),
      fallback("exp_seconds_bucket"),
      fallback("exp_seconds_count"),
    ]).find((c) => c.name === "exp_seconds_bucket")!;
    expect(exp.cardKind).toBe(CARD_KIND.EXP_HISTOGRAM_FALLBACK);
    expect(operandStreamsOf(exp)).toEqual(["exp_seconds_count"]);
  });

  it("reports just the card's own stream otherwise", () => {
    expect(operandStreamsOf(byName["lat_seconds_bucket"])).toEqual(["lat_seconds_bucket"]);
  });
});

describe("labels", () => {
  it("extracts user label names from a fetchSchema=true load", () => {
    const stream: MetricStream = {
      ...fallback("m_total"),
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "value", type: "Float64" },
        { name: "__hash__", type: "Utf8" },
        { name: "job", type: "Utf8" },
        { name: "instance", type: "Utf8" },
      ],
    };
    const card = buildMetricCards([stream])[0];
    expect(card.labels).toEqual(["job", "instance"]);
  });

  it("leaves labels undefined on the schema-less landing load", () => {
    expect(buildMetricCards([fallback("m_total")])[0].labels).toBeUndefined();
  });
});

describe("buildTypeFilterBuckets — the cheap pass must agree with the expensive one", () => {
  // A real histogram family (authoritative base, fallback-metadata members —
  // exactly how ingestion writes them), plus a few standalone metrics.
  const streams: MetricStream[] = [
    authoritative("lat_seconds", "histogram", { unit: "s", docs: 0 }),
    fallback("lat_seconds_bucket"),
    fallback("lat_seconds_sum"),
    fallback("lat_seconds_count"),
    authoritative("http_requests_total", "counter"),
    authoritative("cpu_usage", "gauge"),
    authoritative("go_info", "info"),
  ];

  it("returns the same bucket buildMetricCards would, for every card", () => {
    // It exists to skip the rule set (variants, expressions, legends, units) for a
    // one-word badge. It must not skip the ANSWER: this is the test that stops the
    // cheap path drifting from the real one.
    const cheap = buildTypeFilterBuckets(streams);

    for (const card of buildMetricCards(streams)) {
      expect(cheap[card.name]).toBe(card.typeFilterBucket);
    }
  });

  it("also answers for the metadata-only bases buildMetricCards suppresses", () => {
    // The dropdown still lists them, so they still need a badge — and the badge has
    // to come from the declared type, because the card kind for a base is `other`.
    const cheap = buildTypeFilterBuckets(streams);
    const cardNames = buildMetricCards(streams).map((c) => c.name);

    expect(cardNames).not.toContain("lat_seconds"); // suppressed phantom
    // ...but still badged, and badged HONESTLY. Asserting only `toBeDefined`
    // here is what let a regression ship: the cheap pass resolves a histogram
    // base to card kind `other` (correct — it has no card of its own), and
    // mapping that straight to a bucket badged a stream whose own metadata says
    // `histogram` as "Other". The dropdown lists it, so the badge is the only
    // type the user ever sees for it.
    expect(cheap["lat_seconds"]).toBe("histogram");
  });

  it("classifies a histogram's members by FAMILY, not by their coerced type", () => {
    // Ingestion stamps `_bucket`/`_sum`/`_count` as Counter. Reading the declared
    // type alone mislabels most of a histogram family — the exact bug the old
    // hand-rolled fallback had.
    const cheap = buildTypeFilterBuckets(streams);
    expect(cheap["lat_seconds_bucket"]).toBe("histogram");
    expect(cheap["http_requests_total"]).toBe("counter");
    expect(cheap["cpu_usage"]).toBe("gauge");
    expect(cheap["go_info"]).toBe("other");
  });

  it("badges a family base by its declared type, but keeps 'other' where 'other' is the truth", () => {
    const mixed: MetricStream[] = [
      // Bases: no card of their own, so their card kind is `other`. The badge
      // must therefore come from what the metric actually IS.
      authoritative("lat_seconds", "histogram", { unit: "s", docs: 0 }),
      fallback("lat_seconds_bucket"),
      fallback("lat_seconds_count"),
      authoritative("rpc_seconds", "summary", { docs: 0 }),
      fallback("rpc_seconds_sum"),
      // ...and the ones for which "other" is not a fallback but the answer: v1
      // builds no card for a gaugehistogram (PRD 6.1), `_created` is a
      // timestamp, and an info metric is an info metric. The declared-type
      // fallback must not reach past these and re-badge them.
      authoritative("mem_bytes", "gaugehistogram"),
      authoritative("kube_cronjob_created", "counter"),
      authoritative("go_info", "info"),
    ];

    const cheap = buildTypeFilterBuckets(mixed);

    expect(cheap["lat_seconds"]).toBe("histogram");
    expect(cheap["rpc_seconds"]).toBe("summary");
    expect(cheap["mem_bytes"]).toBe("other");
    expect(cheap["kube_cronjob_created"]).toBe("other");
    expect(cheap["go_info"]).toBe("other");
  });
});

/**
 * `buildMetricCardFor` answers about ONE metric but has to build the whole
 * family model to do it, because a metric's kind depends on which siblings
 * exist. That model is memoized on the stream LIST's identity, which is only
 * sound while the list is replaced rather than mutated — so the thing worth
 * testing is not that it is fast, but that it is never stale.
 */
describe("the family model is cached per stream list, never across lists", () => {
  const withCount = (): MetricStream[] => [
    fallback("http_duration_seconds_sum"),
    fallback("http_duration_seconds_count"),
  ];

  it("answers the same question the same way for the same list", () => {
    const streams = withCount();

    const first = buildMetricCardFor(streams, "http_duration_seconds_sum");
    const second = buildMetricCardFor(streams, "http_duration_seconds_sum");

    expect(second?.cardKind).toBe(first?.cardKind);
    expect(first?.cardKind).toBe(CARD_KIND.MEAN_PAIR);
  });

  it("re-reads a NEW list rather than serving the old one's answer", () => {
    // The very thing the cache could get wrong. `foo_sum` is a mean pair only
    // while `foo_count` is beside it; take the sibling away and the same name
    // must come back as a plain counter. A cache keyed on anything coarser than
    // the list itself would keep insisting it was still a mean pair.
    const pair = buildMetricCardFor(withCount(), "http_duration_seconds_sum");
    expect(pair?.cardKind).toBe(CARD_KIND.MEAN_PAIR);

    const orphaned = buildMetricCardFor(
      [fallback("http_duration_seconds_sum")], // a DIFFERENT array: no _count
      "http_duration_seconds_sum",
    );

    expect(orphaned?.cardKind).toBe(CARD_KIND.COUNTER_RATE);
  });

  it("keeps two live lists apart", () => {
    // Both arrays are reachable at once, so this fails if the cache holds only
    // the most recent entry rather than keying on identity.
    const full = withCount();
    const partial = [fallback("http_duration_seconds_sum")];

    expect(buildMetricCardFor(full, "http_duration_seconds_sum")?.cardKind).toBe(
      CARD_KIND.MEAN_PAIR,
    );
    expect(buildMetricCardFor(partial, "http_duration_seconds_sum")?.cardKind).toBe(
      CARD_KIND.COUNTER_RATE,
    );
    // ...and back again, which a single-slot cache would get wrong.
    expect(buildMetricCardFor(full, "http_duration_seconds_sum")?.cardKind).toBe(
      CARD_KIND.MEAN_PAIR,
    );
  });
});
