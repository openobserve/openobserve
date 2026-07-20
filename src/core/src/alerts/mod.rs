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

use std::sync::Arc;

use async_trait::async_trait;
use config::{
    meta::{
        alerts::{AlertConditionParams, QueryCondition, TriggerEvalResults, alert::Alert},
        search::{SearchEventContext, SearchEventType},
        stream::StreamType,
    },
    utils::json::{Map, Value},
};
use openobserve_alerts::evaluation::QueryConditionExt;

#[cfg(feature = "enterprise")]
pub mod deduplication {
    pub use openobserve_alerts::service::deduplication::*;
}
pub mod derived_streams;
pub mod destinations {
    use async_trait::async_trait;
    use config::meta::destinations::{Destination, Email};
    pub use openobserve_alerts::service::destinations::*;

    struct CoreDestinationReferences;

    #[async_trait]
    impl openobserve_alerts::service::destinations::DestinationReferences
        for CoreDestinationReferences
    {
        async fn user_exists(&self, org_id: &str, email: &str) -> bool {
            crate::db::user::get(Some(org_id), email)
                .await
                .is_ok_and(|user| user.is_some())
        }

        async fn pipeline_using_destination(&self, org_id: &str, name: &str) -> Option<String> {
            openobserve_pipeline::service::list_by_org(org_id)
                .await
                .ok()?
                .into_iter()
                .find(|pipeline| pipeline.contains_remote_destination(name))
                .map(|pipeline| pipeline.name)
        }

        async fn send_test_email(
            &self,
            subject: &str,
            email: &Email,
            body: String,
        ) -> Result<String, String> {
            openobserve_alerts::service::alert::send_email_notification(subject, email, body)
                .await
                .map_err(|error| error.to_string())
        }
    }

    pub async fn save(
        name: &str,
        destination: Destination,
        create: bool,
    ) -> Result<Destination, openobserve_alerts::repository::destinations::DestinationError> {
        openobserve_alerts::service::destinations::save_with_references(
            name,
            destination,
            create,
            &CoreDestinationReferences,
        )
        .await
    }

    pub async fn test_email(
        org_id: &str,
        recipients: &[String],
        body: Option<&str>,
    ) -> Result<String, openobserve_alerts::repository::destinations::DestinationError> {
        openobserve_alerts::service::destinations::test_email_with_references(
            org_id,
            recipients,
            body,
            &CoreDestinationReferences,
        )
        .await
    }

    pub async fn delete(
        org_id: &str,
        name: &str,
    ) -> Result<(), openobserve_alerts::repository::destinations::DestinationError> {
        openobserve_alerts::service::destinations::delete_with_references(
            org_id,
            name,
            &CoreDestinationReferences,
        )
        .await
    }
}
#[cfg(feature = "enterprise")]
pub mod grouping {
    use async_trait::async_trait;
    use config::{meta::alerts::alert::Alert, utils::json};
    use openobserve_alerts::{
        grouping::{NotificationSender, PendingBatch},
        service::alert::AlertExt,
    };

    struct CoreNotificationSender;

    #[async_trait]
    impl NotificationSender for CoreNotificationSender {
        async fn send_notification(
            &self,
            alert: &Alert,
            rows: &[json::Map<String, json::Value>],
            rows_end_time: i64,
            start_time: Option<i64>,
            evaluation_timestamp: i64,
        ) -> Result<(String, String), anyhow::Error> {
            Ok(alert
                .send_notification(rows, rows_end_time, start_time, evaluation_timestamp)
                .await?)
        }
    }

    pub async fn send_grouped_notification(batch: PendingBatch) -> Result<(), anyhow::Error> {
        openobserve_alerts::grouping::send_grouped_notification(batch, &CoreNotificationSender)
            .await
    }
}
#[cfg(feature = "enterprise")]
pub mod org_config {
    pub use openobserve_alerts::service::org_config::*;
}
pub mod scheduler;
pub mod templates {
    pub use openobserve_alerts::service::templates::*;
}

struct CoreRuntimeServices;

#[async_trait]
impl openobserve_alerts::ports::RuntimeServices for CoreRuntimeServices {
    async fn create_default_folder(
        &self,
        org_id: &str,
        folder: config::meta::folder::Folder,
    ) -> anyhow::Result<config::meta::folder::Folder> {
        Ok(crate::folders::save_folder(
            org_id,
            folder,
            config::meta::folder::FolderType::Alerts,
            true,
        )
        .await?)
    }

    async fn evaluate_alert(
        &self,
        alert: &Alert,
        row: Option<&Map<String, Value>>,
        time_range: (Option<i64>, i64),
        trace_id: Option<String>,
    ) -> anyhow::Result<TriggerEvalResults> {
        if alert.is_real_time {
            alert.query_condition.evaluate_realtime(row).await
        } else {
            let mut search_event_ctx = SearchEventContext::with_alert(Some(format!(
                "/alerts/{}/{}/{}/{}",
                alert.org_id, alert.stream_type, alert.stream_name, alert.name
            )));
            search_event_ctx.alert_name = Some(alert.name.clone());
            alert
                .query_condition
                .evaluate_scheduled(
                    &alert.org_id,
                    Some(&alert.stream_name),
                    alert.stream_type,
                    &alert.trigger_condition,
                    time_range,
                    Some(SearchEventType::Alerts),
                    Some(search_event_ctx),
                    trace_id,
                )
                .await
        }
    }

    async fn build_sql(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        query_condition: &QueryCondition,
        conditions: &AlertConditionParams,
    ) -> anyhow::Result<String> {
        openobserve_alerts::evaluation::build_sql(
            org_id,
            stream_name,
            stream_type,
            query_condition,
            conditions,
        )
        .await
    }

    async fn promql_search(
        &self,
        trace_id: &str,
        org_id: &str,
        query: String,
        start: i64,
        end: i64,
        step: i64,
        is_super_cluster: bool,
    ) -> anyhow::Result<config::meta::promql::value::Value> {
        let req = super::promql::MetricsQueryRequest {
            query,
            start,
            end,
            step,
            query_exemplars: false,
            use_cache: None,
            search_type: Some(SearchEventType::Alerts),
            regions: vec![],
            clusters: vec![],
        };
        Ok(super::promql::search::search(trace_id, org_id, &req, "", 0, is_super_cluster).await?)
    }

    async fn setup_tracing_with_trace_id(
        &self,
        trace_id: &str,
        span: tracing::Span,
    ) -> tracing::Span {
        crate::service::setup_tracing_with_trace_id(trace_id, span).await
    }

    fn report_search_metrics(
        &self,
        start: std::time::Instant,
        org_id: &str,
        stream_type: StreamType,
        search_type: &str,
    ) {
        crate::self_reporting::http_report_metrics(
            start,
            org_id,
            stream_type,
            "200",
            "_search",
            search_type,
            "",
        );
    }

    #[cfg(feature = "enterprise")]
    async fn route_incident(
        &self,
        alert: &Alert,
        row: &Map<String, Value>,
        notify_rows: &[Map<String, Value>],
        timestamp: i64,
    ) -> anyhow::Result<Option<openobserve_alerts::ports::IncidentRoute>> {
        Ok(
            openobserve_alerts::service::incidents::correlate_alert_to_incident(
                alert,
                row,
                notify_rows,
                timestamp,
            )
            .await?
            .map(|outcome| openobserve_alerts::ports::IncidentRoute {
                incident_id: outcome.incident_id().to_string(),
                service_name: outcome.service_name().to_string(),
            }),
        )
    }

    #[cfg(feature = "enterprise")]
    async fn permitted_alerts(
        &self,
        org_id: &str,
        user_id: Option<&str>,
        folder_id: Option<&str>,
    ) -> Result<Option<Vec<String>>, openobserve_alerts::ports::PermissionError> {
        use common::utils::auth::AuthExtractor;
        use o2_openfga::{config::get_config, meta::mapping::OFGA_MODELS};
        use openobserve_alerts::ports::PermissionError;

        let Some(user_id) = user_id else {
            return Err(PermissionError::MissingUser);
        };
        if !get_config().list_only_permitted {
            return Ok(None);
        }
        if let Some(folder_id) = folder_id {
            let user_role = match crate::db::user::get(Some(org_id), user_id).await {
                Ok(Some(user)) => user.role,
                _ => return Err(PermissionError::UserNotFound),
            };
            if crate::authz::check_permissions(
                user_id,
                AuthExtractor {
                    org_id: org_id.to_string(),
                    o2_type: format!(
                        "{}:{folder_id}",
                        OFGA_MODELS.get("alert_folders").unwrap().key,
                    ),
                    method: "GET".to_string(),
                    bypass_check: false,
                    parent_id: String::new(),
                    use_all_org: false,
                    use_self_context: false,
                    use_self_parent: true,
                    auth: String::new(),
                },
                user_role,
                false,
            )
            .await
            {
                return Ok(None);
            }
        }
        crate::authz::list_objects_for_user(
            org_id,
            user_id,
            "GET_INDIVIDUAL_FROM_ROLE",
            OFGA_MODELS.get("alerts").unwrap().key,
        )
        .await
        .map_err(|error| PermissionError::Other(error.to_string()))
    }

    #[cfg(feature = "enterprise")]
    async fn report_incident_created(&self, org_id: &str, incident_id: &str, timestamp: i64) {
        crate::self_reporting::report_request_usage_stats(
            config::meta::self_reporting::usage::RequestStats {
                records: 1,
                request_body: Some(serde_json::json!({"incident_id": incident_id}).to_string()),
                ..Default::default()
            },
            org_id,
            "",
            StreamType::Metadata,
            config::meta::self_reporting::usage::UsageType::NewIncident,
            0,
            timestamp,
        )
        .await;
    }

    #[cfg(feature = "enterprise")]
    async fn service_graph_edges(&self, org_id: &str) -> anyhow::Result<Vec<Value>> {
        Ok(
            crate::traces::service_graph::query_edges_from_stream_internal(
                org_id, None, None, None,
            )
            .await?,
        )
    }

    #[cfg(feature = "enterprise")]
    async fn sre_agent_credentials(&self, org_id: &str) -> anyhow::Result<(String, String)> {
        crate::organization::get_sre_agent_credentials(org_id).await
    }

    #[cfg(feature = "cloud")]
    async fn record_new_incident_ai_usage(&self, org_id: &str, incident_id: &str) {
        use crate::trial_quota::{AiUsageContext, TrialQuotaFeature};

        let deduction =
            crate::trial_quota::try_deduct(org_id, TrialQuotaFeature::NewIncident).await;
        let usage_ctx = AiUsageContext {
            user_email: "system@openobserve.ai".to_string(),
            incident_id: Some(incident_id.to_string()),
            ..Default::default()
        };
        if deduction.is_ok() {
            crate::trial_quota::record_free_ai_usage(
                org_id,
                &usage_ctx,
                TrialQuotaFeature::NewIncident,
            );
        } else if crate::trial_quota::org_has_active_subscription(org_id).await {
            crate::trial_quota::record_billable_ai_usage(
                org_id,
                &usage_ctx,
                TrialQuotaFeature::NewIncident,
            );
        }
    }

    #[cfg(feature = "cloud")]
    async fn allow_incident_reanalysis(
        &self,
        org_id: &str,
        user_email: &str,
        incident_id: &str,
    ) -> bool {
        use crate::trial_quota::{AiUsageContext, TrialQuotaFeature};

        let usage_ctx = AiUsageContext {
            user_email: user_email.to_string(),
            incident_id: Some(incident_id.to_string()),
            ..Default::default()
        };
        match crate::trial_quota::try_deduct(org_id, TrialQuotaFeature::IncidentReAnalysis).await {
            Ok(_) => {
                crate::trial_quota::record_free_ai_usage(
                    org_id,
                    &usage_ctx,
                    TrialQuotaFeature::IncidentReAnalysis,
                );
                true
            }
            Err(error) => {
                if crate::trial_quota::org_has_active_subscription(org_id).await {
                    crate::trial_quota::record_billable_ai_usage(
                        org_id,
                        &usage_ctx,
                        TrialQuotaFeature::IncidentReAnalysis,
                    );
                    true
                } else {
                    log::info!("[INCIDENTS::RCA] Skipping reanalysis for org {org_id}: {error}");
                    false
                }
            }
        }
    }
}

pub fn install_runtime_services() {
    let _ = openobserve_alerts::ports::install_runtime_services(Arc::new(CoreRuntimeServices));
}
