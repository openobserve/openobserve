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
        value::{
            EvalContext, Labels, LabelsExt, RangeValue, Sample, Value, signature_without_labels,
        },
    },
    utils::sort::sort_float,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashMap;

use crate::scalar_param::ScalarParam;

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
pub(crate) fn histogram_quantile(
    phi: &ScalarParam,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let start = std::time::Instant::now();
    let trace_id = &eval_ctx.trace_id;
    let Some(in_matrix) = histogram_input(data, "histogram_quantile")? else {
        return Ok(Value::None);
    };

    // Always use range query path - compute all timestamps at once
    let timestamps = eval_ctx.timestamps();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] histogram_quantile({phi:?}) started with {} series and {} time points",
        in_matrix.len(),
        timestamps.len()
    );

    let groups = classic_histograms(in_matrix);
    let group_count = groups.len();
    let mut range_values = Vec::with_capacity(group_count);
    let mut coalesced = Vec::new();
    for (labels, bucket_series) in groups {
        let mut samples = Vec::with_capacity(timestamps.len());
        for_each_step(&bucket_series, &timestamps, |eval_ts, buckets| {
            let quantile_value = bucket_quantile_sorted(phi.at(eval_ts), buckets, &mut coalesced);
            samples.push(Sample::new(eval_ts, quantile_value));
            Ok(())
        })?;
        if !samples.is_empty() {
            range_values.push(RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            });
        }
    }

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] histogram_quantile({phi:?}) completed in {:?}, folded {group_count} groups into {} series",
        start.elapsed(),
        range_values.len()
    );
    Ok(Value::Matrix(range_values))
}

/// The fraction of observations between `lower` and `upper`, per classic histogram and step.
pub(crate) fn histogram_fraction(
    lower: &ScalarParam,
    upper: &ScalarParam,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let Some(in_matrix) = histogram_input(data, "histogram_fraction")? else {
        return Ok(Value::None);
    };
    let timestamps = eval_ctx.timestamps();
    let mut range_values = Vec::new();
    let mut coalesced = Vec::new();
    for (labels, bucket_series) in classic_histograms(in_matrix) {
        let mut samples = Vec::with_capacity(timestamps.len());
        for_each_step(&bucket_series, &timestamps, |eval_ts, buckets| {
            let fraction = bucket_fraction(
                lower.at(eval_ts),
                upper.at(eval_ts),
                buckets,
                &mut coalesced,
            );
            samples.push(Sample::new(eval_ts, fraction));
            Ok(())
        })?;
        if !samples.is_empty() {
            range_values.push(RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            });
        }
    }
    Ok(Value::Matrix(range_values))
}

/// One series per quantile and classic histogram, labelled `label="<φ>"` with the φ of each step.
pub(crate) fn histogram_quantiles(
    data: Value,
    label: &str,
    phis: &[ScalarParam],
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let Some(in_matrix) = histogram_input(data, "histogram_quantiles")? else {
        return Ok(Value::None);
    };
    let timestamps = eval_ctx.timestamps();
    let mut range_values = Vec::new();
    let mut scratch = Vec::new();
    let mut coalesced = Vec::new();
    for (labels, bucket_series) in classic_histograms(in_matrix) {
        if labels.iter().any(|existing| existing.name == label) {
            return Err(DataFusionError::Plan(format!(
                "histogram_quantiles: label \"{label}\" already exists on the input"
            )));
        }
        // a φ that varies per step makes one series per distinct value
        let mut series: Vec<(String, Vec<Sample>)> = Vec::new();
        let mut slot_of: HashMap<String, usize> = HashMap::new();
        for_each_step(&bucket_series, &timestamps, |eval_ts, buckets| {
            let mut step_values = Vec::with_capacity(phis.len());
            for phi in phis {
                let phi = phi.at(eval_ts);
                let value = quantile_label(phi);
                if step_values.contains(&value) {
                    return Err(DataFusionError::Plan(format!(
                        "histogram_quantiles: quantile {value} is given twice"
                    )));
                }
                scratch.clear();
                scratch.extend_from_slice(buckets);
                let sample = Sample::new(
                    eval_ts,
                    bucket_quantile_sorted(phi, &mut scratch, &mut coalesced),
                );
                let slot = *slot_of.entry(value.clone()).or_insert_with(|| {
                    series.push((value.clone(), Vec::new()));
                    series.len() - 1
                });
                series[slot].1.push(sample);
                step_values.push(value);
            }
            Ok(())
        })?;
        for (value, samples) in series {
            let mut labels = labels.clone();
            super::set_label(&mut labels, label, &value);
            range_values.push(RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            });
        }
    }
    Ok(Value::Matrix(range_values))
}

/// The error for a function that reads native histograms, which ingest stores as classic buckets.
pub(crate) fn native_histogram_guidance(func_name: &str) -> String {
    let instead = match func_name {
        "histogram_count" => {
            "Query the histogram's `_count` series instead, for example `rate(x_count[5m])`."
        }
        "histogram_sum" => {
            "Query the histogram's `_sum` series instead, for example `rate(x_sum[5m])`."
        }
        "histogram_avg" => {
            "Divide its `_sum` series by its `_count` series instead, for example `rate(x_sum[5m]) / rate(x_count[5m])`."
        }
        _ => "There is no classic-bucket equivalent.",
    };
    format!(
        "`{func_name}` reads native histograms, which OpenObserve stores as classic buckets. {instead}"
    )
}

fn histogram_input(data: Value, func_name: &str) -> Result<Option<Vec<RangeValue>>> {
    match data {
        Value::Matrix(matrix) => Ok(Some(matrix)),
        Value::None => Ok(None),
        _ => Err(DataFusionError::Plan(format!(
            "{func_name}: vector or matrix argument expected"
        ))),
    }
}

/// Bucket series sorted by bound, grouped by every label except `le`, `__name__` and `__hash__`.
fn classic_histograms(in_matrix: Vec<RangeValue>) -> Vec<(Labels, Vec<(f64, RangeValue)>)> {
    let mut metrics_by_sig: HashMap<u64, Vec<(f64, RangeValue)>> = HashMap::default();
    for rv in in_matrix {
        let Ok(upper_bound) = rv.labels.get_value(BUCKET_LABEL).parse::<f64>() else {
            continue;
        };
        let sig = signature_without_labels(&rv.labels, &[HASH_LABEL, NAME_LABEL, BUCKET_LABEL]);
        metrics_by_sig
            .entry(sig)
            .or_default()
            .push((upper_bound, rv));
    }
    metrics_by_sig
        .into_values()
        .map(|mut bucket_series| {
            bucket_series.sort_by(|a, b| sort_float(&a.0, &b.0));
            let labels = bucket_series[0]
                .1
                .labels
                .iter()
                .filter(|l| l.name != HASH_LABEL && l.name != NAME_LABEL && l.name != BUCKET_LABEL)
                .cloned()
                .collect();
            (labels, bucket_series)
        })
        .collect()
}

/// Calls `f` at every step where a bucket of the histogram has a sample, with those buckets.
fn for_each_step(
    bucket_series: &[(f64, RangeValue)],
    timestamps: &[i64],
    mut f: impl FnMut(i64, &mut Vec<Bucket>) -> Result<()>,
) -> Result<()> {
    let mut cursors = vec![0usize; bucket_series.len()];
    let mut buckets = Vec::with_capacity(bucket_series.len());
    for &eval_ts in timestamps {
        buckets.clear();
        for ((upper_bound, bucket_rv), cursor) in bucket_series.iter().zip(cursors.iter_mut()) {
            while *cursor < bucket_rv.samples.len()
                && bucket_rv.samples[*cursor].timestamp < eval_ts
            {
                *cursor += 1;
            }
            if let Some(sample) = bucket_rv
                .samples
                .get(*cursor)
                .filter(|sample| sample.timestamp == eval_ts)
            {
                buckets.push(Bucket::new(*upper_bound, sample.value));
            }
        }
        if !buckets.is_empty() {
            f(eval_ts, &mut buckets)?;
        }
    }
    Ok(())
}

/// Upstream's `FormatOpenMetricsFloat`: Go's shortest `'g'` form, with ".0" on an integral value.
fn quantile_label(phi: f64) -> String {
    if phi == 0.0 {
        return "0.0".to_string();
    }
    if phi.is_nan() {
        return "NaN".to_string();
    }
    if phi.is_infinite() {
        return if phi > 0.0 { "+Inf" } else { "-Inf" }.to_string();
    }
    let scientific = format!("{phi:e}");
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("`{:e}` always writes an exponent");
    let exponent: i32 = exponent.parse().expect("`{:e}` writes a decimal exponent");
    // Go's shortest `'g'` switches to an exponent below 1e-4 and from 1e6
    if !(-4..6).contains(&exponent) {
        let sign = if exponent < 0 { '-' } else { '+' };
        return format!("{mantissa}e{sign}{:02}", exponent.abs());
    }
    let text = phi.to_string();
    if text.contains('.') {
        text
    } else {
        text + ".0"
    }
}

// cf. upstream `BucketFraction` (promql/quantile.go); `buckets` must be sorted by upper bound
fn bucket_fraction(
    lower: f64,
    upper: f64,
    buckets: &mut Vec<Bucket>,
    coalesced: &mut Vec<Bucket>,
) -> f64 {
    if buckets
        .last()
        .is_none_or(|b| b.upper_bound != f64::INFINITY)
    {
        return f64::NAN;
    }
    coalesce_buckets_into(buckets, coalesced);
    let count = coalesced[coalesced.len() - 1].count;
    if count == 0.0 || lower.is_nan() || upper.is_nan() {
        return f64::NAN;
    }
    if lower >= upper {
        return 0.0;
    }
    // the first bucket starts at 0 when its upper bound is positive, else at -Inf
    let mut lower_bound = if coalesced[0].upper_bound <= 0.0 {
        f64::NEG_INFINITY
    } else {
        0.0
    };
    let mut rank = 0.0;
    let mut lower_rank = None;
    let mut upper_rank = None;
    for (i, bucket) in coalesced.iter().enumerate() {
        if i > 0 {
            lower_bound = coalesced[i - 1].upper_bound;
        }
        let upper_bound = bucket.upper_bound;
        // a bucket with an infinite edge is not interpolated
        let interpolate = |v: f64| {
            if lower_bound == f64::NEG_INFINITY {
                bucket.count
            } else {
                rank + (bucket.count - rank) * (v - lower_bound) / (upper_bound - lower_bound)
            }
        };
        if lower_rank.is_none() && lower_bound >= lower {
            lower_rank = Some(rank);
        }
        if upper_rank.is_none() && lower_bound >= upper {
            upper_rank = Some(rank);
        }
        if lower_rank.is_none() && lower_bound < lower && upper_bound > lower {
            lower_rank = Some(interpolate(lower));
        }
        if upper_rank.is_none() && lower_bound < upper && upper_bound > upper {
            upper_rank = Some(interpolate(upper));
        }
        if lower_rank.is_some() && upper_rank.is_some() {
            break;
        }
        rank = bucket.count;
    }
    let capped = |rank: Option<f64>| {
        rank.filter(|rank| *rank <= count || rank.is_nan())
            .unwrap_or(count)
    };
    (capped(upper_rank) - capped(lower_rank)) / count
}

// cf. https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L76
/// Compute a classic histogram quantile from buckets already sorted by upper bound.
fn bucket_quantile_sorted(phi: f64, buckets: &mut Vec<Bucket>, coalesced: &mut Vec<Bucket>) -> f64 {
    if phi.is_nan() || buckets.is_empty() {
        return f64::NAN;
    }
    if phi < 0.0 {
        return f64::NEG_INFINITY;
    }
    if phi > 1.0 {
        return f64::INFINITY;
    }
    // The caller guarantees that `buckets` is non-empty.
    let highest_bucket = &buckets[buckets.len() - 1];
    if !(highest_bucket.upper_bound.is_infinite() && highest_bucket.upper_bound.is_sign_positive())
    {
        return f64::NAN;
    }
    coalesce_buckets_into(buckets, coalesced);
    ensure_monotonic(coalesced);
    let buckets = coalesced;
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

// Equal bounds must be adjacent so their counts accumulate in input order.
fn coalesce_buckets_into(buckets: &mut Vec<Bucket>, merged: &mut Vec<Bucket>) {
    merged.clear();
    for bucket in buckets.drain(..) {
        if let Some(last) = merged.last_mut()
            && bucket.upper_bound == last.upper_bound
        {
            last.count += bucket.count;
        } else {
            merged.push(bucket);
        }
    }
}

#[cfg(test)]
fn coalesce_buckets(mut buckets: Vec<Bucket>) -> Vec<Bucket> {
    let mut merged = Vec::new();
    coalesce_buckets_into(&mut buckets, &mut merged);
    merged
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
    mod legacy {
        use super::*;
        pub(super) fn histogram_quantile(
            phi: f64,
            data: Value,
            eval_ctx: &EvalContext,
        ) -> Result<Value> {
            let start = std::time::Instant::now();
            let trace_id = &eval_ctx.trace_id;

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

            let timestamps = eval_ctx.timestamps();
            log::info!(
                "[trace_id: {trace_id}] [PromQL Timing] histogram_quantile({phi}) started with {} series and {} time points",
                in_matrix.len(),
                timestamps.len()
            );

            let mut metrics_by_sig: HashMap<u64, Vec<(f64, RangeValue)>> = HashMap::default();

            for rv in in_matrix {
                let Ok(upper_bound) = rv.labels.get_value(BUCKET_LABEL).parse::<f64>() else {
                    continue;
                };

                let sig =
                    signature_without_labels(&rv.labels, &[HASH_LABEL, NAME_LABEL, BUCKET_LABEL]);
                metrics_by_sig
                    .entry(sig)
                    .or_default()
                    .push((upper_bound, rv));
            }

            let group_count = metrics_by_sig.len();
            let mut range_values = Vec::with_capacity(group_count);

            for (_sig, mut bucket_series) in metrics_by_sig {
                bucket_series.sort_by(|a, b| sort_float(&a.0, &b.0));
                let base_labels = bucket_series[0]
                    .1
                    .labels
                    .iter()
                    .filter(|l| {
                        l.name != HASH_LABEL && l.name != NAME_LABEL && l.name != BUCKET_LABEL
                    })
                    .cloned()
                    .collect();

                let mut samples = Vec::with_capacity(timestamps.len());
                let mut cursors = vec![0usize; bucket_series.len()];

                for &eval_ts in &timestamps {
                    let mut buckets = Vec::with_capacity(bucket_series.len());

                    for ((upper_bound, bucket_rv), cursor) in
                        bucket_series.iter().zip(cursors.iter_mut())
                    {
                        while *cursor < bucket_rv.samples.len()
                            && bucket_rv.samples[*cursor].timestamp < eval_ts
                        {
                            *cursor += 1;
                        }
                        if let Some(sample) = bucket_rv
                            .samples
                            .get(*cursor)
                            .filter(|sample| sample.timestamp == eval_ts)
                        {
                            buckets.push(Bucket::new(*upper_bound, sample.value));
                        }
                    }

                    if !buckets.is_empty() {
                        let quantile_value = bucket_quantile_sorted(phi, buckets);
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
                "[trace_id: {trace_id}] [PromQL Timing] histogram_quantile({phi}) completed in {:?}, folded {group_count} groups into {} series",
                start.elapsed(),
                range_values.len()
            );
            Ok(Value::Matrix(range_values))
        }

        pub(super) fn bucket_quantile_sorted(phi: f64, buckets: Vec<Bucket>) -> f64 {
            if phi.is_nan() || buckets.is_empty() {
                return f64::NAN;
            }
            if phi < 0.0 {
                return f64::NEG_INFINITY;
            }
            if phi > 1.0 {
                return f64::INFINITY;
            }
            let highest_bucket = &buckets[buckets.len() - 1];
            if !(highest_bucket.upper_bound.is_infinite()
                && highest_bucket.upper_bound.is_sign_positive())
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

        pub(super) fn coalesce_buckets(buckets: Vec<Bucket>) -> Vec<Bucket> {
            let mut merged: Vec<Bucket> = Vec::new();
            for bucket in buckets {
                if let Some(last) = merged.last_mut()
                    && bucket.upper_bound == last.upper_bound
                {
                    last.count += bucket.count;
                } else {
                    merged.push(bucket);
                }
            }
            merged
        }

        pub(super) fn ensure_monotonic(buckets: &mut [Bucket]) {
            let mut max = buckets[0].count;
            for bucket in &mut buckets[1..] {
                if bucket.count > max {
                    max = bucket.count;
                } else if bucket.count < max {
                    bucket.count = max;
                }
            }
        }
    }

    use std::sync::Arc;

    use config::meta::promql::value::Label;
    use expect_test::expect;

    use super::*;

    type MatrixBits = Vec<(Vec<(String, String)>, Vec<(i64, u64)>)>;

    fn random_word(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }

    fn random_count(state: &mut u64) -> f64 {
        let word = random_word(state);
        match word % 13 {
            0 => -0.0,
            1 => f64::INFINITY,
            2 => f64::NEG_INFINITY,
            3 => f64::from_bits(0x7ff8_0000_0000_0042),
            4 => f64::from_bits(1),
            _ => (word % 100_000) as f64 / 17.0 - 100.0,
        }
    }

    #[test]
    fn test_histogram_scratch_quantiles_match_frozen_old_bits() {
        let mut state = 0x8259_a03c_d71f_610bu64;
        let phis = [
            f64::NAN,
            f64::NEG_INFINITY,
            -1.0,
            -0.0,
            0.0,
            0.1,
            0.5,
            0.9,
            1.0,
            2.0,
            f64::INFINITY,
        ];
        let bounds = [
            f64::NEG_INFINITY,
            -1.0,
            -0.0,
            0.0,
            0.5,
            1.0,
            1.0,
            5.0,
            f64::INFINITY,
            f64::NAN,
        ];
        let mut raw = Vec::with_capacity(64);
        let mut merged = Vec::with_capacity(64);
        let raw_pointer = raw.as_ptr();
        let merged_pointer = merged.as_ptr();
        for case in 0..2000 {
            let count = (random_word(&mut state) % 41) as usize;
            let mut source = Vec::with_capacity(count + 1);
            for _ in 0..count {
                let bound = bounds[(random_word(&mut state) % bounds.len() as u64) as usize];
                source.push(Bucket::new(bound, random_count(&mut state)));
            }
            if case % 2 == 0 {
                source.push(Bucket::new(f64::INFINITY, random_count(&mut state)));
            }
            source.sort_by(|a, b| sort_float(&a.upper_bound, &b.upper_bound));
            for phi in phis {
                raw.clear();
                raw.extend(source.iter().cloned());
                let expected = legacy::bucket_quantile_sorted(phi, source.clone());
                let actual = bucket_quantile_sorted(phi, &mut raw, &mut merged);
                assert_eq!(
                    actual.to_bits(),
                    expected.to_bits(),
                    "case={case}, phi={phi}, buckets={source:?}"
                );
                assert_eq!(raw.as_ptr(), raw_pointer);
                assert_eq!(merged.as_ptr(), merged_pointer);
                assert_eq!(raw.capacity(), 64);
                assert_eq!(merged.capacity(), 64);
            }
        }
    }

    #[test]
    fn test_histogram_scratch_reuse_across_empty_valid_and_phi_early_returns() {
        let mut raw = Vec::with_capacity(8);
        let mut merged = Vec::with_capacity(8);
        let cases = [
            (
                0.9,
                vec![Bucket::new(1.0, 2.0), Bucket::new(f64::INFINITY, 3.0)],
            ),
            (0.9, vec![]),
            (f64::NAN, vec![Bucket::new(f64::INFINITY, 9.0)]),
            (-1.0, vec![Bucket::new(1.0, 5.0)]),
            (2.0, vec![Bucket::new(1.0, 5.0)]),
            (0.5, vec![Bucket::new(1.0, 5.0)]),
            (
                0.5,
                vec![
                    Bucket::new(-0.0, -0.0),
                    Bucket::new(0.0, 1.0),
                    Bucket::new(f64::INFINITY, 2.0),
                ],
            ),
            (
                0.9,
                vec![Bucket::new(1.0, 0.0), Bucket::new(f64::INFINITY, -0.0)],
            ),
            (
                0.9,
                vec![
                    Bucket::new(1.0, 8.0),
                    Bucket::new(2.0, 2.0),
                    Bucket::new(f64::INFINITY, 10.0),
                ],
            ),
        ];
        for _ in 0..3 {
            for (phi, source) in &cases {
                raw.clear();
                raw.extend(source.iter().cloned());
                assert_eq!(
                    bucket_quantile_sorted(*phi, &mut raw, &mut merged).to_bits(),
                    legacy::bucket_quantile_sorted(*phi, source.clone()).to_bits()
                );
            }
        }
    }

    #[test]
    fn test_histogram_scratch_intermediate_bucket_bits_match_frozen_old() {
        let nan = f64::from_bits(0x7ff8_0000_0000_0042);
        let cases = [
            vec![Bucket::new(-0.0, -0.0), Bucket::new(0.0, 0.0)],
            vec![Bucket::new(0.0, -0.0), Bucket::new(-0.0, -0.0)],
            vec![
                Bucket::new(1.0, 1e16),
                Bucket::new(1.0, -1e16),
                Bucket::new(1.0, 1.0),
            ],
            vec![
                Bucket::new(1.0, 1e16),
                Bucket::new(1.0, 1.0),
                Bucket::new(1.0, -1e16),
            ],
            vec![
                Bucket::new(f64::INFINITY, f64::INFINITY),
                Bucket::new(f64::INFINITY, f64::NEG_INFINITY),
            ],
            vec![
                Bucket::new(nan, 2.0),
                Bucket::new(nan, 3.0),
                Bucket::new(1.0, 4.0),
            ],
            vec![
                Bucket::new(0.0, nan),
                Bucket::new(1.0, 3.0),
                Bucket::new(2.0, 1.0),
            ],
            vec![
                Bucket::new(0.0, 3.0),
                Bucket::new(1.0, nan),
                Bucket::new(2.0, 1.0),
            ],
        ];
        let bits = |buckets: &[Bucket]| {
            buckets
                .iter()
                .map(|bucket| (bucket.upper_bound.to_bits(), bucket.count.to_bits()))
                .collect::<Vec<_>>()
        };
        let mut raw = Vec::with_capacity(8);
        let mut merged = Vec::with_capacity(8);
        for source in cases {
            raw.clear();
            raw.extend(source.iter().cloned());
            let mut expected = legacy::coalesce_buckets(source);
            coalesce_buckets_into(&mut raw, &mut merged);
            assert!(raw.is_empty());
            assert_eq!(bits(&merged), bits(&expected));
            ensure_monotonic(&mut merged);
            legacy::ensure_monotonic(&mut expected);
            assert_eq!(bits(&merged), bits(&expected));
        }
    }

    fn matrix_bits(mut value: Value) -> MatrixBits {
        value.sort();
        let Value::Matrix(rows) = value else {
            panic!("expected matrix")
        };
        rows.into_iter()
            .map(|row| {
                assert!(row.exemplars.is_none());
                assert!(row.time_window.is_none());
                (
                    row.labels
                        .iter()
                        .map(|label| (label.name.clone(), label.value.clone()))
                        .collect(),
                    row.samples
                        .into_iter()
                        .map(|sample| (sample.timestamp, sample.value.to_bits()))
                        .collect(),
                )
            })
            .collect()
    }

    #[test]
    fn test_histogram_scratch_matrix_matches_frozen_old_labels_timestamps_and_bits() {
        let mut state = 0xa2e1_765b_9003_23d7u64;
        let bounds = [
            "+Inf", "-0", "0", "1", "1.0", "2", "-1", "-Inf", "NaN", "NaN", "invalid",
        ];
        let valid_bounds = ["+Inf", "0", "0.5", "1", "2", "3", "4", "5", "8", "16", "32"];
        let eval = EvalContext::new(-2, 5, 1, "histogram-differential".into());
        for case in 0..80 {
            let case_bounds = if case % 2 == 0 {
                &valid_bounds
            } else {
                &bounds
            };
            let mut rows = Vec::new();
            for group in 0..4 {
                for (index, bound) in case_bounds.iter().enumerate() {
                    let mut samples = Vec::new();
                    if (case + index + group) % 9 != 0 {
                        for timestamp in -4..=5 {
                            if !random_word(&mut state).is_multiple_of(4) {
                                let count = if case % 2 == 0 {
                                    let level = if index == 0 {
                                        1000.0
                                    } else {
                                        index as f64 * 10.0
                                    };
                                    level * (timestamp + 6) as f64
                                        + (random_word(&mut state) % 1000) as f64 / 1000.0
                                } else {
                                    random_count(&mut state)
                                };
                                samples.push(Sample::new(timestamp, count));
                            }
                        }
                        if case % 11 == 0 {
                            samples.reverse();
                        }
                    }
                    if case % 13 == 0 && samples.len() > 1 {
                        samples.insert(
                            1,
                            Sample::new(samples[0].timestamp, random_count(&mut state)),
                        );
                    }
                    rows.push(RangeValue {
                        labels: vec![
                            Arc::new(Label::new(NAME_LABEL, "generic_histogram")),
                            Arc::new(Label::new("dimension", &format!("group-{group}"))),
                            Arc::new(Label::new(BUCKET_LABEL, bound)),
                            Arc::new(Label::new(HASH_LABEL, "ignored-series-hash")),
                        ],
                        samples,
                        exemplars: None,
                        time_window: None,
                    });
                }
            }
            rows.push(RangeValue {
                labels: vec![Arc::new(Label::new("dimension", "missing-bucket-label"))],
                samples: vec![Sample::new(0, 99.0)],
                exemplars: None,
                time_window: None,
            });
            // Change input order without changing within-timestamp accumulation.
            let rotate = (random_word(&mut state) % rows.len() as u64) as usize;
            rows.rotate_left(rotate);
            for phi in [f64::NAN, -1.0, -0.0, 0.5, 0.9, 1.0, 2.0] {
                let input = Value::Matrix(rows.clone());
                let expected = legacy::histogram_quantile(phi, input.clone(), &eval).unwrap();
                let actual = histogram_quantile(&ScalarParam::Const(phi), input, &eval).unwrap();
                assert_eq!(
                    matrix_bits(actual),
                    matrix_bits(expected),
                    "case={case}, phi={phi}"
                );
            }
        }
        assert!(matches!(
            histogram_quantile(&ScalarParam::Const(0.9), Value::None, &eval).unwrap(),
            Value::None
        ));
        assert_eq!(
            histogram_quantile(&ScalarParam::Const(0.9), Value::Float(1.0), &eval)
                .unwrap_err()
                .to_string(),
            legacy::histogram_quantile(0.9, Value::Float(1.0), &eval)
                .unwrap_err()
                .to_string()
        );
    }

    #[test]
    fn test_histogram_quantile_handles_unsorted_buckets_and_sparse_timestamps() {
        let eval_ctx = EvalContext::new(1, 3, 1, "test".to_string());
        let series = |le: &str, samples: Vec<Sample>| RangeValue {
            labels: vec![
                Arc::new(Label::new("__name__", "request_duration_bucket")),
                Arc::new(Label::new("path", "/api")),
                Arc::new(Label::new("le", le)),
            ],
            samples,
            exemplars: None,
            time_window: None,
        };
        let input = Value::Matrix(vec![
            // +Inf comes first on purpose; no bucket has a sample at 2, and only +Inf at 3
            series("+Inf", vec![Sample::new(1, 10.0), Sample::new(3, 30.0)]),
            series("1", vec![Sample::new(1, 5.0)]),
        ]);

        let Value::Matrix(result) =
            histogram_quantile(&ScalarParam::Const(0.5), input, &eval_ctx).unwrap()
        else {
            panic!("expected matrix");
        };
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0]
                .samples
                .iter()
                .map(|sample| (sample.timestamp, sample.value.to_bits()))
                .collect::<Vec<_>>(),
            vec![(1, 1.0f64.to_bits()), (3, f64::NAN.to_bits())],
        );
    }

    /// Upstream `FormatOpenMetricsFloat`: Go's shortest `'g'`, with ".0" on an integral value.
    #[test]
    fn test_quantile_label_formats_like_openmetrics() {
        for (phi, expected) in [
            (0.5, "0.5"),
            (0.0, "0.0"),
            (-0.0, "0.0"),
            (1.0, "1.0"),
            (-1.0, "-1.0"),
            (0.99, "0.99"),
            (0.0001, "0.0001"),
            (0.00001, "1e-05"),
            (-0.000012, "-1.2e-05"),
            (123456.0, "123456.0"),
            (1e6, "1e+06"),
            (1.5e300, "1.5e+300"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "+Inf"),
            (f64::NEG_INFINITY, "-Inf"),
        ] {
            assert_eq!(quantile_label(phi), expected, "{phi}");
        }
    }

    #[test]
    fn test_coalesce_buckets_preserves_float_edges() {
        let buckets = coalesce_buckets(vec![
            Bucket::new(-0.0, 1.0),
            Bucket::new(0.0, 2.0),
            Bucket::new(f64::INFINITY, f64::INFINITY),
            Bucket::new(f64::INFINITY, f64::NEG_INFINITY),
            Bucket::new(f64::NAN, 4.0),
            Bucket::new(f64::NAN, 5.0),
        ]);
        assert_eq!(buckets.len(), 4);
        assert_eq!(buckets[0].upper_bound.to_bits(), (-0.0_f64).to_bits());
        assert_eq!(buckets[0].count, 3.0);
        assert!(buckets[1].count.is_nan());
        assert!(buckets[2].upper_bound.is_nan());
        assert!(buckets[3].upper_bound.is_nan());
        assert_eq!(buckets[2].count, 4.0);
        assert_eq!(buckets[3].count, 5.0);
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
