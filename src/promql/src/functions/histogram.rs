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
        histogram::O2FloatHistogram,
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

    let mut range_values = Vec::new();
    for mut rv in in_matrix {
        if let Some(histograms) = rv.histogram_samples.take()
            && !histograms.is_empty()
        {
            let mut samples = Vec::with_capacity(histograms.len());
            for sample in histograms {
                let histogram = sample
                    .histogram
                    .float()
                    .map_err(|err| DataFusionError::Execution(err.to_string()))?;
                samples.push(Sample::new(
                    sample.timestamp,
                    native_histogram_quantile(phi, histogram)?,
                ));
            }
            range_values.push(RangeValue {
                labels: rv.labels.without_metric_name(),
                samples,
                histogram_samples: Some(Vec::new()),
                exemplars: None,
                time_window: None,
            });
            continue;
        }
        // Verify this metric has a bucket label
        if rv.labels.get_value(BUCKET_LABEL).parse::<f64>().is_err() {
            continue;
        }

        let sig = signature_without_labels(&rv.labels, &[HASH_LABEL, NAME_LABEL, BUCKET_LABEL]);
        metrics_by_sig.entry(sig).or_default().push(rv);
    }

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
                    buckets.push(Bucket::new(upper_bound, sample.value));
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
                histogram_samples: None,
                exemplars: None,
                time_window: None,
            });
        }
    }

    Ok(Value::Matrix(range_values))
}

pub(crate) fn histogram_count(data: Value) -> Result<Value> {
    histogram_scalar(data, |histogram| histogram.count)
}

pub(crate) fn histogram_sum(data: Value) -> Result<Value> {
    histogram_scalar(data, |histogram| histogram.sum)
}

pub(crate) fn histogram_avg(data: Value) -> Result<Value> {
    histogram_scalar(data, |histogram| histogram.sum / histogram.count)
}

pub(crate) fn histogram_fraction(lower: f64, upper: f64, data: Value) -> Result<Value> {
    let Value::Matrix(matrix) = data else {
        return if matches!(data, Value::None) {
            Ok(Value::None)
        } else {
            Err(DataFusionError::Plan(
                "histogram_fraction: vector or matrix argument expected".into(),
            ))
        };
    };
    let mut output = Vec::new();
    for rv in matrix {
        let Some(histograms) = rv.histogram_samples else {
            continue;
        };
        let mut samples = Vec::with_capacity(histograms.len());
        for sample in histograms {
            let histogram = sample
                .histogram
                .float()
                .map_err(|err| DataFusionError::Execution(err.to_string()))?;
            samples.push(Sample::new(
                sample.timestamp,
                native_histogram_fraction(lower, upper, histogram)?,
            ));
        }
        if !samples.is_empty() {
            output.push(RangeValue {
                labels: rv.labels.without_metric_name(),
                samples,
                histogram_samples: Some(Vec::new()),
                exemplars: None,
                time_window: rv.time_window,
            });
        }
    }
    Ok(Value::Matrix(output))
}

fn histogram_scalar(data: Value, value: impl Fn(&O2FloatHistogram) -> f64) -> Result<Value> {
    let Value::Matrix(matrix) = data else {
        return if matches!(data, Value::None) {
            Ok(Value::None)
        } else {
            Err(DataFusionError::Plan(
                "native histogram vector or matrix argument expected".into(),
            ))
        };
    };
    let mut output = Vec::new();
    for rv in matrix {
        let Some(histograms) = rv.histogram_samples else {
            continue;
        };
        let mut samples = Vec::with_capacity(histograms.len());
        for sample in histograms {
            let histogram = sample
                .histogram
                .float()
                .map_err(|err| DataFusionError::Execution(err.to_string()))?;
            samples.push(Sample::new(sample.timestamp, value(histogram)));
        }
        if !samples.is_empty() {
            output.push(RangeValue {
                labels: rv.labels.without_metric_name(),
                samples,
                histogram_samples: Some(Vec::new()),
                exemplars: None,
                time_window: rv.time_window,
            });
        }
    }
    Ok(Value::Matrix(output))
}

fn native_histogram_quantile(phi: f64, histogram: &O2FloatHistogram) -> Result<f64> {
    if phi < 0.0 {
        return Ok(f64::NEG_INFINITY);
    }
    if phi > 1.0 {
        return Ok(f64::INFINITY);
    }
    if histogram.count == 0.0 || phi.is_nan() {
        return Ok(f64::NAN);
    }

    let buckets = histogram
        .all_buckets()
        .map_err(|err| DataFusionError::Execution(err.to_string()))?;
    let reverse = !histogram.sum.is_nan() && phi >= 0.5;
    let mut rank = if reverse {
        (1.0 - phi) * histogram.count
    } else {
        phi * histogram.count
    };
    let mut count = 0.0;
    let mut selected = None;
    let iterator: Box<dyn Iterator<Item = _>> = if reverse {
        Box::new(buckets.iter().rev().copied())
    } else {
        Box::new(buckets.iter().copied())
    };
    for bucket in iterator {
        if bucket.count == 0.0 {
            continue;
        }
        count += bucket.count;
        selected = Some(bucket);
        if count >= rank {
            break;
        }
    }
    let Some(mut bucket) = selected else {
        return Ok(f64::NAN);
    };
    if bucket.lower < 0.0 && bucket.upper > 0.0 {
        if histogram.negative_buckets.is_empty() && !histogram.positive_buckets.is_empty() {
            bucket.lower = 0.0;
        } else if histogram.positive_buckets.is_empty() && !histogram.negative_buckets.is_empty() {
            bucket.upper = 0.0;
        }
    }
    count = count.min(histogram.count);
    if count < rank {
        return if histogram.sum.is_nan() {
            Ok(f64::NAN)
        } else {
            Ok(bucket.upper)
        };
    }
    if reverse {
        rank = count - rank;
    } else {
        rank -= count - bucket.count;
    }
    let fraction = rank / bucket.count;
    if bucket.lower <= 0.0 && bucket.upper >= 0.0 {
        return Ok(bucket.lower + (bucket.upper - bucket.lower) * fraction);
    }
    let log_lower = bucket.lower.abs().log2();
    let log_upper = bucket.upper.abs().log2();
    if bucket.lower > 0.0 {
        Ok(2.0_f64.powf(log_lower + (log_upper - log_lower) * fraction))
    } else {
        Ok(-2.0_f64.powf(log_upper + (log_lower - log_upper) * (1.0 - fraction)))
    }
}

fn native_histogram_fraction(lower: f64, upper: f64, histogram: &O2FloatHistogram) -> Result<f64> {
    if histogram.count == 0.0 || lower.is_nan() || upper.is_nan() {
        return Ok(f64::NAN);
    }
    if lower >= upper {
        return Ok(0.0);
    }
    let buckets = histogram
        .all_buckets()
        .map_err(|err| DataFusionError::Execution(err.to_string()))?;
    let mut rank = 0.0;
    let mut lower_rank = None;
    let mut upper_rank = None;
    for mut bucket in buckets {
        let zero_bucket = bucket.lower <= 0.0 && bucket.upper >= 0.0;
        if zero_bucket {
            if histogram.negative_buckets.is_empty() && !histogram.positive_buckets.is_empty() {
                bucket.lower = 0.0;
            } else if histogram.positive_buckets.is_empty()
                && !histogram.negative_buckets.is_empty()
            {
                bucket.upper = 0.0;
            }
        }
        let interpolate = |bound: f64| {
            if zero_bucket {
                rank + bucket.count * (bound - bucket.lower) / (bucket.upper - bucket.lower)
            } else {
                let log_lower = bucket.lower.abs().log2();
                let log_upper = bucket.upper.abs().log2();
                let log_bound = bound.abs().log2();
                let fraction = if bound > 0.0 {
                    (log_bound - log_lower) / (log_upper - log_lower)
                } else {
                    1.0 - (log_bound - log_upper) / (log_lower - log_upper)
                };
                rank + bucket.count * fraction
            }
        };
        if lower_rank.is_none() {
            if bucket.lower >= lower {
                lower_rank = Some(rank);
            } else if bucket.lower < lower && bucket.upper > lower {
                lower_rank = Some(interpolate(lower));
            }
        }
        if upper_rank.is_none() {
            if bucket.lower >= upper {
                upper_rank = Some(rank);
            } else if bucket.lower < upper && bucket.upper > upper {
                upper_rank = Some(interpolate(upper));
            }
        }
        if lower_rank.is_some() && upper_rank.is_some() {
            break;
        }
        rank += bucket.count;
    }
    let count = histogram.count;
    let lower_rank = lower_rank.unwrap_or(count).min(count);
    let upper_rank = upper_rank.unwrap_or(count).min(count);
    Ok((upper_rank - lower_rank) / count)
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
    use config::meta::promql::histogram::{
        CounterResetHint, HistogramSample, HistogramSpan, O2FloatHistogram,
    };
    use expect_test::expect;

    use super::*;

    fn native_value() -> Value {
        let histogram = O2FloatHistogram {
            schema: 0,
            zero_threshold: 0.0,
            zero_count: 0.0,
            count: 4.0,
            sum: 5.0,
            positive_spans: vec![HistogramSpan {
                offset: 0,
                length: 2,
            }],
            negative_spans: vec![],
            positive_buckets: vec![2.0, 2.0],
            negative_buckets: vec![],
            counter_reset_hint: CounterResetHint::Gauge,
            start_time: 0,
        };
        Value::Matrix(vec![RangeValue {
            labels: vec![],
            samples: vec![],
            histogram_samples: Some(vec![HistogramSample::from_decoded(1_000_000, histogram)]),
            exemplars: None,
            time_window: None,
        }])
    }

    fn only_float(value: Value) -> f64 {
        let Value::Matrix(matrix) = value else {
            panic!("matrix expected")
        };
        matrix[0].samples[0].value
    }

    #[test]
    fn test_native_histogram_functions() {
        let eval_ctx = EvalContext::new(1_000_000, 1_000_000, 1, "test".into());
        assert_eq!(only_float(histogram_count(native_value()).unwrap()), 4.0);
        assert_eq!(only_float(histogram_sum(native_value()).unwrap()), 5.0);
        assert_eq!(only_float(histogram_avg(native_value()).unwrap()), 1.25);
        assert_eq!(
            only_float(histogram_quantile(0.5, native_value(), &eval_ctx).unwrap()),
            1.0
        );
        assert_eq!(
            only_float(histogram_fraction(0.0, 1.0, native_value()).unwrap()),
            0.5
        );
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
