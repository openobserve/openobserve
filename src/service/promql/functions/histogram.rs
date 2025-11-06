// Copyright 2025 OpenObserve Inc.
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
    meta::promql::{BUCKET_LABEL, HASH_LABEL, NAME_LABEL},
    utils::sort::sort_float,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashMap;

use crate::service::promql::value::{
    EvalContext, InstantValue, Labels, LabelsExt, RangeValue, Sample, Value,
    signature_without_labels,
};

// https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L33
#[derive(Debug, Clone, PartialEq)]
struct Bucket {
    upper_bound: f64,
    count: f64,
}

impl Bucket {
    #[allow(dead_code)]
    fn new(upper_bound: f64, count: f64) -> Self {
        Self { upper_bound, count }
    }
}

// https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L45
#[derive(Debug)]
struct MetricWithBuckets {
    labels: Labels,
    buckets: Vec<Bucket>,
}

/// TODO: support native histograms; see [`histogramQuantile`]
///
/// [`histogramQuantile`]: https://github.com/prometheus/prometheus/blob/f7c6130ff27a2a12412c02cce223f7a8abc59e49/promql/quantile.go#L146
pub(crate) fn histogram_quantile(sample_time: i64, phi: f64, data: Value) -> Result<Value> {
    let in_vec = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "histogram_quantile: vector argument expected".to_owned(),
            ));
        }
    };

    let mut metrics_with_buckets: HashMap<u64, MetricWithBuckets> = HashMap::default();
    for InstantValue { mut labels, sample } in in_vec {
        // [https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile]:
        //
        // The conventional float samples in `in_vec` are considered the counts
        // of observations in each bucket of one or more conventional
        // histograms. Each float sample must have a label `le` where the label
        // value denotes the inclusive upper bound of the bucket. *Float samples
        // without such a label are silently ignored.*
        let upper_bound: f64 = match labels.get_value(BUCKET_LABEL).parse() {
            Ok(u) => u,
            Err(_) => continue,
        };

        let sig = signature_without_labels(&labels, &[HASH_LABEL, NAME_LABEL, BUCKET_LABEL]);
        let entry = metrics_with_buckets.entry(sig).or_insert_with(|| {
            labels
                .retain(|l| l.name != HASH_LABEL && l.name != NAME_LABEL && l.name != BUCKET_LABEL);
            MetricWithBuckets {
                labels,
                buckets: Vec::new(),
            }
        });
        entry.buckets.push(Bucket {
            upper_bound,
            count: sample.value,
        });
    }

    let values = metrics_with_buckets
        .into_values()
        .map(|mb| InstantValue {
            labels: mb.labels,
            sample: Sample::new(sample_time, bucket_quantile(phi, mb.buckets)),
        })
        .collect();

    Ok(Value::Vector(values))
}

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn histogram_quantile_range(
    phi: f64,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] histogram_quantile_range() started with phi={}, {} timestamps",
        eval_ctx.trace_id,
        phi,
        eval_ctx.timestamps().len()
    );

    // Handle matrix input for range queries
    let in_matrix = match data {
        Value::Matrix(m) => {
            log::info!(
                "[trace_id: {}] [PromQL Timing] histogram_quantile_range() processing {} series",
                eval_ctx.trace_id,
                m.len()
            );
            m
        }
        Value::Vector(v) => {
            // For instant queries, convert to the original function
            log::info!(
                "[trace_id: {}] [PromQL Timing] histogram_quantile_range() converting vector to instant query",
                eval_ctx.trace_id
            );
            let sample_time = eval_ctx.start;
            return histogram_quantile(sample_time, phi, Value::Vector(v));
        }
        Value::None => {
            log::info!(
                "[trace_id: {}] [PromQL Timing] histogram_quantile_range() received None input",
                eval_ctx.trace_id
            );
            return Ok(Value::None);
        }
        _ => {
            return Err(DataFusionError::Plan(
                "histogram_quantile: vector or matrix argument expected".to_owned(),
            ));
        }
    };

    // For instant queries, use the original implementation
    if eval_ctx.is_instant() {
        let in_vec: Vec<InstantValue> = in_matrix
            .into_iter()
            .flat_map(|rv| {
                rv.samples
                    .into_iter()
                    .map(move |s| InstantValue {
                        labels: rv.labels.clone(),
                        sample: s,
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        return histogram_quantile(eval_ctx.start, phi, Value::Vector(in_vec));
    }

    // For range queries, compute all timestamps at once
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

        let mut samples = Vec::with_capacity(timestamps.len());

        // For each timestamp, compute histogram_quantile
        for &eval_ts in &timestamps {
            let mut buckets = Vec::new();

            // Collect bucket values at this timestamp
            for bucket_rv in &bucket_series {
                let upper_bound: f64 = match bucket_rv.labels.get_value(BUCKET_LABEL).parse() {
                    Ok(u) => u,
                    Err(_) => continue,
                };

                // Find the sample closest to eval_ts
                if let Some(sample) = bucket_rv
                    .samples
                    .iter()
                    .find(|s| s.timestamp == eval_ts)
                    .or_else(|| bucket_rv.samples.first())
                {
                    buckets.push(Bucket {
                        upper_bound,
                        count: sample.value,
                    });
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

    log::info!(
        "[trace_id: {}] [PromQL Timing] histogram_quantile_range() total execution took: {:?}, produced {} series",
        eval_ctx.trace_id,
        start.elapsed(),
        range_values.len()
    );
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
                    st = Some(Bucket {
                        upper_bound: last.upper_bound,
                        count: last.count + b.count,
                    });
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
    use expect_test::expect;

    use super::*;

    #[test]
    fn test_coalesce_buckets() {
        let buckets = vec![
            Bucket {
                upper_bound: 1.0,
                count: 2.0,
            },
            Bucket {
                upper_bound: 1.0,
                count: 3.0,
            },
            Bucket {
                upper_bound: 2.0,
                count: 4.0,
            },
            Bucket {
                upper_bound: 3.0,
                count: 1.0,
            },
            Bucket {
                upper_bound: 3.0,
                count: 1.0,
            },
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
            Bucket {
                upper_bound: 1.0,
                count: 2.0,
            },
            Bucket {
                upper_bound: 2.0,
                count: 1.0,
            },
            Bucket {
                upper_bound: 3.0,
                count: 4.0,
            },
            Bucket {
                upper_bound: 4.0,
                count: 3.0,
            },
            Bucket {
                upper_bound: 5.0,
                count: 5.0,
            },
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
