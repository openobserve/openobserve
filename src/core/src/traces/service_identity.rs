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

//! One request's service identity: resolved per resource and service, stamped, observed.

use std::{collections::HashMap, sync::Arc};

#[cfg(feature = "enterprise")]
use config::{
    TIMESTAMP_COL_NAME,
    meta::service_identity::{EnvSource, SIGNAL_TRACES, ServiceVersionObservation},
    utils::flatten::format_label_name_cow,
};
use config::{
    meta::service_identity::{
        O2_SERVICE_ENV, O2_SERVICE_IMAGE, O2_SERVICE_VERSION, O2_SERVICE_WHERE, OrgIdentity,
    },
    utils::json,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::service_identity::{
    fields::IdentityFields,
    resolver::{self, ResolvedIdentity, SPAN_KEYS_K8S_CLUSTER},
};
use opentelemetry_proto::tonic::common::v1::KeyValue;
use serde_json::Map;

/// The stamped columns; a client may not send them and a UDS list may not drop them.
pub const SERVICE_IDENTITY_FIELDS: [&str; 4] = [
    O2_SERVICE_WHERE,
    O2_SERVICE_ENV,
    O2_SERVICE_VERSION,
    O2_SERVICE_IMAGE,
];
pub const SERVICE_IDENTITY_FIELD_PREFIX: &str = "o2_service_";
// The registry `service_name` column is string_len(256).
#[cfg(feature = "enterprise")]
const MAX_SERVICE_NAME_BYTES: usize = 256;
// The registry `version` column is string_len(128).
#[cfg(feature = "enterprise")]
const MAX_VERSION_BYTES: usize = 128;
// The registry `env` column is string_len(256).
#[cfg(feature = "enterprise")]
const MAX_ENV_BYTES: usize = 256;

#[cfg(feature = "enterprise")]
static DEFAULT_FIELDS: std::sync::LazyLock<Arc<IdentityFields>> =
    std::sync::LazyLock::new(|| Arc::new(IdentityFields::from_defaults()));

/// The columns one (resource, service name) writes on every span.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceStamp {
    pub where_key: String,
    pub env: String,
    pub version: Option<String>,
    /// Written only when the image digest is known, so unknown images add no column.
    pub image: Option<String>,
}

impl ServiceStamp {
    pub fn apply(&self, record: &mut Map<String, json::Value>) {
        record.insert(
            O2_SERVICE_WHERE.to_string(),
            json::Value::String(self.where_key.clone()),
        );
        record.insert(
            O2_SERVICE_ENV.to_string(),
            json::Value::String(self.env.clone()),
        );
        if let Some(version) = &self.version {
            record.insert(
                O2_SERVICE_VERSION.to_string(),
                json::Value::String(version.clone()),
            );
        }
        if let Some(image) = &self.image {
            record.insert(
                O2_SERVICE_IMAGE.to_string(),
                json::Value::String(image.clone()),
            );
        }
    }

    #[cfg(feature = "enterprise")]
    fn of(identity: &ResolvedIdentity) -> Self {
        Self {
            where_key: identity.where_identity.where_key.clone(),
            env: identity.env.env.clone(),
            version: (!identity.version.version.is_empty())
                .then(|| identity.version.version.clone()),
            image: identity.version.image.clone(),
        }
    }
}

/// One request's identities and registry observations; the OSS build stamps nothing.
#[derive(Default)]
pub struct ServiceIdentityCollector {
    #[cfg(feature = "enterprise")]
    overrides: Arc<OrgIdentity>,
    #[cfg(feature = "enterprise")]
    fields: Arc<IdentityFields>,
    #[cfg(feature = "enterprise")]
    first_span: Vec<(&'static str, String)>,
    #[cfg(feature = "enterprise")]
    resource: HashMap<String, Arc<ServiceStamp>>,
    #[cfg(feature = "enterprise")]
    resolved: HashMap<String, HashMap<String, ResolvedIdentity>>,
    #[cfg(feature = "enterprise")]
    observations: HashMap<String, ServiceVersionObservation>,
    #[cfg(feature = "enterprise")]
    oversized: std::collections::HashSet<String>,
    #[cfg(feature = "enterprise")]
    scratch: String,
    #[cfg(feature = "enterprise")]
    inert: bool,
}

impl ServiceIdentityCollector {
    /// Reads the org's overrides and identity field groups from memory once per request.
    pub async fn for_org(org_id: &str) -> Self {
        #[cfg(feature = "enterprise")]
        {
            if !config::get_config().service_versions.enabled {
                return Self::inert();
            }
            Self {
                overrides: crate::db::service_identity::get_cached_overrides(org_id).await,
                fields: crate::db::service_identity::get_cached_fields(org_id).await,
                ..Default::default()
            }
        }
        #[cfg(not(feature = "enterprise"))]
        {
            let _ = org_id;
            Self::default()
        }
    }

    pub fn new(overrides: Arc<OrgIdentity>) -> Self {
        #[cfg(feature = "enterprise")]
        {
            Self {
                overrides,
                fields: DEFAULT_FIELDS.clone(),
                ..Default::default()
            }
        }
        #[cfg(not(feature = "enterprise"))]
        {
            let _ = overrides;
            Self::default()
        }
    }

    /// Stamps and observes nothing, so a disabled feature adds no columns and no registry rows.
    #[cfg(feature = "enterprise")]
    pub fn inert() -> Self {
        Self {
            inert: true,
            ..Default::default()
        }
    }

    /// Forgets the previous resource's stamps; `first_span_attrs` feed only the cluster fallback.
    pub fn enter_resource(&mut self, first_span_attrs: &[KeyValue]) {
        #[cfg(feature = "enterprise")]
        {
            self.resource.clear();
            self.first_span = SPAN_KEYS_K8S_CLUSTER
                .iter()
                .filter_map(|key| {
                    let attr = first_span_attrs.iter().find(|kv| kv.key == *key)?;
                    let value = crate::ingestion::grpc::get_val(&attr.value.as_ref());
                    Some((*key, attr_text(&value)?))
                })
                .collect();
        }
        #[cfg(not(feature = "enterprise"))]
        let _ = first_span_attrs;
    }

    /// The stamp of `service_name` in the current resource, resolved on its first span only.
    pub fn stamp_for_span(
        &mut self,
        service_name: &str,
        resource_attrs: &HashMap<String, json::Value>,
    ) -> Option<Arc<ServiceStamp>> {
        #[cfg(feature = "enterprise")]
        {
            if self.inert {
                return None;
            }
            if let Some(stamp) = self.resource.get(service_name) {
                return Some(stamp.clone());
            }
            let first_span = &self.first_span;
            let identity = resolver::resolve_resource(
                |key| resource_attrs.get(key).and_then(attr_text),
                |key| {
                    first_span
                        .iter()
                        .find(|(k, _)| *k == key)
                        .map(|(_, v)| v.clone())
                },
                service_name,
                &self.overrides,
                &self.fields,
            );
            let stamp = Arc::new(ServiceStamp::of(&identity));
            self.remember(service_name, identity);
            self.resource
                .insert(service_name.to_string(), stamp.clone());
            Some(stamp)
        }
        #[cfg(not(feature = "enterprise"))]
        {
            let _ = (service_name, resource_attrs);
            None
        }
    }

    /// Resolves a flattened JSON record unless it already carries `o2_service_where`.
    pub fn stamp_json_record(&mut self, record: &mut Map<String, json::Value>) {
        #[cfg(feature = "enterprise")]
        {
            if self.inert || record.contains_key(O2_SERVICE_WHERE) {
                return;
            }
            let Some(service_name) = str_field(record, "service_name").map(str::to_string) else {
                return;
            };
            let flat = |key: &str| {
                record
                    .get(format_label_name_cow(key).as_ref())
                    .and_then(attr_text)
            };
            let identity = resolver::resolve_record(
                flat,
                record.keys().map(String::as_str),
                &service_name,
                &self.overrides,
                &self.fields,
            );
            let supplied: Vec<_> = [O2_SERVICE_ENV, O2_SERVICE_VERSION, O2_SERVICE_IMAGE]
                .into_iter()
                .filter_map(|key| record.get(key).cloned().map(|value| (key, value)))
                .collect();
            ServiceStamp::of(&identity).apply(record);
            for (key, value) in supplied {
                record.insert(key.to_string(), value);
            }
            self.remember(&service_name, identity);
        }
        #[cfg(not(feature = "enterprise"))]
        let _ = record;
    }

    /// Post-pipeline values win; a record not resolved in this request is stored as-is.
    pub fn observe(&mut self, stream: &str, record: &Map<String, json::Value>) {
        #[cfg(feature = "enterprise")]
        {
            let Self {
                resolved,
                observations,
                oversized,
                scratch,
                ..
            } = self;
            let (Some(service), Some(where_key), Some(timestamp)) = (
                str_field(record, "service_name"),
                str_field(record, O2_SERVICE_WHERE),
                record.get(TIMESTAMP_COL_NAME).and_then(json::Value::as_i64),
            ) else {
                return;
            };
            let Some(identity) = resolved.get(service).and_then(|w| w.get(where_key)) else {
                return;
            };
            let version = str_field(record, O2_SERVICE_VERSION).unwrap_or_default();
            let image = str_field(record, O2_SERVICE_IMAGE);
            let env = str_field(record, O2_SERVICE_ENV).unwrap_or_default();
            scratch.clear();
            let label = if env.is_empty() || env == identity.env.env {
                identity.env.inferred_label()
            } else {
                env
            };
            for part in [
                stream,
                service,
                where_key,
                version,
                image.unwrap_or_default(),
                label,
            ] {
                scratch.push_str(part);
                scratch.push('\u{1f}');
            }
            // A value its column cannot hold would fail the whole org's flush.
            if service.len() > MAX_SERVICE_NAME_BYTES
                || version.len() > MAX_VERSION_BYTES
                || env.len() > MAX_ENV_BYTES
            {
                if !oversized.contains(scratch.as_str()) {
                    oversized.insert(scratch.clone());
                }
                return;
            }
            if let Some(existing) = observations.get_mut(scratch.as_str()) {
                existing.first_seen = existing.first_seen.min(timestamp);
                existing.last_seen = existing.last_seen.max(timestamp);
                return;
            }
            observations.insert(
                scratch.clone(),
                new_observation(identity, stream, service, (version, image), env, timestamp),
            );
        }
        #[cfg(not(feature = "enterprise"))]
        let _ = (stream, record);
    }

    /// Hands the request's observations to the registry queue; call only after the write succeeded.
    #[cfg(feature = "enterprise")]
    pub fn queue(self, org_id: &str) {
        crate::db::service_versions::count_oversized(org_id, self.oversized.len());
        let observations = self.into_observations(org_id);
        if !observations.is_empty() {
            crate::db::service_versions::queue_observations(org_id, observations);
        }
    }

    /// Keyed by (source stream, version key, env): one entry per env, so none is lost.
    #[cfg(feature = "enterprise")]
    pub fn into_observations(
        self,
        org_id: &str,
    ) -> std::collections::BTreeMap<String, ServiceVersionObservation> {
        self.observations
            .into_values()
            .filter(|o| {
                infra::schema::is_service_source_stream(
                    config::meta::stream::StreamType::Traces,
                    &o.source_stream,
                )
            })
            .map(|o| {
                (
                    format!(
                        "{}\u{1f}{}\u{1f}{}",
                        o.source_stream,
                        o.version_key(org_id),
                        o.env
                    ),
                    o,
                )
            })
            .collect()
    }

    #[cfg(feature = "enterprise")]
    fn remember(&mut self, service_name: &str, identity: ResolvedIdentity) {
        self.resolved
            .entry(service_name.to_string())
            .or_default()
            .insert(identity.where_identity.where_key.clone(), identity);
    }
}

/// An attribute as resolver text: arrays and maps as JSON text, null as absent.
#[cfg(feature = "enterprise")]
fn attr_text(value: &json::Value) -> Option<String> {
    match value {
        json::Value::Null => None,
        json::Value::String(v) => Some(v.clone()),
        other => Some(other.to_string()),
    }
}

#[cfg(feature = "enterprise")]
fn str_field<'a>(record: &'a Map<String, json::Value>, key: &str) -> Option<&'a str> {
    record.get(key).and_then(json::Value::as_str)
}

#[cfg(feature = "enterprise")]
fn new_observation(
    identity: &ResolvedIdentity,
    stream: &str,
    service_name: &str,
    (version, image): (&str, Option<&str>),
    env: &str,
    timestamp: i64,
) -> ServiceVersionObservation {
    let image = config::meta::service_identity::keyed_image(version, image);
    let image_ref = identity
        .version
        .image_ref
        .clone()
        .filter(|_| image.is_some() && image == identity.version.image.as_deref());
    let (raw_version, version_source) = if version == identity.version.version {
        (
            identity.version.raw_version.clone(),
            identity.version.version_source.clone(),
        )
    } else {
        (
            (!version.is_empty()).then(|| version.to_string()),
            O2_SERVICE_VERSION.to_string(),
        )
    };
    let mut observation = ServiceVersionObservation {
        service_name: service_name.to_string(),
        where_key: identity.where_identity.where_key.clone(),
        where_kind: identity.where_identity.where_kind,
        k8s_cluster: identity.where_identity.k8s_cluster.clone(),
        k8s_namespace: identity.where_identity.k8s_namespace.clone(),
        env: String::new(),
        env_source: identity.env.env_source,
        env_source_value: String::new(),
        version: version.to_string(),
        raw_version,
        version_source,
        image: image.map(str::to_string),
        image_ref,
        source_stream: stream.to_string(),
        signal: SIGNAL_TRACES.to_string(),
        first_seen: timestamp,
        last_seen: timestamp,
    };
    set_env(&mut observation, identity, env);
    observation
}

/// The registry keeps the inferred label; only a pipeline-set env replaces it.
#[cfg(feature = "enterprise")]
fn set_env(observation: &mut ServiceVersionObservation, identity: &ResolvedIdentity, env: &str) {
    if env.is_empty() || env == identity.env.env {
        observation.env = identity.env.inferred_label().to_string();
        observation.env_source = identity.env.env_source;
        observation.env_source_value = identity.env.env_source_value.clone();
    } else {
        observation.env = env.to_string();
        observation.env_source = EnvSource::Attribute;
        observation.env_source_value = O2_SERVICE_ENV.to_string();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_writes_version_only_when_present() {
        let mut record = Map::new();
        ServiceStamp {
            where_key: "k8s:prod-eu/shop".to_string(),
            env: "production".to_string(),
            version: None,
            image: None,
        }
        .apply(&mut record);
        assert_eq!(record[O2_SERVICE_WHERE], "k8s:prod-eu/shop");
        assert_eq!(record[O2_SERVICE_ENV], "production");
        assert!(!record.contains_key(O2_SERVICE_VERSION));
        assert!(!record.contains_key(O2_SERVICE_IMAGE));
    }

    #[cfg(not(feature = "enterprise"))]
    #[test]
    fn oss_collector_is_inert() {
        let mut collector = ServiceIdentityCollector::new(Arc::default());
        collector.enter_resource(&[]);
        let resource: HashMap<String, json::Value> =
            [("service_service.version".to_string(), json::json!("1.2.3"))]
                .into_iter()
                .collect();
        assert!(collector.stamp_for_span("checkout", &resource).is_none());
        let mut record =
            json::json!({"service_name": "checkout", "service_service_version": "1.2.3"})
                .as_object()
                .cloned()
                .unwrap();
        let before = record.clone();
        collector.stamp_json_record(&mut record);
        assert_eq!(record, before);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn unstamped_json_preserves_each_pipeline_field() {
        for (key, value) in [
            (O2_SERVICE_ENV, "pipeline-env"),
            (O2_SERVICE_VERSION, "1.5.0"),
        ] {
            let mut collector = ServiceIdentityCollector::new(Arc::default());
            let mut record = json::json!({"service_name": "checkout", "_timestamp": 10,
                "service_service_version": "1.4.2", "service_deployment_environment": "prod"})
            .as_object()
            .cloned()
            .unwrap();
            record.insert(key.to_string(), json::json!(value));
            collector.stamp_json_record(&mut record);
            assert_eq!(record[key], value);
            collector.observe("default", &record);
            let observation = collector.observations.values().next().unwrap();
            if key == O2_SERVICE_VERSION {
                assert_eq!(observation.version, value);
                assert_eq!(observation.raw_version.as_deref(), Some(value));
                assert_eq!(observation.version_source, O2_SERVICE_VERSION);
            } else {
                assert_eq!(observation.env, value);
                assert_eq!(observation.env_source, EnvSource::Attribute);
                assert_eq!(observation.env_source_value, O2_SERVICE_ENV);
            }
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn traces_o2_writes_itself_are_not_observed() {
        let mut collector = ServiceIdentityCollector::new(Arc::default());
        for stream in ["default", "_evaluator"] {
            let mut record = json::json!({"service_name": "checkout", "_timestamp": 10,
                "service_service_version": "1.4.2"})
            .as_object()
            .cloned()
            .unwrap();
            collector.stamp_json_record(&mut record);
            collector.observe(stream, &record);
        }
        let observed: Vec<_> = collector
            .into_observations("org")
            .into_values()
            .map(|o| o.source_stream)
            .collect();
        assert_eq!(observed, vec!["default".to_string()]);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn oversized_values_are_not_observed() {
        let cases = [
            ("service_name", MAX_SERVICE_NAME_BYTES),
            (O2_SERVICE_VERSION, MAX_VERSION_BYTES),
            (O2_SERVICE_ENV, MAX_ENV_BYTES),
        ];
        for (key, max) in cases {
            for (len, observed) in [(max, 1), (max + 1, 0)] {
                let mut collector = ServiceIdentityCollector::new(Arc::default());
                let value = json::json!("x".repeat(len));
                let mut record = json::json!({"service_name": "checkout", "_timestamp": 10})
                    .as_object()
                    .cloned()
                    .unwrap();
                if key == "service_name" {
                    record.insert(key.to_string(), value.clone());
                }
                collector.stamp_json_record(&mut record);
                record.insert(key.to_string(), value);
                collector.observe("default", &record);
                collector.observe("default", &record);
                assert_eq!(collector.oversized.len(), 1 - observed, "{key} {len}");
                assert_eq!(collector.observations.len(), observed, "{key} {len}");
                let org = format!("oversized_metric_{key}_{len}");
                let counter = config::metrics::SERVICE_VERSIONS_DROPPED_TOTAL
                    .with_label_values(&[&org, "oversized"]);
                let before = counter.get();
                collector.queue(&org);
                assert_eq!(counter.get() - before, (1 - observed) as u64, "{key} {len}");
            }
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_second_env_in_one_request_is_observed_beside_the_first() {
        let mut collector = ServiceIdentityCollector::new(Arc::default());
        for (ts, env) in [(10, "prod"), (20, "staging"), (30, "prod")] {
            let mut record = json::json!({"service_name": "checkout", "_timestamp": ts,
                "service_service_version": "1.4.2"})
            .as_object()
            .cloned()
            .unwrap();
            collector.stamp_json_record(&mut record);
            record.insert(O2_SERVICE_ENV.to_string(), json::json!(env));
            collector.observe("default", &record);
        }
        let observed: Vec<_> = collector
            .into_observations("org")
            .into_values()
            .map(|o| (o.env, o.first_seen, o.last_seen))
            .collect();
        assert_eq!(
            observed,
            vec![
                ("prod".to_string(), 10, 30),
                ("staging".to_string(), 20, 20)
            ]
        );
    }
}
