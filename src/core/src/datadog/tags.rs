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

use std::collections::{BTreeMap, BTreeSet};

use opentelemetry_proto::tonic::{
    common::v1::{AnyValue, KeyValue, any_value::Value},
    resource::v1::Resource,
};

pub(super) const HOST_NAME: &str = "host.name";
pub(super) const SERVICE_NAME: &str = "service.name";
pub(super) const DEPLOYMENT_ENVIRONMENT_NAME: &str = "deployment.environment.name";

const RESOURCE_KEYS: [(&str, &str); 33] = [
    ("env", DEPLOYMENT_ENVIRONMENT_NAME),
    ("service", SERVICE_NAME),
    ("version", "service.version"),
    ("host", HOST_NAME),
    ("container_id", "container.id"),
    ("container_name", "container.name"),
    ("image_name", "container.image.name"),
    ("image_tag", "container.image.tags"),
    ("runtime", "container.runtime.name"),
    ("cloud_provider", "cloud.provider"),
    ("region", "cloud.region"),
    ("zone", "cloud.availability_zone"),
    ("task_family", "aws.ecs.task.family"),
    ("task_arn", "aws.ecs.task.arn"),
    ("ecs_cluster_name", "aws.ecs.cluster.arn"),
    ("task_version", "aws.ecs.task.revision"),
    ("ecs_container_name", "aws.ecs.container.arn"),
    ("kube_container_name", "k8s.container.name"),
    ("kube_cluster_name", "k8s.cluster.name"),
    ("kube_deployment", "k8s.deployment.name"),
    ("kube_replica_set", "k8s.replicaset.name"),
    ("kube_stateful_set", "k8s.statefulset.name"),
    ("kube_daemon_set", "k8s.daemonset.name"),
    ("kube_job", "k8s.job.name"),
    ("kube_cronjob", "k8s.cronjob.name"),
    ("kube_namespace", "k8s.namespace.name"),
    ("pod_name", "k8s.pod.name"),
    ("kube_app_name", "app.kubernetes.io/name"),
    ("kube_app_instance", "app.kubernetes.io/instance"),
    ("kube_app_version", "app.kubernetes.io/version"),
    ("kube_app_component", "app.kubernetes.io/component"),
    ("kube_app_part_of", "app.kubernetes.io/part-of"),
    ("kube_app_managed_by", "app.kubernetes.io/managed-by"),
];

/// Datadog `key:value` tags split into resource attributes (known keys, OTel names) and the rest.
#[derive(Debug, Default)]
pub(super) struct SplitTags {
    pub(super) resource: BTreeMap<String, String>,
    pub(super) attributes: BTreeMap<String, String>,
}

impl SplitTags {
    pub(super) fn from_tags<'a>(tags: impl IntoIterator<Item = &'a str>) -> Self {
        let mut grouped: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for tag in tags {
            if tag.is_empty() {
                continue;
            }
            let (key, value) = split_tag(tag);
            grouped.entry(key).or_default().insert(value);
        }
        let mut split = Self::default();
        for (key, values) in grouped {
            // Bracket-leading single values must remain distinct from encoded multi-value tags.
            let value = if values.len() > 1 || values.iter().any(|value| value.starts_with('[')) {
                serde_json::json!(values).to_string()
            } else {
                values.into_iter().collect()
            };
            match resource_key(key) {
                Some(otel_key) => split.resource.insert(otel_key.to_string(), value),
                None => split.attributes.insert(key.to_string(), value),
            };
        }
        split
    }
}

/// Splits on the first `:`; a tag without one is a key with an empty value.
pub(super) fn split_tag(tag: &str) -> (&str, &str) {
    tag.split_once(':').unwrap_or((tag, ""))
}

pub(super) fn resource_key(key: &str) -> Option<&'static str> {
    RESOURCE_KEYS
        .iter()
        .find(|(dd_key, _)| *dd_key == key)
        .map(|(_, otel_key)| *otel_key)
}

pub(super) fn key_value(key: impl Into<String>, value: Value) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue { value: Some(value) }),
        ..Default::default()
    }
}

pub(super) fn string_kv(key: impl Into<String>, value: impl Into<String>) -> KeyValue {
    key_value(key, Value::StringValue(value.into()))
}

pub(super) fn to_key_values(map: BTreeMap<String, String>) -> Vec<KeyValue> {
    map.into_iter().map(|(k, v)| string_kv(k, v)).collect()
}

pub(super) fn resource(attributes: BTreeMap<String, String>) -> Resource {
    Resource {
        attributes: to_key_values(attributes),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_tags_maps_known_keys_to_resource_and_keeps_the_rest() {
        let tags = SplitTags::from_tags([
            "env:prod",
            "service:checkout",
            "kube_namespace:shop",
            "team:payments",
            "url:http://a:8080",
            "standalone",
            "",
            "env:staging",
        ]);
        assert_eq!(
            tags.resource[DEPLOYMENT_ENVIRONMENT_NAME],
            r#"["prod","staging"]"#
        );
        assert_eq!(tags.resource[SERVICE_NAME], "checkout");
        assert_eq!(tags.resource["k8s.namespace.name"], "shop");
        assert_eq!(tags.attributes["team"], "payments");
        assert_eq!(tags.attributes["url"], "http://a:8080");
        assert_eq!(tags.attributes["standalone"], "");
        assert_eq!(tags.resource.len() + tags.attributes.len(), 6);
    }

    #[test]
    fn test_repeated_tag_values_are_canonical_and_keep_literal_arrays_distinct() {
        for input in [
            vec!["team:payments", "team:platform", "team:payments"],
            vec!["team:platform", "team:payments"],
        ] {
            let tags = SplitTags::from_tags(input);
            assert_eq!(tags.attributes["team"], r#"["payments","platform"]"#);
        }
        let literal = SplitTags::from_tags([r#"team:["payments","platform"]"#]);
        assert_eq!(
            literal.attributes["team"],
            r#"["[\"payments\",\"platform\"]"]"#
        );
        let duplicate = SplitTags::from_tags(["team:payments", "team:payments"]);
        assert_eq!(duplicate.attributes["team"], "payments");
    }
}
