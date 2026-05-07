// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Service Streams Types
//!
//! Types used for service discovery and telemetry correlation.
//! These are shared between openobserve core and enterprise modules.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::meta::stream::StreamType;

/// Information about a stream where a service was discovered
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
pub struct StreamInfo {
    /// Stream name
    pub stream_name: String,

    /// Stream type (logs, metrics, traces)
    ///
    /// This field explicitly identifies the stream type, enabling UIs to:
    /// 1. Query the correct API endpoint (logs/_search vs metrics/_search)
    /// 2. Display appropriate type badges/icons
    /// 3. Handle flattened stream lists without losing type information
    #[serde(default)]
    pub stream_type: StreamType,

    /// Optional filter conditions that identify this service in the stream
    /// Example: {"namespace": "production", "cluster": "us-east-1"}
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub filters: HashMap<String, String>,
}

impl std::hash::Hash for StreamInfo {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.stream_name.hash(state);
        self.stream_type.hash(state);
        // Sort filters by key for consistent hashing
        let mut filter_items: Vec<_> = self.filters.iter().collect();
        filter_items.sort_by_key(|(k, _)| *k);
        for (k, v) in filter_items {
            k.hash(state);
            v.hash(state);
        }
    }
}

impl StreamInfo {
    /// Create a new stream info with just the stream name (defaults to Logs type)
    pub fn new(stream_name: String) -> Self {
        Self {
            stream_name,
            stream_type: StreamType::default(),
            filters: HashMap::new(),
        }
    }

    /// Create a new stream info with explicit stream type
    pub fn with_type(stream_name: String, stream_type: StreamType) -> Self {
        Self {
            stream_name,
            stream_type,
            filters: HashMap::new(),
        }
    }

    /// Create a new stream info with filters (defaults to Logs type)
    pub fn with_filters(stream_name: String, filters: HashMap<String, String>) -> Self {
        Self {
            stream_name,
            stream_type: StreamType::default(),
            filters,
        }
    }

    /// Create a new stream info with stream type and filters
    pub fn with_type_and_filters(
        stream_name: String,
        stream_type: StreamType,
        filters: HashMap<String, String>,
    ) -> Self {
        Self {
            stream_name,
            stream_type,
            filters,
        }
    }

    /// Set the stream type (builder pattern)
    pub fn set_stream_type(mut self, stream_type: StreamType) -> Self {
        self.stream_type = stream_type;
        self
    }
}

/// Response from the correlate API
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CorrelationResponse {
    /// Matched service name
    pub service_name: String,
    /// Dimensions that were used for matching (minimal set)
    pub matched_dimensions: HashMap<String, String>,
    /// Additional dimensions available for filtering
    pub additional_dimensions: HashMap<String, String>,
    /// Related streams grouped by type (for backward compatibility)
    pub related_streams: RelatedStreams,
    /// Flattened list of all streams with explicit stream_type
    ///
    /// This field provides a flat list of all streams where each stream has its
    /// stream_type explicitly set. This is useful for UIs that:
    /// 1. Display all streams in a single list/table
    /// 2. Need to query streams without maintaining the nested structure
    /// 3. Pass streams between components (type info is preserved)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub all_streams: Vec<StreamInfo>,
    /// The identity set that was selected for this correlation (by best-coverage resolution).
    /// `None` if the feature is not enabled or the set was not determined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_set_id: Option<String>,
}

impl CorrelationResponse {
    /// Build the flattened all_streams list from related_streams
    ///
    /// This should be called after constructing the related_streams to populate all_streams.
    /// Each stream will have its stream_type set based on which collection it came from.
    pub fn build_all_streams(&mut self) {
        let mut all = Vec::new();

        // Add logs with explicit type
        for stream in &self.related_streams.logs {
            let mut s = stream.clone();
            s.stream_type = StreamType::Logs;
            all.push(s);
        }

        // Add traces with explicit type
        for stream in &self.related_streams.traces {
            let mut s = stream.clone();
            s.stream_type = StreamType::Traces;
            all.push(s);
        }

        // Add metrics with explicit type
        for stream in &self.related_streams.metrics {
            let mut s = stream.clone();
            s.stream_type = StreamType::Metrics;
            all.push(s);
        }

        self.all_streams = all;
    }

    /// Create a new CorrelationResponse with all_streams pre-populated
    pub fn new(
        service_name: String,
        matched_dimensions: HashMap<String, String>,
        additional_dimensions: HashMap<String, String>,
        related_streams: RelatedStreams,
    ) -> Self {
        let mut response = Self {
            service_name,
            matched_dimensions,
            additional_dimensions,
            related_streams,
            all_streams: Vec::new(),
            matched_set_id: None,
        };
        response.build_all_streams();
        response
    }
}

/// Related streams grouped by type
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RelatedStreams {
    pub logs: Vec<StreamInfo>,
    pub traces: Vec<StreamInfo>,
    pub metrics: Vec<StreamInfo>,
}

/// Dimension analytics summary for an organization
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DimensionAnalyticsSummary {
    /// Organization ID
    pub org_id: String,

    /// Total number of dimensions tracked
    pub total_dimensions: usize,

    /// Dimensions by cardinality class
    pub by_cardinality: HashMap<String, Vec<String>>,

    /// Recommended priority dimensions for correlation
    /// (sorted by cardinality, lowest first)
    pub recommended_priority_dimensions: Vec<String>,

    /// All dimension analytics (dimensions with ingested data)
    pub dimensions: Vec<DimensionAnalytics>,

    /// All alias groups found in the org's stream schemas
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_groups: Vec<FoundGroup>,

    /// Field name sources for the "service" semantic group, ranked by hit count.
    /// Shows which actual field names in each stream type contributed a service name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub service_field_sources: Vec<ServiceFieldSource>,

    /// When this summary was generated
    pub generated_at: i64,
}

/// Describes a raw field name that was used to populate a semantic group,
/// along with which stream types it appeared in and how many services used it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ServiceFieldSource {
    /// The raw field name in the stream, e.g. "kubernetes_labels_app"
    pub field_name: String,
    /// Stream types where this field was used, e.g. ["logs", "traces"]
    pub stream_types: Vec<String>,
    /// Number of services where this field provided the semantic group value
    pub hit_count: usize,
}

/// A semantic alias group found in the org's stream schemas.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FoundGroup {
    /// Semantic group ID, e.g., "k8s-cluster"
    pub group_id: String,
    /// Human-readable display name, e.g., "K8s Cluster"
    pub display: String,
    /// Which stream types contain a field from this group (e.g., ["logs", "traces"])
    pub stream_types: Vec<String>,
    /// Actual field name found per stream type, e.g., {"logs": "k8s_cluster_name"}
    pub aliases: HashMap<String, String>,
    /// True if this group appears in 2+ stream types AND has acceptable cardinality
    /// (Deprecated: logic moving to UI)
    pub recommended: bool,
    /// Number of unique values seen in actual data (None if no data collected yet)
    pub unique_values: Option<usize>,
    /// Cardinality class derived from unique_values (None if no data yet)
    pub cardinality_class: Option<CardinalityClass>,
    /// Category this group belongs to (e.g., "AWS", "Kubernetes", "Azure", "GCP", "Common").
    /// Sourced from the underlying `FieldAlias.group`. When `None`, the frontend falls
    /// back to inferring the category from `group_id` prefix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

/// Dimension analytics tracking
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DimensionAnalytics {
    /// Dimension name (e.g., "k8s-cluster", "environment", "service")
    pub dimension_name: String,

    /// Current cardinality (number of unique values seen)
    pub cardinality: usize,

    /// Cardinality class
    pub cardinality_class: CardinalityClass,

    /// Number of services that have this dimension
    pub service_count: usize,

    /// When this dimension was first seen
    pub first_seen: i64,

    /// When this dimension was last updated
    pub last_updated: i64,

    /// Sample values mapped by stream type, then stream name (limited to 10 for inspection)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub sample_values: HashMap<String, HashMap<String, Vec<String>>>,

    /// For each unique value of this dimension, the co-occurring values of other dimensions.
    /// Example: { "common-dev": { "k8s-namespace": ["introspection", "ziox", "dev"] } }
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub value_children: HashMap<String, HashMap<String, Vec<String>>>,

    /// Number of services that carry each specific value of this dimension.
    /// Example: { "staging": 42, "prod-us-east": 18, "prod-us-west": 11 }
    /// Used for per-value coverage: value_counts[v] / service_count = fraction of
    /// env services in that specific group value.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub value_counts: HashMap<String, usize>,
}

impl DimensionAnalytics {
    /// Create new dimension analytics
    pub fn new(dimension_name: String) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            dimension_name,
            cardinality: 0,
            cardinality_class: CardinalityClass::VeryLow,
            service_count: 0,
            first_seen: now,
            last_updated: now,
            sample_values: HashMap::new(),
            value_children: HashMap::new(),
            value_counts: HashMap::new(),
        }
    }

    /// Update analytics with new data
    pub fn update(
        &mut self,
        cardinality: usize,
        service_count: usize,
        sample_values: HashMap<String, HashMap<String, Vec<String>>>,
        value_children: HashMap<String, HashMap<String, Vec<String>>>,
        value_counts: HashMap<String, usize>,
    ) {
        self.cardinality = cardinality;
        self.cardinality_class = CardinalityClass::from_cardinality(cardinality);
        self.service_count = service_count;
        self.last_updated = chrono::Utc::now().timestamp_micros();

        // Keep only first 10 sample values per stream within each stream type
        self.sample_values = sample_values
            .into_iter()
            .map(|(stream_type, streams)| {
                (
                    stream_type,
                    streams
                        .into_iter()
                        .map(|(k, v)| (k, v.into_iter().take(10).collect()))
                        .collect(),
                )
            })
            .collect();

        self.value_children = value_children;
        self.value_counts = value_counts;
    }

    /// Check if this dimension is suitable for correlation
    pub fn is_suitable_for_correlation(&self) -> bool {
        self.cardinality_class.is_suitable_for_correlation()
    }
}

/// Cardinality classification for dimensions
///
/// Used to determine which dimensions are stable (good for correlation)
/// vs transient (should be filtered out or used only for additional filtering)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq, PartialOrd, Ord)]
pub enum CardinalityClass {
    /// 1-10 unique values (e.g., cluster, environment, region)
    /// Best for correlation - very stable
    VeryLow,

    /// 10-100 unique values (e.g., namespace, service, application)
    /// Good for correlation - stable
    Low,

    /// 100-1000 unique values (e.g., deployment, host, version)
    /// Medium stability - can be used for correlation
    Medium,

    /// 1000-10000 unique values (e.g., pod, container, node)
    /// High volatility - should not be used for correlation
    High,

    /// More than 10000 unique values (e.g., trace_id, request_id, span_id)
    /// Very high volatility - definitely not for correlation
    VeryHigh,
}

/// Streams organized by type
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct ServiceStreams {
    /// Log stream names
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub logs: Vec<String>,

    /// Trace stream names
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub traces: Vec<String>,

    /// Metric stream names
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metrics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct StreamSummary {
    /// Number of log streams
    pub logs_count: usize,

    /// Number of trace streams
    pub traces_count: usize,

    /// Number of metric streams
    pub metrics_count: usize,

    /// Whether this group has all three telemetry types
    pub has_full_correlation: bool,
}

impl CardinalityClass {
    /// Classify cardinality based on unique value count
    pub fn from_cardinality(cardinality: usize) -> Self {
        match cardinality {
            0..=10 => CardinalityClass::VeryLow,
            11..=100 => CardinalityClass::Low,
            101..=1000 => CardinalityClass::Medium,
            1001..=10000 => CardinalityClass::High,
            _ => CardinalityClass::VeryHigh,
        }
    }

    /// Whether this cardinality class is suitable for correlation
    /// (VeryLow, Low, Medium are good; High and VeryHigh are not)
    pub fn is_suitable_for_correlation(&self) -> bool {
        matches!(
            self,
            CardinalityClass::VeryLow | CardinalityClass::Low | CardinalityClass::Medium
        )
    }

    /// Get priority score for correlation (lower is better)
    /// Used to sort dimensions by preference for correlation
    pub fn priority_score(&self) -> u8 {
        match self {
            CardinalityClass::VeryLow => 1,
            CardinalityClass::Low => 2,
            CardinalityClass::Medium => 3,
            CardinalityClass::High => 4,
            CardinalityClass::VeryHigh => 5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_info_with_type() {
        let stream = StreamInfo::with_type("my_stream".to_string(), StreamType::Metrics);
        assert_eq!(stream.stream_name, "my_stream");
        assert_eq!(stream.stream_type, StreamType::Metrics);
        assert!(stream.filters.is_empty());
    }

    #[test]
    fn test_stream_info_with_type_and_filters() {
        let mut filters = HashMap::new();
        filters.insert("namespace".to_string(), "prod".to_string());

        let stream = StreamInfo::with_type_and_filters(
            "my_stream".to_string(),
            StreamType::Traces,
            filters.clone(),
        );
        assert_eq!(stream.stream_name, "my_stream");
        assert_eq!(stream.stream_type, StreamType::Traces);
        assert_eq!(stream.filters, filters);
    }

    #[test]
    fn test_stream_info_hash_includes_stream_type() {
        use std::{
            collections::hash_map::DefaultHasher,
            hash::{Hash, Hasher},
        };

        // Same stream name but different stream types should hash differently
        let logs_stream = StreamInfo::with_type("app".to_string(), StreamType::Logs);
        let metrics_stream = StreamInfo::with_type("app".to_string(), StreamType::Metrics);

        let mut hasher1 = DefaultHasher::new();
        logs_stream.hash(&mut hasher1);
        let hash1 = hasher1.finish();

        let mut hasher2 = DefaultHasher::new();
        metrics_stream.hash(&mut hasher2);
        let hash2 = hasher2.finish();

        assert_ne!(
            hash1, hash2,
            "Same stream name with different stream types should hash differently"
        );
    }

    #[test]
    fn test_correlation_response_build_all_streams() {
        let logs_stream = StreamInfo::with_type("logs1".to_string(), StreamType::Logs);
        let traces_stream = StreamInfo::with_type("traces1".to_string(), StreamType::Traces);
        let metrics_stream = StreamInfo::with_type("metrics1".to_string(), StreamType::Metrics);

        let response = CorrelationResponse::new(
            "test-service".to_string(),
            HashMap::new(),
            HashMap::new(),
            RelatedStreams {
                logs: vec![logs_stream],
                traces: vec![traces_stream],
                metrics: vec![metrics_stream],
            },
        );

        assert_eq!(response.all_streams.len(), 3);

        let logs_in_all = response
            .all_streams
            .iter()
            .find(|s| s.stream_name == "logs1")
            .unwrap();
        assert_eq!(logs_in_all.stream_type, StreamType::Logs);

        let traces_in_all = response
            .all_streams
            .iter()
            .find(|s| s.stream_name == "traces1")
            .unwrap();
        assert_eq!(traces_in_all.stream_type, StreamType::Traces);

        let metrics_in_all = response
            .all_streams
            .iter()
            .find(|s| s.stream_name == "metrics1")
            .unwrap();
        assert_eq!(metrics_in_all.stream_type, StreamType::Metrics);
    }

    #[test]
    fn test_cardinality_class_from_cardinality() {
        assert_eq!(
            CardinalityClass::from_cardinality(5),
            CardinalityClass::VeryLow
        );
        assert_eq!(
            CardinalityClass::from_cardinality(50),
            CardinalityClass::Low
        );
        assert_eq!(
            CardinalityClass::from_cardinality(500),
            CardinalityClass::Medium
        );
        assert_eq!(
            CardinalityClass::from_cardinality(5000),
            CardinalityClass::High
        );
        assert_eq!(
            CardinalityClass::from_cardinality(50000),
            CardinalityClass::VeryHigh
        );
    }

    #[test]
    fn test_stream_info_new() {
        let s = StreamInfo::new("my_stream".to_string());
        assert_eq!(s.stream_name, "my_stream");
        assert_eq!(s.stream_type, StreamType::default());
        assert!(s.filters.is_empty());
    }

    #[test]
    fn test_stream_info_with_filters() {
        let mut filters = HashMap::new();
        filters.insert("env".to_string(), "prod".to_string());
        let s = StreamInfo::with_filters("s".to_string(), filters.clone());
        assert_eq!(s.filters, filters);
        assert_eq!(s.stream_type, StreamType::default());
    }

    #[test]
    fn test_stream_info_set_stream_type() {
        let s = StreamInfo::new("s".to_string()).set_stream_type(StreamType::Metrics);
        assert_eq!(s.stream_type, StreamType::Metrics);
    }

    #[test]
    fn test_cardinality_class_is_suitable_for_correlation() {
        assert!(CardinalityClass::VeryLow.is_suitable_for_correlation());
        assert!(CardinalityClass::Low.is_suitable_for_correlation());
        assert!(CardinalityClass::Medium.is_suitable_for_correlation());
        assert!(!CardinalityClass::High.is_suitable_for_correlation());
        assert!(!CardinalityClass::VeryHigh.is_suitable_for_correlation());
    }

    #[test]
    fn test_cardinality_class_priority_score() {
        assert_eq!(CardinalityClass::VeryLow.priority_score(), 1);
        assert_eq!(CardinalityClass::Low.priority_score(), 2);
        assert_eq!(CardinalityClass::Medium.priority_score(), 3);
        assert_eq!(CardinalityClass::High.priority_score(), 4);
        assert_eq!(CardinalityClass::VeryHigh.priority_score(), 5);
    }

    #[test]
    fn test_dimension_analytics_new() {
        let d = DimensionAnalytics::new("namespace".to_string());
        assert_eq!(d.dimension_name, "namespace");
        assert_eq!(d.cardinality, 0);
        assert_eq!(d.service_count, 0);
        assert_eq!(d.cardinality_class, CardinalityClass::VeryLow);
        assert!(d.sample_values.is_empty());
    }

    #[test]
    fn test_dimension_analytics_update() {
        let mut d = DimensionAnalytics::new("env".to_string());
        let mut sample = HashMap::new();
        sample.insert("logs".to_string(), HashMap::new());
        d.update(5, 2, sample, HashMap::new(), HashMap::new());
        assert_eq!(d.cardinality, 5);
        assert_eq!(d.service_count, 2);
        assert_eq!(d.cardinality_class, CardinalityClass::VeryLow);
    }

    #[test]
    fn test_dimension_analytics_is_suitable_for_correlation() {
        let mut d = DimensionAnalytics::new("region".to_string());
        d.update(3, 1, HashMap::new(), HashMap::new(), HashMap::new());
        assert!(d.is_suitable_for_correlation());

        // high cardinality — not suitable
        d.update(5000, 1, HashMap::new(), HashMap::new(), HashMap::new());
        assert!(!d.is_suitable_for_correlation());
    }

    #[test]
    fn test_cardinality_class_boundary_values() {
        // Exact boundary cases for from_cardinality
        assert_eq!(
            CardinalityClass::from_cardinality(0),
            CardinalityClass::VeryLow
        );
        assert_eq!(
            CardinalityClass::from_cardinality(10),
            CardinalityClass::VeryLow
        );
        assert_eq!(
            CardinalityClass::from_cardinality(11),
            CardinalityClass::Low
        );
        assert_eq!(
            CardinalityClass::from_cardinality(100),
            CardinalityClass::Low
        );
        assert_eq!(
            CardinalityClass::from_cardinality(101),
            CardinalityClass::Medium
        );
        assert_eq!(
            CardinalityClass::from_cardinality(1000),
            CardinalityClass::Medium
        );
        assert_eq!(
            CardinalityClass::from_cardinality(1001),
            CardinalityClass::High
        );
        assert_eq!(
            CardinalityClass::from_cardinality(10000),
            CardinalityClass::High
        );
        assert_eq!(
            CardinalityClass::from_cardinality(10001),
            CardinalityClass::VeryHigh
        );
        assert_eq!(
            CardinalityClass::from_cardinality(usize::MAX),
            CardinalityClass::VeryHigh
        );
    }

    #[test]
    fn test_cardinality_class_ordering() {
        // Derived PartialOrd should respect declaration order
        assert!(CardinalityClass::VeryLow < CardinalityClass::Low);
        assert!(CardinalityClass::Low < CardinalityClass::Medium);
        assert!(CardinalityClass::Medium < CardinalityClass::High);
        assert!(CardinalityClass::High < CardinalityClass::VeryHigh);
    }

    #[test]
    fn test_dimension_analytics_update_truncates_sample_values() {
        let mut d = DimensionAnalytics::new("pod".to_string());
        // 15 sample values in one stream → should be truncated to 10
        let many_values: Vec<String> = (0..15).map(|i| format!("v{i}")).collect();
        let mut inner = HashMap::new();
        inner.insert("stream1".to_string(), many_values);
        let mut sample = HashMap::new();
        sample.insert("logs".to_string(), inner);

        d.update(15, 1, sample, HashMap::new(), HashMap::new());

        // After update, samples should be truncated to first 10
        let stream_samples = &d.sample_values["logs"]["stream1"];
        assert_eq!(stream_samples.len(), 10);
        assert_eq!(stream_samples[0], "v0");
        assert_eq!(stream_samples[9], "v9");
    }

    #[test]
    fn test_stream_info_filters_empty_absent() {
        let s = StreamInfo::with_type("s".to_string(), StreamType::Logs);
        let json = serde_json::to_value(&s).unwrap();
        assert!(!json.as_object().unwrap().contains_key("filters"));
    }

    #[test]
    fn test_stream_info_filters_present_when_nonempty() {
        let mut filters = HashMap::new();
        filters.insert("env".to_string(), "prod".to_string());
        let s = StreamInfo::with_type_and_filters("s".to_string(), StreamType::Logs, filters);
        let json = serde_json::to_value(&s).unwrap();
        assert!(json.as_object().unwrap().contains_key("filters"));
    }

    #[test]
    fn test_correlation_response_all_streams_absent_when_empty() {
        let r = CorrelationResponse {
            service_name: "svc".to_string(),
            matched_dimensions: HashMap::new(),
            additional_dimensions: HashMap::new(),
            related_streams: RelatedStreams {
                logs: vec![],
                traces: vec![],
                metrics: vec![],
            },
            all_streams: vec![],
            matched_set_id: None,
        };
        let json = serde_json::to_value(&r).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("all_streams"));
        assert!(!obj.contains_key("matched_set_id"));
    }

    #[test]
    fn test_correlation_response_all_streams_present_when_nonempty() {
        let r = CorrelationResponse {
            service_name: "svc".to_string(),
            matched_dimensions: HashMap::new(),
            additional_dimensions: HashMap::new(),
            related_streams: RelatedStreams {
                logs: vec![],
                traces: vec![],
                metrics: vec![],
            },
            all_streams: vec![StreamInfo::with_type("x".to_string(), StreamType::Logs)],
            matched_set_id: Some("set1".to_string()),
        };
        let json = serde_json::to_value(&r).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("all_streams"));
        assert!(obj.contains_key("matched_set_id"));
    }

    #[test]
    fn test_dimension_analytics_empty_maps_absent() {
        let d = DimensionAnalytics::new("env".to_string());
        let json = serde_json::to_value(&d).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("sample_values"));
        assert!(!obj.contains_key("value_children"));
        assert!(!obj.contains_key("value_counts"));
    }

    #[test]
    fn test_service_streams_empty_vecs_absent() {
        let s = ServiceStreams::default();
        let json = serde_json::to_value(&s).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("logs"));
        assert!(!obj.contains_key("traces"));
        assert!(!obj.contains_key("metrics"));
    }

    #[test]
    fn test_service_streams_vecs_present_when_nonempty() {
        let s = ServiceStreams {
            logs: vec!["l".to_string()],
            traces: vec!["t".to_string()],
            metrics: vec!["m".to_string()],
        };
        let json = serde_json::to_value(&s).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("logs"));
        assert!(obj.contains_key("traces"));
        assert!(obj.contains_key("metrics"));
    }
}
