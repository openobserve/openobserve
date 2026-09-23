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

use config::meta::alerts::alert::ListAlertsParams;
use db::alerts::destinations::DestinationError;
use infra::db::get_orm_client_ro;

/// A system whose rows name an alert destination by string rather than by a foreign key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestinationConsumer {
    Alert,
    CompositeAlert,
    Pipeline,
    SyntheticMonitor,
    OncallPolicy,
    OncallTeamChannel,
    #[cfg(feature = "enterprise")]
    Workflow,
    #[cfg(feature = "enterprise")]
    AnomalyDetection,
}

impl DestinationConsumer {
    #[cfg(feature = "enterprise")]
    const ALL: [Self; 8] = [
        Self::Alert,
        Self::CompositeAlert,
        Self::Pipeline,
        Self::SyntheticMonitor,
        Self::OncallPolicy,
        Self::OncallTeamChannel,
        Self::Workflow,
        Self::AnomalyDetection,
    ];
    #[cfg(not(feature = "enterprise"))]
    const ALL: [Self; 6] = [
        Self::Alert,
        Self::CompositeAlert,
        Self::Pipeline,
        Self::SyntheticMonitor,
        Self::OncallPolicy,
        Self::OncallTeamChannel,
    ];

    /// Singular/plural label for the refusal message, e.g. "1 alert" / "2 alerts".
    fn count_label(self, count: usize) -> String {
        let (one, many) = match self {
            Self::Alert => ("alert", "alerts"),
            Self::CompositeAlert => ("composite alert", "composite alerts"),
            Self::Pipeline => ("pipeline", "pipelines"),
            Self::SyntheticMonitor => ("synthetic monitor", "synthetic monitors"),
            Self::OncallPolicy => ("escalation policy", "escalation policies"),
            Self::OncallTeamChannel => ("team channel", "team channels"),
            #[cfg(feature = "enterprise")]
            Self::Workflow => ("workflow", "workflows"),
            #[cfg(feature = "enterprise")]
            Self::AnomalyDetection => ("anomaly detection config", "anomaly detection configs"),
        };
        format!("{count} {}", if count == 1 { one } else { many })
    }
}

/// One consumer's reference to a destination, found by [`destination_usage`].
#[derive(Debug)]
pub struct DestinationUse {
    pub consumer: DestinationConsumer,
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
}

/// Every reference to `name`; `usage_for` has no wildcard arm, so a missed consumer won't compile.
pub async fn destination_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    let mut uses = Vec::new();
    for consumer in DestinationConsumer::ALL {
        uses.extend(usage_for(consumer, org_id, name).await?);
    }
    Ok(uses)
}

/// The `delete` refusal message: per-kind counts and names, e.g. `'x' is used by 1 alert (a)`.
pub fn usage_message(name: &str, uses: &[DestinationUse]) -> String {
    let parts: Vec<String> = DestinationConsumer::ALL
        .into_iter()
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
                    names.join(", ")
                )
            })
        })
        .collect();
    format!("'{name}' is used by {}", join_with_and(&parts))
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

async fn usage_for(
    consumer: DestinationConsumer,
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    match consumer {
        DestinationConsumer::Alert => alert_usage(org_id, name).await,
        DestinationConsumer::CompositeAlert => composite_alert_usage(org_id, name).await,
        DestinationConsumer::Pipeline => pipeline_usage(org_id, name).await,
        DestinationConsumer::SyntheticMonitor => synthetic_monitor_usage(org_id, name).await,
        DestinationConsumer::OncallPolicy => oncall_policy_usage(org_id, name).await,
        DestinationConsumer::OncallTeamChannel => oncall_team_channel_usage(org_id, name).await,
        #[cfg(feature = "enterprise")]
        DestinationConsumer::Workflow => workflow_usage(org_id, name).await,
        #[cfg(feature = "enterprise")]
        DestinationConsumer::AnomalyDetection => anomaly_detection_usage(org_id, name).await,
    }
}

/// Reads the database directly; the `ALERTS` cache cannot answer "used" while cold.
async fn alert_usage(org_id: &str, name: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let conn = get_orm_client_ro().await;
    let alerts = db::alerts::alert::list_with_folders(conn, ListAlertsParams::new(org_id)).await?;
    Ok(alerts
        .into_iter()
        .filter(|(_, alert)| alert.destinations.iter().any(|d| d == name))
        .map(|(folder, alert)| DestinationUse {
            consumer: DestinationConsumer::Alert,
            id: alert.id.map(|id| id.to_string()).unwrap_or_default(),
            name: alert.name,
            folder_id: Some(folder.folder_id),
        })
        .collect())
}

/// Composites live outside the `alerts` table, so `alert_usage` alone cannot see them.
async fn composite_alert_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
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
        if dests.iter().any(|d| d == name) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::CompositeAlert,
                id: composite.id.clone(),
                name: composite.name.clone(),
                folder_id: Some(composite.folder_id.clone()),
            });
        }
    }
    Ok(uses)
}

async fn pipeline_usage(org_id: &str, name: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let pipelines = infra::pipeline::list_by_org(org_id).await?;
    Ok(pipelines
        .into_iter()
        .filter(|pl| pl.contains_remote_destination(name))
        .map(|pl| DestinationUse {
            consumer: DestinationConsumer::Pipeline,
            id: pl.id,
            name: pl.name,
            folder_id: None,
        })
        .collect())
}

/// Uses `list_referencing_destination`, which fails closed, not `list`, which skips a bad row.
async fn synthetic_monitor_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    let conn = get_orm_client_ro().await;
    let checks =
        infra::table::synthetics_checks::list_referencing_destination(conn, org_id, name).await?;
    Ok(checks
        .into_iter()
        .map(|check| DestinationUse {
            consumer: DestinationConsumer::SyntheticMonitor,
            id: check.id,
            name: check.name,
            folder_id: Some(check.folder_id),
        })
        .collect())
}

/// Escalation policies have no name of their own; `team_id` is the closest identifying field.
async fn oncall_policy_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    let policies = infra::table::oncall_policies::list(org_id).await?;
    Ok(policies
        .into_iter()
        .filter(|policy| policy.destinations.iter().any(|d| d == name))
        .map(|policy| DestinationUse {
            consumer: DestinationConsumer::OncallPolicy,
            id: policy.id,
            name: policy.team_id,
            folder_id: None,
        })
        .collect())
}

/// The team channel overrides the policy's list when set; checking both is the safe superset.
async fn oncall_team_channel_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
    let teams = infra::table::oncall_teams::list(org_id).await?;
    Ok(teams
        .into_iter()
        .filter(|team| {
            team.channel_destinations
                .as_ref()
                .is_some_and(|dests| dests.iter().any(|d| d == name))
        })
        .map(|team| DestinationUse {
            consumer: DestinationConsumer::OncallTeamChannel,
            id: team.id,
            name: team.name,
            folder_id: None,
        })
        .collect())
}

/// Folder-blind like the alerts arm: any workflow node naming this destination blocks the delete.
#[cfg(feature = "enterprise")]
async fn workflow_usage(org_id: &str, name: &str) -> Result<Vec<DestinationUse>, DestinationError> {
    let workflows = crate::workflows::list_workflows(org_id, None, None, None)
        .await
        .map_err(|e| DestinationError::InfraError(infra::errors::Error::Message(e.to_string())))?;
    Ok(workflows
        .into_iter()
        .filter(|w| {
            w.nodes.iter().any(|node| {
                matches!(
                    &node.data,
                    config::meta::pipeline::components::NodeData::Destination(dest)
                        if dest.destination_id == name
                )
            })
        })
        .map(|w| DestinationUse {
            consumer: DestinationConsumer::Workflow,
            id: w.id,
            name: w.name,
            folder_id: Some(w.folder_id),
        })
        .collect())
}

/// Fails closed on an unreadable `alert_destinations` value instead of `.ok()`-swallowing it.
#[cfg(feature = "enterprise")]
async fn anomaly_detection_usage(
    org_id: &str,
    name: &str,
) -> Result<Vec<DestinationUse>, DestinationError> {
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
        if dests.iter().any(|d| d == name) {
            uses.push(DestinationUse {
                consumer: DestinationConsumer::AnomalyDetection,
                id: config.anomaly_id.clone(),
                name: config.name.clone(),
                folder_id: Some(config.folder_id.clone()),
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
        let (pk, ..) = infra::table::folders::get_or_create(org_id, folder, FolderType::Alerts)
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
    async fn test_synthetic_monitor_arm_refuses() {
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
        assert_eq!(uses[0].consumer, DestinationConsumer::SyntheticMonitor);
    }

    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_oncall_policy_arm_refuses() {
        let org_id = "test_org_du_oncall";
        let team_id = "du-team";
        let name = "du-dest-oncall";
        let policy = infra::table::oncall_policies::get_or_create(org_id, team_id)
            .await
            .unwrap();
        infra::table::oncall_policies::update_rungs(
            org_id,
            team_id,
            &policy.rungs,
            Some(&[name.to_string()]),
            None,
        )
        .await
        .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::OncallPolicy);
    }

    /// The team channel overrides the policy's own list, so it needs its own guard too.
    #[tokio::test]
    #[ignore] // requires the local sqlite infra to be initialized
    async fn test_oncall_team_channel_arm_refuses() {
        let org_id = "test_org_du_teamchannel";
        let name = "du-dest-teamchannel";
        let team = infra::table::oncall_teams::create(org_id, "du-team", "UTC", None)
            .await
            .unwrap();
        infra::table::oncall_teams::set_channel(org_id, &team.id, Some(vec![name.to_string()]))
            .await
            .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::OncallTeamChannel);
    }

    /// A destination used by three consumers must return all three, not just the first match.
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

        let team_id = "du-multi-team";
        let policy = infra::table::oncall_policies::get_or_create(org_id, team_id)
            .await
            .unwrap();
        infra::table::oncall_policies::update_rungs(
            org_id,
            team_id,
            &policy.rungs,
            Some(&[name.to_string()]),
            None,
        )
        .await
        .unwrap();

        let uses = destination_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 3, "expected all three consumers, got {uses:?}");
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

        let uses = workflow_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::Workflow);
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

        let uses = anomaly_detection_usage(org_id, name).await.unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].consumer, DestinationConsumer::AnomalyDetection);
    }

    #[test]
    fn test_usage_message_orders_and_counts_by_consumer_kind() {
        let uses = vec![
            DestinationUse {
                consumer: DestinationConsumer::SyntheticMonitor,
                id: "s1".to_string(),
                name: "s1".to_string(),
                folder_id: None,
            },
            DestinationUse {
                consumer: DestinationConsumer::SyntheticMonitor,
                id: "s2".to_string(),
                name: "s2".to_string(),
                folder_id: None,
            },
            DestinationUse {
                consumer: DestinationConsumer::OncallPolicy,
                id: "p1".to_string(),
                name: "team1".to_string(),
                folder_id: None,
            },
            DestinationUse {
                consumer: DestinationConsumer::Alert,
                id: "a1".to_string(),
                name: "a1".to_string(),
                folder_id: Some("default".to_string()),
            },
        ];
        assert_eq!(
            usage_message("pagerduty-prod", &uses),
            "'pagerduty-prod' is used by 1 alert (a1), 2 synthetic monitors (s1, s2) and 1 escalation policy (team1)"
        );
    }

    #[test]
    fn test_usage_message_single_consumer_has_no_and() {
        let uses = vec![DestinationUse {
            consumer: DestinationConsumer::Pipeline,
            id: "p1".to_string(),
            name: "p1".to_string(),
            folder_id: None,
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
            },
            DestinationUse {
                consumer: DestinationConsumer::OncallTeamChannel,
                id: "t1".to_string(),
                name: "team-chat".to_string(),
                folder_id: None,
            },
        ];
        assert_eq!(
            usage_message("x", &uses),
            "'x' is used by 1 composite alert (comp1) and 1 team channel (team-chat)"
        );
    }
}
