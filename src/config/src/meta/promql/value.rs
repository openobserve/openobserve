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

use std::{fmt, hash::Hasher, sync::Arc, time::Duration};

use hashbrown::HashSet;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{
    Deserialize, Serialize,
    de::{Deserializer, SeqAccess, Visitor},
    ser::{SerializeSeq, SerializeStruct, Serializer},
};

use crate::{
    FxIndexMap,
    meta::{promql::NAME_LABEL, search::SearchEventType},
    utils::{json, sort::sort_float},
};

// https://prometheus.io/docs/concepts/data_model/#metric-names-and-labels
static RE_VALID_LABEL_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").unwrap());

pub type Labels = Vec<Arc<Label>>;

/// Added functionalities on Labels
pub trait LabelsExt {
    /// Remove the metric name i.e. __name__ from the given label
    ///
    /// ```json
    /// {"__name__": "my-metric", "job": "k8s"} -> {"job": "k8s"}
    /// ```
    fn without_metric_name(self) -> Labels;

    /// Return the value of the label associated with this name of the label.
    fn get_value(&self, name: &str) -> String;

    /// Set a new label -> value to this label
    fn set(&mut self, name: &str, value: &str);

    /// Get the values
    fn values(&self) -> Vec<String>;

    /// Get the keys
    fn keys(&self) -> Vec<String>;

    /// Without label, drops the given label name from the output.
    fn without_label(self, name: &str) -> Labels;

    /// Signature for the given set of labels
    fn signature(&self) -> u64;

    /// keep the labels as described by the `labels` vector
    /// and delete everything else
    fn keep(&self, labels: &[String]) -> Labels;

    /// delete the labels as described by the `labels` vector
    /// and keep the remaining
    fn delete(&self, labels: &[String]) -> Labels;

    /// Sort the labels by name
    fn sort(&mut self);
}

impl LabelsExt for Labels {
    fn without_label(mut self, name: &str) -> Labels {
        self.retain(|label| label.name != name);
        self
    }

    fn without_metric_name(self) -> Labels {
        self.without_label(NAME_LABEL)
    }

    fn get_value(&self, name: &str) -> String {
        self.iter()
            .filter(|l| l.name == name)
            .map(|l| l.value.to_string())
            .take(1)
            .collect()
    }

    fn set(&mut self, name: &str, value: &str) {
        self.push(Arc::new(Label {
            name: name.to_string(),
            value: value.to_string(),
        }))
    }

    fn signature(&self) -> u64 {
        signature(self)
    }

    fn keep(&self, labels: &[String]) -> Labels {
        self.iter()
            .flat_map(|label| {
                if labels.contains(&label.name) {
                    Some(label.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    fn delete(&self, labels: &[String]) -> Labels {
        self.iter()
            .flat_map(|label| {
                if !labels.contains(&label.name) {
                    Some(label.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    fn sort(&mut self) {
        self.sort_by(|a, b| a.name.cmp(&b.name))
    }

    fn values(&self) -> Vec<String> {
        self.iter().map(|label| label.value.clone()).collect()
    }

    fn keys(&self) -> Vec<String> {
        self.iter().map(|label| label.name.clone()).collect()
    }
}

#[derive(Debug, Clone, Default, PartialEq, PartialOrd, Serialize)]
pub struct Label {
    pub name: String,
    pub value: String,
}

impl Label {
    /// Create a new instance of Label.
    pub fn new<S: Into<String>>(name: S, value: S) -> Self {
        Label {
            name: name.into(),
            value: value.into(),
        }
    }

    /// Check if the label name is valid.
    pub fn is_valid_label_name(name: &str) -> bool {
        RE_VALID_LABEL_NAME.is_match(name)
    }
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

impl<'de> Deserialize<'de> for Sample {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct SampleVisitor;

        impl<'de> Visitor<'de> for SampleVisitor {
            type Value = Sample;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a sequence of [timestamp, value]")
            }

            fn visit_seq<V>(self, mut seq: V) -> Result<Sample, V::Error>
            where
                V: SeqAccess<'de>,
            {
                // Get timestamp (in seconds)
                let timestamp: f64 = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::invalid_length(0, &self))?;

                // Get value as string
                let value_str: String = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::invalid_length(1, &self))?;

                // Parse value string to f64
                let value = value_str.parse::<f64>().map_err(serde::de::Error::custom)?;

                // Convert timestamp from seconds to microseconds
                let timestamp = (timestamp * 1_000_000.0) as i64;

                Ok(Sample { timestamp, value })
            }
        }

        deserializer.deserialize_seq(SampleVisitor)
    }
}

impl Sample {
    pub fn new(timestamp: i64, value: f64) -> Self {
        Self { timestamp, value }
    }

    #[allow(dead_code)]
    pub fn is_nan(&self) -> bool {
        self.value.is_nan()
    }
}

#[derive(Debug, Default, Clone)]
pub struct Exemplar {
    /// Time in microseconds
    pub timestamp: i64,
    pub value: f64,
    pub labels: Labels,
}

impl Serialize for Exemplar {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_struct("exemplars", 3)?;
        let labels_map = self
            .labels
            .iter()
            .map(|l| (l.name.as_str(), l.value.as_str()))
            .collect::<FxIndexMap<_, _>>();
        seq.serialize_field("timestamp", &(self.timestamp / 1_000_000))?;
        seq.serialize_field("value", &self.value.to_string())?;
        seq.serialize_field("labels", &labels_map)?;
        seq.end()
    }
}

impl<'de> Deserialize<'de> for Exemplar {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ExemplarVisitor;

        impl<'de> Visitor<'de> for ExemplarVisitor {
            type Value = Exemplar;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("struct Exemplar")
            }

            fn visit_map<V>(self, mut map: V) -> Result<Exemplar, V::Error>
            where
                V: serde::de::MapAccess<'de>,
            {
                let mut timestamp = None;
                let mut value = None;
                let mut labels = Vec::new();

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "timestamp" => {
                            let ts = map.next_value::<i64>()?;
                            timestamp = Some(ts * 1_000_000); // Convert seconds to microseconds
                        }
                        "value" => {
                            let val_str = map.next_value::<String>()?;
                            value = Some(val_str.parse::<f64>().map_err(serde::de::Error::custom)?);
                        }
                        "labels" => {
                            let label_map = map.next_value::<FxIndexMap<String, String>>()?;
                            labels = label_map
                                .into_iter()
                                .map(|(name, value)| Arc::new(Label::new(name, value)))
                                .collect();
                        }
                        _ => {
                            let _ = map.next_value::<serde::de::IgnoredAny>()?;
                        }
                    }
                }

                let timestamp =
                    timestamp.ok_or_else(|| serde::de::Error::missing_field("timestamp"))?;
                let value = value.ok_or_else(|| serde::de::Error::missing_field("value"))?;

                Ok(Exemplar {
                    timestamp,
                    value,
                    labels,
                })
            }
        }

        deserializer.deserialize_struct(
            "exemplars",
            &["timestamp", "value", "labels"],
            ExemplarVisitor,
        )
    }
}

impl From<&json::Map<String, json::Value>> for Exemplar {
    fn from(data: &json::Map<String, json::Value>) -> Self {
        let timestamp = data.get("_timestamp").and_then(json::Value::as_i64);
        let value = data.get("value").map(|v| v.as_f64().unwrap_or(0.0));
        let mut labels = vec![];
        for (k, v) in data.iter() {
            if k == "_timestamp" || k == "value" {
                continue;
            }
            labels.push(Arc::new(Label::new(
                k.to_string(),
                json::get_string_value(v),
            )));
        }
        Self {
            timestamp: timestamp.unwrap_or(0),
            value: value.unwrap_or(0.0),
            labels,
        }
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
    pub range: Duration,
    /// The offset used during the query execution.
    /// We don't use it (yet), so its value is always zero.
    // See https://github.com/prometheus/prometheus/blob/80b7f73d267a812b3689321554aec637b75f468d/promql/parser/ast.go#L192-L198
    pub offset: Duration,
}

impl TimeWindow {
    pub fn new(range: Duration) -> Self {
        Self {
            range,
            offset: Duration::ZERO,
        }
    }
}

/// Context for evaluating PromQL expressions across multiple timestamps
#[derive(Debug, Clone)]
pub struct EvalContext {
    /// Trace ID for logging and debugging
    pub trace_id: String,
    /// Start time in microseconds
    pub start: i64,
    /// End time in microseconds
    pub end: i64,
    /// Step interval in microseconds
    pub step: i64,
}

impl EvalContext {
    pub fn new(start: i64, end: i64, step: i64, trace_id: String) -> Self {
        Self {
            trace_id,
            start,
            end,
            step,
        }
    }

    /// Returns true if this is an instant query (single timestamp)
    pub fn is_instant(&self) -> bool {
        self.start == self.end
    }

    /// Get all evaluation timestamps
    pub fn timestamps(&self) -> Vec<i64> {
        if self.is_instant() {
            vec![self.start]
        } else {
            let nr_steps = (self.end - self.start) / self.step + 1;
            (0..nr_steps)
                .map(|i| self.start + (self.step * i))
                .collect()
        }
    }
}

#[derive(Debug, Clone)]
pub struct QueryContext {
    pub trace_id: String,
    pub org_id: String,
    pub query_exemplars: bool,
    pub query_data: bool,
    pub need_wal: bool,
    pub use_cache: bool,
    pub timeout: u64, // seconds, query timeout
    pub search_event_type: Option<SearchEventType>,
    pub regions: Vec<String>,
    pub clusters: Vec<String>,
    pub is_super_cluster: bool,
}

#[derive(Debug, Default, Clone)]
pub struct RangeValue {
    pub labels: Labels,
    pub samples: Vec<Sample>,
    pub exemplars: Option<Vec<Arc<Exemplar>>>,
    pub time_window: Option<TimeWindow>,
}

impl RangeValue {
    /// Returns the values from the `samples` field as an array of f64
    pub fn get_sample_values(&self) -> Vec<f64> {
        self.samples.iter().map(|sample| sample.value).collect()
    }

    pub fn extend(&mut self, other: RangeValue) {
        if !other.samples.is_empty() {
            self.samples.extend(other.samples);
        }
        // check exemplars
        if let Some(exemplars) = other.exemplars
            && !exemplars.is_empty()
        {
            if let Some(self_exemplars) = &mut self.exemplars {
                self_exemplars.extend(exemplars);
            } else {
                self.exemplars = Some(exemplars);
            }
        }
    }
}

impl Serialize for RangeValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.exemplars.is_none() {
            let mut seq = serializer.serialize_struct("range_value", 2)?;
            let labels_map = self
                .labels
                .iter()
                .map(|l| (l.name.as_str(), l.value.as_str()))
                .collect::<FxIndexMap<_, _>>();
            seq.serialize_field("metric", &labels_map)?;
            seq.serialize_field("values", &self.samples)?;
            seq.end()
        } else {
            let mut seq = serializer.serialize_struct("range_value", 2)?;
            let labels_map = self
                .labels
                .iter()
                .map(|l| (l.name.as_str(), l.value.as_str()))
                .collect::<FxIndexMap<_, _>>();
            seq.serialize_field("seriesLabels", &labels_map)?;
            seq.serialize_field("exemplars", &self.exemplars.as_ref().unwrap())?;
            seq.end()
        }
    }
}

impl<'de> Deserialize<'de> for RangeValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RangeValueVisitor;

        impl<'de> Visitor<'de> for RangeValueVisitor {
            type Value = RangeValue;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a map with metric/seriesLabels and values/exemplars fields")
            }

            fn visit_map<V>(self, mut map: V) -> Result<RangeValue, V::Error>
            where
                V: serde::de::MapAccess<'de>,
            {
                let mut labels_map: Option<FxIndexMap<String, String>> = None;
                let mut samples: Option<Vec<Sample>> = None;
                let mut exemplars: Option<Vec<Arc<Exemplar>>> = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "metric" | "seriesLabels" => {
                            labels_map = Some(map.next_value()?);
                        }
                        "values" => {
                            samples = Some(map.next_value()?);
                        }
                        "exemplars" => {
                            exemplars = Some(map.next_value()?);
                        }
                        _ => {
                            let _ = map.next_value::<serde::de::IgnoredAny>()?;
                        }
                    }
                }

                let labels_map =
                    labels_map.ok_or_else(|| serde::de::Error::missing_field("metric"))?;
                let labels = labels_map
                    .into_iter()
                    .map(|(name, value)| Arc::new(Label { name, value }))
                    .collect();

                Ok(RangeValue {
                    labels,
                    samples: samples.unwrap_or_default(),
                    exemplars,
                    time_window: None,
                })
            }
        }

        deserializer.deserialize_map(RangeValueVisitor)
    }
}

impl RangeValue {
    pub fn new<S>(labels: Labels, samples: S) -> Self
    where
        S: IntoIterator<Item = Sample>,
    {
        Self {
            labels,
            samples: Vec::from_iter(samples),
            exemplars: None,
            time_window: None,
        }
    }

    pub fn new_with_exemplars<S>(labels: Labels, exemplars: S) -> Self
    where
        S: IntoIterator<Item = Arc<Exemplar>>,
    {
        Self {
            labels,
            samples: vec![],
            exemplars: Some(Vec::from_iter(exemplars)),
            time_window: None,
        }
    }
}

#[derive(Debug)]
pub enum ExtrapolationKind {
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

    /// Calculate the difference between the first and last value. Don't adjust
    /// for counter resets. Should only be used with gauges.
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
// cf. https://github.com/prometheus/prometheus/blob/80b7f73d267a812b3689321554aec637b75f468d/promql/functions.go#L67
pub fn extrapolated_rate(
    samples: &[Sample],
    eval_ts: i64,
    range: Duration,
    offset: Duration,
    kind: ExtrapolationKind,
) -> Option<f64> {
    if samples.len() < 2 {
        // Not enough samples.
        return None;
    }

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
    String(String),
    None,
}

impl Value {
    pub fn get_ref_matrix_values(&self) -> Option<&Vec<RangeValue>> {
        match self {
            Value::Matrix(values) => Some(values),
            _ => None,
        }
    }

    pub fn get_range_values(self) -> Option<Vec<RangeValue>> {
        match self {
            Value::Matrix(values) => Some(values),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn get_vector(&self) -> Option<&Vec<InstantValue>> {
        match self {
            Value::Vector(values) => Some(values),
            _ => None,
        }
    }

    pub fn get_string(&self) -> Option<String> {
        match self {
            Value::String(v) => Some(v.into()),
            _ => None,
        }
    }

    pub fn get_float(&self) -> Option<f64> {
        match self {
            Value::Float(f) => Some(*f),
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
            Value::String(_) => "string",
            Value::None => "scalar",
        }
    }

    pub fn sort(&mut self) {
        match self {
            Value::Vector(v) => {
                v.sort_by(|a, b| sort_float(&b.sample.value, &a.sample.value));
            }
            Value::Matrix(v) => {
                v.sort_by(|a, b| {
                    if a.labels > b.labels {
                        std::cmp::Ordering::Greater
                    } else if a.labels < b.labels {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Equal
                    }
                });
            }
            _ => {}
        }
    }

    /// Checks if the vector or matrix types contain duplicated label set or
    /// not. This is an undefined condition, hence caller should raise an
    /// error in case this evaluates to `true`.
    pub fn contains_same_label_set(&self) -> bool {
        match self {
            Value::Vector(v) => match v.len() {
                0 | 1 => false,
                2 => v[0].labels.signature() == v[1].labels.signature(),
                _ => {
                    let mut signatures = HashSet::new();
                    for instant in v.iter() {
                        // If the set already contained this value, false is returned.
                        let new = signatures.insert(instant.labels.signature());
                        if !new {
                            return true;
                        }
                    }
                    false
                }
            },
            Value::Matrix(v) => match v.len() {
                0 | 1 => false,
                2 => v[0].labels.signature() == v[1].labels.signature(),
                _ => {
                    let mut signatures = HashSet::new();
                    for instant in v.iter() {
                        // If the set already contained this value, false is returned.
                        let new = signatures.insert(instant.labels.signature());
                        if !new {
                            return true;
                        }
                    }
                    false
                }
            },
            _ => false,
        }
    }
}

// REFACTORME: make this a method of `Metric`
pub fn signature(labels: &Labels) -> u64 {
    signature_without_labels(labels, &[])
}

/// `signature_without_labels` is just as [`signature`], but only for labels not
/// matching `names`.
// REFACTORME: make this a method of `Metric`
pub fn signature_without_labels(labels: &Labels, exclude_names: &[&str]) -> u64 {
    let mut hasher = crate::utils::hash::gxhash::new_hasher();
    labels
        .iter()
        .filter(|item| !exclude_names.contains(&item.name.as_str()))
        .for_each(|item| {
            hasher.write(item.name.as_bytes());
            hasher.write(item.value.as_bytes());
        });
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use std::f64;

    use float_cmp::approx_eq;

    use super::*;

    fn generate_test_labels() -> Labels {
        let labels: Labels = vec![
            Arc::new(Label {
                name: "a".to_owned(),
                value: "1".to_owned(),
            }),
            Arc::new(Label {
                name: "b".to_owned(),
                value: "2".to_owned(),
            }),
            Arc::new(Label {
                name: "c".to_owned(),
                value: "3".to_owned(),
            }),
            Arc::new(Label {
                name: "d".to_owned(),
                value: "4".to_owned(),
            }),
        ];
        labels
    }
    #[test]
    fn test_signature_without_labels() {
        let labels: Labels = generate_test_labels();

        let sig_all = signature(&labels);
        let sig_without_ac = signature_without_labels(&labels, &["a", "c"]);

        // Signatures should be different when excluding labels
        assert_ne!(sig_all, sig_without_ac);

        // Signature with empty exclusion list should match full signature
        assert_eq!(signature(&labels), signature_without_labels(&labels, &[]));

        // Same labels should produce same signature (deterministic)
        assert_eq!(sig_all, signature(&labels));
        assert_eq!(
            sig_without_ac,
            signature_without_labels(&labels, &["a", "c"])
        );
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
        assert!(approx_eq!(f64, delta, 4.0));
    }

    #[test]
    fn test_invalid_label_name() {
        assert!(!Label::is_valid_label_name("~invalid-label-name"));
    }

    #[test]
    fn test_get_value() {
        let labels: Labels = generate_test_labels();

        let value = labels.get_value("a");
        assert!(value == "1");

        let value = labels.get_value("non-existent-label");
        assert!(value.is_empty());
    }

    #[test]
    fn test_keep() {
        let labels: Labels = generate_test_labels();

        let labels_to_include = vec!["a".into(), "b".into()];
        let expected = vec![
            Arc::new(Label::new("a", "1")),
            Arc::new(Label::new("b", "2")),
        ];
        let output = labels.keep(&labels_to_include);

        use std::iter::zip;
        for (expect, got) in zip(expected, output.clone()) {
            assert_eq!(expect.name, got.name, "{:?}", &output);
        }
    }

    #[test]
    fn test_delete() {
        let labels: Labels = generate_test_labels();

        let labels_to_exclude = vec!["a".into(), "b".into()];
        let expected = vec![
            Arc::new(Label::new("c", "3")),
            Arc::new(Label::new("d", "4")),
        ];
        let output = labels.delete(&labels_to_exclude);

        use std::iter::zip;
        for (expect, got) in zip(expected, output.clone()) {
            assert_eq!(expect.name, got.name, "{:?}", &output);
        }
    }

    #[test]
    fn test_keep_delete_empty() {
        let labels: Labels = generate_test_labels();

        let labels_to_exclude = vec![];
        let expected = labels.clone();
        let output_deleted = labels.delete(&labels_to_exclude);
        let output_kept = labels.delete(&labels_to_exclude);

        use std::iter::zip;
        for (expect, got) in zip(expected.clone(), output_deleted.clone()) {
            assert_eq!(expect.name, got.name, "{:?}", &output_deleted);
        }
        for (expect, got) in zip(expected, output_kept.clone()) {
            assert_eq!(expect.name, got.name, "{:?}", &output_kept);
        }
    }

    #[test]
    fn test_sample_serialization() {
        let sample = Sample::new(1_609_459_200_000_000, 42.5); // 2021-01-01 00:00:00 UTC in microseconds
        let json = serde_json::to_string(&sample).unwrap();
        assert_eq!(json, "[1609459200,\"42.5\"]");
    }

    #[test]
    fn test_sample_deserialization() {
        let json = "[1609459200,\"42.5\"]";
        let sample: Sample = serde_json::from_str(json).unwrap();
        assert_eq!(sample.timestamp, 1_609_459_200_000_000);
        assert_eq!(sample.value, 42.5);
    }

    #[test]
    fn test_label_new() {
        let label = Label::new("test_name", "test_value");
        assert_eq!(label.name, "test_name");
        assert_eq!(label.value, "test_value");
    }

    #[test]
    fn test_valid_label_names() {
        assert!(Label::is_valid_label_name("valid_label"));
        assert!(Label::is_valid_label_name("_valid"));
        assert!(Label::is_valid_label_name("Valid123"));
        assert!(Label::is_valid_label_name("a"));

        assert!(!Label::is_valid_label_name("123invalid"));
        assert!(!Label::is_valid_label_name("invalid-label"));
        assert!(!Label::is_valid_label_name("invalid.label"));
        assert!(!Label::is_valid_label_name(""));
    }

    #[test]
    fn test_labels_ext_without_label() {
        let mut labels: Labels = generate_test_labels();
        let original_len = labels.len();

        labels = labels.without_label("b");
        assert_eq!(labels.len(), original_len - 1);

        let names: Vec<_> = labels.iter().map(|l| &l.name).collect();
        assert!(!names.contains(&&"b".to_string()));
        assert!(names.contains(&&"a".to_string()));
    }

    #[test]
    fn test_labels_ext_set() {
        let mut labels: Labels = generate_test_labels();
        let original_len = labels.len();

        labels.set("new_label", "new_value");
        assert_eq!(labels.len(), original_len + 1);

        let value = labels.get_value("new_label");
        assert_eq!(value, "new_value");
    }

    #[test]
    fn test_labels_ext_values_and_keys() {
        let labels: Labels = generate_test_labels();

        let values = labels.values();
        assert!(values.contains(&"1".to_string()));
        assert!(values.contains(&"2".to_string()));
        assert!(values.contains(&"3".to_string()));
        assert!(values.contains(&"4".to_string()));
        assert_eq!(values.len(), 4);

        let keys = labels.keys();
        assert!(keys.contains(&"a".to_string()));
        assert!(keys.contains(&"b".to_string()));
        assert!(keys.contains(&"c".to_string()));
        assert!(keys.contains(&"d".to_string()));
        assert_eq!(keys.len(), 4);
    }

    #[test]
    fn test_labels_ext_sort() {
        let mut labels: Labels = vec![
            Arc::new(Label::new("z", "26")),
            Arc::new(Label::new("a", "1")),
            Arc::new(Label::new("m", "13")),
        ];

        labels.sort();

        assert_eq!(labels[0].name, "a");
        assert_eq!(labels[1].name, "m");
        assert_eq!(labels[2].name, "z");
    }

    #[test]
    fn test_time_window_new() {
        let range = Duration::from_secs(300); // 5 minutes

        let window = TimeWindow::new(range);
        assert_eq!(window.range, range);
        assert_eq!(window.offset, Duration::ZERO);
    }

    #[test]
    fn test_range_value_get_sample_values() {
        let samples = vec![
            Sample::new(1000, 1.5),
            Sample::new(2000, 2.5),
            Sample::new(3000, 3.5),
        ];
        let range_value = RangeValue::new(vec![], samples);

        let values = range_value.get_sample_values();
        assert_eq!(values, vec![1.5, 2.5, 3.5]);
    }

    #[test]
    fn test_range_value_extend() {
        let mut range_value1 = RangeValue::new(vec![], vec![Sample::new(1000, 1.0)]);
        let range_value2 = RangeValue::new(vec![], vec![Sample::new(2000, 2.0)]);

        range_value1.extend(range_value2);
        assert_eq!(range_value1.samples.len(), 2);
        assert_eq!(range_value1.samples[0].value, 1.0);
        assert_eq!(range_value1.samples[1].value, 2.0);
    }

    #[test]
    fn test_range_value_extend_with_exemplars() {
        let mut range_value1 = RangeValue {
            labels: vec![],
            samples: vec![],
            exemplars: Some(vec![Arc::new(Exemplar {
                timestamp: 1000,
                value: 1.0,
                labels: vec![],
            })]),
            time_window: None,
        };

        let range_value2 = RangeValue {
            labels: vec![],
            samples: vec![],
            exemplars: Some(vec![Arc::new(Exemplar {
                timestamp: 2000,
                value: 2.0,
                labels: vec![],
            })]),
            time_window: None,
        };

        range_value1.extend(range_value2);
        assert_eq!(range_value1.exemplars.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn test_range_value_new_with_exemplars() {
        let exemplars = vec![Arc::new(Exemplar {
            timestamp: 1000,
            value: 1.0,
            labels: vec![],
        })];

        let range_value = RangeValue::new_with_exemplars(vec![], exemplars.clone());
        assert!(range_value.samples.is_empty());
        assert_eq!(range_value.exemplars.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn test_labels_value() {
        let labels: Labels = generate_test_labels();

        let value = labels_value(&labels, "a");
        assert_eq!(value, Some("1".to_string()));

        let value = labels_value(&labels, "nonexistent");
        assert_eq!(value, None);
    }

    #[test]
    fn test_value_get_methods() {
        let instant_value = InstantValue {
            labels: vec![],
            sample: Sample::new(1000, 1.0),
        };
        let vector = vec![instant_value.clone()];
        let range_value = RangeValue::new(vec![], vec![Sample::new(1000, 1.0)]);
        let matrix = vec![range_value.clone()];

        let value_vector = Value::Vector(vector.clone());
        assert!(value_vector.get_vector().is_some());
        assert!(value_vector.get_ref_matrix_values().is_none());

        let value_matrix = Value::Matrix(matrix.clone());
        assert!(value_matrix.get_ref_matrix_values().is_some());
        assert!(value_matrix.get_vector().is_none());

        let value_string = Value::String("test".to_string());
        assert_eq!(value_string.get_string(), Some("test".to_string()));

        let value_float = Value::Float(1.23);
        assert_eq!(value_float.get_float(), Some(1.23));
    }

    #[test]
    fn test_value_get_type() {
        assert_eq!(
            Value::Instant(InstantValue {
                labels: vec![],
                sample: Sample::new(1000, 1.0)
            })
            .get_type(),
            "vector"
        );
        assert_eq!(
            Value::Range(RangeValue::new(vec![], vec![])).get_type(),
            "matrix"
        );
        assert_eq!(Value::Vector(vec![]).get_type(), "vector");
        assert_eq!(Value::Matrix(vec![]).get_type(), "matrix");
        assert_eq!(Value::Sample(Sample::new(1000, 1.0)).get_type(), "scalar");
        assert_eq!(Value::Float(std::f64::consts::PI).get_type(), "scalar");
        assert_eq!(Value::String("test".to_string()).get_type(), "string");
        assert_eq!(Value::None.get_type(), "scalar");
    }

    #[test]
    fn test_value_contains_same_label_set() {
        let label1 = vec![Arc::new(Label::new("name", "value1"))];
        let label2 = vec![Arc::new(Label::new("name", "value2"))];
        let label1_dup = vec![Arc::new(Label::new("name", "value1"))];

        // Test vector with unique labels
        let vector_unique = Value::Vector(vec![
            InstantValue {
                labels: label1.clone(),
                sample: Sample::new(1000, 1.0),
            },
            InstantValue {
                labels: label2.clone(),
                sample: Sample::new(2000, 2.0),
            },
        ]);
        assert!(!vector_unique.contains_same_label_set());

        // Test vector with duplicate labels
        let vector_duplicate = Value::Vector(vec![
            InstantValue {
                labels: label1.clone(),
                sample: Sample::new(1000, 1.0),
            },
            InstantValue {
                labels: label1_dup.clone(),
                sample: Sample::new(2000, 2.0),
            },
        ]);
        assert!(vector_duplicate.contains_same_label_set());

        // Test matrix with unique labels
        let matrix_unique = Value::Matrix(vec![
            RangeValue::new(label1.clone(), vec![Sample::new(1000, 1.0)]),
            RangeValue::new(label2.clone(), vec![Sample::new(2000, 2.0)]),
        ]);
        assert!(!matrix_unique.contains_same_label_set());

        // Test matrix with duplicate labels
        let matrix_duplicate = Value::Matrix(vec![
            RangeValue::new(label1.clone(), vec![Sample::new(1000, 1.0)]),
            RangeValue::new(label1_dup.clone(), vec![Sample::new(2000, 2.0)]),
        ]);
        assert!(matrix_duplicate.contains_same_label_set());

        // Test single element cases
        let single_vector = Value::Vector(vec![InstantValue {
            labels: label1.clone(),
            sample: Sample::new(1000, 1.0),
        }]);
        assert!(!single_vector.contains_same_label_set());

        let empty_vector = Value::Vector(vec![]);
        assert!(!empty_vector.contains_same_label_set());

        // Test non-vector/matrix types
        assert!(!Value::Float(1.0).contains_same_label_set());
    }

    #[test]
    fn test_value_sort() {
        let mut vector = Value::Vector(vec![
            InstantValue {
                labels: vec![],
                sample: Sample::new(1000, 1.0),
            },
            InstantValue {
                labels: vec![],
                sample: Sample::new(2000, 3.0),
            },
            InstantValue {
                labels: vec![],
                sample: Sample::new(3000, 2.0),
            },
        ]);

        vector.sort();

        if let Value::Vector(ref v) = vector {
            assert_eq!(v[0].sample.value, 3.0); // Highest value first
            assert_eq!(v[1].sample.value, 2.0);
            assert_eq!(v[2].sample.value, 1.0); // Lowest value last
        }

        let mut matrix = Value::Matrix(vec![
            RangeValue::new(
                vec![Arc::new(Label::new("k1", "v1"))],
                vec![Sample::new(1000, 1.0), Sample::new(2000, 1.0)],
            ), // sum = 2.0
            RangeValue::new(
                vec![Arc::new(Label::new("k1", "v3"))],
                vec![Sample::new(1000, 2.0), Sample::new(2000, 3.0)],
            ), // sum = 5.0
            RangeValue::new(
                vec![Arc::new(Label::new("k1", "v2"))],
                vec![Sample::new(1000, 1.5), Sample::new(2000, 1.5)],
            ), // sum = 3.0
        ]);

        // we sort by alphabetical order of labels
        matrix.sort();

        if let Value::Matrix(ref m) = matrix {
            let sum0: f64 = m[0].samples.iter().map(|s| s.value).sum();
            let sum1: f64 = m[1].samples.iter().map(|s| s.value).sum();
            let sum2: f64 = m[2].samples.iter().map(|s| s.value).sum();
            assert_eq!(sum0, 2.0);
            assert_eq!(sum1, 3.0);
            assert_eq!(sum2, 5.0);
        }
    }

    #[test]
    fn test_exemplar_from_json_map() {
        let mut map = json::Map::new();
        map.insert(
            "_timestamp".to_string(),
            json::Value::Number(serde_json::Number::from(1609459200)),
        );
        map.insert(
            "value".to_string(),
            json::Value::Number(serde_json::Number::from_f64(42.5).unwrap()),
        );
        map.insert(
            "trace_id".to_string(),
            json::Value::String("abc123".to_string()),
        );
        map.insert(
            "span_id".to_string(),
            json::Value::String("def456".to_string()),
        );

        let exemplar = Exemplar::from(&map);
        assert_eq!(exemplar.timestamp, 1609459200);
        assert_eq!(exemplar.value, 42.5);
        assert_eq!(exemplar.labels.len(), 2);

        let trace_id_value = exemplar.labels.get_value("trace_id");
        assert_eq!(trace_id_value, "abc123");

        let span_id_value = exemplar.labels.get_value("span_id");
        assert_eq!(span_id_value, "def456");
    }

    #[test]
    fn test_exemplar_serialization() {
        let exemplar = Exemplar {
            timestamp: 1_609_459_200_000_000,
            value: 42.5,
            labels: vec![Arc::new(Label::new("trace_id", "abc123"))],
        };

        let json = serde_json::to_string(&exemplar).unwrap();
        assert!(json.contains("\"timestamp\":1609459200"));
        assert!(json.contains("\"value\":\"42.5\""));
        assert!(json.contains("\"trace_id\":\"abc123\""));
    }

    #[test]
    fn test_extrapolated_rate_edge_cases() {
        // Test with insufficient samples
        let samples = [Sample::new(1000, 1.0)];
        let result = extrapolated_rate(
            &samples,
            75_000_000,
            Duration::from_secs(60),
            Duration::ZERO,
            ExtrapolationKind::Rate,
        );
        assert!(result.is_none());

        // Test with empty samples
        let empty_samples: &[Sample] = &[];
        let result = extrapolated_rate(
            empty_samples,
            75_000_000,
            Duration::from_secs(60),
            Duration::ZERO,
            ExtrapolationKind::Rate,
        );
        assert!(result.is_none());
    }
}
