// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use serde::{
    ser::{SerializeSeq, SerializeStruct, Serializer},
    Serialize,
};
use std::{cmp::Ordering, sync::Arc, time::Duration};

// See https://docs.rs/indexmap/latest/indexmap/#alternate-hashers
type FxIndexMap<K, V> = indexmap::IndexMap<K, V, ahash::RandomState>;

pub type Labels = Vec<Arc<Label>>;

#[derive(Debug, Clone)]
pub struct Label {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Sample {
    /// Time in microseconds
    pub timestamp: i64,
    pub value: f64,
}

impl Serialize for Sample {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_seq(Some(2))?;
        seq.serialize_element(&(self.timestamp / 1_000_000))?;
        seq.serialize_element(&self.value.to_string())?;
        seq.end()
    }
}

impl Sample {
    pub(crate) fn new(timestamp: i64, value: f64) -> Self {
        Self { timestamp, value }
    }
}

#[derive(Debug, Clone)]
pub struct InstantValue {
    pub labels: Labels,
    pub sample: Sample,
}

impl Serialize for InstantValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_struct("instant_value", 2)?;
        let labels_map = self
            .labels
            .iter()
            .map(|l| (l.name.as_str(), l.value.as_str()))
            .collect::<FxIndexMap<_, _>>();
        seq.serialize_field("metric", &labels_map)?;
        seq.serialize_field("value", &self.sample)?;
        seq.end()
    }
}

#[derive(Debug, Clone)]
pub struct TimeWindow {
    /// Evaluation timestamp, microseconds.
    pub eval_ts: i64,
    pub range: Duration,
    /// The offset used during the query execution.
    /// We don't use it (yet), so its value is always zero.
    //
    // See https://github.com/prometheus/prometheus/blob/80b7f73d267a812b3689321554aec637b75f468d/promql/parser/ast.go#L192-L198
    pub offset: Duration,
}

impl TimeWindow {
    pub fn new(eval_ts: i64, range: Duration) -> Self {
        assert!(eval_ts > 0);
        Self {
            eval_ts,
            range,
            offset: Duration::ZERO,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RangeValue {
    pub labels: Labels,
    pub samples: Vec<Sample>,
    pub time_window: Option<TimeWindow>,
}

impl Serialize for RangeValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_struct("range_value", 2)?;
        let labels_map = self
            .labels
            .iter()
            .map(|l| (l.name.as_str(), l.value.as_str()))
            .collect::<FxIndexMap<_, _>>();
        seq.serialize_field("metric", &labels_map)?;
        seq.serialize_field("values", &self.samples)?;
        seq.end()
    }
}

impl RangeValue {
    pub(crate) fn new<S>(labels: Labels, samples: S) -> Self
    where
        S: IntoIterator<Item = Sample>,
    {
        Self {
            labels,
            samples: Vec::from_iter(samples),
            time_window: None,
        }
    }
}

#[derive(Debug)]
pub(crate) enum ExtrapolationKind {
    /// Calculate the per-second average rate of increase of the time series.
    /// Adjust for breaks in monotonicity (counter resets).
    /// Should only be used with counters.
    ///
    /// See <https://prometheus.io/docs/prometheus/latest/querying/functions/#rate>
    Rate,

    /// Calculate the increase in the time series. Adjust for counter resets.
    /// Should only be used with counters.
    ///
    /// See <https://prometheus.io/docs/prometheus/latest/querying/functions/#increase>
    Increase,

    /// Calculate the difference between the first and last value. Don't adjust for counter resets. Should only be used with gauges.
    ///
    /// See <https://prometheus.io/docs/prometheus/latest/querying/functions/#delta>
    Delta,
}

/// `extrapolated_rate` is a utility function for rate/increase/delta.
///
/// Calculates the rate (allowing for counter resets if `kind` is Rate or
/// Increase), extrapolates if the first/last sample is close to the boundary,
/// and returns the result as either per-second (if `kind` is Rate) or overall.
///
/// Returns `None` if there are fewer than two samples.
///
/// See the diagrams at <https://promlabs.com/blog/2021/01/29/how-exactly-does-promql-calculate-rates/#extrapolation-of-data>
///
/// # Panics
///
/// Panics if the samples are not in the range.
//
// cf. https://github.com/prometheus/prometheus/blob/80b7f73d267a812b3689321554aec637b75f468d/promql/functions.go#L67
pub(crate) fn extrapolated_rate(
    samples: &[Sample],
    eval_ts: i64,
    range: Duration,
    offset: Duration,
    kind: ExtrapolationKind,
) -> Option<f64> {
    let start = {
        let range_plus_offset = range
            .checked_add(offset)
            .expect("BUG: overflow")
            .as_micros()
            .try_into()
            .expect("BUG: integer conversion failed");
        eval_ts
            .checked_sub(range_plus_offset)
            .expect("BUG: overflow")
    };
    assert!(start > 0);
    let end = eval_ts
        .checked_sub(
            offset
                .as_micros()
                .try_into()
                .expect("BUG: integer conversion failed"),
        )
        .expect("BUG: overflow");
    assert!(end > 0);
    assert!(start <= end);

    if samples.len() < 2 {
        // Not enough samples.
        return None;
    }
    let first = &samples[0];
    let last = &samples.last().unwrap();

    // The caller must ensure that the samples are in the range.
    assert!(first.timestamp <= last.timestamp);
    assert!(first.timestamp >= start);
    assert!(last.timestamp <= end);

    let mut result = last.value - first.value;

    let is_counter = matches!(kind, ExtrapolationKind::Rate | ExtrapolationKind::Increase);
    if is_counter {
        // Handle counter resets.
        let mut prev_value = first.value;
        for sample in &samples[1..] {
            if sample.value < prev_value {
                result += prev_value;
            }
            prev_value = sample.value;
        }
    }

    // Duration between first/last samples and boundary of range.
    let mut duration_to_start = (first.timestamp - start) as f64 / 1_000.0;
    let duration_to_end = (end - last.timestamp) as f64 / 1_000.0;

    let sampled_interval = (last.timestamp - first.timestamp) as f64 / 1_000.0;
    let avg_duration_between_samples = sampled_interval / (samples.len() - 1) as f64;

    if is_counter && result > 0.0 && first.value >= 0.0 {
        // Counters cannot be negative. If we have any slope at all
        // (i.e. `result` went up), we can extrapolate the zero point
        // of the counter. If the duration to the zero point is shorter
        // than the `duration_to_start`, we take the zero point as the start
        // of the series, thereby avoiding extrapolation to negative
        // counter values.
        let duration_to_zero = sampled_interval * (first.value / result);
        if duration_to_zero < duration_to_start {
            duration_to_start = duration_to_zero;
        }
    }

    // If the first/last samples are close to the boundaries of the range,
    // extrapolate the result. This is as we expect that another sample
    // will exist given the spacing between samples we've seen thus far,
    // with an allowance for noise.
    let extrapolation_threshold = avg_duration_between_samples * 1.1;
    let mut extrapolate_to_interval = sampled_interval;

    if duration_to_start < extrapolation_threshold {
        extrapolate_to_interval += duration_to_start;
    } else {
        extrapolate_to_interval += avg_duration_between_samples / 2.0;
    }
    if duration_to_end < extrapolation_threshold {
        extrapolate_to_interval += duration_to_end;
    } else {
        extrapolate_to_interval += avg_duration_between_samples / 2.0;
    }
    let factor = extrapolate_to_interval / sampled_interval;
    if matches!(kind, ExtrapolationKind::Rate) {
        result *= factor / range.as_secs_f64();
    } else {
        result *= factor;
    }

    Some(result)
}

pub fn labels_value(labels: &Labels, name: &str) -> Option<String> {
    labels
        .binary_search_by_key(&name, |label| label.name.as_str())
        .ok()
        .map(|index| labels[index].value.clone())
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum Value {
    Instant(InstantValue),
    Range(RangeValue),
    Vector(Vec<InstantValue>),
    Matrix(Vec<RangeValue>),
    Sample(Sample), // only used for return literal value
    Float(f64),
    None,
}

impl Value {
    pub(crate) fn get_ref_matrix_values(&self) -> Option<&Vec<RangeValue>> {
        match self {
            Value::Matrix(values) => Some(values),
            _ => None,
        }
    }

    pub fn get_type(&self) -> &str {
        match self {
            Value::Instant(_) => "vector",
            Value::Range(_) => "matrix",
            Value::Vector(_) => "vector",
            Value::Matrix(_) => "matrix",
            Value::Sample(_) => "scalar",
            Value::Float(_) => "scalar",
            Value::None => "scalar",
        }
    }

    pub fn sort(&mut self) {
        match self {
            Value::Vector(v) => {
                v.sort_by(|a, b| {
                    b.sample
                        .value
                        .partial_cmp(&a.sample.value)
                        .unwrap_or(Ordering::Equal)
                });
            }
            Value::Matrix(v) => {
                v.sort_by(|a, b| {
                    let a = a.samples.iter().map(|x| x.value).sum::<f64>();
                    let b = b.samples.iter().map(|x| x.value).sum::<f64>();
                    b.partial_cmp(&a).unwrap_or(Ordering::Equal)
                });
            }
            _ => {}
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Signature([u8; 32]);

impl From<Signature> for String {
    fn from(sig: Signature) -> Self {
        hex::encode(sig.0)
    }
}

// REFACTORME: make this a method of `Metric`
pub fn signature(labels: &Labels) -> Signature {
    signature_without_labels(labels, &[])
}

/// `signature_without_labels` is just as [`signature`], but only for labels not matching `names`.
// REFACTORME: make this a method of `Metric`
pub fn signature_without_labels(labels: &Labels, exclude_names: &[&str]) -> Signature {
    let mut hasher = blake3::Hasher::new();
    labels
        .iter()
        .filter(|item| !exclude_names.contains(&item.name.as_str()))
        .for_each(|item| {
            hasher.update(item.name.as_bytes());
            hasher.update(item.value.as_bytes());
        });
    Signature(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use expect_test::expect;
    use float_cmp::approx_eq;

    #[test]
    fn test_signature_without_labels() {
        let mut labels: Labels = Default::default();
        labels.push(Arc::new(Label {
            name: "a".to_owned(),
            value: "1".to_owned(),
        }));
        labels.push(Arc::new(Label {
            name: "b".to_owned(),
            value: "2".to_owned(),
        }));
        labels.push(Arc::new(Label {
            name: "c".to_owned(),
            value: "3".to_owned(),
        }));
        labels.push(Arc::new(Label {
            name: "d".to_owned(),
            value: "4".to_owned(),
        }));

        let sig = signature(&labels);
        expect![[r#"
            "f287fde2994111abd7740b5c7c28b0eeabe3f813ae65397bb6acb684e2ab6b22"
        "#]]
        .assert_debug_eq(&String::from(sig));

        let sig: String = signature_without_labels(&labels, &["a", "c"]).into();
        expect![[r#"
            "ec9c3a0c9c03420d330ab62021551cffe993c07b20189c5ed831dad22f54c0c7"
        "#]]
        .assert_debug_eq(&sig);
        assert_eq!(sig.len(), 64);

        assert_eq!(signature(&labels), signature_without_labels(&labels, &[]));
    }

    #[test]
    fn test_extrapolated_rate() {
        fn extrapolate(samples: &[Sample], kind: ExtrapolationKind) -> f64 {
            extrapolated_rate(
                samples,
                75_000_000,
                Duration::from_secs(60),
                Duration::ZERO,
                kind,
            )
            .unwrap()
        }

        // See the diagrams at
        // https://promlabs.com/blog/2021/01/29/how-exactly-does-promql-calculate-rates/#extrapolation-of-data

        // Diagram 1
        let samples = [
            Sample::new(23_000_000, 1.0),
            Sample::new(38_000_000, 1.0),
            Sample::new(53_000_000, 2.0),
            Sample::new(68_000_000, 2.0),
        ];

        let rate = extrapolate(&samples, ExtrapolationKind::Rate);
        assert!(approx_eq!(f64, rate, 0.0222, epsilon = 0.0001));

        let increase = extrapolate(&samples, ExtrapolationKind::Increase);
        assert!(approx_eq!(f64, increase, 1.3333, epsilon = 0.0001));
        assert!(approx_eq!(f64, increase, rate * 60.0));

        let delta = extrapolate(&samples, ExtrapolationKind::Delta);
        assert_eq!(delta, increase);

        // Diagram 2: the first value is too far from the boundary to extrapolate fully
        let samples_2 = &samples[1..];

        let rate = extrapolate(samples_2, ExtrapolationKind::Rate);
        assert!(approx_eq!(f64, rate, 0.0247, epsilon = 0.0001));

        let increase = extrapolate(samples_2, ExtrapolationKind::Increase);
        assert!(approx_eq!(f64, increase, 1.4833, epsilon = 0.0001));
        assert!(approx_eq!(f64, increase, rate * 60.0));

        let delta = extrapolate(samples_2, ExtrapolationKind::Delta);
        assert_eq!(delta, increase);

        // Diagram 3: dealing with counter resets
        let samples = [
            Sample::new(23_000_000, 6.0),
            Sample::new(38_000_000, 10.0),
            Sample::new(53_000_000, 4.0),
            Sample::new(68_000_000, 9.0),
        ];

        let rate = extrapolate(&samples, ExtrapolationKind::Rate);
        assert!(approx_eq!(f64, rate, 0.2888, epsilon = 0.0001));

        let increase = extrapolate(&samples, ExtrapolationKind::Increase);
        assert!(approx_eq!(f64, increase, 17.3333, epsilon = 0.0001));
        assert!(approx_eq!(f64, increase, rate * 60.0));

        let delta = extrapolate(&samples, ExtrapolationKind::Delta);
        assert!(approx_eq!(f64, dbg!(delta), 4.0));
    }
}
