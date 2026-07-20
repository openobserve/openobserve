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

//! Degrades Prometheus native (sparse) histograms into their classic representation:
//! `_count`, `_sum` and cumulative `le` `_bucket` records, so existing PromQL
//! (`histogram_quantile` etc.) works on them unchanged.
//!
//! Known limitations, inherited from classic semantics:
//! - `sum by (le)` is only sound across series sharing a bucket layout. Each native
//!   series carries `le`s only for its own value range, so quantiles aggregated
//!   across series with different ranges understate the cumulative tail. Per-series
//!   quantiles, homogeneous-group aggregations and `_count`/`_sum` rates are exact.
//! - quantiles interpolate linearly within a bucket, like every classic histogram.
//!   Prometheus >= 3.0 interpolates native buckets exponentially, so its results can
//!   differ by up to the bucket width (~6% at schema 0, less at finer schemas, more
//!   after downscaling). This is an approximate fallback, not a native-fidelity one.

use proto::prometheus_rpc;

/// The classic streams a native histogram degrades into.
pub const CLASSIC_HISTOGRAM_SUFFIXES: [&str; 3] = ["_bucket", "_count", "_sum"];

/// Exponential schemas (`base = 2^(2^-schema)`). Anything outside -- notably NHCB,
/// schema -53 -- cannot be converted: our wire type does not decode `custom_values`.
const SCHEMA_RANGE: std::ops::RangeInclusive<i32> = -4..=8;

/// Downscaling may merge below the native schema floor -- the emitted `le` bounds are
/// plain classic bounds, not required to form a valid native schema. At -10
/// (base 2^1024) one bucket spans all of f64, so the loop always terminates.
const MIN_DOWNSCALE_SCHEMA: i32 = -10;

/// The `__name__` suffix, the `le` label (`None` for `_count`/`_sum`), and the value.
pub type ClassicHistogramRecord = (&'static str, Option<String>, f64);

/// Prometheus's stale-marker bit pattern in `sum`; an ordinary NaN is NOT stale.
const STALE_NAN_BITS: u64 = 0x7ff0_0000_0000_0002;

/// Degrades one native histogram sample into classic records: cumulative `le` buckets
/// closed by `le="inf"`. Empty for unsupported schemas and stale markers.
pub fn expand_native_histogram(hp: &prometheus_rpc::Histogram) -> Vec<ClassicHistogramRecord> {
    expand_with_bucket_limit(hp, config::get_config().prom.native_histogram_max_buckets)
}

fn expand_with_bucket_limit(
    hp: &prometheus_rpc::Histogram,
    max_buckets: usize,
) -> Vec<ClassicHistogramRecord> {
    if !SCHEMA_RANGE.contains(&hp.schema) {
        log::warn!(
            "[METRICS:PROM] dropping native histogram with unsupported schema {}",
            hp.schema
        );
        return vec![];
    }

    // a stale marker terminates the series; expanding it would write a spurious
    // `_count = 0` that reads as a counter reset
    if hp.sum.to_bits() == STALE_NAN_BITS {
        return vec![];
    }

    let count = match hp.count {
        Some(prometheus_rpc::histogram::Count::CountInt(v)) => v as f64,
        Some(prometheus_rpc::histogram::Count::CountFloat(v)) => v,
        None => 0.0,
    };
    let zero_count = match hp.zero_count {
        Some(prometheus_rpc::histogram::ZeroCount::ZeroCountInt(v)) => v as f64,
        Some(prometheus_rpc::histogram::ZeroCount::ZeroCountFloat(v)) => v,
        None => 0.0,
    };

    let mut pos = span_buckets(&hp.positive_spans, &hp.positive_deltas, &hp.positive_counts);
    let mut neg = span_buckets(&hp.negative_spans, &hp.negative_deltas, &hp.negative_counts);

    // every emitted `le` label becomes a series, so merge adjacent buckets (halving
    // resolution) until the sample's le count fits the cardinality budget
    let mut schema = hp.schema;
    while le_estimate(&pos, &neg, zero_count) > max_buckets.max(3)
        && schema > MIN_DOWNSCALE_SCHEMA
    {
        schema -= 1;
        pos = downscale(pos);
        neg = downscale(neg);
    }

    // bucket `idx` covers `(base^(idx-1), base^idx]`, mirrored on the negative side
    let mut buckets: Vec<(f64, f64, f64)> = Vec::new(); // (lower, upper, count)
    for &(idx, c) in &pos {
        buckets.push((bucket_bound(schema, idx - 1), bucket_bound(schema, idx), c));
    }
    for &(idx, c) in &neg {
        buckets.push((
            -bucket_bound(schema, idx),
            -bucket_bound(schema, idx - 1),
            c,
        ));
    }
    if zero_count > 0.0 {
        buckets.push((-hp.zero_threshold, hp.zero_threshold, zero_count));
    }

    // classic buckets are cumulative in `le` order
    buckets.sort_by(|a, b| a.1.total_cmp(&b.1));

    let mut recs = Vec::with_capacity(2 * buckets.len() + 3);
    recs.push(("_count", None, count));
    recs.push(("_sum", None, hp.sum));

    let mut points: Vec<(String, f64)> = Vec::with_capacity(2 * buckets.len() + 1);
    let mut cumulative = 0.0;
    let mut prev_upper = f64::NEG_INFINITY;
    for (lower, upper, c) in buckets {
        // a zero-increment record at the lower bound of each bucket run pins sparse
        // gaps, so quantile interpolation cannot smear counts across them.
        // `lower < upper` skips the marker when clamping collapsed both bounds.
        if lower > prev_upper && lower < upper {
            push_le_point(&mut points, format_le(lower), cumulative);
        }
        cumulative += c;
        push_le_point(&mut points, format_le(upper), cumulative);
        prev_upper = upper;
    }
    // `le="inf"` must equal `_count`; `max` also repairs a short count field
    push_le_point(&mut points, format_le(f64::INFINITY), count.max(cumulative));

    recs.extend(points.into_iter().map(|(le, v)| ("_bucket", Some(le), v)));
    recs
}

/// `le` label: 4 significant digits, shortest decimal ("0.5946", "8"). Cannot collide
/// adjacent buckets -- the finest schema spaces bounds 0.271% apart vs the 0.1%
/// worst-case label resolution.
fn format_le(v: f64) -> String {
    let rounded: f64 = format!("{v:.3e}").parse().unwrap();
    if rounded.is_finite() || !v.is_finite() {
        rounded.to_string()
    } else {
        // rounding f64::MAX (the clamped last bucket) overflows to infinity and would
        // collide with `le="inf"`; keep the full-precision label
        v.to_string()
    }
}

/// Appends a cumulative `le` point, merging points whose labels collide after rounding
/// (an arbitrary `zero_threshold` can round onto a neighboring bucket bound).
fn push_le_point(points: &mut Vec<(String, f64)>, le: String, cumulative: f64) {
    match points.last_mut() {
        Some((last_le, last_v)) if *last_le == le => *last_v = cumulative.max(*last_v),
        _ => points.push((le, cumulative)),
    }
}

/// Upper bound of bucket `idx`: `2^(idx * 2^-schema)` via `exp2`, so powers of two are
/// exact and a boundary shared between schemas is the identical f64 (downscaling keeps
/// surviving `le`s in the same series). Clamped finite so the last representable
/// bucket cannot collide with `le="inf"`.
fn bucket_bound(schema: i32, idx: i64) -> f64 {
    let bound = ((idx as f64) * 2f64.powi(-schema)).exp2();
    bound.clamp(f64::MIN_POSITIVE, f64::MAX)
}

/// Upper bound on the `le` labels a sample will emit: each populated bucket gets an
/// upper record, each contiguous run a lower-bound gap marker, plus the zero bucket's
/// two bounds and `inf`.
fn le_estimate(pos: &[(i64, f64)], neg: &[(i64, f64)], zero_count: f64) -> usize {
    let side = |b: &[(i64, f64)]| {
        let runs = b
            .iter()
            .zip(b.iter().skip(1))
            .filter(|((a, _), (b, _))| *b != a + 1)
            .count()
            + usize::from(!b.is_empty());
        b.len() + runs
    };
    side(pos) + side(neg) + if zero_count > 0.0 { 2 } else { 0 } + 1
}

/// Merges adjacent bucket pairs: `idx` at schema `s` maps to `ceil(idx / 2)` at
/// schema `s - 1`.
fn downscale(buckets: Vec<(i64, f64)>) -> Vec<(i64, f64)> {
    let mut out: Vec<(i64, f64)> = Vec::with_capacity(buckets.len() / 2 + 1);
    for (idx, c) in buckets {
        let merged_idx = (idx + 1).div_euclid(2);
        match out.last_mut() {
            Some((last_idx, last_c)) if *last_idx == merged_idx => *last_c += c,
            _ => out.push((merged_idx, c)),
        }
    }
    out
}

/// Decodes the sparse layout (spans + integer deltas or absolute float counts) into
/// `(bucket index, absolute count)` pairs for every populated bucket.
fn span_buckets(
    spans: &[prometheus_rpc::BucketSpan],
    deltas: &[i64],
    counts: &[f64],
) -> Vec<(i64, f64)> {
    let use_float_counts = !counts.is_empty();
    let mut buckets = Vec::new();
    let mut idx: i64 = 0;
    let mut pos = 0;
    let mut cumulative_delta: i64 = 0;
    for span in spans {
        idx += span.offset as i64;
        for _ in 0..span.length {
            let count = if use_float_counts {
                let Some(c) = counts.get(pos) else {
                    return buckets;
                };
                *c
            } else {
                let Some(d) = deltas.get(pos) else {
                    return buckets;
                };
                cumulative_delta += *d;
                cumulative_delta as f64
            };
            pos += 1;
            // skips zero-count buckets and NaN float counts
            if count > 0.0 {
                buckets.push((idx, count));
            }
            idx += 1;
        }
    }
    buckets
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_histogram_base() -> prometheus_rpc::Histogram {
        prometheus_rpc::Histogram {
            schema: 0, // base = 2
            timestamp: 1_700_000_000_000,
            ..Default::default()
        }
    }

    fn bucket_records(recs: &[ClassicHistogramRecord]) -> Vec<(f64, f64)> {
        recs.iter()
            .filter(|(suffix, ..)| *suffix == "_bucket")
            .map(|(_, le, v)| (le.as_ref().unwrap().parse::<f64>().unwrap(), *v))
            .collect()
    }

    fn scalar_record(recs: &[ClassicHistogramRecord], suffix: &str) -> f64 {
        recs.iter().find(|(s, ..)| *s == suffix).unwrap().2
    }

    /// Strictly increasing `le`, non-decreasing cumulative counts, closing `inf` --
    /// what `histogram_quantile` needs to be sound.
    fn assert_bucket_invariants(recs: &[ClassicHistogramRecord]) {
        let buckets = bucket_records(recs);
        for w in buckets.windows(2) {
            assert!(w[0].0 < w[1].0, "le not strictly increasing: {buckets:?}");
            assert!(w[0].1 <= w[1].1, "cumulative decreasing: {buckets:?}");
        }
        assert_eq!(buckets.last().unwrap().0, f64::INFINITY);
    }

    /// Integer histogram: spans `[{0,2},{1,1}]` + deltas `[3,1,-1]` decode to buckets
    /// `{0:3, 1:4, 3:3}` with idx 2 an implicit gap.
    #[test]
    fn test_expand_native_histogram_integer() {
        let hp = prometheus_rpc::Histogram {
            sum: 100.0,
            zero_threshold: 0.001,
            count: Some(prometheus_rpc::histogram::Count::CountInt(12)),
            zero_count: Some(prometheus_rpc::histogram::ZeroCount::ZeroCountInt(2)),
            positive_spans: vec![
                prometheus_rpc::BucketSpan {
                    offset: 0,
                    length: 2,
                },
                prometheus_rpc::BucketSpan {
                    offset: 1,
                    length: 1,
                },
            ],
            positive_deltas: vec![3, 1, -1],
            ..native_histogram_base()
        };

        let recs = expand_native_histogram(&hp);
        assert_eq!(scalar_record(&recs, "_count"), 12.0);
        assert_eq!(scalar_record(&recs, "_sum"), 100.0);
        // gap markers: le=4 pins the empty (2,4], le=-0.001/0.5 open each bucket run
        assert_eq!(
            bucket_records(&recs),
            vec![
                (-0.001, 0.0),
                (0.001, 2.0),
                (0.5, 2.0),
                (1.0, 5.0),
                (2.0, 9.0),
                (4.0, 9.0),
                (8.0, 12.0),
                (f64::INFINITY, 12.0),
            ]
        );
        // "inf", matching the OTLP writer's formatting
        assert_eq!(recs.last().unwrap().1.as_deref(), Some("inf"));
    }

    /// Float histogram (absolute counts) with negative buckets: cumulation starts from
    /// the most negative bucket.
    #[test]
    fn test_expand_native_histogram_float_with_negative_buckets() {
        let hp = prometheus_rpc::Histogram {
            sum: -3.5,
            count: Some(prometheus_rpc::histogram::Count::CountFloat(9.0)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 1, // idx 1 -> le 2
                length: 1,
            }],
            positive_counts: vec![4.0],
            negative_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0, // idx 0 and 1 -> le -0.5 and -1
                length: 2,
            }],
            negative_counts: vec![2.0, 3.0],
            ..native_histogram_base()
        };

        let recs = expand_native_histogram(&hp);
        assert_eq!(
            bucket_records(&recs),
            vec![
                (-2.0, 0.0), // lower-bound marker of the negative run
                (-1.0, 3.0), // negative idx 1: [-2, -1)
                (-0.5, 5.0), // negative idx 0: [-1, -0.5)
                (1.0, 5.0),  // lower-bound marker: (-0.5, 1] carries nothing
                (2.0, 9.0),  // positive idx 1: (1, 2]
                (f64::INFINITY, 9.0),
            ]
        );
    }

    /// Non-exponential schemas (NHCB, -53) are dropped, not stored corrupt.
    #[test]
    fn test_expand_native_histogram_rejects_unsupported_schema() {
        let hp = prometheus_rpc::Histogram {
            schema: -53,
            count: Some(prometheus_rpc::histogram::Count::CountInt(5)),
            ..Default::default()
        };
        assert!(expand_native_histogram(&hp).is_empty());
    }

    /// A stale marker drops the whole sample; an ordinary NaN sum keeps count/buckets
    /// (only `_sum` is dropped later by NaN sanitization).
    #[test]
    fn test_expand_native_histogram_stale_marker_vs_plain_nan() {
        let stale = prometheus_rpc::Histogram {
            sum: f64::from_bits(0x7ff0_0000_0000_0002),
            ..native_histogram_base()
        };
        assert!(expand_native_histogram(&stale).is_empty());

        let plain_nan = prometheus_rpc::Histogram {
            sum: f64::NAN,
            count: Some(prometheus_rpc::histogram::Count::CountInt(7)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 1,
            }],
            positive_deltas: vec![7],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&plain_nan);
        assert_eq!(scalar_record(&recs, "_count"), 7.0);
        assert!(scalar_record(&recs, "_sum").is_nan());
        assert_eq!(
            bucket_records(&recs),
            vec![(0.5, 0.0), (1.0, 7.0), (f64::INFINITY, 7.0)]
        );
    }

    /// An empty histogram still yields `_count`/`_sum`/`inf`; a missing count falls
    /// back to the bucket total so `le="inf"` stays monotonic.
    #[test]
    fn test_expand_native_histogram_empty_and_short_count() {
        let empty = expand_native_histogram(&native_histogram_base());
        assert_eq!(scalar_record(&empty, "_count"), 0.0);
        assert_eq!(bucket_records(&empty), vec![(f64::INFINITY, 0.0)]);

        let hp = prometheus_rpc::Histogram {
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 1,
            }],
            positive_deltas: vec![7],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_eq!(
            bucket_records(&recs),
            vec![(0.5, 0.0), (1.0, 7.0), (f64::INFINITY, 7.0)]
        );
    }

    /// Reference vector cross-checked against an independent decoder implementation,
    /// including a two-bucket gap at idx 4-5.
    #[test]
    fn test_expand_native_histogram_reference_vector() {
        let hp = prometheus_rpc::Histogram {
            sum: 175.5,
            zero_threshold: 0.00001,
            count: Some(prometheus_rpc::histogram::Count::CountInt(13)),
            zero_count: Some(prometheus_rpc::histogram::ZeroCount::ZeroCountInt(2)),
            positive_spans: vec![
                prometheus_rpc::BucketSpan {
                    offset: 0,
                    length: 4,
                },
                prometheus_rpc::BucketSpan {
                    offset: 2,
                    length: 1,
                },
            ],
            positive_deltas: vec![2, -1, 2, -1, 1],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(scalar_record(&recs, "_count"), 13.0);
        assert_eq!(scalar_record(&recs, "_sum"), 175.5);
        assert_eq!(
            bucket_records(&recs),
            vec![
                (-0.00001, 0.0),
                (0.00001, 2.0), // zero bucket: 2
                (0.5, 2.0),
                (1.0, 4.0),   // (0.5,1]: 2
                (2.0, 5.0),   // (1,2]:   1
                (4.0, 8.0),   // (2,4]:   3
                (8.0, 10.0),  // (4,8]:  2
                (32.0, 10.0), // idx 4-5 gap: (8,32] carries nothing
                (64.0, 13.0), // (32,64]: 3
                (f64::INFINITY, 13.0),
            ]
        );
    }

    /// schema 8 (finest, ~0.27% bucket spacing): adjacent bounds must stay distinct
    /// `le` labels.
    #[test]
    fn test_expand_native_histogram_schema8_adjacent_bounds_distinct() {
        let hp = prometheus_rpc::Histogram {
            schema: 8,
            count: Some(prometheus_rpc::histogram::Count::CountInt(8)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 250,
                length: 2,
            }],
            positive_deltas: vec![5, -2],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        let buckets = bucket_records(&recs);
        // lower marker at idx 249's bound, uppers for idx 250 and 251, then inf
        assert_eq!(buckets.len(), 4);
        assert_eq!(
            buckets.iter().map(|(_, c)| *c).collect::<Vec<_>>(),
            vec![0.0, 5.0, 8.0, 8.0]
        );
        assert_eq!(buckets[1].0, 1.968);
        assert_eq!(buckets[2].0, 1.973);
    }

    /// Power-of-two bounds are exact and a boundary shared between schemas is the
    /// identical f64.
    #[test]
    fn test_bucket_bounds_are_exact_and_schema_aligned() {
        assert_eq!(bucket_bound(2, 12), 8.0); // 2^(12/4)
        assert_eq!(bucket_bound(2, -16), 0.0625); // 2^(-16/4)
        assert_eq!(bucket_bound(0, 3), 8.0);
        assert_eq!(bucket_bound(-1, 2), 16.0); // 2^(2*2)
        assert_eq!(bucket_bound(2, 12).to_string(), "8");
        // shared boundary across schemas: schema 2 idx 4 == schema 1 idx 2 == schema 0 idx 1
        assert_eq!(bucket_bound(2, 4), bucket_bound(0, 1));
        assert_eq!(bucket_bound(2, 4), 2.0);
    }

    /// `le` labels carry 4 significant digits rendered as the shortest decimal.
    #[test]
    fn test_format_le() {
        assert_eq!(format_le(8.0), "8");
        assert_eq!(format_le(0.5946035575013605), "0.5946");
        assert_eq!(format_le(0.022097086912079608), "0.0221");
        assert_eq!(format_le(-0.7071067811865476), "-0.7071");
        assert_eq!(format_le(f64::INFINITY), "inf");
        assert_eq!(format_le(0.00001), "0.00001");
        // finest schema stays collision-free
        assert_ne!(
            format_le(bucket_bound(8, 250)),
            format_le(bucket_bound(8, 251))
        );
    }

    /// A `zero_threshold` that rounds onto a neighboring bucket bound merges into one
    /// record instead of emitting two records with the same `le`.
    #[test]
    fn test_expand_native_histogram_merges_le_rounding_collisions() {
        let hp = prometheus_rpc::Histogram {
            zero_threshold: 1.0001, // rounds to le="1", same as bucket idx 0's bound
            count: Some(prometheus_rpc::histogram::Count::CountInt(5)),
            zero_count: Some(prometheus_rpc::histogram::ZeroCount::ZeroCountInt(2)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 1,
            }],
            positive_deltas: vec![3],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        // both uppers format to "1" and merge, keeping the full cumulative 5
        assert_eq!(
            bucket_records(&recs),
            vec![(0.5, 0.0), (1.0, 5.0), (f64::INFINITY, 5.0)]
        );
    }

    /// Over-limit samples are downscaled (bucket pairs merged), not truncated.
    #[test]
    fn test_expand_native_histogram_downscales_to_bucket_limit() {
        let hp = prometheus_rpc::Histogram {
            schema: 2, // base = 2^(1/4)
            count: Some(prometheus_rpc::histogram::Count::CountInt(36)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 1,
                length: 8, // idx 1..=8, counts 1..=8
            }],
            positive_deltas: vec![1, 1, 1, 1, 1, 1, 1, 1],
            ..native_histogram_base()
        };

        // no limit pressure: 8 buckets stay at schema 2
        let full = expand_with_bucket_limit(&hp, 64);
        assert_eq!(bucket_records(&full).len(), 10); // 8 uppers + 1 lower marker + inf

        // limit 4 le labels: two halvings land on schema 0
        let scaled = expand_with_bucket_limit(&hp, 4);
        assert_bucket_invariants(&scaled);
        assert_eq!(
            bucket_records(&scaled),
            vec![
                (1.0, 0.0),  // lower marker
                (2.0, 10.0), // (1, 2]: 1+2+3+4
                (4.0, 36.0), // (2, 4]: 5+6+7+8
                (f64::INFINITY, 36.0),
            ]
        );
        // total observations survive downscaling
        assert_eq!(scalar_record(&scaled, "_count"), 36.0);
    }

    /// The limit counts emitted `le` labels, not populated buckets: isolated buckets
    /// each add a gap marker, so 4 populated buckets can mean 9 labels.
    #[test]
    fn test_expand_native_histogram_limit_counts_le_labels_not_buckets() {
        let hp = prometheus_rpc::Histogram {
            schema: 3,
            count: Some(prometheus_rpc::histogram::Count::CountInt(4)),
            positive_spans: (0..4)
                .map(|i| prometheus_rpc::BucketSpan {
                    offset: if i == 0 { 0 } else { 1 },
                    length: 1,
                })
                .collect(),
            positive_deltas: vec![1, 0, 0, 0], // idx 0, 2, 4, 6: count 1 each
            ..native_histogram_base()
        };

        // 4 buckets + 4 markers + inf = 9 labels > 8: one halving makes them
        // contiguous (idx 0..=3 at schema 2), 6 labels
        let recs = expand_with_bucket_limit(&hp, 8);
        assert_bucket_invariants(&recs);
        assert_eq!(bucket_records(&recs).len(), 6);
        assert_eq!(scalar_record(&recs, "_count"), 4.0);
    }

    /// A schema -4 sample over the limit keeps merging below the native schema floor
    /// instead of silently exceeding the cap.
    #[test]
    fn test_expand_native_histogram_downscales_below_native_schema_floor() {
        let hp = prometheus_rpc::Histogram {
            schema: -4,
            count: Some(prometheus_rpc::histogram::Count::CountInt(6)),
            positive_spans: (0..6)
                .map(|i| prometheus_rpc::BucketSpan {
                    offset: if i == 0 { 0 } else { 1 },
                    length: 1,
                })
                .collect(),
            positive_deltas: vec![1, 0, 0, 0, 0, 0], // idx 0,2,4,6,8,10
            ..native_histogram_base()
        };
        let recs = expand_with_bucket_limit(&hp, 5);
        assert_bucket_invariants(&recs);
        assert!(bucket_records(&recs).len() <= 5);
        assert_eq!(scalar_record(&recs, "_count"), 6.0);
        assert_eq!(bucket_records(&recs).last().unwrap().1, 6.0);
    }

    /// A wide zero bucket overlapping the first bucket's lower bound must not emit a
    /// gap marker inside it -- `le` stays strictly increasing.
    #[test]
    fn test_expand_native_histogram_zero_bucket_overlapping_first_bucket() {
        let hp = prometheus_rpc::Histogram {
            schema: -4,
            zero_threshold: 0.5, // > 1/65536, the (0, 1] bucket's lower bound
            count: Some(prometheus_rpc::histogram::Count::CountInt(4)),
            zero_count: Some(prometheus_rpc::histogram::ZeroCount::ZeroCountInt(1)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 1,
            }],
            positive_deltas: vec![3],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(
            bucket_records(&recs),
            vec![(-0.5, 0.0), (0.5, 1.0), (1.0, 4.0), (f64::INFINITY, 4.0)]
        );
    }

    /// The gauge reset hint changes rate/reset semantics at query time, not the bucket
    /// layout: expansion output is identical with and without it.
    #[test]
    fn test_expand_native_histogram_gauge_hint_is_ignored() {
        let counter = prometheus_rpc::Histogram {
            sum: 9.0,
            count: Some(prometheus_rpc::histogram::Count::CountInt(5)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 1,
            }],
            positive_deltas: vec![5],
            ..native_histogram_base()
        };
        let gauge = prometheus_rpc::Histogram {
            reset_hint: prometheus_rpc::histogram::ResetHint::Gauge as i32,
            ..counter.clone()
        };
        assert_eq!(
            expand_native_histogram(&counter),
            expand_native_histogram(&gauge)
        );
    }

    /// A histogram whose observations all landed in the zero bucket has no spans at
    /// all; it must still round-trip as `[-zt: 0, zt: n, inf: n]`.
    #[test]
    fn test_expand_native_histogram_zero_bucket_only() {
        let hp = prometheus_rpc::Histogram {
            zero_threshold: 0.25,
            count: Some(prometheus_rpc::histogram::Count::CountInt(5)),
            zero_count: Some(prometheus_rpc::histogram::ZeroCount::ZeroCountInt(5)),
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(
            bucket_records(&recs),
            vec![(-0.25, 0.0), (0.25, 5.0), (f64::INFINITY, 5.0)]
        );
    }

    /// Spans promising more buckets than the data carries: decode truncates, keeping
    /// the buckets seen so far.
    #[test]
    fn test_expand_native_histogram_truncated_deltas() {
        let hp = prometheus_rpc::Histogram {
            count: Some(prometheus_rpc::histogram::Count::CountInt(9)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 3, // promises 3 buckets
            }],
            positive_deltas: vec![9], // carries 1
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(
            bucket_records(&recs),
            vec![(0.5, 0.0), (1.0, 9.0), (f64::INFINITY, 9.0)]
        );
    }

    /// A count larger than the bucket total is kept on `_count` and `le="inf"`.
    #[test]
    fn test_expand_native_histogram_count_exceeds_buckets() {
        let hp = prometheus_rpc::Histogram {
            count: Some(prometheus_rpc::histogram::Count::CountInt(10)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 1,
            }],
            positive_deltas: vec![7],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(scalar_record(&recs, "_count"), 10.0);
        assert_eq!(
            bucket_records(&recs),
            vec![(0.5, 0.0), (1.0, 7.0), (f64::INFINITY, 10.0)]
        );
    }

    /// Both bounds of an extreme bucket clamp to `f64::MAX`: the gap marker is
    /// suppressed and the record stays distinct from `le="inf"`.
    #[test]
    fn test_expand_native_histogram_bound_overflow_clamps() {
        let hp = prometheus_rpc::Histogram {
            count: Some(prometheus_rpc::histogram::Count::CountInt(4)),
            positive_spans: vec![
                prometheus_rpc::BucketSpan {
                    offset: 0,
                    length: 1,
                },
                prometheus_rpc::BucketSpan {
                    offset: 1079, // idx 1080: 2^1080 and 2^1079 both overflow f64
                    length: 1,
                },
            ],
            positive_deltas: vec![3, -2],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(
            bucket_records(&recs),
            vec![
                (0.5, 0.0),
                (1.0, 3.0),
                // rounding f64::MAX to 4 digits would overflow to infinity and collide
                // with the inf bucket, so the clamped bound keeps full precision
                (f64::MAX, 4.0),
                (f64::INFINITY, 4.0),
            ]
        );
    }

    /// NaN float counts are skipped; the remaining buckets keep their positions.
    #[test]
    fn test_expand_native_histogram_nan_float_count_skipped() {
        let hp = prometheus_rpc::Histogram {
            count: Some(prometheus_rpc::histogram::Count::CountFloat(5.0)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 1,
                length: 2,
            }],
            positive_counts: vec![f64::NAN, 5.0],
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        // idx 1 (NaN) skipped; idx 2 -> (2, 4] with its lower-bound marker
        assert_eq!(
            bucket_records(&recs),
            vec![(2.0, 0.0), (4.0, 5.0), (f64::INFINITY, 5.0)]
        );
    }

    /// An interior empty bucket is skipped; the gap marker pins the next bucket's
    /// lower bound.
    #[test]
    fn test_expand_native_histogram_interior_zero_bucket_gap() {
        let hp = prometheus_rpc::Histogram {
            count: Some(prometheus_rpc::histogram::Count::CountInt(5)),
            positive_spans: vec![prometheus_rpc::BucketSpan {
                offset: 0,
                length: 3,
            }],
            positive_deltas: vec![3, -3, 2], // buckets 3, 0, 2
            ..native_histogram_base()
        };
        let recs = expand_native_histogram(&hp);
        assert_bucket_invariants(&recs);
        assert_eq!(
            bucket_records(&recs),
            vec![
                (0.5, 0.0),
                (1.0, 3.0),
                (2.0, 3.0), // idx 1 empty: le=2 is the gap marker for (2, 4]
                (4.0, 5.0),
                (f64::INFINITY, 5.0),
            ]
        );
    }
}
