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
//
// Portions ported from opentelemetry-collector-contrib receiver/datadogreceiver (Apache-2.0).

use std::{collections::BTreeMap, sync::LazyLock};

use opentelemetry_proto::tonic::{
    collector::metrics::v1::ExportMetricsServiceRequest,
    common::v1::KeyValue,
    metrics::v1::{
        AggregationTemporality, ExponentialHistogram, ExponentialHistogramDataPoint, Metric,
        ResourceMetrics, exponential_histogram_data_point::Buckets, metric::Data,
    },
};
use prost::Message;
use proto::datadog_agentpayload::{
    SketchPayload,
    sketch_payload::{Sketch, sketch::Dogsketch},
};

use super::{
    DatadogError, ExpansionBudget, RECORD_BYTES, attributes_bytes,
    metrics::{resource_metrics, seconds_to_nanos},
    resource_bytes,
    tags::{HOST_NAME, SplitTags, to_key_values},
};

const RELATIVE_ACCURACY: f64 = 1.0 / 128.0;
const GAMMA: f64 = 1.0 + 2.0 * RELATIVE_ACCURACY;
const SCALE: i32 = 5;
const AGENT_SKETCH_OFFSET: i32 = 1338;
const MAX_INDEX: u32 = i16::MAX as u32;
/// The OTel SDK's default size; past it a sketch is downscaled so memory tracks the payload.
const MAX_DENSE_BUCKETS: i32 = 160;

/// Shares depend only on `|key|`, so the exp/ln work runs once per key, not per sketch.
static KEY_SHARES: LazyLock<Vec<KeyShares>> =
    LazyLock::new(|| (0..MAX_INDEX as i32).map(KeyShares::new).collect());

#[derive(Debug, Default)]
struct SketchBuckets {
    negative: BTreeMap<i32, u64>,
    positive: BTreeMap<i32, u64>,
    zero: u64,
}

/// The scale-5 buckets one DDSketch key overlaps; a key is narrower than a bucket, so at most two.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct KeyShares {
    first: i32,
    best: i32,
    proportions: [f64; 2],
}

impl KeyShares {
    fn new(key: i32) -> Self {
        let lower = sketch_lower_bound(key);
        let upper = sketch_lower_bound(key.abs() + 1);
        let size = upper - lower;
        let mut shares = Self::default();
        let mut best: Option<f64> = None;
        let mut index = lower_bound_to_histogram_index(lower);
        while histogram_lower_bound(index) < upper {
            let overlap = histogram_lower_bound(index + 1).min(upper)
                - histogram_lower_bound(index).max(lower);
            let proportion = overlap / size;
            if proportion > 0.0 {
                if best.is_none() {
                    shares.first = index;
                }
                if best.is_none_or(|p| proportion > p) {
                    best = Some(proportion);
                    shares.best = index;
                }
                shares.proportions[(index - shares.first) as usize] = proportion;
            }
            index += 1;
        }
        shares
    }
}

/// Delta exponential histograms (scale 5 or coarser) from a `SketchPayload`, one per DDSketch.
pub fn sketches_to_otlp(body: &[u8]) -> Result<ExportMetricsServiceRequest, DatadogError> {
    let payload = SketchPayload::decode(body).map_err(|e| DatadogError::Decode(e.to_string()))?;
    let mut budget = ExpansionBudget::new(body);
    Ok(ExportMetricsServiceRequest {
        resource_metrics: payload
            .sketches
            .into_iter()
            .map(|sketch| sketch_to_resource_metrics(sketch, &mut budget))
            .collect::<Result<_, _>>()?,
    })
}

fn sketch_to_resource_metrics(
    sketch: Sketch,
    budget: &mut ExpansionBudget,
) -> Result<ResourceMetrics, DatadogError> {
    budget.charge(RECORD_BYTES, 1)?;
    let tags = SplitTags::from_tags(sketch.tags.iter().map(String::as_str));
    let mut resource_attrs = tags.resource;
    if !sketch.host.is_empty() {
        resource_attrs.insert(HOST_NAME.to_string(), sketch.host);
    }
    // Downstream OTLP ingest copies the resource at least once per point.
    let point_bytes = RECORD_BYTES + resource_bytes(&resource_attrs);
    let attributes = to_key_values(tags.attributes);
    let mut data_points = Vec::with_capacity(sketch.dogsketches.len());
    for dogsketch in &sketch.dogsketches {
        match dogsketch_to_data_point(dogsketch, &attributes, point_bytes, budget)? {
            Some(dp) => data_points.push(dp),
            None => log::warn!(
                "[DATADOG] dropping invalid sketch for {} at {}",
                sketch.metric,
                dogsketch.ts
            ),
        }
    }
    let metric = Metric {
        name: sketch.metric,
        data: Some(Data::ExponentialHistogram(ExponentialHistogram {
            data_points,
            aggregation_temporality: AggregationTemporality::Delta as i32,
        })),
        ..Default::default()
    };
    Ok(resource_metrics(resource_attrs, metric))
}

/// `None` drops an invalid sketch; a payload past its size budget fails as a whole.
fn dogsketch_to_data_point(
    sketch: &Dogsketch,
    attributes: &[KeyValue],
    point_bytes: usize,
    budget: &mut ExpansionBudget,
) -> Result<Option<ExponentialHistogramDataPoint>, DatadogError> {
    let (Ok(count), Some(mut buckets)) =
        (u64::try_from(sketch.cnt), map_buckets(&sketch.k, &sketch.n))
    else {
        return Ok(None);
    };
    let scale = fit_scale(&mut buckets);
    let dense = (span(&buckets.positive) + span(&buckets.negative)) as usize;
    budget.charge(
        point_bytes + attributes_bytes(attributes) + dense * size_of::<u64>(),
        1,
    )?;
    Ok(Some(ExponentialHistogramDataPoint {
        attributes: attributes.to_vec(),
        time_unix_nano: seconds_to_nanos(sketch.ts),
        count,
        sum: Some(sketch.sum),
        min: Some(sketch.min),
        max: Some(sketch.max),
        scale,
        zero_count: buckets.zero,
        zero_threshold: (f64::from(1 - AGENT_SKETCH_OFFSET) * GAMMA.ln()).exp(),
        positive: dense_buckets(&buckets.positive),
        negative: dense_buckets(&buckets.negative),
        ..Default::default()
    }))
}

/// Spreads DDSketch buckets over overlapping scale-5 buckets; `None` if the sketch is malformed.
fn map_buckets(keys: &[i32], counts: &[u32]) -> Option<SketchBuckets> {
    // `cnt` may legitimately differ from the sum of `n`, but unpaired keys mean a corrupt sketch.
    if keys.len() != counts.len() {
        return None;
    }
    let mut buckets = SketchBuckets::default();
    for (&key, &count) in keys.iter().zip(counts) {
        if key == 0 {
            buckets.zero += u64::from(count);
            continue;
        }
        // Past MAX_INDEX the upper bound overflows to infinity and the overlap loop never ends.
        if key.unsigned_abs() >= MAX_INDEX {
            return None;
        }
        let side = if key < 0 {
            &mut buckets.negative
        } else {
            &mut buckets.positive
        };
        distribute(key, u64::from(count), side);
    }
    Some(buckets)
}

fn distribute(key: i32, count: u64, side: &mut BTreeMap<i32, u64>) {
    let shares = &KEY_SHARES[key.unsigned_abs() as usize];
    let mut assigned = 0u64;
    for (index, &proportion) in (shares.first..).zip(&shares.proportions) {
        if proportion > 0.0 {
            let rounded = (proportion * count as f64) as u64;
            *side.entry(index).or_default() += rounded;
            assigned += rounded;
        }
    }
    *side.entry(shares.best).or_default() += count.saturating_sub(assigned);
}

/// Merges adjacent bucket pairs until each side fits `MAX_DENSE_BUCKETS`; returns the new scale.
fn fit_scale(buckets: &mut SketchBuckets) -> i32 {
    let mut scale = SCALE;
    while span(&buckets.positive).max(span(&buckets.negative)) > MAX_DENSE_BUCKETS {
        buckets.positive = halve(&buckets.positive);
        buckets.negative = halve(&buckets.negative);
        scale -= 1;
    }
    scale
}

fn span(sparse: &BTreeMap<i32, u64>) -> i32 {
    match (sparse.first_key_value(), sparse.last_key_value()) {
        (Some((first, _)), Some((last, _))) => last - first + 1,
        _ => 0,
    }
}

/// One scale down: bucket `i` merges into `i >> 1`, which floors for negative indices too.
fn halve(sparse: &BTreeMap<i32, u64>) -> BTreeMap<i32, u64> {
    let mut merged = BTreeMap::new();
    for (&index, &count) in sparse {
        *merged.entry(index >> 1).or_default() += count;
    }
    merged
}

fn dense_buckets(sparse: &BTreeMap<i32, u64>) -> Option<Buckets> {
    let (&first, _) = sparse.first_key_value()?;
    let (&last, _) = sparse.last_key_value()?;
    let mut bucket_counts = vec![0u64; (last - first) as usize + 1];
    for (&index, &count) in sparse {
        bucket_counts[(index - first) as usize] = count;
    }
    Some(Buckets {
        offset: first,
        bucket_counts,
    })
}

fn sketch_lower_bound(index: i32) -> f64 {
    (f64::from(index.abs() - AGENT_SKETCH_OFFSET) * GAMMA.ln()).exp()
}

fn histogram_lower_bound(index: i32) -> f64 {
    (f64::from(index) * std::f64::consts::LN_2 / f64::from(1 << SCALE)).exp()
}

fn lower_bound_to_histogram_index(value: f64) -> i32 {
    let bits = value.to_bits();
    // An exact power of two sits on a bucket boundary, which belongs to the bucket below.
    if bits & ((1u64 << 52) - 1) == 0 {
        let exponent = ((bits >> 52) & 0x7ff) as i32 - 1023;
        return (exponent << SCALE) - 1;
    }
    (value.ln() * std::f64::consts::LOG2_E * f64::from(1 << SCALE)).floor() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dogsketch(k: Vec<i32>, n: Vec<u32>) -> Dogsketch {
        let cnt = n.iter().map(|c| i64::from(*c)).sum();
        Dogsketch {
            ts: 1_700_000_000,
            cnt,
            min: -3.0,
            max: 250.0,
            avg: 10.0,
            sum: 1234.5,
            k,
            n,
        }
    }

    fn point(sketch: &Dogsketch) -> ExponentialHistogramDataPoint {
        let mut budget = ExpansionBudget(usize::MAX);
        dogsketch_to_data_point(sketch, &[], 0, &mut budget)
            .unwrap()
            .unwrap()
    }

    fn total(buckets: &Option<Buckets>) -> u64 {
        buckets.as_ref().map_or(0, |b| b.bucket_counts.iter().sum())
    }

    #[test]
    fn test_sketch_keeps_count_sum_min_max_and_bucket_totals() {
        let payload = SketchPayload {
            sketches: vec![Sketch {
                metric: "request.latency".into(),
                host: "web-1".into(),
                tags: vec!["env:prod".into(), "route:/cart".into()],
                dogsketches: vec![dogsketch(
                    vec![-1400, 0, 1338, 1400, 1500, 1650, 1700],
                    vec![3, 2, 7, 11, 13, 101, 1],
                )],
                ..Default::default()
            }],
            metadata: None,
        };
        let req = sketches_to_otlp(&payload.encode_to_vec()).unwrap();
        let rm = &req.resource_metrics[0];
        let metric = &rm.scope_metrics[0].metrics[0];
        assert_eq!(metric.name, "request.latency");
        let Some(Data::ExponentialHistogram(hist)) = &metric.data else {
            panic!("expected exponential histogram");
        };
        assert_eq!(
            hist.aggregation_temporality,
            AggregationTemporality::Delta as i32
        );
        let dp = &hist.data_points[0];
        assert_eq!(dp.count, 138);
        assert_eq!(dp.sum, Some(1234.5));
        assert_eq!(dp.min, Some(-3.0));
        assert_eq!(dp.max, Some(250.0));
        // Keys 1338 to 1700 span about 260 scale-5 buckets, past MAX_DENSE_BUCKETS.
        assert_eq!(dp.scale, 4);
        assert_eq!(dp.time_unix_nano, 1_700_000_000_000_000_000);
        assert_eq!(dp.zero_count, 2);
        assert_eq!(total(&dp.negative), 3);
        assert_eq!(
            dp.zero_count + total(&dp.positive) + total(&dp.negative),
            dp.count
        );
        assert_eq!(dp.attributes.len(), 1);
    }

    #[test]
    fn test_sketch_bucket_lands_where_its_values_are() {
        // Key 1338 covers [1, gamma), which falls in scale-5 bucket 0.
        let buckets = map_buckets(&[1338], &[10]).unwrap();
        assert_eq!(buckets.positive.values().sum::<u64>(), 10);
        assert_eq!(*buckets.positive.keys().next().unwrap(), 0);
        assert_eq!(lower_bound_to_histogram_index(1.0), -1);
        assert_eq!(lower_bound_to_histogram_index(2.0f64.powf(0.5 / 32.0)), 0);
    }

    #[test]
    fn test_ddsketch_keys_land_in_exact_scale5_buckets() {
        let dp = point(&dogsketch(
            vec![-1338, 0, 1338, 1339, 1400],
            vec![4, 2, 10, 100, 1000],
        ));
        assert_eq!(dp.scale, 5);
        assert_eq!(dp.zero_count, 2);
        let negative = dp.negative.unwrap();
        assert_eq!((negative.offset, negative.bucket_counts), (0, vec![4]));
        let positive = dp.positive.unwrap();
        assert_eq!(positive.offset, 0);
        assert_eq!(&positive.bucket_counts[..2], [10 + 39, 61]);
        assert_eq!(&positive.bucket_counts[44..], [869, 131]);
        assert_eq!(positive.bucket_counts[2..44].iter().sum::<u64>(), 0);
    }

    #[test]
    fn test_a_sketch_with_distant_keys_is_downscaled_to_a_bounded_layout() {
        let dp = point(&dogsketch(vec![-32766, -1, 1, 32766], vec![1, 2, 3, 4]));
        assert!(dp.scale < SCALE, "{}", dp.scale);
        for side in [&dp.positive, &dp.negative] {
            let len = side.as_ref().unwrap().bucket_counts.len();
            assert!(len <= MAX_DENSE_BUCKETS as usize, "{len}");
        }
        assert_eq!(total(&dp.negative), 3);
        assert_eq!(total(&dp.positive), 7);
    }

    #[test]
    fn test_a_payload_of_sparse_sketches_past_its_bucket_budget_is_rejected() {
        let payload = SketchPayload {
            sketches: vec![Sketch {
                metric: "m".into(),
                dogsketches: vec![
                    Dogsketch {
                        k: vec![1, 32766],
                        n: vec![1, 1],
                        ..Default::default()
                    };
                    8000
                ],
                ..Default::default()
            }],
            metadata: None,
        };
        let err = sketches_to_otlp(&payload.encode_to_vec()).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_many_tags_on_many_empty_sketches_past_the_size_budget_are_rejected() {
        let payload = SketchPayload {
            sketches: vec![Sketch {
                metric: "m".into(),
                tags: (0..50)
                    .map(|i| format!("tag{i}:{}", "v".repeat(50)))
                    .collect(),
                dogsketches: vec![Dogsketch::default(); 5000],
                ..Default::default()
            }],
            metadata: None,
        };
        let err = sketches_to_otlp(&payload.encode_to_vec()).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_many_untagged_empty_sketches_past_the_size_budget_are_rejected() {
        let payload = SketchPayload {
            sketches: vec![Sketch {
                metric: "m".into(),
                dogsketches: vec![Dogsketch::default(); 200_000],
                ..Default::default()
            }],
            metadata: None,
        };
        let err = sketches_to_otlp(&payload.encode_to_vec()).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_sketch_with_out_of_range_key_is_dropped() {
        assert!(map_buckets(&[i32::from(i16::MAX)], &[1]).is_none());
        assert!(map_buckets(&[-40_000], &[1]).is_none());
        let payload = SketchPayload {
            sketches: vec![Sketch {
                metric: "m".into(),
                dogsketches: vec![
                    dogsketch(vec![40_000], vec![1]),
                    dogsketch(vec![1400], vec![4]),
                ],
                ..Default::default()
            }],
            metadata: None,
        };
        let req = sketches_to_otlp(&payload.encode_to_vec()).unwrap();
        let Some(Data::ExponentialHistogram(hist)) =
            &req.resource_metrics[0].scope_metrics[0].metrics[0].data
        else {
            panic!("expected exponential histogram");
        };
        assert_eq!(hist.data_points.len(), 1);
        assert_eq!(hist.data_points[0].count, 4);
    }

    #[test]
    fn test_sketch_with_mismatched_keys_and_counts_is_dropped() {
        assert!(map_buckets(&[1400, 1401], &[4]).is_none());
        assert!(map_buckets(&[1400], &[4, 5]).is_none());
        let mut budget = ExpansionBudget(usize::MAX);
        let sketch = dogsketch(vec![1400, 1401], vec![4]);
        assert!(
            dogsketch_to_data_point(&sketch, &[], 0, &mut budget)
                .unwrap()
                .is_none()
        );
    }

    fn distribute_directly(key: i32, count: u64, side: &mut BTreeMap<i32, u64>) {
        let lower = sketch_lower_bound(key);
        let upper = sketch_lower_bound(key.abs() + 1);
        let size = upper - lower;
        let mut best: Option<(f64, i32)> = None;
        let mut assigned = 0u64;
        let mut index = lower_bound_to_histogram_index(lower);
        while histogram_lower_bound(index) < upper {
            let overlap = histogram_lower_bound(index + 1).min(upper)
                - histogram_lower_bound(index).max(lower);
            let proportion = overlap / size;
            if proportion > 0.0 {
                if best.is_none_or(|(p, _)| proportion > p) {
                    best = Some((proportion, index));
                }
                let rounded = (proportion * count as f64) as u64;
                *side.entry(index).or_default() += rounded;
                assigned += rounded;
            }
            index += 1;
        }
        if let Some((_, index)) = best {
            *side.entry(index).or_default() += count.saturating_sub(assigned);
        }
    }

    #[test]
    fn test_key_share_table_matches_the_direct_mapping_for_every_key() {
        for key in 1..MAX_INDEX as i32 {
            for count in [1, 7, 1000, u64::from(u32::MAX)] {
                let (mut table, mut direct) = (BTreeMap::new(), BTreeMap::new());
                distribute(key, count, &mut table);
                distribute_directly(key, count, &mut direct);
                assert_eq!(table, direct, "key {key} count {count}");
            }
        }
    }
}
