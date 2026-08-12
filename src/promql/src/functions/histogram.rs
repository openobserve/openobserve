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

use config::{
    meta::promql::{
        BUCKET_LABEL, HASH_LABEL, NAME_LABEL,
        value::{EvalContext, LabelsExt, RangeValue, Sample, Value, signature_without_labels},
    },
    utils::sort::sort_float,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashMap;

// https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L33
#[derive(Debug, Clone, PartialEq)]
struct Bucket {
    upper_bound: f64,
    count: f64,
}

impl Bucket {
    fn new(upper_bound: f64, count: f64) -> Self {
        Self { upper_bound, count }
    }
}

struct BucketSeries {
    upper_bound: f64,
    samples: Vec<Sample>,
    cursor: usize,
}

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn histogram_quantile(phi: f64, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    // Handle input data - convert to matrix format if needed
    let in_matrix = match data {
        Value::Matrix(m) => m,
        Value::None => {
            return Ok(Value::None);
        }
        _ => {
            return Err(DataFusionError::Plan(
                "histogram_quantile: vector or matrix argument expected".to_owned(),
            ));
        }
    };

    // Always use range query path - compute all timestamps at once
    let timestamps = eval_ctx.timestamps();

    // Group metrics by their signature (without bucket label)
    let mut metrics_by_sig: HashMap<u64, Vec<RangeValue>> = HashMap::default();

    for rv in in_matrix {
        // Verify this metric has a bucket label
        if rv.labels.get_value(BUCKET_LABEL).parse::<f64>().is_err() {
            continue;
        }

        let sig = signature_without_labels(&rv.labels, &[HASH_LABEL, NAME_LABEL, BUCKET_LABEL]);
        metrics_by_sig.entry(sig).or_default().push(rv);
    }

    let mut range_values = Vec::new();

    for (_sig, bucket_series) in metrics_by_sig {
        // Get the labels (without bucket label) from the first series
        let mut base_labels = bucket_series[0].labels.clone();
        base_labels
            .retain(|l| l.name != HASH_LABEL && l.name != NAME_LABEL && l.name != BUCKET_LABEL);

        // Parse each upper bound once and keep a monotonic cursor into each
        // bucket's samples. The old implementation restarted `find()` from
        // the beginning for every evaluation timestamp, making a range query
        // O(bucket_series * timestamps^2).
        let mut bucket_series = bucket_series
            .into_iter()
            .filter_map(|series| {
                series
                    .labels
                    .get_value(BUCKET_LABEL)
                    .parse()
                    .ok()
                    .map(|upper_bound| BucketSeries {
                        upper_bound,
                        samples: series.samples,
                        cursor: 0,
                    })
            })
            .collect::<Vec<_>>();

        let mut samples = Vec::with_capacity(timestamps.len());

        // For each timestamp, compute histogram_quantile
        for &eval_ts in &timestamps {
            let mut buckets = Vec::new();

            // Collect bucket values at this timestamp
            for series in &mut bucket_series {
                while series.cursor < series.samples.len()
                    && series.samples[series.cursor].timestamp < eval_ts
                {
                    series.cursor += 1;
                }

                let value = if series.cursor < series.samples.len()
                    && series.samples[series.cursor].timestamp == eval_ts
                {
                    Some(series.samples[series.cursor].value)
                } else {
                    // Preserve the existing fallback for sparse inputs.
                    series.samples.first().map(|sample| sample.value)
                };
                if let Some(value) = value {
                    buckets.push(Bucket::new(series.upper_bound, value));
                }
            }

            if !buckets.is_empty() {
                let quantile_value = bucket_quantile(phi, buckets);
                samples.push(Sample::new(eval_ts, quantile_value));
            }
        }

        if !samples.is_empty() {
            range_values.push(RangeValue {
                labels: base_labels,
                samples,
                exemplars: None,
                time_window: None,
            });
        }
    }

    Ok(Value::Matrix(range_values))
}

// cf. https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L76
fn bucket_quantile(phi: f64, mut buckets: Vec<Bucket>) -> f64 {
    if phi.is_nan() || buckets.is_empty() {
        return f64::NAN;
    }
    if phi < 0.0 {
        return f64::NEG_INFINITY;
    }
    if phi > 1.0 {
        return f64::INFINITY;
    }
    buckets.sort_by(|a, b| sort_float(&a.upper_bound, &b.upper_bound));
    // The caller of `bucket_quantile` guarantees that `buckets` is non-empty.
    let highest_bucket = &buckets[buckets.len() - 1];
    if !(highest_bucket.upper_bound.is_infinite() && highest_bucket.upper_bound.is_sign_positive())
    {
        return f64::NAN;
    }
    let mut buckets = coalesce_buckets(buckets);
    ensure_monotonic(&mut buckets);
    let buckets = buckets;
    if buckets.len() < 2 {
        return f64::NAN;
    }
    let observations = buckets[buckets.len() - 1].count;
    if observations == 0.0 {
        return f64::NAN;
    }
    let mut rank = phi * observations;
    let b = match buckets[..buckets.len() - 1]
        .iter()
        .position(|b| b.count >= rank)
    {
        Some(b) => b,
        None => buckets.len() - 1, // Should not reach here if data is valid
    };
    if b == buckets.len() - 1 {
        return buckets[buckets.len() - 2].upper_bound;
    }
    if b == 0 && buckets[0].upper_bound <= 0.0 {
        return buckets[0].upper_bound;
    }
    let bucket_end = buckets[b].upper_bound;
    let mut count = buckets[b].count;
    let bucket_start = if b > 0 {
        count -= buckets[b - 1].count;
        rank -= buckets[b - 1].count;
        buckets[b - 1].upper_bound
    } else {
        0.0
    };

    bucket_start + (bucket_end - bucket_start) * (rank / count)
}

/// `coalesce_buckets` merges buckets with the same upper bound.
/// The input buckets must be sorted.
fn coalesce_buckets(buckets: Vec<Bucket>) -> Vec<Bucket> {
    let mut st = None;
    let mut buckets = buckets
        .into_iter()
        .filter_map(|b| match st.as_mut() {
            None => {
                st = Some(b);
                None
            }
            Some(last) => {
                if b.upper_bound == last.upper_bound {
                    st = Some(Bucket::new(last.upper_bound, last.count + b.count));
                    None
                } else {
                    let nb = last.clone();
                    *last = b;
                    Some(nb)
                }
            }
        })
        .collect::<Vec<_>>();
    if let Some(last) = st {
        buckets.push(last);
    }
    buckets
}

// For the rationale behind this function, see
// https://github.com/prometheus/prometheus/blob/0bf707e288eaa8694105e53c81a102017529793d/promql/quantile.go#L314-L347
fn ensure_monotonic(buckets: &mut [Bucket]) {
    let mut max = buckets[0].count;
    for bucket in &mut buckets[1..] {
        if bucket.count > max {
            max = bucket.count;
        } else if bucket.count < max {
            bucket.count = max;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::Label;
    use expect_test::expect;

    use super::*;

    fn histogram_series(le: &str, samples: &[(i64, f64)]) -> RangeValue {
        RangeValue {
            labels: vec![
                Arc::new(Label::new(NAME_LABEL, "request_duration_bucket")),
                Arc::new(Label::new(BUCKET_LABEL, le)),
                Arc::new(Label::new("path", "/api")),
            ],
            samples: samples
                .iter()
                .map(|&(timestamp, value)| Sample::new(timestamp, value))
                .collect(),
            exemplars: None,
            time_window: None,
        }
    }

    #[test]
    fn test_histogram_quantile_advances_bucket_cursors_and_preserves_sparse_fallback() {
        let input = Value::Matrix(vec![
            histogram_series("1", &[(100, 2.0), (300, 4.0)]),
            histogram_series("2", &[(100, 4.0), (200, 6.0), (300, 8.0)]),
            histogram_series("+Inf", &[(100, 8.0), (200, 10.0), (300, 12.0)]),
        ]);
        let eval_ctx = EvalContext::new(100, 300, 100, "histogram-cursor-test".to_string());

        let Value::Matrix(result) = histogram_quantile(0.5, input, &eval_ctx).unwrap() else {
            panic!("expected matrix")
        };
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].samples.len(), 3);
        assert_eq!(result[0].samples[0].value, 2.0);
        // le=1 is missing at 200, so the historical first-sample fallback is
        // still used: [2, 6, 10] => p50 1.75.
        assert_eq!(result[0].samples[1].value, 1.75);
        assert_eq!(result[0].samples[2].value, 1.5);
    }

    #[test]
    fn test_coalesce_buckets() {
        let buckets = vec![
            Bucket::new(1.0, 2.0),
            Bucket::new(1.0, 3.0),
            Bucket::new(2.0, 4.0),
            Bucket::new(3.0, 1.0),
            Bucket::new(3.0, 1.0),
        ];

        expect![[r#"
            [
                Bucket {
                    upper_bound: 1.0,
                    count: 5.0,
                },
                Bucket {
                    upper_bound: 2.0,
                    count: 4.0,
                },
                Bucket {
                    upper_bound: 3.0,
                    count: 2.0,
                },
            ]
        "#]]
        .assert_debug_eq(&coalesce_buckets(buckets));
    }

    #[test]
    fn test_coalesce_buckets_regular() {
        let buckets = vec![
            Bucket::new(1.0, 2.0),
            Bucket::new(2.0, 3.0),
            Bucket::new(2.0, 5.0),
            Bucket::new(3.0, 4.0),
            Bucket::new(4.0, 1.0),
        ];

        let expected_result = vec![
            Bucket::new(1.0, 2.0),
            Bucket::new(2.0, 8.0),
            Bucket::new(3.0, 4.0),
            Bucket::new(4.0, 1.0),
        ];

        let result = coalesce_buckets(buckets.clone());

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_coalesce_buckets_empty() {
        let buckets = vec![];

        let expected_result = vec![];

        let result = coalesce_buckets(buckets.clone());

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_coalesce_buckets_single_element() {
        let buckets = vec![Bucket::new(1.0, 2.0)];

        let expected_result = vec![Bucket::new(1.0, 2.0)];

        let result = coalesce_buckets(buckets.clone());

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_coalesce_buckets_all_same() {
        let buckets = vec![
            Bucket::new(1.0, 2.0),
            Bucket::new(1.0, 3.0),
            Bucket::new(1.0, 5.0),
        ];

        let expected_result = vec![Bucket::new(1.0, 10.0)];

        let result = coalesce_buckets(buckets.clone());

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_ensure_monotonic() {
        let mut buckets = vec![
            Bucket::new(1.0, 2.0),
            Bucket::new(2.0, 1.0),
            Bucket::new(3.0, 4.0),
            Bucket::new(4.0, 3.0),
            Bucket::new(5.0, 5.0),
        ];
        ensure_monotonic(&mut buckets);
        expect![[r#"
            [
                Bucket {
                    upper_bound: 1.0,
                    count: 2.0,
                },
                Bucket {
                    upper_bound: 2.0,
                    count: 2.0,
                },
                Bucket {
                    upper_bound: 3.0,
                    count: 4.0,
                },
                Bucket {
                    upper_bound: 4.0,
                    count: 4.0,
                },
                Bucket {
                    upper_bound: 5.0,
                    count: 5.0,
                },
            ]
        "#]]
        .assert_debug_eq(&buckets);
    }

    #[test]
    fn test_ensure_monotonic_single_bucket() {
        let mut buckets = vec![Bucket::new(1.0, 2.0)];
        ensure_monotonic(&mut buckets);
        assert_eq!(buckets, vec![Bucket::new(1.0, 2.0),]);
    }

    #[test]
    fn test_ensure_monotonic_increasing() {
        let mut buckets = vec![
            Bucket::new(1.0, 2.0),
            Bucket::new(2.0, 3.0),
            Bucket::new(3.0, 4.0),
            Bucket::new(4.0, 5.0),
        ];
        ensure_monotonic(&mut buckets);
        assert_eq!(
            buckets,
            vec![
                Bucket::new(1.0, 2.0),
                Bucket::new(2.0, 3.0),
                Bucket::new(3.0, 4.0),
                Bucket::new(4.0, 5.0),
            ]
        );
    }

    #[test]
    fn test_ensure_monotonic_decreasing() {
        let mut buckets = vec![
            Bucket::new(1.0, 5.0),
            Bucket::new(2.0, 4.0),
            Bucket::new(3.0, 3.0),
            Bucket::new(4.0, 2.0),
        ];
        ensure_monotonic(&mut buckets);
        assert_eq!(
            buckets,
            vec![
                Bucket::new(1.0, 5.0),
                Bucket::new(2.0, 5.0),
                Bucket::new(3.0, 5.0),
                Bucket::new(4.0, 5.0),
            ]
        );
    }

    #[test]
    fn test_ensure_monotonic_mixed() {
        let mut buckets = vec![
            Bucket::new(1.0, 5.0),
            Bucket::new(2.0, 3.0),
            Bucket::new(3.0, 7.0),
            Bucket::new(4.0, 2.0),
        ];
        ensure_monotonic(&mut buckets);
        assert_eq!(
            buckets,
            vec![
                Bucket::new(1.0, 5.0),
                Bucket::new(2.0, 5.0),
                Bucket::new(3.0, 7.0),
                Bucket::new(4.0, 7.0),
            ]
        );
    }
}
