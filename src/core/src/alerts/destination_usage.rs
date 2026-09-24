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

use std::collections::HashMap;

use config::meta::alerts::alert::ListAlertsParams;
use db::alerts::destinations::DestinationError;
use infra::db::get_orm_client_ro;
use strum::{EnumIter, IntoEnumIterator};

/// Names shown per consumer kind in the refusal message before it switches to "and N more".
const MAX_NAMES_SHOWN: usize = 5;

/// A system whose rows name an alert destination by string rather than by a foreign key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter)]
pub enum DestinationConsumer {
    Alert,
    CompositeAlert,
    Pipeline,
    SyntheticCheck,
    #[cfg(feature = "enterprise")]
    Workflow,
    #[cfg(feature = "enterprise")]
    AnomalyDetection,
    #[cfg(feature = "enterprise")]
    IncidentIntegration,
}

impl DestinationConsumer {
    /// Singular/plural label for the refusal message, e.g. "1 alert" / "2 alerts".
    fn count_label(self, count: usize) -> String {
        let (one, many) = match self {
            Self::Alert => ("alert", "alerts"),
            Self::CompositeAlert => ("composite alert", "composite alerts"),
            Self::Pipeline => ("pipeline", "pipelines"),
            Self::SyntheticCheck => ("synthetic check", "synthetic checks"),
            #[cfg(feature = "enterprise")]
            Self::Workflow => ("workflow", "workflows"),
            #[cfg(feature = "enterprise")]
            Self::AnomalyDetection => ("anomaly detection config", "anomaly detection configs"),
            #[cfg(feature = "enterprise")]
            Self::IncidentIntegration => ("incident integration", "incident integrations"),
        };
        format!("{count} {}", if count == 1 { one } else { many })
    }
}

/// One consumer's reference to one destination, found by [`destination_usage`] or [`all_usage`].
#[derive(Debug)]
pub struct DestinationUse {
    pub consumer: DestinationConsumer,
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub destination_name: String,
}

/// Every reference to `name`, across every consumer — the full breakdown, for the display path.
pub async fn destination_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    let mut uses = Vec::new();
    for consumer in DestinationConsumer::iter() {
        uses.extend(
            usage_for(consumer, org_id)
                .await?
                .into_iter()
                .filter(|u| u.destination_name == name),
        );
    }
    Ok(uses)
}

/// For the delete path: stops at the first match, so bulk delete avoids hundreds of full scans.
pub async fn first_use(org_id: &str, name: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    for consumer in DestinationConsumer::iter() {
        let found: Vec<DestinationUse> = usage_for(consumer, org_id)
            .await?
            .into_iter()
            .filter(|u| u.destination_name == name)
            .collect();
        if !found.is_empty() {
            return Ok(found);
        }
    }
    Ok(Vec::new())
}

/// Every reference to every destination, grouped by name — the usage endpoint's page-wide read.
pub async fn all_usage(
    org_id: &str,
) -> Result<HashMap<String, Vec<DestinationUse>>, DestinationError> {
    let mut by_destination: HashMap<String, Vec<DestinationUse>> = HashMap::new();
    for consumer in DestinationConsumer::iter() {
        for u in usage_for(consumer, org_id).await? {
            by_destination
                .entry(u.destination_name.clone())
                .or_default()
                .push(u);
        }
    }
    Ok(by_destination)
}

/// The `delete` refusal message: per-kind counts and names, e.g. `'x' is used by 1 alert (a)`.
pub fn usage_message(name: &str, uses: &[DestinationUse]) -> String {
    let parts: Vec<String> = DestinationConsumer::iter()
        .filter_map(|consumer| {
            let names: Vec<&str> = uses
                .iter()
                .filter(|u| u.consumer == consumer)
                .map(|u| u.name.as_str())
                .collect();
            (!names.is_empty()).then(|| {
                format!(
                    "{} ({})",
                    consumer.count_label(names.len()),
                    shown_names(&names)
                )
            })
        })
        .collect();
    format!("'{name}' is used by {}", join_with_and(&parts))
}

/// Caps the listed names at `MAX_NAMES_SHOWN`, appending "and N more" — the count stays exact.
fn shown_names(names: &[&str]) -> String {
    let extra = names.len().saturating_sub(MAX_NAMES_SHOWN);
    let shown = names[..names.len().min(MAX_NAMES_SHOWN)].join(", ");
    if extra > 0 {
        format!("{shown} and {extra} more")
    } else {
        shown
    }
}

/// `["a", "b", "c"] -> "a, b and c"` — no Oxford comma, matching the refusal message's shape.
fn join_with_and(parts: &[String]) -> String {
    match parts.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// Maps a `sea_orm` error into `DestinationError` the way the rest of `infra` does.
fn db_err(e: sea_orm::DbErr) -> DestinationError {
    let db_err = infra::errors::DbError::SeaORMError(e.to_string());
    DestinationError::InfraError(infra::errors::Error::DbError(db_err))
}

/// Reports a JSON decode failure rather than swallowing it — unreadable must not mean "not used".
fn decode_err(context: &str, e: serde_json::Error) -> DestinationError {
    DestinationError::InfraError(infra::errors::Error::Message(format!("{context}: {e}")))
}

/// Dedupes a row's destination names — a name listed twice on one row must not count as two uses.
fn unique_names(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    names
        .into_iter()
        .filter(|n| seen.insert(n.clone()))
        .collect()
}

/// No wildcard arm plus `EnumIter`-derived iteration: a missed consumer can't compile silently.
async fn usage_for(
    consumer: DestinationConsumer,
    org_id: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    match consumer {
        DestinationConsumer::Alert => alert_usage(org_id).await,
        DestinationConsumer::CompositeAlert => composite_alert_usage(org_id).await,
        DestinationConsumer::Pipeline => pipeline_usage(org_id).await,
        DestinationConsumer::SyntheticCheck => synthetic_check_usage(org_id).await,
        #[cfg(feature = "enterprise")]
        DestinationConsumer::Workflow => workflow_usage(org_id).await,
        #[cfg(feature = "enterprise")]
        DestinationConsumer::AnomalyDetection => anomaly_detection_usage(org_id).await,
        #[cfg(feature = "enterprise")]
        DestinationConsumer::IncidentIntegration => incident_integration_usage(org_id).await,
    }
}

/// Reads the database directly; the `ALERTS` cache cannot answer "used" while cold.
async fn alert_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let conn = get_orm_client_ro().await;
    let alerts = db::alerts::alert::list_with_folders(conn, ListAlertsParams::new(org_id)).await?;
    let mut uses = Vec::new();
    for (folder, alert) in alerts {
        let id = alert.id.map(|id| id.to_string()).unwrap_or_default();
        for destination_name in unique_names(alert.destinations) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::Alert,
                id: id.clone(),
                name: alert.name.clone(),
                folder_id: Some(folder.folder_id.clone()),
                destination_name,
            });
        }
    }
    Ok(uses)
}

/// Composites live outside the `alerts` table, so `alert_usage` alone cannot see them.
async fn composite_alert_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let conn = get_orm_client_ro().await;
    let composites = infra::table::alert_composites::list_by_org(conn, org_id)
        .await
        .map_err(db_err)?;
    let mut uses = Vec::new();
    for composite in composites {
        let dests: Vec<String> =
            serde_json::from_value(composite.destinations.clone()).map_err(|e| {
                decode_err(&format!("composite alert {} destinations", composite.id), e)
            })?;
        for destination_name in unique_names(dests) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::CompositeAlert,
                id: composite.id.clone(),
                name: composite.name.clone(),
                folder_id: Some(composite.folder_id.clone()),
                destination_name,
            });
        }
    }
    Ok(uses)
}

async fn pipeline_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let pipelines = infra::pipeline::list_by_org(org_id).await?;
    let mut uses = Vec::new();
    for pl in pipelines {
        let names = pl.nodes.iter().filter_map(|node| {
            if let config::meta::pipeline::components::NodeData::RemoteStream(dest) = &node.data {
                Some(dest.destination_name.to_string())
            } else {
                None
            }
        });
        for destination_name in unique_names(names.collect()) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::Pipeline,
                id: pl.id.clone(),
                name: pl.name.clone(),
                folder_id: None,
                destination_name,
            });
        }
    }
    Ok(uses)
}

/// Uses `list_fully_decoded`, which fails closed, unlike `list`, which skips a bad row.
async fn synthetic_check_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let conn = get_orm_client_ro().await;
    let checks = infra::table::synthetics_checks::list_fully_decoded(conn, org_id).await?;
    let mut uses = Vec::new();
    for check in checks {
        for destination_name in unique_names(check.destinations) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::SyntheticCheck,
                id: check.id.clone(),
                name: check.name.clone(),
                folder_id: Some(check.folder_id.clone()),
                destination_name,
            });
        }
    }
    Ok(uses)
}

/// Folder-blind like the alerts arm: a workflow node can name a destination in any folder.
#[cfg(feature = "enterprise")]
async fn workflow_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let workflows = crate::workflows::list_workflows(org_id, None)
        .await
        .map_err(|e| DestinationError::InfraError(infra::errors::Error::Message(e.to_string())))?;
    let mut uses = Vec::new();
    for w in workflows {
        let names = w.nodes.iter().filter_map(|node| {
            if let config::meta::pipeline::components::NodeData::Destination(dest) = &node.data {
                Some(dest.destination_id.clone())
            } else {
                None
            }
        });
        for destination_name in unique_names(names.collect()) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::Workflow,
                id: w.id.clone(),
                name: w.name.clone(),
                folder_id: None,
                destination_name,
            });
        }
    }
    Ok(uses)
}

/// Fails closed on an unreadable `alert_destinations` value instead of `.ok()`-swallowing it.
#[cfg(feature = "enterprise")]
async fn anomaly_detection_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let conn = get_orm_client_ro().await;
    let configs = infra::table::anomaly_detection::config::list_by_org(conn, org_id).await?;
    let mut uses = Vec::new();
    for config in configs {
        let dests: Vec<String> = match &config.alert_destinations {
            Some(v) => serde_json::from_value(v.clone()).map_err(|e| {
                decode_err(
                    &format!("anomaly config {} destinations", config.anomaly_id),
                    e,
                )
            })?,
            None => Vec::new(),
        };
        for destination_name in unique_names(dests) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::AnomalyDetection,
                id: config.anomaly_id.clone(),
                name: config.name.clone(),
                folder_id: Some(config.folder_id.clone()),
                destination_name,
            });
        }
    }
    Ok(uses)
}

/// Read at notify time as `base_destinations`; deleting one silently un-notifies future incidents.
#[cfg(feature = "enterprise")]
async fn incident_integration_usage(org_id: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let integrations = infra::table::incident_integrations::list_by_org(org_id).await?;
    let mut uses = Vec::new();
    for i in integrations {
        for destination_name in unique_names(i.destinations) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::IncidentIntegration,
                id: i.id.clone(),
                name: i.name.clone(),
                folder_id: None,
                destination_name,
            });
        }
    }
    Ok(uses)
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::alert::Alert,
        folder::{Folder, FolderType},
        pipeline::{
            Pipeline, PipelineKind,
            components::{Node, NodeData, PipelineSource},
        },
        stream::{RemoteStreamParams, StreamParams, StreamType},
        synthetics::{Synthetic, SyntheticType},
    };
    use infra::{db::get_orm_client_rw, table::entity::alert_composites};
    use sea_orm::ActiveValue::Set;

    use super::*;

    /// Creates the org's "default" folder and returns its primary key (composites/anomaly configs
    /// need it).
    async fn ensure_default_folder(org_id: &str) -> String {
        let folder = Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Default::default()
        };
        let (pk, ..) = infra::table::folders::put(org_id, None, folder, FolderType::Alerts)
            .await
            .unwrap();
        pk.to_string()
    }

    /// `Alert` has private fields, so `..Default::default()` fails outside its crate; go through
    /// `Deserialize`.
    fn test_alert(name: &str, destination: &str) -> Alert {
        serde_json::from_value(serde_json::json!({
            "name": name,
            "destinations": [destination],
        }))
        .unwrap()
    }

    /// The regression this module closes: `ALERTS` stays empty here, so a cache-backed guard would
    /// miss this.
    #[tokio::test]
    #[ignore] // requires the local sqlite/coordinator infra to be initialized
    async fn test_alert_arm_refuses_with_a_cold_cache() {
        let org_id = "test_org_du_alert";
        let name = "du-dest-alert";
        ensure_default_folder(org_id).await;
        let conn = get_orm_client_rw().await;
        let alert = test_alert("du-alert", name);
        infra::table::alerts::create(conn, org_id, "default", alert, false)
            .await
            .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::Alert);
    }

    /// Composites live outside the `alerts` table entirely; a destination they use must still
    /// refuse.
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_composite_alert_arm_refuses() {
        let org_id = "test_org_du_composite";
        let name = "du-dest-composite";
        let folder_pk = ensure_default_folder(org_id).await;
        let conn = get_orm_client_rw().await;
        let active = alert_composites::ActiveModel {
            id: Set("du-composite-1".to_string()),
            org: Set(org_id.to_string()),
            folder_id: Set(folder_pk),
            name: Set("du-composite".to_string()),
            description: Set(None),
            expression: Set("true".to_string()),
            warning_counts_as_firing: Set(false),
            stale_child_policy: Set(0),
            destinations: Set(serde_json::json!([name])),
            template: Set(None),
            context_attributes: Set(None),
            enabled: Set(true),
            silence_seconds: Set(0),
            creates_incident: Set(false),
            workflows: Set(serde_json::json!([])),
            priority: Set(None),
            tags: Set(None),
            owner: Set(None),
            last_edited_by: Set(None),
            updated_at: Set(None),
            evaluation_generation: Set(0),
            pending_period_sec: Set(0),
        };
        infra::table::alert_composites::create_with_children(conn, active, vec![])
            .await
            .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::CompositeAlert);
    }

    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_pipeline_arm_refuses() {
        let org_id = "test_org_du_pipeline";
        let name = "du-dest-pipeline";
        let pipeline = Pipeline {
            id: "du-pipeline-1".to_string(),
            version: 0,
            enabled: true,
            org: org_id.to_string(),
            name: "du-pipeline".to_string(),
            description: "".to_string(),
            kind: PipelineKind::User,
            source: PipelineSource::Realtime(StreamParams {
                org_id: org_id.into(),
                stream_name: "logs".into(),
                stream_type: StreamType::Logs,
            }),
            nodes: vec![Node::new(
                "n1".to_string(),
                NodeData::RemoteStream(RemoteStreamParams {
                    org_id: org_id.into(),
                    destination_name: name.into(),
                }),
                0.0,
                0.0,
                "output".to_string(),
            )],
            edges: vec![],
        };
        infra::pipeline::put(&pipeline).await.unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::Pipeline);
    }

    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_synthetic_check_arm_refuses() {
        let org_id = "test_org_du_synthetic";
        let name = "du-dest-synthetic";
        let conn = get_orm_client_rw().await;
        let check = Synthetic {
            name: "du-check".to_string(),
            check_type: SyntheticType::Http,
            target: "https://example.com".to_string(),
            destinations: vec![name.to_string()],
            ..Default::default()
        };
        infra::table::synthetics_checks::create(conn, org_id, check, false)
            .await
            .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::SyntheticCheck);
    }

    /// A destination used by two consumers must return both, not just the first match.
    #[tokio::test]
    #[ignore] // requires the local sqlite/coordinator infra to be initialized
    async fn test_returns_every_consumer_not_just_the_first() {
        let org_id = "test_org_du_multi";
        let name = "du-dest-multi";
        ensure_default_folder(org_id).await;
        let alert_conn = get_orm_client_rw().await;
        let alert = test_alert("du-multi-alert", name);
        infra::table::alerts::create(alert_conn, org_id, "default", alert, false)
            .await
            .unwrap();

        let check_conn = get_orm_client_rw().await;
        let check = Synthetic {
            name: "du-multi-check".to_string(),
            check_type: SyntheticType::Http,
            target: "https://example.com".to_string(),
            destinations: vec![name.to_string()],
            ..Default::default()
        };
        infra::table::synthetics_checks::create(check_conn, org_id, check, false)
            .await
            .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 2, "expected both consumers, got {uses:?}");
    }

    /// A destination nothing references still deletes — the guard must not over-fire.
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_unreferenced_destination_reports_no_usage() {
        let org_id = "test_org_du_unused";
        let name = "du-dest-unused";
        let uses = destination_usage(org_id, name).await.unwrap();
        assert!(uses.is_empty());
    }

    /// `first_use` stops at the first match, unlike the full `destination_usage` scan.
    #[tokio::test]
    #[ignore] // requires the local sqlite/coordinator infra to be initialized
    async fn test_first_use_stops_at_the_first_match() {
        let org_id = "test_org_du_firstuse";
        let name = "du-dest-firstuse";
        ensure_default_folder(org_id).await;
        let alert_conn = get_orm_client_rw().await;
        let alert = test_alert("du-firstuse-alert", name);
        infra::table::alerts::create(alert_conn, org_id, "default", alert, false)
            .await
            .unwrap();

        let check_conn = get_orm_client_rw().await;
        let check = Synthetic {
            name: "du-firstuse-check".to_string(),
            check_type: SyntheticType::Http,
            target: "https://example.com".to_string(),
            destinations: vec![name.to_string()],
            ..Default::default()
        };
        infra::table::synthetics_checks::create(check_conn, org_id, check, false)
            .await
            .unwrap();

        let full = destination_usage(org_id, name).await.unwrap();
        assert_eq!(
            full.len(),
            2,
            "both consumers should show up in the full scan"
        );

        let first = first_use(org_id, name).await.unwrap();
        assert_eq!(
            first.len(),
            1,
            "the delete path should stop at the first match"
        );
        assert_eq!(first[0].consumer, DestinationConsumer::Alert);
    }

    /// `all_usage` groups by destination name in one pass, the read the P1 usage endpoint needs.
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_all_usage_groups_by_destination_across_consumers() {
        let org_id = "test_org_du_allusage";
        ensure_default_folder(org_id).await;
        let alert_conn = get_orm_client_rw().await;
        let alert = test_alert("du-allusage-alert", "du-dest-a");
        infra::table::alerts::create(alert_conn, org_id, "default", alert, false)
            .await
            .unwrap();

        let check_conn = get_orm_client_rw().await;
        let check = Synthetic {
            name: "du-allusage-check".to_string(),
            check_type: SyntheticType::Http,
            target: "https://example.com".to_string(),
            destinations: vec!["du-dest-b".to_string()],
            ..Default::default()
        };
        infra::table::synthetics_checks::create(check_conn, org_id, check, false)
            .await
            .unwrap();

        let by_destination = all_usage(org_id).await.unwrap();
        assert_eq!(by_destination.get("du-dest-a").map(Vec::len), Some(1));
        assert_eq!(
            by_destination["du-dest-a"][0].consumer,
            DestinationConsumer::Alert
        );
        assert_eq!(by_destination.get("du-dest-b").map(Vec::len), Some(1));
        assert_eq!(
            by_destination["du-dest-b"][0].consumer,
            DestinationConsumer::SyntheticCheck
        );
    }

    /// Seeds a real `NodeData::Destination` node so this exercises `workflow_usage`'s match, not an
    /// empty org.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized, and the enterprise feature
    async fn test_workflow_arm_refuses() {
        let org_id = "test_org_du_workflow";
        let name = "du-dest-workflow";
        let workflow = infra::table::workflows::Workflow {
            id: "du-workflow-1".to_string(),
            org_id: org_id.to_string(),
            folder_id: "".to_string(),
            created_at: 0,
            updated_at: 0,
            created_by: "test@example.com".to_string(),
            enabled: true,
            name: "du-workflow".to_string(),
            description: "".to_string(),
            nodes: vec![Node::new(
                "n1".to_string(),
                NodeData::Destination(config::meta::pipeline::components::WorkflowDestination {
                    destination_id: name.to_string(),
                    template_override: None,
                }),
                0.0,
                0.0,
                "output".to_string(),
            )],
            edges: vec![],
        };
        infra::table::workflows::save_workflow(workflow)
            .await
            .unwrap();

        let uses = workflow_usage(org_id).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::Workflow);
        assert_eq!(uses[0].destination_name, name);
    }

    /// Seeds a config with a real `alert_destinations` entry, exercising the decode path, not an
    /// empty org.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized, and the enterprise feature
    async fn test_anomaly_detection_arm_refuses() {
        let org_id = "test_org_du_anomaly";
        let name = "du-dest-anomaly";
        let folder_pk = ensure_default_folder(org_id).await;
        let conn = get_orm_client_rw().await;
        let config = infra::table::entity::anomaly_detection_config::Model {
            anomaly_id: "du-anomaly-1".to_string(),
            org_id: org_id.to_string(),
            stream_name: "default".to_string(),
            stream_type: "logs".to_string(),
            enabled: true,
            name: "du-anomaly".to_string(),
            description: None,
            query_mode: "sql".to_string(),
            filters: None,
            custom_sql: None,
            detection_function: "rcf".to_string(),
            histogram_interval: "1h".to_string(),
            schedule_interval: "5m".to_string(),
            detection_window_seconds: 3600,
            training_window_days: 7,
            retrain_interval_days: 1,
            threshold: 95,
            alert_budget_per_day: None,
            seasonality: "none".to_string(),
            is_trained: false,
            training_started_at: None,
            training_completed_at: None,
            last_error: None,
            last_processed_timestamp: None,
            current_model_version: 0,
            rcf_num_trees: 50,
            rcf_tree_size: 256,
            rcf_shingle_size: 8,
            alert_enabled: true,
            alert_destinations: Some(serde_json::json!([name])),
            folder_id: folder_pk,
            owner: None,
            priority: None,
            tags: None,
            status: 0,
            retries: 0,
            last_failed_at: None,
            last_alert_fired_at: None,
            last_recovery_notified_at: None,
            last_updated: 0,
            created_at: 1_000_000,
            updated_at: 1_000_000,
        };
        infra::table::anomaly_detection::config::create(conn, config)
            .await
            .unwrap();

        let uses = anomaly_detection_usage(org_id).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::AnomalyDetection);
        assert_eq!(uses[0].destination_name, name);
    }

    /// The ninth consumer: incident integrations page nobody once the destination is gone.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized, and the enterprise feature
    async fn test_incident_integration_arm_refuses() {
        let org_id = "test_org_du_incident";
        let name = "du-dest-incident";
        let now = 1_000_000;
        let record = infra::table::incident_integrations::IncidentIntegrationRecord {
            id: "du-incident-1".to_string(),
            org_id: org_id.to_string(),
            name: "du-incident".to_string(),
            source_type: "auto".to_string(),
            token: infra::table::incident_integrations::generate_token(),
            enabled: true,
            config: serde_json::json!({}),
            destinations: vec![name.to_string()],
            created_by: "test@example.com".to_string(),
            created_at: now,
            updated_at: now,
        };
        infra::table::incident_integrations::add(&record)
            .await
            .unwrap();

        let uses = incident_integration_usage(org_id).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::IncidentIntegration);
        assert_eq!(uses[0].destination_name, name);
    }

    #[test]
    fn test_unique_names_drops_a_duplicate_on_one_row() {
        let names = vec!["a".to_string(), "b".to_string(), "a".to_string()];
        assert_eq!(unique_names(names), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn test_usage_message_orders_and_counts_by_consumer_kind() {
        let uses = vec![
            DestinationUse {
                consumer: DestinationConsumer::SyntheticCheck,
                id: "s1".to_string(),
                name: "s1".to_string(),
                folder_id: None,
                destination_name: "pagerduty-prod".to_string(),
            },
            DestinationUse {
                consumer: DestinationConsumer::SyntheticCheck,
                id: "s2".to_string(),
                name: "s2".to_string(),
                folder_id: None,
                destination_name: "pagerduty-prod".to_string(),
            },
            DestinationUse {
                consumer: DestinationConsumer::Pipeline,
                id: "p1".to_string(),
                name: "pl1".to_string(),
                folder_id: None,
                destination_name: "pagerduty-prod".to_string(),
            },
            DestinationUse {
                consumer: DestinationConsumer::Alert,
                id: "a1".to_string(),
                name: "a1".to_string(),
                folder_id: Some("default".to_string()),
                destination_name: "pagerduty-prod".to_string(),
            },
        ];
        assert_eq!(
            usage_message("pagerduty-prod", &uses),
            "'pagerduty-prod' is used by 1 alert (a1), 1 pipeline (pl1) and 2 synthetic checks (s1, s2)"
        );
    }

    #[test]
    fn test_usage_message_caps_names_and_counts_the_rest() {
        let uses: Vec<DestinationUse> = (1..=7)
            .map(|i| DestinationUse {
                consumer: DestinationConsumer::Alert,
                id: format!("a{i}"),
                name: format!("a{i}"),
                folder_id: None,
                destination_name: "x".to_string(),
            })
            .collect();
        assert_eq!(
            usage_message("x", &uses),
            "'x' is used by 7 alerts (a1, a2, a3, a4, a5 and 2 more)"
        );
    }

    #[test]
    fn test_usage_message_single_consumer_has_no_and() {
        let uses = vec![DestinationUse {
            consumer: DestinationConsumer::Pipeline,
            id: "p1".to_string(),
            name: "p1".to_string(),
            folder_id: None,
            destination_name: "x".to_string(),
        }];
        assert_eq!(usage_message("x", &uses), "'x' is used by 1 pipeline (p1)");
    }

    #[test]
    fn test_usage_message_includes_the_new_consumer_kinds() {
        let uses = vec![
            DestinationUse {
                consumer: DestinationConsumer::CompositeAlert,
                id: "c1".to_string(),
                name: "comp1".to_string(),
                folder_id: Some("default".to_string()),
                destination_name: "x".to_string(),
            },
            DestinationUse {
                consumer: DestinationConsumer::SyntheticCheck,
                id: "s1".to_string(),
                name: "check1".to_string(),
                folder_id: None,
                destination_name: "x".to_string(),
            },
        ];
        assert_eq!(
            usage_message("x", &uses),
            "'x' is used by 1 composite alert (comp1) and 1 synthetic check (check1)"
        );
    }
}
