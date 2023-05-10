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
use std::{cmp::Ordering, sync::Arc};

pub const FIELD_HASH: &str = "__hash__";
pub const FIELD_NAME: &str = "__name__";
pub const FIELD_TYPE: &str = "metric_type";
pub const FIELD_TIME: &str = "_timestamp";
pub const FIELD_VALUE: &str = "value";
pub const FIELD_BUCKET: &str = "le";

pub const TYPE_COUNTER: &str = "counter";
pub const TYPE_GAUGE: &str = "gauge";
pub const TYPE_HISTOGRAM: &str = "histogram";
pub const TYPE_SUMMARY: &str = "summary";

// See https://docs.rs/indexmap/latest/indexmap/#alternate-hashers
type FxIndexMap<K, V> =
    indexmap::IndexMap<K, V, std::hash::BuildHasherDefault<rustc_hash::FxHasher>>;

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

#[derive(Debug, Clone)]
pub struct InstantValue {
    pub labels: Labels,
    pub value: Sample,
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
        seq.serialize_field("value", &self.value)?;
        seq.end()
    }
}

#[derive(Debug, Clone)]
pub struct RangeValue {
    pub labels: Labels,
    pub time_range: Option<(i64, i64)>, // start, end
    pub values: Vec<Sample>,
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
        seq.serialize_field("values", &self.values)?;
        seq.end()
    }
}

impl RangeValue {
    /// Returns first and last data points, [extrapolated] to the time window
    /// boundaries.
    ///
    /// [extrapolated]: https://promlabs.com/blog/2021/01/29/how-exactly-does-promql-calculate-rates/#extrapolation-of-data
    pub(crate) fn extrapolate(&self) -> Option<(Sample, Sample)> {
        let samples = &self.values;
        if samples.len() < 2 {
            return None;
        }
        let first = samples.first().unwrap();
        let last = samples.last().unwrap();

        let (t_start, t_end) = self.time_range.unwrap();
        assert!(t_start < t_end);
        assert!(t_start <= first.timestamp);
        assert!(first.timestamp <= last.timestamp);
        assert!(last.timestamp <= t_end);

        Some((
            if first.timestamp == t_start {
                *first
            } else {
                extrapolated_sample(first, last, t_start)
            },
            if last.timestamp == t_end {
                *last
            } else {
                extrapolated_sample(first, last, t_end)
            },
        ))
    }
}

pub fn labels_value(labels: &Labels, name: &str) -> Option<String> {
    labels
        .binary_search_by_key(&name, |label| label.name.as_str())
        .ok()
        .map(|index| labels[index].value.clone())
}

// https://promlabs.com/blog/2021/01/29/how-exactly-does-promql-calculate-rates/#extrapolation-of-data
fn extrapolated_sample(p1: &Sample, p2: &Sample, t: i64) -> Sample {
    let dt = p2.timestamp - p1.timestamp;
    let dv = p2.value - p1.value;
    let dt2 = t - p1.timestamp;
    let dv2 = dv * dt2 as f64 / dt as f64;
    Sample {
        timestamp: t,
        value: p1.value + dv2,
    }
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
                    b.value
                        .value
                        .partial_cmp(&a.value.value)
                        .unwrap_or(Ordering::Equal)
                });
            }
            Value::Matrix(v) => {
                v.sort_by(|a, b| {
                    let a = a.values.iter().map(|x| x.value).sum::<f64>();
                    let b = b.values.iter().map(|x| x.value).sum::<f64>();
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
    fn test_extrapolated_sample() {
        let p1 = Sample {
            timestamp: 100,
            value: 10.0,
        };
        let p2 = Sample {
            timestamp: 200,
            value: 20.0,
        };
        let p3 = extrapolated_sample(&p1, &p2, 300);
        assert_eq!(p3.timestamp, 300);
        assert_eq!(p3.value, 30.0);

        let p1 = Sample {
            timestamp: 225,
            value: 1.0,
        };
        let p2 = Sample {
            timestamp: 675,
            value: 2.0,
        };
        let p3 = extrapolated_sample(&p1, &p2, 750);
        let p4 = extrapolated_sample(&p1, &p2, 150);
        assert_eq!(format!("{:.2}", p3.value - p4.value), "1.33");

        let p1 = Sample {
            timestamp: 375,
            value: 1.0,
        };
        let p2 = Sample {
            timestamp: 675,
            value: 2.0,
        };
        let p3 = extrapolated_sample(&p1, &p2, 750);
        let p4 = extrapolated_sample(&p1, &p2, 300);
        assert_eq!(format!("{:.2}", p3.value - p4.value), "1.50");
    }
}
