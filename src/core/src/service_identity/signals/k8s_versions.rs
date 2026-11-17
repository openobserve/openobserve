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

//! Versions for spans that carry none yet, named by the image K8s reports for their pod.

use std::collections::{BTreeMap, BTreeSet};

use config::meta::service_identity::{
    EnvSource, O2_SERVICE_ENV, SIGNAL_TRACES, ServiceVersionObservation, ServiceVersionRecord,
    VERSION_SOURCE_K8S_POD_IMAGE, WhereKind, version_key,
};
use infra::table::service_versions;
use o2_enterprise::enterprise::service_identity::{
    infer::{IdentityInputs, WHERE_K8S_PREFIX, infer_env},
    signals::mappers::{K1Observation, PodRow},
};

/// Registry observations for unversioned pods whose container image K8s names, keyed like ingest.
pub fn image_observations(
    org: &str,
    pods: &[PodRow],
    presence: &[K1Observation],
) -> BTreeMap<String, ServiceVersionObservation> {
    let reported: BTreeSet<_> = pods
        .iter()
        .filter(|pod| !pod.version.is_empty())
        .map(|pod| (&pod.service, &pod.where_key, &pod.version))
        .collect();
    let mut out: BTreeMap<String, ServiceVersionObservation> = BTreeMap::new();
    for pod in pods
        .iter()
        .filter(|pod| pod.version.is_empty() && pod.where_key.starts_with(WHERE_K8S_PREFIX))
    {
        let Some(image) = presence.iter().find(|image| {
            !image.version.is_empty()
                && image.pod == pod.k8s_pod
                && image.namespace == pod.k8s_namespace
                && image.container == pod.k8s_container
                && image.k8s_cluster == pod.k8s_cluster
        }) else {
            continue;
        };
        if reported.contains(&(&pod.service, &pod.where_key, &image.version)) {
            continue;
        }
        let observation = observation(pod, image);
        let key = serde_json::json!([observation.source_stream, observation.version_key(org)])
            .to_string();
        out.entry(key)
            .and_modify(|seen| {
                seen.first_seen = seen.first_seen.min(observation.first_seen);
                seen.last_seen = seen.last_seen.max(observation.last_seen);
            })
            .or_insert(observation);
    }
    out
}

/// Drops fills for a version text spans registered in the scope, in an earlier window as well.
pub async fn without_span_texts(
    org: &str,
    observations: BTreeMap<String, ServiceVersionObservation>,
) -> Result<BTreeMap<String, ServiceVersionObservation>, infra::errors::Error> {
    if observations.is_empty() {
        return Ok(observations);
    }
    let conn = infra::db::get_orm_client_rw().await;
    let plain: BTreeSet<_> = observations
        .values()
        .map(|row| version_key(org, &row.service_name, &row.where_key, &row.version))
        .collect();
    let scopes: BTreeSet<_> = observations
        .values()
        .map(|row| row.scope_key(org))
        .collect();
    let mut registered =
        service_versions::get_by_keys(conn, org, &plain.into_iter().collect::<Vec<_>>()).await?;
    registered.extend(
        service_versions::imaged_by_scopes(conn, org, &scopes.into_iter().collect::<Vec<_>>())
            .await?,
    );
    Ok(drop_span_texts(org, observations, &registered))
}

fn observation(pod: &PodRow, image: &K1Observation) -> ServiceVersionObservation {
    let inferred = infer_env(&IdentityInputs::traces(
        &pod.service,
        Some(&pod.k8s_cluster),
        Some(&pod.k8s_namespace),
        None,
        None,
    ));
    // The stamped label wins over the where's own inference, as a pipeline-set env does.
    let (env, env_source, env_source_value) = if pod.env.is_empty() || pod.env == inferred.env {
        (inferred.env, inferred.env_source, inferred.env_source_value)
    } else {
        (
            pod.env.clone(),
            EnvSource::Attribute,
            O2_SERVICE_ENV.to_string(),
        )
    };
    ServiceVersionObservation {
        service_name: pod.service.clone(),
        where_key: pod.where_key.clone(),
        where_kind: WhereKind::K8s,
        k8s_cluster: pod.k8s_cluster.clone(),
        k8s_namespace: pod.k8s_namespace.clone(),
        env,
        env_source,
        env_source_value,
        version: image.version.clone(),
        raw_version: image.image_ref.clone(),
        version_source: VERSION_SOURCE_K8S_POD_IMAGE.to_string(),
        image: image.image.clone(),
        image_ref: image.image_ref.clone(),
        source_stream: pod.source_stream.clone(),
        signal: SIGNAL_TRACES.to_string(),
        first_seen: pod.min_ts,
        last_seen: pod.max_ts,
    }
}

fn drop_span_texts(
    org: &str,
    mut observations: BTreeMap<String, ServiceVersionObservation>,
    registered: &[ServiceVersionRecord],
) -> BTreeMap<String, ServiceVersionObservation> {
    let spans: BTreeSet<_> = registered
        .iter()
        .filter(|row| row.version_source != VERSION_SOURCE_K8S_POD_IMAGE)
        .map(|row| (row.scope_key.clone(), row.version.clone()))
        .collect();
    observations.retain(|_, row| !spans.contains(&(row.scope_key(org), row.version.clone())));
    observations
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::service_identity::signals::mappers::{
        WindowCtx, map_k1, map_t3,
    };
    use serde_json::json;

    use super::*;

    fn ctx(stream: &str) -> WindowCtx {
        WindowCtx {
            org_id: "org".into(),
            source_stream: stream.into(),
            window_start: 1_000,
            window_secs: 300,
            written_at: 2_000,
            cluster: "region".into(),
        }
    }

    #[test]
    fn an_unversioned_pod_takes_the_image_k8s_reports_and_disables_compare() {
        let pods = map_t3(
            &ctx("default"),
            &[
                json!({"service":"checkout","where_key":"k8s:prod-eu/shop","version":null,"env":"prod","k8s_namespace":"shop","k8s_pod":"checkout-7d9f-abc","k8s_workload":"checkout","k8s_workload_kind":"deployment","k8s_container":"app","spans":40,"min_ts":1_100,"max_ts":1_200}),
                json!({"service":"checkout","where_key":"k8s:prod-eu/shop","version":null,"env":"prod","k8s_namespace":"shop","k8s_pod":"checkout-7d9f-def","k8s_workload":"checkout","k8s_workload_kind":"deployment","k8s_container":"app","spans":10,"min_ts":1_050,"max_ts":1_150}),
                json!({"service":"cart","where_key":"k8s:prod-eu/shop","version":"3.1.0","env":"prod","k8s_namespace":"shop","k8s_pod":"cart-1","k8s_workload":"cart","k8s_workload_kind":"deployment","k8s_container":"app","spans":5,"min_ts":1_000,"max_ts":1_100}),
                json!({"service":"search","where_key":"k8s:prod-eu/shop","version":null,"env":"prod","k8s_namespace":"shop","k8s_pod":"search-1","k8s_workload":"search","k8s_workload_kind":"deployment","k8s_container":"app","spans":5,"min_ts":1_000,"max_ts":1_100}),
            ],
        );
        let digest = "docker-pullable://ghcr.io/acme/checkout@sha256:9c1e4b7f0011223344556677889900aabbccddeeff00112233445566778899aa";
        let presence = map_k1(
            &ctx("kube_pod_container_info"),
            &[
                json!({"namespace":"shop","pod":"checkout-7d9f-abc","container":"app","image":"ghcr.io/acme/checkout:2.4.0","image_id":digest,"k8s_cluster":"prod-eu"}),
                json!({"namespace":"shop","pod":"checkout-7d9f-def","container":"app","image":"ghcr.io/acme/checkout:2.4.0","image_id":digest,"k8s_cluster":"prod-eu"}),
                json!({"namespace":"shop","pod":"cart-1","container":"app","image":"ghcr.io/acme/cart:3.1.0","image_id":"","k8s_cluster":"prod-eu"}),
                json!({"namespace":"shop","pod":"search-1","container":"sidecar","image":"envoy:1.30","image_id":"","k8s_cluster":"prod-eu"}),
            ],
        );
        let filled: Vec<_> = image_observations("org", &pods, &presence)
            .into_values()
            .collect();
        assert_eq!(filled.len(), 1, "{filled:?}");
        let row = &filled[0];
        assert_eq!(
            (row.service_name.as_str(), row.version.as_str()),
            ("checkout", "2.4.0")
        );
        assert_eq!(row.version_source, VERSION_SOURCE_K8S_POD_IMAGE);
        assert_eq!(row.image.as_deref(), Some("9c1e4b7"));
        assert_eq!(
            row.image_ref.as_deref(),
            Some("ghcr.io/acme/checkout:2.4.0")
        );
        assert_eq!((row.first_seen, row.last_seen), (1_050, 1_200));
        assert_eq!(
            (row.env.as_str(), row.env_source),
            ("prod", EnvSource::Cluster)
        );
        let record = row.to_record("org", 2_000);
        assert_eq!(
            crate::service_identity::api::compare_disabled(&record),
            (true, Some("no_span_version"))
        );
    }

    #[test]
    fn k8s_never_adds_a_row_for_a_version_text_spans_report() {
        let pod = |service: &str, pod: &str, version: Option<&str>| json!({"service":service,"where_key":"k8s:prod-eu/shop","version":version,"env":"prod","k8s_namespace":"shop","k8s_pod":pod,"k8s_workload":service,"k8s_workload_kind":"deployment","k8s_container":"app","spans":20,"min_ts":1_100,"max_ts":1_200});
        let pods = map_t3(
            &ctx("default"),
            &[
                pod("checkout", "checkout-7d9f-abc", Some("2.4.0")),
                pod("checkout", "checkout-7d9f-def", None),
                pod("billing", "billing-1", None),
            ],
        );
        let image = |pod: &str, image: &str, digest: &str| json!({"namespace":"shop","pod":pod,"container":"app","image":image,"image_id":format!("docker-pullable://{image}@sha256:{digest}"),"k8s_cluster":"prod-eu"});
        let presence = map_k1(
            &ctx("kube_pod_container_info"),
            &[
                image(
                    "checkout-7d9f-abc",
                    "ghcr.io/acme/checkout:2.4.0",
                    "9c1e4b7f0011223344556677889900aabbccddeeff00112233445566778899aa",
                ),
                image(
                    "checkout-7d9f-def",
                    "ghcr.io/acme/checkout:2.4.0",
                    "3f9c2ab14e0d7c55a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677",
                ),
                image(
                    "billing-1",
                    "ghcr.io/acme/billing:1.2.0",
                    "0a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677aabbccddeeff0011",
                ),
            ],
        );
        let filled: Vec<_> = image_observations("org", &pods, &presence)
            .into_values()
            .collect();
        assert_eq!(
            filled
                .iter()
                .map(|row| (row.service_name.as_str(), row.version.as_str()))
                .collect::<Vec<_>>(),
            [("billing", "1.2.0")],
            "the span text keeps its one row; K8s fills only a text no span reports"
        );
        let span_row = config::meta::service_identity::ServiceVersionObservation {
            version_source: "service.version".into(),
            image: None,
            image_ref: None,
            version: "2.4.0".into(),
            service_name: "checkout".into(),
            ..filled[0].clone()
        }
        .to_record("org", 2_000);
        let records: Vec<_> = filled
            .iter()
            .map(|row| row.to_record("org", 2_000))
            .chain([span_row.clone()])
            .collect();
        assert_eq!(
            crate::service_identity::api::image_count(
                &crate::service_identity::api::version_images(records.iter()),
                &span_row
            ),
            0
        );
    }

    #[test]
    fn a_text_spans_registered_earlier_blocks_the_k8s_fill_of_that_text() {
        let fill = |service: &str, version: &str| {
            let row = ServiceVersionObservation {
                service_name: service.into(),
                where_key: "k8s:prod-eu/shop".into(),
                where_kind: WhereKind::K8s,
                k8s_cluster: "prod-eu".into(),
                k8s_namespace: "shop".into(),
                env: "prod".into(),
                env_source: EnvSource::Cluster,
                env_source_value: "prod-eu".into(),
                version: version.into(),
                raw_version: None,
                version_source: VERSION_SOURCE_K8S_POD_IMAGE.into(),
                image: Some("9c1e4b7".into()),
                image_ref: None,
                source_stream: "default".into(),
                signal: SIGNAL_TRACES.into(),
                first_seen: 1_000,
                last_seen: 1_100,
            };
            (row.version_key("org"), row)
        };
        let registered = |service: &str, version: &str, source: &str, image: Option<&str>| {
            ServiceVersionObservation {
                version_source: source.into(),
                image: image.map(str::to_string),
                ..fill(service, version).1
            }
            .to_record("org", 2_000)
        };
        let observations = BTreeMap::from([
            fill("checkout", "2.4.0"),
            fill("checkout", "2.5.0"),
            fill("billing", "1.2.0"),
            fill("search", "4.0.0"),
        ]);
        let kept = drop_span_texts(
            "org",
            observations,
            &[
                registered("checkout", "2.4.0", "service.version", None),
                registered("checkout", "2.5.0", "container.image.tag", Some("3f9c2ab")),
                registered(
                    "billing",
                    "1.2.0",
                    VERSION_SOURCE_K8S_POD_IMAGE,
                    Some("9c1e4b7"),
                ),
                registered("cart", "4.0.0", "service.version", None),
            ],
        );
        assert_eq!(
            kept.values()
                .map(|row| (row.service_name.as_str(), row.version.as_str()))
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([("billing", "1.2.0"), ("search", "4.0.0")]),
            "a span text of the same scope blocks the fill, whatever its image; a K8s row does not"
        );
    }
}
