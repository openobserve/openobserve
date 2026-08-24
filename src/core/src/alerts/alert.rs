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

use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};

use async_trait::async_trait;
#[cfg(feature = "enterprise")]
use axum::http::HeaderMap;
use chrono::{Duration, Local, TimeZone, Timelike, Utc};
#[cfg(feature = "enterprise")]
use common::utils::http::get_or_create_trace_id;
use config::{
    SMTP_CLIENT, TIMESTAMP_COL_NAME, get_config,
    meta::{
        alerts::{
            FrequencyType, Operator, QueryType, TriggerEvalResults,
            alert::{Alert, AlertListFilter, ListAlertsParams, RowTemplateType},
        },
        destinations::{
            AwsSns, DestinationType, Email, Endpoint, HTTPType, Module, Template, TemplateKind,
            TemplateType,
        },
        folder::{DEFAULT_FOLDER, Folder, FolderType},
        search::{SearchEventContext, SearchEventType},
        sql::resolve_stream_names,
        stream::StreamType,
    },
    utils::{
        base64,
        json::{Map, Value},
    },
};
use cron::Schedule;
#[cfg(feature = "enterprise")]
use db::workflows::{AssociationDeleteEvent, WorkflowTriggerType};
use db::{
    self,
    authz::{remove_ownership, set_ownership},
    folders,
};
#[cfg(feature = "enterprise")]
use infra::table::workflows::WorkflowTriggerEntity;
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    schema::unwrap_stream_settings,
    table,
};
use itertools::Itertools;
use lettre::{
    AsyncTransport, Message,
    message::{Attachment, MultiPart, SinglePart},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::meta::{TriggerActionRequest, TriggerSource};
#[cfg(feature = "enterprise")]
use o2_openfga::{
    authorizer::authz::{get_ofga_type, remove_parent_relation, set_parent_relation},
    config::get_config as get_openfga_config,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use search::sql::RE_ONLY_SELECT;
use svix_ksuid::Ksuid;
#[cfg(feature = "enterprise")]
use tracing::{Level, span};

#[cfg(feature = "enterprise")]
use crate::auth::check_permissions;
use crate::{
    alerts::{
        QueryConditionExt, build_sql, destinations,
        notifications::{
            NotificationContext, RenderedMessage, apply_custom_template, build_row_columns, chart,
            custom::{VarValue, process_variable_replace},
            derive_channel_format,
            format::ChannelFormat,
            render,
            render::slack as slack_render,
            resolve_content,
        },
    },
    auth::is_ofga_unsupported,
    common::{infra::config::ORGANIZATIONS, meta::authz::Authz, utils::ssrf_guard::SsrfGuard},
    short_url,
};

/// Errors that can occur when interacting with alerts.
#[derive(Debug, thiserror::Error)]
pub enum AlertError {
    /// An error that occurs while interacting with the database through the
    /// [infra] crate.
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),

    #[error("Error creating default alerts folder")]
    CreateDefaultFolderError,

    #[error("Alert ID is required")]
    AlertIdMissing,

    #[error("Alert name is required")]
    AlertNameMissing,

    #[error("Alert name cannot contain ':', '#', '?', '&', '%', quotes and space characters")]
    AlertNameOfgaUnsupported,

    #[error("Alert name cannot contain '/'")]
    AlertNameContainsForwardSlash,

    #[error("Alert destination or workflows is required")]
    AlertDestinationMissing,

    /// The warning/critical pair is invalid for the chosen operator.
    /// "Less severe" is direction-dependent — see `level::validate_thresholds`.
    #[error("Invalid warning threshold: {0}")]
    InvalidWarningThreshold(config::meta::alerts::level::ThresholdError),

    /// Aggregation alerts carry their thresholds in `aggregation.having.value`
    /// / `aggregation.warning_value`, validated separately (§4.4).
    #[error("Invalid aggregation warning value: {0}")]
    InvalidAggregationThreshold(config::meta::alerts::aggregation_level::AggThresholdError),

    /// Per-group alerting (`multi_alert`) has its own admissibility rules —
    /// group_by, orderable operator, "any group" count gates, and the v1
    /// exclusions for incidents and multi-window comparison (alerts_2.md
    /// M-9/M-10, §5.5 MN-11).
    #[error("Invalid per-group alert configuration: {0}")]
    InvalidMultiAlert(config::meta::alerts::grouping::MultiAlertError),

    /// Realtime alerts are out of scope for multi-level thresholds (D12):
    /// they persist no state and never classify a level.
    #[error("Warning thresholds are not supported on real-time alerts")]
    WarningThresholdOnRealtimeAlert,

    /// A PromQL warning value without the condition it qualifies.
    #[error("A PromQL warning value requires a PromQL condition")]
    PromqlWarningWithoutCondition,

    /// A tag failed normalization (PT-7). The inner error names the offending
    /// tag so the user knows exactly which one to fix.
    #[error("Invalid tag: {0}")]
    InvalidTag(config::meta::alerts::tags::TagError),

    /// On aggregation and PromQL alerts, `trigger_condition.threshold` is a
    /// COVERAGE gate (group/series count), not severity — a warning there is
    /// explicitly disallowed (D13). Severity warnings belong to the family's
    /// own field: `aggregation.warning_value` / `promql_warning_value`.
    #[error(
        "warning_threshold is not supported on {family} alerts: the count threshold is coverage, not severity — use {field} instead"
    )]
    WarningOnCoverageGate {
        family: &'static str,
        field: &'static str,
    },

    #[error("Alert already exists")]
    CreateAlreadyExists,

    /// Error that occurs when trying to create an alert in a folder that cannot
    /// be found.
    #[error("Error creating alert in folder that cannot be found")]
    CreateFolderNotFound,

    /// Error that occurs when trying to move an alert to a destination folder
    /// that cannot be found.
    #[error("Error moving alert to folder that cannot be found")]
    MoveDestinationFolderNotFound,

    #[error("Alert not found")]
    AlertNotFound,

    #[error("Alert destination {dest} not found")]
    AlertDestinationNotFound { dest: String },

    #[error("Stream {stream_name} not found")]
    StreamNotFound { stream_name: String },

    /// Feature 5 (SA-3 … SA-19). Rendered from the inner error, which names
    /// its own bound so the 400 is actionable.
    #[error("{0}")]
    InvalidSloAlert(config::meta::slo::condition::SloAlertError),

    #[error("Error decoding vrl function for alert: {0}")]
    DecodeVrl(#[from] std::io::Error),

    #[error(transparent)]
    ParseCron(#[from] cron::error::Error),

    #[error("Realtime alert should use Custom query type")]
    RealtimeMissingCustomQuery,

    #[error("Alert with SQL mode should have a query")]
    SqlMissingQuery,

    #[error("Alert with SQL can not contain SELECT * in the SQL query")]
    SqlContainsSelectStar,

    #[error("Alert with PromQL mode should have a query")]
    PromqlMissingQuery,

    #[error("{error_message}")]
    SendNotificationError { error_message: String },

    #[error(transparent)]
    GetDestinationWithTemplateError(#[from] db::alerts::destinations::DestinationError),

    #[error(
        "No template configured for alert destination {dest}. Either set a template on the alert or on the destination."
    )]
    TemplateNotConfigured { dest: String },

    #[error("Alert template {template} not found")]
    AlertTemplateNotFound { template: String },

    #[error(
        "Alert period is greater than max query range of {max_query_range_hours} hours for stream \"{stream_name}\""
    )]
    PeriodExceedsMaxQueryRange {
        max_query_range_hours: i64,
        stream_name: String,
    },

    #[error("Error resolving stream names in SQL query: {0}")]
    ResolveStreamNameError(#[source] anyhow::Error),

    /// An error occurred trying to get the list of permitted alerts in
    /// enterprise mode because no user_id was provided.
    #[error("user_id required to get permitted alerts in enterprise mode")]
    PermittedAlertsMissingUser,

    /// An error occurred trying to get the list of permitted alerts in
    /// enterprise mode using the validator.
    #[error("PermittedAlertsValidator# {0}")]
    PermittedAlertsValidator(String),

    #[error("Permission denied")]
    PermissionDenied,

    #[error("User not found")]
    UserNotFound,

    /// Not support save destination remote pipeline for alert so far
    #[error("Not support save destination {0} type for alert so far")]
    NotSupportedAlertDestinationType(Module),

    #[error("Alert workflow {id} not found")]
    AlertWorkflowNotFound { id: String },

    /// S-16 PR 4. An SLO whose source alert vanished can only read no-data
    /// forever, which is a worse outcome than a refused delete — so the delete
    /// is refused, and the SLOs are named because "some SLO depends on this" is
    /// not something a user can act on.
    ///
    /// **User-initiated deletes only.** Org teardown removes SLOs before alerts
    /// (`org_cleanup::step_delete_db_resources`) and goes through the unguarded
    /// [`delete_by_id`], so an org deletion can never stall here.
    #[error(
        "this alert is the measurement source for {slos}; delete or repoint them before deleting it"
    )]
    AlertSourceOfSlos { slos: String },

    #[error("this alert is referenced by one or more composite alerts")]
    AlertReferencedByComposites {
        /// Captured while holding the organization graph lock. HTTP callers
        /// filter this snapshot through current folder RBAC before returning it.
        parents: Vec<CompositeParentReference>,
    },

    #[error("composite graph lock unavailable: {0}")]
    CompositeGraphLockUnavailable(String),

    /// S-16 PR 4. Save-time validation only holds at save time: an edit to the
    /// source alert can break the SLI's eligibility invariants (§5.1, §5.4)
    /// afterwards, with no signal, leaving the SLO frozen forever on a config
    /// that was valid when it was created. Refused for the same reason the
    /// delete is — allowing it and warning on the SLO page silently degrades
    /// the SLO.
    ///
    /// `breakages` pairs each SLO with **its own** reason rather than quoting
    /// one: the rules are measured against each SLO's `slice_interval_secs`, so
    /// a single edit can break a 60s SLO on cadence and a 300s one on silence,
    /// and a shared reason would name the wrong fix for one of them.
    #[error("this edit breaks the SLOs measuring from this alert — {breakages}")]
    AlertSourceEditBreaksSlos { breakages: String },
}

pub async fn save(
    org_id: &str,
    stream_name: &str,
    name: &str,
    mut alert: Alert,
    create: bool,
    overwrite: bool,
) -> Result<(), AlertError> {
    // Currently all alerts are stored in the default folder so create the
    // default folder for the org if it doesn't exist yet.
    if !table::folders::exists(org_id, DEFAULT_FOLDER, FolderType::Alerts).await? {
        create_default_alerts_folder(org_id).await?;
    };

    let slo_effect =
        prepare_alert(org_id, stream_name, name, &mut alert, create, overwrite).await?;

    // save the alert
    // TODO: Get the folder id
    match db::alerts::alert::set(org_id, alert, create).await {
        Ok(alert) => {
            if name.is_empty() {
                set_ownership(
                    org_id,
                    "alerts",
                    Authz {
                        obj_id: alert.id.unwrap().to_string(),
                        parent_type: "alert_folders".to_owned(),
                        parent: DEFAULT_FOLDER.to_owned(),
                    },
                )
                .await;
            }
            slo_effect.apply().await;
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// `pub(crate)` because SLOs live in these same folders (§6b, D28) and their
/// save path needs the identical create-on-demand behaviour.
pub(crate) async fn create_default_alerts_folder(org_id: &str) -> Result<Folder, AlertError> {
    let default_folder = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: "default".to_owned(),
        description: "default".to_owned(),
        icon: None,
    };
    folders::save_folder(org_id, default_folder, FolderType::Alerts, true)
        .await
        .map_err(|_| AlertError::CreateDefaultFolderError)
}

/// Per-group alerting admissibility (M-9/M-10, §5.5 MN-11).
///
/// A no-op for every alert that has not opted in — which is every alert that
/// predates the feature, since the flag cannot be present in JSON written
/// before it existed. Called from `prepare_alert`, so it runs on BOTH create
/// and update: removing the last `group_by` column from a multi-alert, or
/// turning on incidents, is rejected on the edit path too.
///
/// Extracted rather than inlined so the boundary tests can call **this exact
/// function**. Duplicating the call in a test helper would still compile after
/// the production call changed, leaving the tests quietly verifying something
/// else.
// Sync (unlike its async AlertError-returning neighbours, whose futures hide
// the size from this lint); boxing the error is not worth the churn here.
#[allow(clippy::result_large_err)]
fn validate_multi_alert_config(alert: &Alert) -> Result<(), AlertError> {
    config::meta::alerts::grouping::validate_multi_alert(
        &alert.query_condition,
        &alert.trigger_condition,
        alert.creates_incident,
    )
    .map_err(AlertError::InvalidMultiAlert)?;

    // Checked here, not in `validate_multi_alert`, because the grouping
    // config is a sibling of the query condition rather than part of it.
    // Same shape as MN-11's incidents rule.
    let notification_grouping = alert
        .deduplication
        .as_ref()
        .and_then(|d| d.grouping.as_ref())
        .is_some_and(|g| g.enabled);
    if alert.query_condition.multi_alert_enabled() && notification_grouping {
        return Err(AlertError::InvalidMultiAlert(
            config::meta::alerts::grouping::MultiAlertError::NotificationGroupingUnsupported,
        ));
    }
    Ok(())
}

/// Drop the per-group rows of an alert that is no longer a multi-alert (§5.3).
///
/// Runs **after** the row is committed, so the flag is durably off before the
/// rows go: an evaluation racing this cleanup is caught either by
/// `persist_group_plan`'s in-transaction re-check or, failing that, by the
/// reaper — which keys off the *existence* of non-rollup rows rather than the
/// current flag, precisely so rows orphaned by a crash between save and
/// cleanup are still collected.
///
/// Best-effort by design: the reaper is the backstop, so a failure here must
/// not fail the user's save. It is not, however, a substitute for this call —
/// the sweep can be turned off entirely (`ZO_ALERT_GROUP_SWEEP_INTERVAL=0`),
/// and rollback is supposed to be immediate.
async fn clean_up_opted_out_groups(alert: &Alert) {
    if alert.query_condition.multi_alert_enabled() {
        return;
    }
    let Some(alert_id) = alert.id.as_ref().map(|id| id.to_string()) else {
        return;
    };
    match db::alerts::alert_states::delete_all_groups(&alert_id).await {
        Ok(0) => {}
        Ok(n) => log::info!(
            "alert {alert_id}: per-group alerting turned off, dropped {n} group state row(s) \
             without transitions"
        ),
        Err(e) => log::error!(
            "alert {alert_id}: could not drop group state rows after opt-out, leaving them to the \
             reaper: {e}"
        ),
    }
}

/// What saving this alert does to the SLOs measuring from it: decided before
/// the write by [`prepare_alert`], applied after it by the caller.
///
/// Split in two on purpose. The refusals belong before the write, and the
/// generation bump belongs after it — a bump discards up to a window of
/// measurement, and a save that is then rejected downstream or fails outright
/// must not have discarded anything.
#[must_use = "the SLOs this save redefines have to be told once the alert is written"]
#[derive(Debug, Default)]
pub(crate) struct SloSourceEffect {
    org: String,
    /// SLO ids whose epoch this save ends, because the alert's condition moved
    /// and "good" now means something else (D59).
    redefined: Vec<String>,
}

impl SloSourceEffect {
    /// Best-effort, like the alert's own state and ledger teardown: the alert
    /// is already written by the time this runs, so a meta-DB blip here must
    /// not turn a saved alert into a 500.
    pub(crate) async fn apply(self) {
        if self.redefined.is_empty() {
            return;
        }
        crate::slo::service::redefine_for_source_alert(&self.org, &self.redefined).await;
    }
}

/// Validates the alert and prepares it before it is written to the database.
fn prepared_alert_name(route_name: &str, body_name: &str) -> String {
    let name = if body_name.trim().is_empty() {
        route_name
    } else {
        body_name
    };
    name.trim().to_string()
}

async fn prepare_alert(
    org_id: &str,
    stream_name: &str,
    route_name: &str,
    alert: &mut Alert,
    create: bool,
    overwrite: bool,
) -> Result<SloSourceEffect, AlertError> {
    alert.name = prepared_alert_name(route_name, &alert.name);

    // Don't allow the characters not supported by ofga
    if is_ofga_unsupported(&alert.name) {
        return Err(AlertError::AlertNameOfgaUnsupported);
    }
    alert.org_id = org_id.to_string();
    let stream_type = alert.stream_type;
    alert.stream_name = stream_name.to_string();
    alert.row_template = alert.row_template.trim().to_string();

    if alert.id.is_none() && !create {
        return Err(AlertError::AlertIdMissing);
    }

    // Kept for the SLO lifecycle at the end of this function: deciding whether
    // "good" changed needs the alert as it was, and this is the one read of it.
    let mut old_alert: Option<Alert> = None;
    if let Some(alert_id) = alert.id {
        match get_by_id_db(org_id, alert_id).await {
            Ok(existing) => {
                if create && !overwrite {
                    return Err(AlertError::CreateAlreadyExists);
                }
                alert.owner = existing.owner.clone();
                old_alert = Some(existing);
            }
            Err(AlertError::AlertNotFound) => {
                if !create {
                    return Err(AlertError::AlertNotFound);
                }
            }
            Err(e) => return Err(e),
        }
    }

    if alert.trigger_condition.frequency_type == FrequencyType::Cron {
        let now = Utc::now().second();
        alert.trigger_condition.cron = update_cron_expression(&alert.trigger_condition.cron, now);
        // Check the cron expression
        Schedule::from_str(&alert.trigger_condition.cron).map_err(AlertError::ParseCron)?;
    } else {
        // if cron is not empty, set it to empty string
        if !alert.trigger_condition.cron.is_empty() {
            alert.trigger_condition.cron = "".to_string();
        }
        if alert.trigger_condition.frequency == 0 {
            // default frequency is 60 seconds
            alert.trigger_condition.frequency =
                std::cmp::max(60, get_config().limit.alert_schedule_interval);
        }
    }

    // An SLO alert (§6b.6) runs no query and therefore has no stream. The
    // `stream_name` half of this check is skipped for it — note the two are
    // conflated under `AlertNameMissing`, so without this an SLO alert is
    // rejected with "Alert name is required" while carrying a perfectly good
    // name, which is what live testing hit.
    let is_slo_alert = alert.query_condition.query_type == QueryType::Slo;
    if alert.name.is_empty() || (!is_slo_alert && alert.stream_name.is_empty()) {
        return Err(AlertError::AlertNameMissing);
    }
    if alert.name.contains('/') {
        return Err(AlertError::AlertNameContainsForwardSlash);
    }

    if let Some(vrl) = alert.query_condition.vrl_function.as_ref() {
        match base64::decode_url(vrl) {
            Ok(vrl) => {
                let vrl = vrl.trim().to_owned();
                if !vrl.is_empty() && !vrl.ends_with('.') {
                    let vrl = base64::encode_url(&format!("{vrl}\n."));
                    alert.query_condition.vrl_function = Some(vrl);
                } else if vrl.is_empty() || vrl.eq(".") {
                    // In case the vrl contains only ".", no need to save it
                    alert.query_condition.vrl_function = None;
                }
            }
            Err(e) => {
                return Err(AlertError::DecodeVrl(e));
            }
        }
    }

    // Validate alert-level template if specified
    if let Some(ref template_name) = alert.template
        && !template_name.is_empty()
        && db::alerts::templates::get(org_id, template_name)
            .await
            .is_err()
    {
        return Err(AlertError::AlertTemplateNotFound {
            template: template_name.clone(),
        });
    }

    #[cfg(feature = "enterprise")]
    let destination_missing = alert.destinations.is_empty() && alert.workflows.is_empty();
    #[cfg(not(feature = "enterprise"))]
    let destination_missing = alert.destinations.is_empty();

    // before saving alert check alert destination
    if destination_missing {
        return Err(AlertError::AlertDestinationMissing);
    }
    for dest in alert.destinations.iter() {
        match db::alerts::destinations::get(org_id, dest).await {
            Ok(d) => {
                if !d.is_alert_destinations() {
                    return Err(AlertError::NotSupportedAlertDestinationType(d.module));
                }
            }
            Err(_) => {
                return Err(AlertError::AlertDestinationNotFound {
                    dest: dest.to_string(),
                });
            }
        }
    }

    #[cfg(feature = "enterprise")]
    for workflow in alert.workflows.iter() {
        match crate::workflows::get_workflow_by_id(org_id, workflow).await {
            Ok(None) => {
                return Err(AlertError::AlertWorkflowNotFound {
                    id: workflow.to_owned(),
                });
            }
            Ok(Some(_)) => {}
            Err(e) => {
                return Err(AlertError::InfraError(infra::errors::Error::OtherError(e)));
            }
        }
    }

    // before saving alert check alert context attributes
    if alert.context_attributes.is_some() {
        let attrs = alert.context_attributes.as_ref().unwrap();
        let mut new_attrs = hashbrown::HashMap::with_capacity(attrs.len());
        for key in attrs.keys() {
            let new_key = key.trim().to_string();
            if !new_key.is_empty() {
                new_attrs.insert(new_key, attrs.get(key).unwrap().to_string());
            }
        }
        alert.context_attributes = Some(new_attrs);
    }

    // Tags are normalized at save (PT-7), NOT merely validated: the repaired
    // form (trimmed, lowercased, deduped) is what gets stored, so filtering
    // compares like with like. Rejections name the offending tag.
    alert.tags =
        config::meta::alerts::tags::normalize_tags(&alert.tags).map_err(AlertError::InvalidTag)?;

    // Feature 5: the SLO wiring, including the `query_type == Slo` ⇔
    // `slo_condition.is_some()` invariant in both directions.
    validate_slo_alert_wiring(org_id, alert, create).await?;

    // An SLO alert runs NO query, so it has no stream to resolve a schema for
    // and no period to measure against `max_query_range`. Requiring either
    // would make every SLO alert unsavable. Only this block is skipped —
    // everything after it still applies, notably the realtime rejection: an
    // SLO alert is not `Custom`, so a realtime one is refused exactly as any
    // other non-Custom realtime alert is.
    if !is_slo_alert {
        // before saving alert check column type to decide numeric condition
        let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
        if stream_name.is_empty() || schema.fields().is_empty() {
            return Err(AlertError::StreamNotFound {
                stream_name: stream_name.to_owned(),
            });
        }

        // Alerts must follow the max_query_range of the stream as set in the schema
        if let Some(settings) = unwrap_stream_settings(&schema) {
            let max_query_range = settings.max_query_range;
            if max_query_range > 0
                && !alert.is_real_time
                && alert.trigger_condition.period > max_query_range * 60
            {
                return Err(AlertError::PeriodExceedsMaxQueryRange {
                    max_query_range_hours: max_query_range,
                    stream_name: stream_name.to_owned(),
                });
            }
        }
    }

    if alert.is_real_time && alert.query_condition.query_type != QueryType::Custom {
        return Err(AlertError::RealtimeMissingCustomQuery);
    }

    // Multi-level thresholds (alerts_2.md Feature 1). Rejected at write time so
    // an unreachable warning level can never reach the evaluator.
    //
    // Realtime alerts persist no state and never classify a level (D12), so
    // EVERY warning family is rejected on them — not just the count one.
    if alert.is_real_time
        && (alert.trigger_condition.warning_threshold.is_some()
            || alert
                .query_condition
                .aggregation
                .as_ref()
                .is_some_and(|a| a.warning_value.is_some())
            || alert.query_condition.promql_warning_value.is_some())
    {
        return Err(AlertError::WarningThresholdOnRealtimeAlert);
    }
    if alert.trigger_condition.warning_threshold.is_some() {
        // On aggregation/PromQL alerts the count threshold is a COVERAGE gate
        // (group/series count), and a coverage warning is disallowed (D13).
        if alert.query_condition.aggregation.is_some() {
            return Err(AlertError::WarningOnCoverageGate {
                family: "aggregation",
                field: "aggregation.warning_value",
            });
        }
        if alert.query_condition.promql_condition.is_some()
            || alert.query_condition.query_type == QueryType::PromQL
        {
            return Err(AlertError::WarningOnCoverageGate {
                family: "PromQL",
                field: "promql_warning_value",
            });
        }
        config::meta::alerts::level::validate_thresholds(
            alert.trigger_condition.operator,
            alert.trigger_condition.threshold,
            alert.trigger_condition.warning_threshold,
        )
        .map_err(AlertError::InvalidWarningThreshold)?;
    }

    // Aggregation alerts use a different threshold pair entirely (§4.4): the
    // critical value lives in `having.value` and the warning in
    // `warning_value`. Validate whenever an aggregation is present, so a
    // non-numeric `having.value` is caught at write time rather than failing
    // every evaluation.
    if let Some(agg) = alert.query_condition.aggregation.as_ref() {
        config::meta::alerts::aggregation_level::validate_aggregation_thresholds(agg)
            .map_err(AlertError::InvalidAggregationThreshold)?;
    }

    validate_multi_alert_config(alert)?;

    // PromQL carries a third threshold family: the condition value baked into
    // the query. Its warning needs the same §4.5 direction check, measured
    // against `promql_condition.operator`.
    if let Some(warning) = alert.query_condition.promql_warning_value {
        let Some(pc) = alert.query_condition.promql_condition.as_ref() else {
            return Err(AlertError::PromqlWarningWithoutCondition);
        };
        let critical = config::utils::json::get_float_value(&pc.value);
        config::meta::alerts::level::validate_thresholds_f64(pc.operator, critical, Some(warning))
            .map_err(AlertError::InvalidWarningThreshold)?;
    }

    match alert.query_condition.query_type {
        QueryType::SQL => {
            if alert.query_condition.sql.is_none()
                || alert.query_condition.sql.as_ref().unwrap().is_empty()
            {
                return Err(AlertError::SqlMissingQuery);
            }
            if alert.query_condition.sql.is_some()
                && RE_ONLY_SELECT.is_match(alert.query_condition.sql.as_ref().unwrap())
            {
                return Err(AlertError::SqlContainsSelectStar);
            }

            let sql = alert.query_condition.sql.as_ref().unwrap();
            let stream_names = match resolve_stream_names(sql) {
                Ok(stream_names) => stream_names,
                Err(e) => {
                    return Err(AlertError::ResolveStreamNameError(e));
                }
            };

            // SQL may contain multiple stream names, check for each stream
            // if the alert period is greater than the max query range
            for stream in stream_names.iter() {
                if !stream.eq(stream_name)
                    && let Some(settings) =
                        infra::schema::get_settings(org_id, stream, stream_type).await
                {
                    let max_query_range = settings.max_query_range;
                    if max_query_range > 0
                        && !alert.is_real_time
                        && alert.trigger_condition.period > max_query_range * 60
                    {
                        return Err(AlertError::PeriodExceedsMaxQueryRange {
                            max_query_range_hours: max_query_range,
                            stream_name: stream_name.to_owned(),
                        });
                    }
                }
            }
        }
        QueryType::PromQL
            if (alert.query_condition.promql.is_none()
                || alert.query_condition.promql.as_ref().unwrap().is_empty()
                || alert.query_condition.promql_condition.is_none()) =>
        {
            return Err(AlertError::PromqlMissingQuery);
        }
        _ => {}
    }

    // Commented intentionally - in case the alert period is big and there
    // is huge amount of data within the time period, the below can timeout and return error.
    // // test the alert
    // if let Err(e) = &alert.evaluate(None).await {
    //     return Err(anyhow::anyhow!("Alert test failed: {}", e));
    // }

    // S-16 PR 4, last because the alert is only now in the shape the SLOs
    // measuring from it will actually read — `frequency` in particular is
    // defaulted above, and judging the pre-normalized value would refuse a
    // cadence the scheduler never runs. This is the one choke point `save`,
    // `create` and `update` all pass through, so a fourth write path added
    // later inherits the guard rather than forgetting it.
    let Some(alert_id) = alert.id else {
        return Ok(SloSourceEffect::default());
    };
    let dependents = crate::slo::service::slos_sourced_from_alert(org_id, &alert_id.to_string())
        .await
        .map_err(|e| AlertError::InfraError(infra::errors::Error::Message(e.to_string())))?;
    if dependents.is_empty() {
        return Ok(SloSourceEffect::default());
    }
    if let Some(refusal) = edit_blocked_by(alert, &dependents) {
        return Err(refusal);
    }
    Ok(SloSourceEffect {
        org: org_id.to_string(),
        redefined: slos_redefined_by(old_alert.as_ref(), alert, &dependents),
    })
}

#[cfg(test)]
mod prepare_alert_name_tests {
    use super::prepared_alert_name;

    #[test]
    fn a_put_body_can_rename_an_alert() {
        assert_eq!(prepared_alert_name("old-name", "new-name"), "new-name");
    }

    #[test]
    fn the_route_name_remains_a_fallback_for_legacy_bodies() {
        assert_eq!(prepared_alert_name("old-name", "  "), "old-name");
    }
}

pub fn update_cron_expression(cron_exp: &str, now: u32) -> String {
    let mut cron_exp = cron_exp.trim().to_owned();
    if cron_exp.starts_with("*") {
        let (_, rest) = cron_exp.split_once("*").unwrap();
        let rest = rest.trim();
        cron_exp = format!("{now} {rest}");
    }
    cron_exp
}

/// Creates a new alert in the specified folder.
pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    mut alert: Alert,
    overwrite: bool,
) -> Result<Alert, AlertError> {
    if !table::folders::exists(org_id, folder_id, FolderType::Alerts).await? {
        if folder_id == DEFAULT_FOLDER {
            create_default_alerts_folder(org_id).await?;
        } else {
            return Err(AlertError::CreateFolderNotFound);
        }
    }

    let alert_name = alert.name.clone();
    let stream_name = alert.stream_name.clone();
    let slo_effect = prepare_alert(
        org_id,
        &stream_name,
        &alert_name,
        &mut alert,
        true,
        overwrite,
    )
    .await?;

    let alert = db::alerts::alert::create(conn, org_id, folder_id, alert, overwrite).await?;
    slo_effect.apply().await;

    set_ownership(
        org_id,
        "alerts",
        Authz {
            obj_id: alert.id.unwrap().to_string(),
            parent_type: "alert_folders".to_owned(),
            parent: folder_id.to_owned(),
        },
    )
    .await;
    Ok(alert)
}

/// Moves the alerts into the specified destination folder.
pub async fn move_to_folder<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    alert_ids: &[Ksuid],
    dst_folder_id: &str,
    _user_id: &str,
) -> Result<(), AlertError> {
    for alert_id in alert_ids {
        let _alert_id_str = alert_id.to_string();

        let Some((curr_folder, alert)) =
            db::alerts::alert::get_by_id(conn, org_id, *alert_id).await?
        else {
            return Err(AlertError::AlertNotFound);
        };

        #[cfg(feature = "enterprise")]
        if get_openfga_config().enabled {
            // TODO: Try to make a single call for all alerts
            if !check_permissions(
                &_alert_id_str,
                org_id,
                _user_id,
                "alerts",
                "PUT",
                Some(&curr_folder.folder_id),
                false,
                true,
                false,
            )
            .await
            {
                return Err(AlertError::PermissionDenied);
            }
        }

        update(
            conn,
            org_id,
            Some((&curr_folder.folder_id, dst_folder_id)),
            alert,
        )
        .await?;

        #[cfg(feature = "enterprise")]
        if get_openfga_config().enabled {
            set_parent_relation(
                &_alert_id_str,
                &get_ofga_type("alerts"),
                dst_folder_id,
                &get_ofga_type("alert_folders"),
            )
            .await;
            remove_parent_relation(
                &_alert_id_str,
                &get_ofga_type("alerts"),
                &curr_folder.folder_id,
                &get_ofga_type("alert_folders"),
            )
            .await;
        }
    }
    Ok(())
}

/// Updates the alert.
///
/// Updates the alert's parent folder if a `folder_id` is given.
pub async fn update<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: Option<(&str, &str)>,
    mut alert: Alert,
) -> Result<Alert, AlertError> {
    let mut dst_folder_id_info = None;
    let _folder_info = if let Some((curr_folder_id, dst_folder_id)) = folder_id {
        // Ensure that the destination folder exists.
        if !table::folders::exists(org_id, dst_folder_id, FolderType::Alerts).await? {
            if dst_folder_id == DEFAULT_FOLDER {
                create_default_alerts_folder(org_id).await?;
            } else {
                return Err(AlertError::MoveDestinationFolderNotFound);
            }
        }
        dst_folder_id_info = Some(dst_folder_id);
        Some((curr_folder_id, dst_folder_id))
    } else {
        None
    };

    let alert_name = alert.name.clone();
    let stream_name = alert.stream_name.clone();

    let slo_effect =
        prepare_alert(org_id, &stream_name, &alert_name, &mut alert, false, false).await?;

    #[cfg(feature = "enterprise")]
    if let Some(ref id) = alert.id {
        let (_, old_alert) = get_by_id(conn, org_id, id.to_owned()).await?;
        let old_workflows = old_alert.workflows;

        if old_workflows != alert.workflows {
            let mut removed = Vec::new();
            let mut added = Vec::new();
            for w in &old_workflows {
                if !alert.workflows.contains(w) {
                    removed.push(w.clone());
                }
            }
            for w in &alert.workflows {
                if !old_workflows.contains(w) {
                    added.push(w.clone());
                }
            }

            for r in removed {
                if let Err(e) =
                    db::workflows::delete_workflow_association(AssociationDeleteEvent::Specific {
                        org_id: org_id.to_string(),
                        entity_id: id.to_string(),
                        workflow_id: r.clone(),
                    })
                    .await
                {
                    log::error!(
                        "error updating workflow association for alert update : error removing old workflow association of {org_id}/{r} for alert {} : {e}",
                        id
                    );
                }
            }

            for a in added {
                if let Err(e) = db::workflows::associate_workflow(
                    org_id,
                    &a,
                    &id.to_string(),
                    WorkflowTriggerEntity::Alert.to_string(),
                    WorkflowTriggerType::AlertFired.to_string(),
                )
                .await
                {
                    log::error!(
                        "error updating workflow association for alert update : error adding new workflow association of {org_id}/{a} for alert {} : {e}",
                        id
                    );
                }
            }
        }
    }

    let alert = db::alerts::alert::update(conn, org_id, dst_folder_id_info, alert).await?;
    slo_effect.apply().await;
    clean_up_opted_out_groups(&alert).await;
    #[cfg(feature = "enterprise")]
    if let Some((curr_folder_id, dst_folder_id)) = _folder_info
        && get_openfga_config().enabled
    {
        let alert_id = alert.id.unwrap().to_string();
        set_parent_relation(
            &alert_id,
            &get_ofga_type("alerts"),
            dst_folder_id,
            &get_ofga_type("alert_folders"),
        )
        .await;
        remove_parent_relation(
            &alert_id,
            &get_ofga_type("alerts"),
            curr_folder_id,
            &get_ofga_type("alert_folders"),
        )
        .await;
    }
    Ok(alert)
}

/// Gets the alert by its KSUID primary key.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(Folder, Alert), AlertError> {
    match db::alerts::alert::get_by_id(conn, org_id, alert_id).await? {
        Some(f_a) => Ok(f_a),
        None => Err(AlertError::AlertNotFound),
    }
}

pub async fn get_by_id_db(org_id: &str, alert_id: Ksuid) -> Result<Alert, AlertError> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    get_by_id(conn, org_id, alert_id).await.map(|f_a| f_a.1)
}

pub async fn get_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<Option<Alert>, AlertError> {
    let alert = db::alerts::alert::get_by_name(org_id, stream_type, stream_name, name).await?;
    Ok(alert)
}

pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
    permitted: Option<Vec<String>>,
    filter: AlertListFilter,
) -> Result<Vec<Alert>, AlertError> {
    match db::alerts::alert::list(org_id, stream_type, stream_name).await {
        Ok(alerts) => {
            let owner = filter.owner;
            let enabled = filter.enabled;
            let mut result = Vec::new();
            for alert in alerts {
                if permitted.is_none()
                    || permitted
                        .as_ref()
                        .unwrap()
                        .contains(&format!("alert:{}", alert.name))
                    || permitted
                        .as_ref()
                        .unwrap()
                        .contains(&format!("alert:_all_{org_id}"))
                {
                    if owner.is_some() && !owner.eq(&alert.owner) {
                        continue;
                    }
                    if enabled.is_some() && enabled.unwrap() != alert.enabled {
                        continue;
                    }
                    result.push(alert);
                }
            }
            Ok(result)
        }
        Err(e) => Err(e.into()),
    }
}

/// Gets a list of alerts from the database `ORM_CLIENT`.
pub async fn list_with_folders_db(
    params: ListAlertsParams,
) -> Result<Vec<(Folder, Alert)>, AlertError> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    db::alerts::alert::list_with_folders(conn, params)
        .await
        .map_err(|e| e.into())
}
/// Gets a list of alerts.
pub async fn list_v2<C: ConnectionTrait>(
    conn: &C,
    user_id: Option<&str>,
    params: ListAlertsParams,
) -> Result<Vec<(Folder, Alert)>, AlertError> {
    let (permissions, is_all_permitted) =
        match permitted_alerts(&params.org_id, user_id, params.folder_id.as_deref()).await? {
            Some(ps) => {
                let org_all_permitted = ps.contains(&format!("alert:_all_{}", params.org_id));
                (ps, org_all_permitted)
            }
            None => (vec![], true),
        };

    let alerts = db::alerts::alert::list_with_folders(conn, params)
        .await?
        .into_iter()
        .filter(|(f, a)| {
            // Include the alert if all alerts are permitted.
            is_all_permitted
                // Include the alert if the alert is permitted with the old OpenFGA identifier.
                || permissions.contains(&format!("alert:{}", a.name))
                || permissions.contains(&format!("alert:{}/{}", f.folder_id, a.id.as_ref().unwrap()))
                // Include the alert if the alert is permitted with the new OpenFGA identifier.
                || a.id
                    .is_some_and(|id| permissions.contains(&format!("alert:{id}")))
        })
        .collect_vec();
    Ok(alerts)
}

/// Deletes an alert by its KSUID primary key, unconditionally.
///
/// `pub(crate)` since S-16 PR 4, and that is the enforcement rather than a
/// convention: the two lifecycle-owned callers inside this crate — org teardown
/// and the SLO's own alert cascade — must NOT be stopped by the dependent-SLO
/// guard, while every caller outside it must be. Making the unguarded primitive
/// unreachable from the API crate turns "which one did the handler call" from a
/// review item into a compile error. Deletes by id on a user's behalf go through
/// [`delete_by_id_user`].
pub(crate) async fn delete_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(), AlertError> {
    if db::alerts::alert::get_by_id(conn, org_id, alert_id)
        .await?
        .is_none()
    {
        return Ok(());
    };

    let alert_id_str = alert_id.to_string();
    match db::alerts::alert::delete_by_id(conn, org_id, alert_id).await {
        Ok(_) => {
            remove_ownership(org_id, "alerts", Authz::new(&alert_id_str)).await;
            // Alert run state is owned by the alert's lifecycle (Part IV of
            // alerts.md), so it goes when the alert does. Best-effort: a
            // leftover state row must not fail the delete.
            if let Err(e) = db::alerts::alert_states::delete_by_alert(&alert_id_str).await {
                log::warn!("failed to delete alert state for {alert_id_str}: {e}");
            }
            // The availability ledger (S-16) is owned by the same lifecycle, so
            // org deletion inherits it through `delete_org_alerts` with no
            // dedicated cleanup step. Written straight to `infra`, unlike its
            // neighbour above, because the other regions are already told by
            // that call's `DeleteByAlert` message — which drops the ledger too.
            // Best-effort for the same reason: a stranded interval is retention's
            // problem, not a reason to fail the delete.
            if let Err(e) = infra::table::alert_eval_intervals::delete_by_alert(&alert_id_str).await
            {
                log::warn!("failed to delete alert eval ledger for {alert_id_str}: {e}");
            }
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// Delete an alert **on a user's behalf**, refusing while an SLO measures from
/// it (S-16 PR 4). Disabled SLOs count: a paused SLO measures from that source
/// again the moment it resumes, and by then the source would be gone.
///
/// Deliberately a wrapper rather than a check inside [`delete_by_id`]: org
/// teardown is the one explicit bypass and deletes the entire composite graph
/// before ordinary alerts. SLO and stream cascades use
/// [`delete_many_for_cascade`], which applies the composite-reference guard to
/// the complete target set without applying the dependent-SLO guard.
pub async fn delete_by_id_user<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(), AlertError> {
    let locker = lock_composite_graph(org_id).await?;
    let result = async {
        ensure_alerts_not_referenced(conn, org_id, &[alert_id]).await?;
        let dependents =
            crate::slo::service::slos_sourced_from_alert(org_id, &alert_id.to_string())
                .await
                .map_err(|e| {
                    AlertError::InfraError(infra::errors::Error::Message(e.to_string()))
                })?;
        if let Some(refusal) = delete_blocked_by(&dependents) {
            return Err(refusal);
        }
        delete_by_id(conn, org_id, alert_id).await
    }
    .await;
    finish_graph_locked(result, locker).await
}

/// A readable parent snapshot captured by the guarded-delete service.
///
/// Keeping IDs and folders here (instead of formatting only names into the
/// error string) lets the HTTP boundary reveal only parents the caller may
/// currently read and report the rest as a hidden count.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompositeParentReference {
    pub alert_id: String,
    pub name: String,
    pub folder_id: String,
}

/// Delete every ordinary-alert member of an internal cascade.
///
/// All reverse-reference checks happen while holding the same graph lock used
/// by composite mutations, and every target is checked before the first delete.
/// This is intentionally distinct from [`delete_by_id_user`]: an SLO deleting
/// its generated alerts and a stream deleting its alerts must not trip the
/// dependent-SLO guard, but they must honor composite references.
pub(crate) async fn delete_many_for_cascade<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_ids: &[Ksuid],
) -> Result<(), AlertError> {
    if alert_ids.is_empty() {
        return Ok(());
    }
    let locker = lock_composite_graph(org_id).await?;
    let result = async {
        ensure_alerts_not_referenced(conn, org_id, alert_ids).await?;
        for alert_id in alert_ids {
            delete_by_id(conn, org_id, *alert_id).await?;
        }
        Ok(())
    }
    .await;
    finish_graph_locked(result, locker).await
}

async fn lock_composite_graph(
    org_id: &str,
) -> Result<super::composite_graph_lock::CompositeGraphGuard, AlertError> {
    super::composite_graph_lock::lock(org_id)
        .await
        .map_err(|error| AlertError::CompositeGraphLockUnavailable(error.to_string()))
}

async fn finish_graph_locked<T>(
    result: Result<T, AlertError>,
    locker: super::composite_graph_lock::CompositeGraphGuard,
) -> Result<T, AlertError> {
    let unlock = locker
        .release()
        .await
        .map_err(|error| AlertError::CompositeGraphLockUnavailable(error.to_string()));
    match result {
        Ok(value) => {
            unlock?;
            Ok(value)
        }
        Err(error) => {
            if let Err(unlock_error) = unlock {
                log::error!(
                    "failed to release composite graph lock after delete refusal: {unlock_error}"
                );
            }
            Err(error)
        }
    }
}

async fn ensure_alerts_not_referenced<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_ids: &[Ksuid],
) -> Result<(), AlertError> {
    let mut parents = Vec::new();
    for alert_id in alert_ids {
        parents.extend(
            infra::table::alert_composites::list_parents(
                conn,
                org_id,
                infra::table::alert_composites::ChildKind::Alert,
                &alert_id.to_string(),
            )
            .await
            .map_err(|error| {
                AlertError::InfraError(infra::errors::Error::Message(error.to_string()))
            })?,
        );
    }
    if parents.is_empty() {
        return Ok(());
    }
    parents.sort_by(|left, right| left.id.cmp(&right.id));
    parents.dedup_by(|left, right| left.id == right.id);
    Err(AlertError::AlertReferencedByComposites {
        parents: parents
            .into_iter()
            .map(|parent| CompositeParentReference {
                alert_id: parent.id,
                name: parent.name,
                folder_id: parent.folder_id,
            })
            .collect(),
    })
}

/// The refusal a delete owes the SLOs measuring from this alert, or `None` when
/// nothing does.
fn delete_blocked_by(dependents: &[config::meta::slo::Slo]) -> Option<AlertError> {
    if dependents.is_empty() {
        return None;
    }
    Some(AlertError::AlertSourceOfSlos {
        slos: name_list(dependents.iter().map(|s| s.name.as_str())),
    })
}

/// The refusal a save owes those SLOs, or `None` when the saved alert stays a
/// legal source for every one of them.
///
/// Each SLO is judged against **its own** `slice_interval_secs`: a 300s SLO
/// tolerates a cadence a 60s SLO does not, so one shared verdict would refuse
/// edits that are fine.
///
/// Judged on the alert as it will be AFTER the save, not on the delta. The two
/// coincide for every edit that starts from a legal source, and the post-state
/// form has the property that matters: no sequence of saves can leave a live
/// SLO pointing at an ineligible one. It also keeps the escape open — the edit
/// that repairs the source passes, because the repaired source is eligible.
fn edit_blocked_by(alert: &Alert, dependents: &[config::meta::slo::Slo]) -> Option<AlertError> {
    let breakages: Vec<String> = dependents
        .iter()
        .filter_map(|slo| {
            crate::slo::service::source_alert_edit_breakage(
                alert,
                slo.definition.slice_interval_secs,
            )
            .map(|why| format!("\"{}\": {why}", slo.name))
        })
        .collect();
    if breakages.is_empty() {
        return None;
    }
    Some(AlertError::AlertSourceEditBreaksSlos {
        breakages: breakages.join("; "),
    })
}

/// The SLOs whose epoch this edit ends, by id (D59).
fn slos_redefined_by(
    old_alert: Option<&Alert>,
    alert: &Alert,
    dependents: &[config::meta::slo::Slo],
) -> Vec<String> {
    let Some(old) = old_alert else {
        return Vec::new();
    };
    if !crate::slo::service::source_alert_condition_changed(old, alert) {
        return Vec::new();
    }
    dependents.iter().map(|slo| slo.id.clone()).collect()
}

fn name_list<'a>(names: impl Iterator<Item = &'a str>) -> String {
    names
        .map(|n| format!("\"{n}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod slo_source_guard_tests {
    use config::meta::{
        alerts::{FrequencyType, Operator, QueryCondition, QueryType, TriggerCondition},
        slo::{SliConfig, Slo, SloDefinition},
    };

    use super::*;

    fn source_alert() -> Alert {
        let mut alert = Alert::default();
        alert.name = "checkout latency".into();
        alert.trigger_condition = TriggerCondition {
            period: 10,
            operator: Operator::GreaterThanEquals,
            threshold: 3,
            frequency: 60,
            frequency_type: FrequencyType::Minutes,
            silence: 0,
            ..Default::default()
        };
        alert.query_condition = QueryCondition {
            query_type: QueryType::SQL,
            sql: Some("SELECT count(*) FROM requests WHERE status >= 500".into()),
            ..Default::default()
        };
        alert
    }

    fn dependent(id: &str, name: &str, slice_interval_secs: i64) -> Slo {
        Slo {
            id: id.into(),
            org: "acme".into(),
            folder_id: "default".into(),
            name: name.into(),
            description: String::new(),
            definition: SloDefinition {
                sli_config: SliConfig::Alert {
                    alert_id: "2abcdefghijklmnopqrstuvwxyz".into(),
                },
                group_by: None,
                window_secs: 30 * 86_400,
                slice_interval_secs,
            },
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        }
    }

    // ---- the delete guard ---------------------------------------------------

    /// "Some SLO depends on this" is not something a user can act on, so the
    /// refusal names them.
    #[test]
    fn a_refused_delete_names_every_dependent_slo() {
        let deps = [
            dependent("s1", "checkout availability", 60),
            dependent("s2", "search availability", 300),
        ];
        let err = delete_blocked_by(&deps).expect("a dependent SLO must block the delete");
        let msg = err.to_string();
        assert!(msg.contains("checkout availability"), "{msg}");
        assert!(msg.contains("search availability"), "{msg}");
        assert!(matches!(err, AlertError::AlertSourceOfSlos { .. }));
    }

    #[test]
    fn an_alert_nothing_measures_from_deletes_freely() {
        assert!(delete_blocked_by(&[]).is_none());
    }

    /// A paused SLO counts for everything a running one does: it measures from
    /// that source the moment it resumes, and its source would be gone. The
    /// lookup that feeds these functions deliberately includes disabled rows
    /// (`slos::list_by_source_alert`), so none of them may filter them out
    /// again.
    #[test]
    fn a_disabled_dependent_still_blocks_and_still_redefines() {
        let mut paused = dependent("s1", "paused availability", 300);
        paused.enabled = false;
        let deps = [paused];

        assert!(delete_blocked_by(&deps).is_some());

        let mut breaking = source_alert();
        breaking.trigger_condition.silence = 10;
        assert!(edit_blocked_by(&breaking, &deps).is_some());

        let before = source_alert();
        let mut after = before.clone();
        after.trigger_condition.threshold = 9;
        assert_eq!(slos_redefined_by(Some(&before), &after, &deps), ["s1"]);
    }

    /// An SLO whose source vanished can only read no-data forever, so the
    /// refusal is a 409 — the request conflicts with state that exists, not a
    /// malformed one.
    #[test]
    fn the_delete_refusal_is_a_conflict() {
        let err = delete_blocked_by(&[dependent("s1", "checkout availability", 60)]).unwrap();
        let response: axum::response::Response = err.into();
        assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
    }

    // ---- the edit guard -----------------------------------------------------

    /// The three edits of PR 4's third bullet, each refused with the shared
    /// rule set's own reason so the message names what to undo.
    #[test]
    fn each_eligibility_breaking_edit_is_refused_by_name() {
        let deps = [dependent("s1", "checkout availability", 300)];

        let too_slow = {
            let mut a = source_alert();
            a.trigger_condition.frequency = 600;
            a
        };
        let cron = {
            let mut a = source_alert();
            a.trigger_condition.frequency_type = FrequencyType::Cron;
            a.trigger_condition.cron = "0 9 * * 1-5".into();
            a
        };
        let silenced = {
            let mut a = source_alert();
            a.trigger_condition.silence = 10;
            a
        };
        // The fourth breaking edit — dropping the warning threshold from a
        // silence-carrying source — reaches this function as the same
        // post-state as `silenced`, so it is pinned where the two states
        // differ: `slo::service::source_alert_edit_breakage`.
        for (label, alert, reason) in [
            ("cadence raised past the slice", too_slow, "cadence is 600s"),
            ("switched to cron", cron, "cron-scheduled alert"),
            ("silence raised from 0", silenced, "silences for 10 minutes"),
        ] {
            let err =
                edit_blocked_by(&alert, &deps).unwrap_or_else(|| panic!("{label} must be refused"));
            let msg = err.to_string();
            assert!(
                msg.contains("checkout availability"),
                "{label}: the refusal must name the SLO: {msg}"
            );
            // The shared rule set's own wording, so the message names the
            // remedy rather than restating the refusal.
            assert!(msg.contains(reason), "{label}: {msg}");
            assert!(matches!(err, AlertError::AlertSourceEditBreaksSlos { .. }));
        }
    }

    /// The common path. A guard that refuses renames is a guard nobody can
    /// live with — and a condition edit is handled by a generation bump, not a
    /// refusal.
    #[test]
    fn an_edit_that_breaks_no_invariant_passes_cleanly() {
        let deps = [dependent("s1", "checkout availability", 300)];
        let mut a = source_alert();
        a.name = "checkout latency (p99)".into();
        a.description = "runbook: go/checkout".into();
        a.trigger_condition.threshold = 9;
        a.query_condition.sql = Some("SELECT count(*) FROM requests WHERE status = 503".into());
        assert!(edit_blocked_by(&a, &deps).is_none());
    }

    /// No dependents, no guard: an ordinary alert must stay editable into any
    /// shape at all, including the ones an SLI could never read.
    #[test]
    fn an_alert_nothing_measures_from_edits_freely() {
        let mut a = source_alert();
        a.trigger_condition.frequency_type = FrequencyType::Cron;
        a.trigger_condition.silence = 30;
        assert!(edit_blocked_by(&a, &[]).is_none());
    }

    /// Judged per SLO against its own slice: the 300s SLO tolerates the new
    /// cadence, the 60s one does not, and only the one actually broken is
    /// named.
    #[test]
    fn only_the_slos_the_edit_actually_breaks_are_named() {
        let deps = [
            dependent("s1", "coarse slo", 300),
            dependent("s2", "fine slo", 60),
        ];
        let mut a = source_alert();
        a.trigger_condition.frequency = 300;
        let msg = edit_blocked_by(&a, &deps)
            .expect("the 60s SLO is broken")
            .to_string();
        assert!(msg.contains("fine slo"), "{msg}");
        assert!(!msg.contains("coarse slo"), "{msg}");
    }

    /// One edit can break two SLOs for two different reasons, because the
    /// rules are measured against each SLO's own slice. Quoting one reason for
    /// both would name the wrong fix for one of them — and a user who applied
    /// it would collect a second 409.
    #[test]
    fn each_named_slo_carries_its_own_reason() {
        let deps = [
            dependent("fine slo", "fine slo", 60),
            dependent("coarse slo", "coarse slo", 300),
        ];
        let mut a = source_alert();
        a.trigger_condition.frequency = 120;
        a.trigger_condition.silence = 5;

        let msg = edit_blocked_by(&a, &deps)
            .expect("both SLOs are broken")
            .to_string();
        // The 60s SLO is refused on cadence, checked before silence; the 300s
        // one tolerates the cadence and is refused on silence.
        let fine = msg.find("fine slo").expect(&msg);
        let coarse = msg.find("coarse slo").expect(&msg);
        assert!(msg[fine..coarse].contains("cadence is 120s"), "{msg}");
        assert!(msg[coarse..].contains("silences for 5 minutes"), "{msg}");
    }

    #[test]
    fn the_edit_refusal_is_a_conflict() {
        let mut a = source_alert();
        a.trigger_condition.silence = 10;
        let err = edit_blocked_by(&a, &[dependent("s1", "checkout availability", 300)]).unwrap();
        let response: axum::response::Response = err.into();
        assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
    }

    // ---- the generation bump (D59) -----------------------------------------

    #[test]
    fn a_condition_edit_redefines_every_dependent() {
        let before = source_alert();
        let mut after = before.clone();
        after.trigger_condition.threshold = 9;
        let deps = [
            dependent("s1", "checkout availability", 300),
            dependent("s2", "search availability", 60),
        ];
        assert_eq!(
            slos_redefined_by(Some(&before), &after, &deps),
            ["s1", "s2"]
        );
    }

    #[test]
    fn a_cadence_edit_redefines_nothing() {
        let before = source_alert();
        let mut after = before.clone();
        after.trigger_condition.frequency = 300;
        let deps = [dependent("s1", "checkout availability", 300)];
        assert!(slos_redefined_by(Some(&before), &after, &deps).is_empty());
    }

    /// A create has no "before", so there is nothing to have changed — and
    /// nothing can depend on an alert that does not exist yet anyway.
    #[test]
    fn a_create_redefines_nothing() {
        let deps = [dependent("s1", "checkout availability", 300)];
        assert!(slos_redefined_by(None, &source_alert(), &deps).is_empty());
    }

    // ---- the wiring ---------------------------------------------------------
    //
    // Each verdict above is a pure function, and each is worthless if no write
    // path runs it. These pin the join the same way `org_cleanup` pins the
    // ordering of its teardown steps — against the source of the function
    // itself, because these are flat async functions over global clients with
    // no injection point. Same limit, stated plainly: they see calls that are
    // WRITTEN, not calls that RUN.

    const SOURCE: &str = include_str!("alert.rs");

    fn body_of(from: &str, to: &str) -> &'static str {
        let start = SOURCE
            .find(from)
            .unwrap_or_else(|| panic!("this file defines {from}"));
        let rest = &SOURCE[start..];
        let end = rest
            .find(to)
            .unwrap_or_else(|| panic!("{from} is followed by {to}"));
        &rest[..end]
    }

    /// `prepare_alert` is the one choke point every create, update and save
    /// goes through, which is why the guard lives there rather than in each of
    /// them — a fourth write path added later inherits it.
    #[test]
    fn the_save_path_runs_the_edit_guard_and_the_bump() {
        let prepare = body_of("async fn prepare_alert(", "\npub fn update_cron_expression");
        assert!(
            prepare.contains("edit_blocked_by("),
            "prepare_alert must refuse an eligibility-breaking edit"
        );
        assert!(
            prepare.contains("slos_redefined_by("),
            "prepare_alert must work out which SLOs the edit redefines"
        );
    }

    /// The bump has to land AFTER the alert is written, or a save that is then
    /// refused or fails would have discarded an SLO's window for an edit that
    /// never happened. Pinned as an ordering, not a presence.
    #[test]
    fn every_write_path_applies_the_effect_after_the_write() {
        for (label, from, to, write) in [
            (
                "save",
                "pub async fn save(",
                "\nasync fn prepare_alert(",
                "db::alerts::alert::set(org_id, alert, create)",
            ),
            (
                "create",
                "pub async fn create<C: TransactionTrait>(",
                "\n/// Moves the alerts into the specified destination folder.",
                "db::alerts::alert::create(conn, org_id, folder_id, alert, overwrite)",
            ),
            (
                "update",
                "pub async fn update<C: ConnectionTrait + TransactionTrait>(",
                "\n/// Gets the alert by its KSUID primary key.",
                "db::alerts::alert::update(conn, org_id, dst_folder_id_info, alert)",
            ),
        ] {
            let body = body_of(from, to);
            let written = body
                .find(write)
                .unwrap_or_else(|| panic!("{label} no longer writes through {write}"));
            let applied = body
                .find(".apply(")
                .unwrap_or_else(|| panic!("{label} must apply the effect prepare_alert handed it"));
            assert!(
                applied > written,
                "{label} applies the SLO effect before the alert is written"
            );
        }
    }

    #[test]
    fn the_user_delete_runs_the_delete_guard() {
        let delete = body_of(
            "pub async fn delete_by_id_user<",
            "\n/// The refusal a delete owes",
        );
        assert!(
            delete.contains("delete_blocked_by("),
            "delete_by_id_user must refuse while a dependent SLO exists"
        );
    }

    /// The negative half, and the one ordering alone cannot give: org teardown
    /// and the SLO's own alert cascade both call the shared primitive, and a
    /// single straggler SLO row — left by a failed earlier attempt, or created
    /// during the grace period — would put an org deletion into a retry loop
    /// that can never succeed. The guard belongs on the user's delete only.
    #[test]
    fn the_shared_delete_primitive_stays_unguarded() {
        let delete = body_of(
            "pub(crate) async fn delete_by_id<",
            "\n/// Delete an alert **on a user's behalf**",
        );
        assert!(
            !delete.contains("delete_blocked_by("),
            "the unguarded primitive must not consult the dependent-SLO guard"
        );
        assert!(
            !delete.contains("slos_sourced_from_alert("),
            "the unguarded primitive must not even look the dependents up"
        );
    }
}

pub async fn delete_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), AlertError> {
    let alert = db::alerts::alert::get_by_name(org_id, stream_type, stream_name, name)
        .await
        .map_err(|_| AlertError::AlertNotFound)?
        .ok_or(AlertError::AlertNotFound)?;
    let alert_id = alert.id.ok_or(AlertError::AlertNotFound)?;
    let client = infra::db::ORM_CLIENT
        .get_or_init(infra::db::connect_to_orm)
        .await;
    delete_by_id_user(client, org_id, alert_id).await
}

/// Enables an alert.
pub async fn enable_by_id<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
    should_enable: bool,
) -> Result<(), AlertError> {
    let Some((_, mut alert)) = db::alerts::alert::get_by_id(conn, org_id, alert_id).await? else {
        return Err(AlertError::AlertNotFound);
    };
    alert.enabled = should_enable;
    update(conn, org_id, None, alert).await?;
    Ok(())
}

pub async fn enable_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
    value: bool,
) -> Result<(), AlertError> {
    let mut alert =
        match db::alerts::alert::get_by_name(org_id, stream_type, stream_name, name).await {
            Ok(Some(alert)) => alert,
            _ => {
                return Err(AlertError::AlertNotFound);
            }
        };
    alert.enabled = value;
    db::alerts::alert::set(org_id, alert, false).await?;
    Ok(())
}

/// Triggers an alert.
pub async fn trigger_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(String, String), AlertError> {
    let Some((_, alert)) = db::alerts::alert::get_by_id(conn, org_id, alert_id).await? else {
        return Err(AlertError::AlertNotFound);
    };
    let now = Utc::now().timestamp_micros();

    // For creates_incident=true alerts the incident correlation path handles
    // the notification. For all other cases send the direct notification.
    #[cfg(feature = "enterprise")]
    let incident_routed = if alert.creates_incident
        && o2_enterprise::enterprise::common::config::get_config()
            .incidents
            .enabled
    {
        let synthetic_row = config::utils::json::json!({
            "stream_name": alert.stream_name,
            "stream_type": alert.stream_type.to_string(),
            "alert_name": alert.name,
            "alert_id": alert_id.to_string(),
            "trigger_type": "manual"
        });
        let synthetic_row = synthetic_row.as_object().unwrap();
        let notify = std::slice::from_ref(synthetic_row);

        match crate::alerts::incidents::correlate_alert_to_incident(
            &alert,
            synthetic_row,
            notify,
            now,
            // Manual triggers evaluate nothing; no level to map.
            None,
        )
        .await
        {
            Ok(Some(outcome)) => {
                log::info!(
                    "Manual trigger for alert {org_id}/{} correlated to incident {} (service: {})",
                    alert.name,
                    outcome.incident_id(),
                    outcome.service_name(),
                );
                true
            }
            Ok(None) => {
                log::debug!(
                    "No incident correlation for manually triggered alert {org_id}/{}",
                    alert.name
                );
                false
            }
            Err(e) => {
                log::error!(
                    "Error correlating manual trigger to incident, falling back to direct notification: {e}"
                );
                false
            }
        }
    } else {
        false
    };

    #[cfg(not(feature = "enterprise"))]
    let incident_routed = false;

    let trace_id = config::ider::generate_trace_id();
    let trace_id = format!("trig_id_{trace_id}");
    let (success_message, err_message) = if !incident_routed {
        let outcome = alert
            .send_notification(&trace_id, &[], now, None, now, None, None, None, &[])
            .await?;
        (outcome.success_message, outcome.error_message)
    } else {
        (String::new(), String::new())
    };

    Ok((success_message, err_message))
}

pub async fn trigger_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(String, String), AlertError> {
    let alert = match db::alerts::alert::get_by_name(org_id, stream_type, stream_name, name).await {
        Ok(Some(alert)) => alert,
        _ => {
            return Err(AlertError::AlertNotFound);
        }
    };
    let now = Utc::now().timestamp_micros();

    // For creates_incident=true alerts the incident correlation path handles
    // the notification. For all other cases send the direct notification.
    #[cfg(feature = "enterprise")]
    let incident_routed = if alert.creates_incident
        && o2_enterprise::enterprise::common::config::get_config()
            .incidents
            .enabled
    {
        let synthetic_row = config::utils::json::json!({
            "stream_name": alert.stream_name,
            "stream_type": alert.stream_type.to_string(),
            "alert_name": alert.name,
            "trigger_type": "manual"
        });
        let synthetic_row = synthetic_row.as_object().unwrap();
        let notify = std::slice::from_ref(synthetic_row);

        match crate::alerts::incidents::correlate_alert_to_incident(
            &alert,
            synthetic_row,
            notify,
            now,
            // Manual triggers evaluate nothing; no level to map.
            None,
        )
        .await
        {
            Ok(Some(outcome)) => {
                log::info!(
                    "Manual trigger for alert {org_id}/{} correlated to incident {} (service: {})",
                    alert.name,
                    outcome.incident_id(),
                    outcome.service_name(),
                );
                true
            }
            Ok(None) => {
                log::debug!(
                    "No incident correlation for manually triggered alert {org_id}/{}",
                    alert.name
                );
                false
            }
            Err(e) => {
                log::error!(
                    "Error correlating manual trigger to incident, falling back to direct notification: {e}"
                );
                false
            }
        }
    } else {
        false
    };

    #[cfg(not(feature = "enterprise"))]
    let incident_routed = false;

    let trace_id = config::ider::generate_trace_id();
    let trace_id = format!("trig_name_{trace_id}");
    let (success_message, err_message) = if !incident_routed {
        let outcome = alert
            .send_notification(&trace_id, &[], now, None, now, None, None, None, &[])
            .await?;
        (outcome.success_message, outcome.error_message)
    } else {
        (String::new(), String::new())
    };

    Ok((success_message, err_message))
}

/// Per-destination result of one notification attempt.
///
/// `succeeded` and `failed` are destination NAMES, which is what makes a
/// retry able to skip what already landed (Task 11's ledger) instead of
/// re-paging every destination because one of them errored.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotificationOutcome {
    /// Destination names delivered on THIS attempt. Ledgered-skipped
    /// destinations are not re-listed — they were not dispatched here.
    pub succeeded: Vec<String>,
    /// Destination names that failed on this attempt, for any reason
    /// (fetch error, missing template, bad content spec, transport error).
    pub failed: Vec<String>,
    pub success_message: String,
    pub error_message: String,
}

/// Alert-level template wins over the destination's (§ precedence).
///
/// Extracted from the send loop so the precedence rule is testable without a
/// database.
fn choose_template<'a>(
    alert_tpl: Option<&'a Template>,
    dest_tpl: Option<&'a Template>,
) -> Option<&'a Template> {
    match (alert_tpl, dest_tpl) {
        (Some(alert_tpl), _) => Some(alert_tpl),
        (None, Some(dest_tpl)) => Some(dest_tpl),
        (None, None) => None,
    }
}

#[async_trait]
pub trait AlertExt: Sync + Send + 'static {
    /// Returns the evaluated row data and the end time of the search timerange,
    /// for realtime this is 0. `start_time` is the start time of the search timerange.
    async fn evaluate(
        &self,
        row: Option<&Map<String, Value>>,
        (start_time, end_time): (Option<i64>, i64),
        trace_id: Option<String>,
    ) -> Result<TriggerEvalResults, anyhow::Error>;

    /// Returns a tuple containing a boolean - if all the send notification jobs successfully
    /// and the error message if any
    /// `level` is the severity this evaluation classified (alerts_2.md T-5).
    /// `None` for single-level alerts and for paths with no classification —
    /// templates then render `{alert_level}` as empty.
    #[allow(clippy::too_many_arguments)]
    async fn send_notification(
        &self,
        trace_id: &str,
        rows: &[Map<String, Value>],
        rows_end_time: i64,
        start_time: Option<i64>,
        evaluation_timestamp: i64,
        level: Option<config::meta::alerts::level::AlertLevel>,
        // The exact evaluated observation (T-9). Hybrid count evaluation
        // samples only PAYLOAD_SAMPLE_ROWS rows for the payload, so
        // `rows.len()` caps at 100 — `{alert_count}` must come from here.
        actual_value: Option<f64>,
        // Per-group notification identity (M-4). `None` = alert-level send.
        group_labels: Option<&std::collections::BTreeMap<String, String>>,
        // Destinations already delivered on a PRIOR attempt (Task 11's retry
        // ledger). Skipped here so a retry cannot double-page them.
        skip_destinations: &[String],
    ) -> Result<NotificationOutcome, AlertError>;
}

#[async_trait]
impl AlertExt for Alert {
    async fn evaluate(
        &self,
        row: Option<&Map<String, Value>>,
        (start_time, end_time): (Option<i64>, i64),
        trace_id: Option<String>,
    ) -> Result<TriggerEvalResults, anyhow::Error> {
        if self.is_real_time {
            self.query_condition.evaluate_realtime(row).await
        } else if self.query_condition.query_type == config::meta::alerts::QueryType::Slo {
            // Branch BEFORE the search path: an SLO alert runs no query. It
            // reads the aggregate the ingest pass already computed, which is
            // what decouples the alert's cadence from the measurement's and
            // makes five alerts on one SLO cost zero extra raw-data scans.
            evaluate_slo_alert(self, end_time).await
        } else {
            let mut search_event_ctx = SearchEventContext::with_alert(Some(format!(
                "/alerts/{}/{}/{}/{}",
                self.org_id, self.stream_type, self.stream_name, self.name
            )));
            search_event_ctx.alert_name = Some(self.name.clone());

            self.query_condition
                .evaluate_scheduled(
                    &self.org_id,
                    Some(&self.stream_name),
                    self.stream_type,
                    &self.trigger_condition,
                    (start_time, end_time),
                    Some(SearchEventType::Alerts),
                    Some(search_event_ctx),
                    trace_id,
                )
                .await
        }
    }

    async fn send_notification(
        &self,
        _trace_id: &str,
        rows: &[Map<String, Value>],
        rows_end_time: i64,
        start_time: Option<i64>,
        evaluation_timestamp: i64,
        level: Option<config::meta::alerts::level::AlertLevel>,
        actual_value: Option<f64>,
        group_labels: Option<&std::collections::BTreeMap<String, String>>,
        skip_destinations: &[String],
    ) -> Result<NotificationOutcome, AlertError> {
        let mut outcome = NotificationOutcome::default();
        let mut err_message = "".to_string();
        let mut success_message = "".to_string();
        let mut no_of_error = 0;
        // Destinations skipped by the ledger are neither dispatched nor
        // failures — they must not count toward the all-failed check below,
        // or a retry whose only remaining destination succeeds would still
        // look like a total failure.
        let mut no_of_skipped = 0;

        #[cfg(feature = "enterprise")]
        let mut workflow_error = 0;
        #[cfg(feature = "enterprise")]
        let mut workflow_err_msg = "".to_string();

        #[cfg(not(feature = "enterprise"))]
        let workflow_error = 0;
        #[cfg(not(feature = "enterprise"))]
        let workflow_err_msg = "".to_string();

        // WHICH SLO this notification is about, resolved ONCE and shared by
        // every surface below (each destination's template, and the workflow
        // trigger metadata). An SLO alert reports its SLO where an ordinary
        // alert reports its stream, and the SLO's NAME is on the evaluation
        // row rather than on the alert — so the rowless paths
        // (`trigger_by_id`, `trigger_by_name`) need one primary-key read to
        // say the same thing a firing says. Resolving it here rather than
        // inside the renderer is what keeps that at one read per notification

        // Get alert-level template if specified (takes precedence over destination templates)
        let alert_template = if let Some(ref template_name) = self.template {
            Some(
                db::alerts::templates::get(&self.org_id, template_name)
                    .await
                    .map_err(|_| AlertError::AlertTemplateNotFound {
                        template: template_name.clone(),
                    })?,
            )
        } else {
            None
        };

        // §5.1 Template snapshot: resolve EVERY destination and its template
        // before any send. Two things follow from doing this up front:
        //   1. A template edited mid-notification can no longer render different content to
        //      different destinations of one alert.
        //   2. A destination fetch failure becomes a per-destination failure instead of a `?` that
        //      aborts the remaining destinations — which, once an earlier destination had already
        //      sent, made the resulting all-fail return trigger a retry that re-sent it (§6.1).
        let mut snapshot: Vec<(String, Option<(DestinationType, Option<Template>)>)> =
            Vec::with_capacity(self.destinations.len());
        for dest_name in self.destinations.iter() {
            // Ledgered destinations already landed on a prior attempt.
            if skip_destinations.contains(dest_name) {
                no_of_skipped += 1;
                continue;
            }
            match destinations::get_with_template(&self.org_id, dest_name).await {
                Ok((dest, dest_template)) => match dest.module {
                    Module::Alert {
                        destination_type, ..
                    } => {
                        // Keyed by the name CONFIGURED on the alert, not
                        // `dest.name`: the ledger is matched against
                        // `self.destinations` on the next attempt, so the two
                        // must be the same string.
                        snapshot.push((dest_name.clone(), Some((destination_type, dest_template))))
                    }
                    _ => {
                        log::error!(
                            "Unsupported destination type for alert {}/{}/{}/{} destination {dest_name}",
                            self.org_id,
                            self.stream_type,
                            self.stream_name,
                            self.name,
                        );
                        snapshot.push((dest_name.clone(), None));
                        err_message = format!(
                            "{err_message} Unsupported destination type for destination {dest_name};"
                        );
                    }
                },
                Err(e) => {
                    log::error!(
                        "Error resolving destination {dest_name} for alert {}/{}/{}/{}: {e}",
                        self.org_id,
                        self.stream_type,
                        self.stream_name,
                        self.name,
                    );
                    snapshot.push((dest_name.clone(), None));
                    err_message =
                        format!("{err_message} Error resolving destination {dest_name} err: {e};");
                }
            }
        }
        // Pre-count the resolution failures captured above.
        no_of_error += snapshot.iter().filter(|(_, d)| d.is_none()).count();
        for (name, _) in snapshot.iter().filter(|(_, d)| d.is_none()) {
            outcome.failed.push(name.clone());
        }

        // §5.1 The context is built ONCE per notification: it shortens the
        // alert URL (a DB write) and may run `build_sql`. Per-destination
        // construction would multiply both. Only `metadata` differs per
        // destination, and it is swapped in place below.
        //
        // Built lazily — an alert whose destinations all failed to resolve
        // must not pay for a URL shortening it will never render.
        let mut ctx: Option<NotificationContext> = None;

        // Chart image, built at most ONCE per firing on the first
        // chart-enabled template (history query → downsample → signed URL;
        // no rendering here — pixels are produced at fetch time on the HTTP
        // node, except for email/discord which need bytes in the send).
        // Outer None = not attempted yet; inner None = attempted, no chart.
        let mut chart_asset: Option<Option<(String, chart::payload::ChartPayload)>> = None;
        let mut chart_png: Option<Option<std::sync::Arc<Vec<u8>>>> = None;

        for (dest_name, resolved) in snapshot.iter() {
            let Some((destination_type, dest_template)) = resolved else {
                continue; // already recorded as a resolution failure
            };

            // Use alert-level template if specified, otherwise fall back to
            // the destination's. Neither set is NOT an error (design §4.4) —
            // resolve through the org default / compiled-in fallback instead
            // (a dangling EXPLICIT reference, i.e. Some(name) that fails to
            // load, is still recorded as a resolution failure above and never
            // reaches this point).
            let explicit =
                choose_template(alert_template.as_ref(), dest_template.as_ref()).cloned();
            let effective = crate::alerts::notifications::org_default::resolve_effective_template(
                &self.org_id,
                explicit,
            )
            .await;
            let template = effective.template();

            if ctx.is_none() {
                ctx = Some(
                    build_send_context(
                        self,
                        rows,
                        rows_end_time,
                        start_time,
                        evaluation_timestamp,
                        level,
                        actual_value,
                        group_labels,
                    )
                    .await,
                );
            }
            let ctx = ctx.as_mut().expect("context built above");

            // Chart fields are set PER DESTINATION: only a destination whose
            // template opted in sees them, so the shared context never leaks
            // a chart into a template that didn't ask for one.
            let wants_chart = template.kind == TemplateKind::Content
                && db::alerts::templates::get_parsed_content(template)
                    .map(|s| s.chart.enabled)
                    .unwrap_or(false);
            if wants_chart && chart_asset.is_none() {
                chart_asset = Some(build_chart_asset(self, ctx).await);
            }
            match (wants_chart, chart_asset.as_ref().and_then(|a| a.as_ref())) {
                (true, Some((url, payload))) => {
                    ctx.chart_url = Some(url.clone());
                    // Bytes travel in the send itself only for email (CID
                    // attachment) and Discord (multipart upload); rendered at
                    // most once and shared.
                    let needs_png = matches!(destination_type, DestinationType::Email(_))
                        || matches!(
                            derive_channel_format(destination_type),
                            ChannelFormat::Discord
                        );
                    ctx.chart_png = if needs_png {
                        if chart_png.is_none() {
                            chart_png =
                                Some(chart::try_render_png(payload).map(std::sync::Arc::new));
                        }
                        chart_png.clone().flatten()
                    } else {
                        None
                    };
                }
                _ => {
                    ctx.chart_url = None;
                    ctx.chart_png = None;
                }
            }

            match send_to_destination(self, destination_type, template, ctx).await {
                Ok(resp) => {
                    outcome.succeeded.push(dest_name.clone());
                    success_message = format!("{success_message} destination {dest_name} {resp};");
                }
                Err(e) => {
                    log::error!(
                        "Error sending notification for {}/{}/{}/{} for destination {} err: {}",
                        self.org_id,
                        self.stream_type,
                        self.stream_name,
                        self.name,
                        dest_name,
                        e
                    );
                    no_of_error += 1;
                    outcome.failed.push(dest_name.clone());
                    err_message = format!(
                        "{err_message} Error sending notification for destination {dest_name} err: {e};"
                    );
                }
            }
        }

        // we check specifically for non empty to avoid the clone of data into Value
        #[cfg(feature = "enterprise")]
        if !self.workflows.is_empty() {
            let data: Vec<_> = rows.iter().map(|v| Value::Object(v.clone())).collect();

            let source_id = self
                .id
                .as_ref()
                .map_or(format!("{}/{}", self.org_id, self.name), |v| v.to_string());

            let metadata: HashMap<String, Value> = vec![
                ("org_id", self.org_id.clone().into()),
                ("stream_type", self.stream_type.to_string().into()),
                ("stream_name", self.stream_name.clone().into()),
                ("alert_name", self.name.clone().into()),
                (
                    "alert_type",
                    if self.is_real_time {
                        "realtime"
                    } else {
                        "scheduled"
                    }
                    .into(),
                ),
                ("alert_period", self.trigger_condition.period.into()),
                (
                    "alert_operator",
                    self.trigger_condition.operator.to_string().into(),
                ),
                ("alert_threshold", self.trigger_condition.threshold.into()),
                ("alert_count", rows.len().into()),
                (
                    "alert_start_time",
                    start_time
                        .unwrap_or(
                            rows_end_time
                                - Duration::try_minutes(self.trigger_condition.period)
                                    .unwrap()
                                    .num_microseconds()
                                    .unwrap(),
                        )
                        .into(),
                ),
                ("alert_end_time", rows_end_time.into()),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();

            for workflow in self.workflows.iter() {
                if let Err(e) = crate::workflows::send_workflow_trigger(
                    _trace_id,
                    &self.org_id,
                    source_id.clone(),
                    WorkflowTriggerType::AlertFired,
                    workflow,
                    metadata.clone(),
                    &data,
                )
                .await
                {
                    log::error!(
                        "Error triggering workflow for {}/{}/{}/{} for workflow {} err: {}",
                        self.org_id,
                        self.stream_type,
                        self.stream_name,
                        self.name,
                        workflow,
                        e
                    );
                    workflow_error += 1;
                    workflow_err_msg = format!(
                        "{workflow_err_msg} Error triggering workflow {} err: {e};",
                        workflow
                    );
                }
            }
        }

        outcome.success_message = success_message;
        outcome.error_message = err_message;

        // Attempted = destinations not skipped by the ledger. An attempt in
        // which every attempted destination failed is still a hard error, so
        // the scheduler retries; a partial failure returns Ok and the caller
        // reads `outcome.failed`.
        //
        // DELIBERATE BEHAVIOR CHANGE (`attempted > 0`): previously
        // `no_of_error == self.destinations.len()` was also true when BOTH
        // were zero, so an alert with no destinations at all returned
        // `SendNotificationError` even when its workflows had just fired
        // successfully. That was a latent bug — a workflow-only alert is a
        // supported configuration and reporting it as a total delivery
        // failure made the scheduler retry work that had already succeeded.
        // With the guard, a zero-destination alert falls through to the
        // workflow branch below, which errors only when the workflows
        // themselves all failed. T11's retry logic keys off this return
        // value, so the change is called out rather than left implicit.
        let attempted = self.destinations.len() - no_of_skipped;
        if attempted > 0 && no_of_error == attempted {
            Err(AlertError::SendNotificationError {
                error_message: outcome.error_message,
            })
        } else if self.destinations.is_empty() && workflow_error == self.workflows.len() {
            Err(AlertError::SendNotificationError {
                error_message: workflow_err_msg,
            })
        } else {
            Ok(outcome)
        }
    }
}

/// Build the notification context for a send, resolving the row template
/// first. Metadata is left empty — the caller swaps in each destination's.
#[allow(clippy::too_many_arguments)]
async fn build_send_context(
    alert: &Alert,
    rows: &[Map<String, Value>],
    rows_end_time: i64,
    start_time: Option<i64>,
    evaluation_timestamp: i64,
    level: Option<config::meta::alerts::level::AlertLevel>,
    actual_value: Option<f64>,
    group_labels: Option<&std::collections::BTreeMap<String, String>>,
) -> NotificationContext {
    let org_name = if let Some(org) = ORGANIZATIONS.read().await.get(&alert.org_id) {
        org.name.clone()
    } else {
        alert.org_id.to_string()
    };
    let rows_tpl_val = if alert.row_template.is_empty() {
        vec![Value::String("".to_string())]
    } else {
        process_row_template(
            &org_name,
            &alert.row_template,
            alert,
            alert.row_template_type,
            rows,
        )
    };
    build_notification_context(
        &org_name,
        alert,
        rows,
        &rows_tpl_val,
        ProcessTemplateOptions {
            rows_end_time,
            start_time,
            evaluation_timestamp,
            // Not read by the context builder; the per-destination
            // `is_email` is applied at render time.
            is_email: false,
            level,
            actual_value,
        },
        group_labels,
    )
    .await
}

/// Render and dispatch one notification to one destination.
///
/// Once-per-firing chart build: evaluation history from the triggers stream
/// → downsample → signed stateless render URL (nothing stored anywhere; see
/// notifications::chart). Bounded by a hard timeout so a slow history query
/// can never delay a page. Every failure path returns `None` — the caller
/// degrades to a chartless notification, never an error.
async fn build_chart_asset(
    alert: &Alert,
    ctx: &NotificationContext,
) -> Option<(String, chart::payload::ChartPayload)> {
    let alert_id = alert.id.map(|id| id.to_string())?;
    let req = chart::ChartRequest {
        org_id: &alert.org_id,
        alert_id: &alert_id,
        alert_name: &alert.name,
        stream_name: &alert.stream_name,
        period_secs: (alert.trigger_condition.period.max(1) as u64) * 60,
        trigger_ts: (ctx.alert_trigger_time / 1_000_000) as u64,
        // The context renders these as bare numbers ("5") or "N/A";
        // parse().ok() maps the latter to absence. The *_crit/_warn pair is
        // family-aware (T-5): for aggregation/PromQL alerts it carries the
        // severity thresholds the comparison actually used — NOT
        // `alert_threshold`, which for those families is the group-count
        // gate (live-verified: using it drew the critical line at 1).
        current_value: ctx.alert_agg_value.parse().ok(),
        crit_threshold: ctx.alert_threshold_crit.parse().ok(),
        warn_threshold: ctx.alert_threshold_warn.parse().ok(),
    };
    let payload = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        chart::build_payload(&req),
    )
    .await
    .ok()
    .flatten()?;
    let url = chart::build_chart_url(&alert.org_id, &payload).await?;
    Some((url, payload))
}

/// `ctx` is the notification-wide context; this function swaps in the
/// destination's metadata before rendering (§5.1).
async fn send_to_destination(
    alert: &Alert,
    dest_type: &DestinationType,
    template: &Template,
    ctx: &mut NotificationContext,
) -> Result<String, anyhow::Error> {
    let is_email = matches!(dest_type, DestinationType::Email(_));
    let empty_meta = hashbrown::HashMap::new();
    let metadata: &hashbrown::HashMap<String, String> = match dest_type {
        DestinationType::Http(endpoint) => &endpoint.metadata,
        _ => &empty_meta,
    };
    ctx.metadata = metadata
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    match template.kind {
        TemplateKind::Custom => {
            // Unchanged legacy path — byte-identical output.
            let msg = apply_custom_template(&template.body, ctx, is_email);
            let email_subject = if let TemplateType::Email { title } = &template.template_type {
                apply_custom_template(title, ctx, is_email)
            } else {
                template.name.clone()
            };
            match dest_type {
                DestinationType::Http(endpoint) => send_http_notification(endpoint, msg).await,
                DestinationType::Email(email) => {
                    // Same string for both parts: identical to the MIME this
                    // path emitted before the signature took two bodies.
                    send_email_notification(&email_subject, email, msg.clone(), msg).await
                }
                DestinationType::Sns(aws_sns) => {
                    send_sns_notification(&alert.name, aws_sns, msg).await
                }
            }
        }
        TemplateKind::Content => {
            let spec = db::alerts::templates::get_parsed_content(template)
                .map_err(|e| anyhow::anyhow!("Invalid content template {}: {e}", template.name))?;
            let format = derive_channel_format(dest_type);
            let content = resolve_content(&spec, ctx, format.channel_family());
            let rendered = render(format, &content, ctx)
                .map_err(|e| anyhow::anyhow!("Renderer failed: {e}"))?;

            match (rendered, dest_type) {
                (RenderedMessage::Http { body }, DestinationType::Http(endpoint)) => {
                    // Discord with a rendered chart: upload the PNG in the
                    // same webhook POST (the embed references it as
                    // `attachment://`). Actions destinations keep the plain
                    // JSON path — their payload is rewritten server-side.
                    if matches!(format, ChannelFormat::Discord)
                        && endpoint.action_id.is_none()
                        && let Some(png) = ctx.chart_png.clone()
                    {
                        send_discord_with_attachment(endpoint, body, png).await
                    } else {
                        send_http_notification(endpoint, body).await
                    }
                }
                (
                    RenderedMessage::Email {
                        subject,
                        html,
                        text,
                    },
                    DestinationType::Email(email),
                ) => {
                    send_email_notification_with_inline_png(
                        &subject,
                        email,
                        text,
                        html,
                        ctx.chart_png.clone(),
                    )
                    .await
                }
                (
                    RenderedMessage::Sns {
                        subject: _,
                        message,
                    },
                    DestinationType::Sns(aws_sns),
                ) => send_sns_notification(&alert.name, aws_sns, message).await,
                (rendered, dest_type) => Err(anyhow::anyhow!(
                    "Rendered message {rendered:?} does not match destination type {dest_type:?}"
                )),
            }
        }
    }
}

/// Send a pre-built message string to a single destination type.
///
/// Used by incident notifications, which build their own payload rather than
/// going through the alert template system.
#[cfg(feature = "enterprise")]
pub(crate) async fn dispatch_notification(
    dest_type: &DestinationType,
    subject: &str,
    msg: String,
) -> Result<String, anyhow::Error> {
    match dest_type {
        DestinationType::Http(endpoint) => send_http_notification(endpoint, msg).await,
        // Incident notifications build one payload with no HTML/plaintext
        // split, so both parts carry the same string — byte-identical to the
        // MIME this path emitted before the signature took two bodies.
        DestinationType::Email(email) => {
            send_email_notification(subject, email, msg.clone(), msg).await
        }
        DestinationType::Sns(aws_sns) => send_sns_notification(subject, aws_sns, msg).await,
    }
}

/// Dispatch a rendered test-send message to one destination.
///
/// `title` is the already-`[TEST] `-marked title `build_test_message` stamped
/// onto the content before rendering — used as the SNS subject, mirroring the
/// live path's `send_sns_notification(&alert.name, ...)` (this module,
/// `send_to_destination`), which also uses a caller-supplied subject rather
/// than deriving one from the rendered body. Passing it explicitly (instead
/// of re-deriving it from `rendered`, or hardcoding a literal) keeps this
/// function agnostic to the rendered payload's shape and guarantees the SNS
/// subject is never anything other than the actual marked title.
///
/// Unlike [`dispatch_notification`], this is NOT enterprise-gated: test-send
/// (Task 15) is an OSS-visible feature, and it needs the same private
/// `send_http_notification` / `send_email_notification` / `send_sns_notification`
/// transports this module already owns. Kept as a distinct, narrowly-scoped
/// function rather than removing the `#[cfg]` from `dispatch_notification`
/// itself, so the enterprise-only incident-notification call sites are
/// untouched.
pub(crate) async fn dispatch_test_message(
    dest_type: &DestinationType,
    title: &str,
    rendered: RenderedMessage,
) -> Result<String, anyhow::Error> {
    match (rendered, dest_type) {
        (RenderedMessage::Http { body }, DestinationType::Http(endpoint)) => {
            send_http_notification(endpoint, body).await
        }
        (
            RenderedMessage::Email {
                subject,
                html,
                text,
            },
            DestinationType::Email(email),
        ) => send_email_notification(&subject, email, text, html).await,
        (RenderedMessage::Http { body }, DestinationType::Sns(aws_sns)) => {
            send_sns_notification(title, aws_sns, body).await
        }
        (RenderedMessage::Sns { subject, message }, DestinationType::Sns(aws_sns)) => {
            send_sns_notification(&subject, aws_sns, message).await
        }
        (rendered, dest_type) => Err(anyhow::anyhow!(
            "Rendered message {rendered:?} does not match destination type {dest_type:?}"
        )),
    }
}

async fn send_http_notification(endpoint: &Endpoint, msg: String) -> Result<String, anyhow::Error> {
    #[cfg(feature = "enterprise")]
    let msg = if endpoint.action_id.is_some() {
        let incoming_msg = serde_json::from_str::<serde_json::Value>(&msg)
            .map_err(|e| anyhow::anyhow!("Message should be valid JSON for actions: {e}"))?;
        let inputs = if incoming_msg.is_object() {
            vec![incoming_msg]
        } else if incoming_msg.is_array() {
            incoming_msg.as_array().unwrap().to_vec()
        } else {
            return Err(anyhow::anyhow!(
                "Unsupported message format for actions: {}",
                msg
            ));
        };

        let trace_id = get_or_create_trace_id(
            &HeaderMap::new(),
            &span!(Level::TRACE, "action_destinations"),
        );

        let req = TriggerActionRequest {
            inputs,
            trigger_source: TriggerSource::Alerts,
            trace_id,
        };
        serde_json::to_string(&req)
            .map_err(|e| anyhow::anyhow!("Request should be valid JSON for actions: {e}"))?
    } else {
        msg
    };

    // Block SSRF: validate the destination URL (including DNS resolution) before
    // making any outbound request. The client is built through `build_safe_client`
    // so that redirect targets and per-connect DNS resolution are re-validated.
    if let Err(e) = SsrfGuard::validate_url_with_config_async(&endpoint.url).await {
        return Err(anyhow::anyhow!(
            "Destination URL blocked by SSRF guard: {e}"
        ));
    }

    let builder = if endpoint.skip_tls_verify {
        reqwest::Client::builder().danger_accept_invalid_certs(true)
    } else {
        reqwest::Client::builder()
    };
    let client = common::utils::ssrf_guard::build_safe_client(builder)?;
    let url = url::Url::parse(&endpoint.url)?;
    let build_req = |body: String| {
        let mut req = match endpoint.method {
            HTTPType::POST => client.post(url.clone()),
            HTTPType::PUT => client.put(url.clone()),
            HTTPType::GET => client.get(url.clone()),
        };
        // Add additional headers if any from destination description
        let mut has_context_type = false;
        if let Some(headers) = &endpoint.headers {
            for (key, value) in headers.iter() {
                if !key.is_empty() && !value.is_empty() {
                    if key.to_lowercase().trim() == "content-type" {
                        has_context_type = true;
                    }
                    req = req.header(key, value);
                }
            }
        };
        // set default content type
        if !has_context_type {
            req = req.header("Content-type", "application/json");
        }
        req.body(body)
    };

    // Slack validates image URLs server-side at post time: an unfetchable
    // chart URL (VPN-only ZO_WEB_URL) makes it reject the ENTIRE message with
    // `400 invalid_attachments`, losing the alert. Reachability is a property
    // of the deployment, not the destination — once one send has bounced,
    // pre-strip images for the next hour instead of paying a guaranteed
    // reject-and-resend round trip on every alert.
    let is_slack_hook = url.host_str() == Some("hooks.slack.com");
    let now_secs = (config::utils::time::now_micros() / 1_000_000) as u64;
    let mut msg = msg;
    if is_slack_hook
        && slack_render::images_undeliverable(now_secs)
        && let Some(stripped) = slack_render::strip_image_blocks(&msg)
    {
        config::metrics::ALERT_CHART_EVENTS_TOTAL
            .with_label_values(&["slack_image_pre_stripped"])
            .inc();
        msg = stripped.msg;
    }

    let resp = match build_req(msg.clone()).send().await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error sending request to {} with error {e:?}", endpoint.url);
            return Err(anyhow::anyhow!("error sending request : {e:?}"));
        }
    };
    let resp_status = resp.status();
    let resp_body = resp.text().await?;

    log::debug!(
        "Alert sent to destination {} with status: {}, body:\n{}",
        endpoint.url,
        resp_status,
        resp_body,
    );

    if !resp_status.is_success() {
        // Slack-only recovery: the alert must not be lost over an image.
        // Strip the image blocks, resend once, and remember process-wide.
        if is_slack_hook
            && resp_status == reqwest::StatusCode::BAD_REQUEST
            && (resp_body.contains("invalid_attachments") || resp_body.contains("invalid_blocks"))
            && let Some(stripped) = slack_render::strip_image_blocks(&msg)
            && let Ok(retry_resp) = build_req(stripped.msg).send().await
            && retry_resp.status().is_success()
        {
            config::metrics::ALERT_CHART_EVENTS_TOTAL
                .with_label_values(&["slack_image_rejected"])
                .inc();
            // Removing the image fixed THIS send — but that only says
            // something about `ZO_WEB_URL`'s reachability when the image we
            // removed was actually ours. A custom template embedding a
            // third-party image Slack dislikes must not suppress charts
            // process-wide for an hour, nor be reported as a `web_url`
            // problem the operator would then go and "fix" in vain.
            if stripped.had_web_url_image {
                slack_render::mark_images_undeliverable(now_secs);
                log::warn!(
                    "[ALERT_CHART] Slack rejected the notification ({resp_body}) because its \
                     image proxy could not fetch the chart image; delivered without the image. \
                     Slack must be able to reach {} from the public internet — or set \
                     ZO_ALERT_CHART_ENABLED=false to stop embedding charts.",
                    config::get_config().common.web_url,
                );
            } else {
                log::warn!(
                    "[ALERT_CHART] Slack rejected the notification ({resp_body}); it was \
                     delivered after removing its image block(s). The image did not point at \
                     this deployment's web_url, so the chart-image suppression was NOT engaged \
                     — check the image URLs in the destination's template."
                );
            }
            return Ok(format!(
                "sent status: {} (image stripped: Slack rejected it)",
                reqwest::StatusCode::OK,
            ));
        }
        log::error!(
            "Alert http notification failed with status: {resp_status}, body: {resp_body}, payload: {msg}"
        );
        return Err(anyhow::anyhow!(
            "sent error status: {}, err: {}",
            resp_status,
            resp_body
        ));
    }

    Ok(format!("sent status: {resp_status}, body: {resp_body}"))
}

/// Send a multipart/alternative email.
///
/// Parameter order is `(text_body, html_body)` to MATCH
/// `MultiPart::alternative_plain_html`, whose first argument is the plaintext
/// part. Keeping the two orderings identical is deliberate: the failure mode of
/// swapping them — HTML delivered as the plaintext part, so every alert email
/// shows raw markup — is silent and customer-visible.
///
/// The custom-template path passes the SAME string for both, which reproduces
/// exactly the MIME this function emitted when it took one `msg`. The
/// Phase-1b renderers pass genuinely distinct parts.
pub async fn send_email_notification(
    email_subject: &str,
    email: &Email,
    text_body: String,
    html_body: String,
) -> Result<String, anyhow::Error> {
    send_email_notification_with_inline_png(email_subject, email, text_body, html_body, None).await
}

/// [`send_email_notification`] plus an optional inline chart PNG.
///
/// With a PNG the MIME becomes
/// `alternative(plain, related(html, image))` — the HTML part references the
/// image as `cid:` ([`render::email::CHART_CONTENT_ID`]) and the bytes travel
/// inside this same email, so the chart renders even in clients that block
/// remote images and nothing is hosted anywhere. Without a PNG the MIME is
/// byte-identical to what this function always emitted.
pub async fn send_email_notification_with_inline_png(
    email_subject: &str,
    email: &Email,
    text_body: String,
    html_body: String,
    inline_png: Option<std::sync::Arc<Vec<u8>>>,
) -> Result<String, anyhow::Error> {
    let cfg = get_config();
    if !cfg.smtp.smtp_enabled {
        return Err(anyhow::anyhow!("SMTP configuration not enabled"));
    }

    let recipients = email.recipients.clone();
    let mut email = Message::builder()
        .from(cfg.smtp.smtp_from_email.parse()?)
        .subject(email_subject.to_string());

    for recipient in recipients {
        email = email.to(recipient.parse()?);
    }

    if !cfg.smtp.smtp_reply_to.is_empty() {
        email = email.reply_to(cfg.smtp.smtp_reply_to.parse()?);
    }

    let multipart = match inline_png {
        None => MultiPart::alternative_plain_html(text_body, html_body),
        Some(png) => MultiPart::alternative()
            .singlepart(SinglePart::plain(text_body))
            .multipart(
                MultiPart::related()
                    .singlepart(SinglePart::html(html_body))
                    .singlepart(
                        Attachment::new_inline(
                            crate::alerts::notifications::render::email::CHART_CONTENT_ID
                                .to_string(),
                        )
                        .body(
                            png.as_ref().clone(),
                            "image/png".parse().expect("static mime type"),
                        ),
                    ),
            ),
    };
    let email = email.multipart(multipart).unwrap();

    // Send the email
    match SMTP_CLIENT.as_ref().unwrap().send(email).await {
        Ok(resp) => Ok(format!("sent email response code: {}", resp.code())),
        Err(e) => Err(anyhow::anyhow!("Error sending email: {e}")),
    }
}

/// Discord webhook send with the chart PNG uploaded in the same request
/// (multipart: `payload_json` + one file part). The embed references the
/// image as `attachment://` ([`render::discord::CHART_ATTACHMENT_NAME`]), so
/// no URL fetch is involved anywhere — true zero-storage delivery. Same SSRF
/// guard discipline as `send_http_notification`.
async fn send_discord_with_attachment(
    endpoint: &Endpoint,
    msg: String,
    png: std::sync::Arc<Vec<u8>>,
) -> Result<String, anyhow::Error> {
    if let Err(e) = SsrfGuard::validate_url_with_config_async(&endpoint.url).await {
        return Err(anyhow::anyhow!(
            "Destination URL blocked by SSRF guard: {e}"
        ));
    }
    let builder = if endpoint.skip_tls_verify {
        reqwest::Client::builder().danger_accept_invalid_certs(true)
    } else {
        reqwest::Client::builder()
    };
    let client = common::utils::ssrf_guard::build_safe_client(builder)?;
    let url = url::Url::parse(&endpoint.url)?;

    let form = reqwest::multipart::Form::new()
        .text("payload_json", msg.clone())
        .part(
            "files[0]",
            reqwest::multipart::Part::bytes(png.as_ref().clone())
                .file_name(crate::alerts::notifications::render::discord::CHART_ATTACHMENT_NAME)
                .mime_str("image/png")?,
        );

    let resp = client.post(url).multipart(form).send().await?;
    let resp_status = resp.status();
    let resp_body = resp.text().await?;
    if !resp_status.is_success() {
        log::error!(
            "Alert discord notification failed with status: {resp_status}, body: {resp_body}, payload: {msg}"
        );
        return Err(anyhow::anyhow!(
            "sent error status: {}, err: {}",
            resp_status,
            resp_body
        ));
    }
    Ok(format!("sent status: {resp_status}, body: {resp_body}"))
}

async fn send_sns_notification(
    alert_name: &str,
    aws_sns: &AwsSns,
    msg: String,
) -> Result<String, anyhow::Error> {
    let mut message_attributes = HashMap::new();
    message_attributes.insert(
        "AlertName".to_string(),
        aws_sdk_sns::types::MessageAttributeValue::builder()
            .data_type("String")
            .string_value(alert_name)
            .build()?,
    );

    let sns_client = config::get_sns_client().await;
    let ret = sns_client
        .publish()
        .topic_arn(&aws_sns.sns_topic_arn)
        .message(msg)
        .set_message_attributes(Some(message_attributes))
        .send()
        .await;
    match ret {
        Ok(resp) => Ok(format!(
            "sent SNS response message_id: {:?}, sequence_number: {:?}",
            resp.message_id(),
            resp.sequence_number()
        )),
        Err(e) => Err(anyhow::anyhow!("Error sending SNS notification: {e}")),
    }
}

fn process_row_template(
    org_name: &str,
    tpl: &String,
    alert: &Alert,
    row_type: RowTemplateType,
    rows: &[Map<String, Value>],
) -> Vec<Value> {
    let alert_type = if alert.is_real_time {
        "realtime"
    } else {
        "scheduled"
    };
    let alert_count = rows.len();
    let mut rows_tpl = Vec::with_capacity(rows.len());

    // For JSON row template type, try to parse the template as JSON
    let is_json_template = row_type == RowTemplateType::Json;

    for row in rows.iter() {
        let mut resp = tpl.to_string();
        let mut alert_start_time = 0;
        let mut alert_end_time = 0;
        for (key, value) in row.iter() {
            let value = if value.is_string() {
                value.as_str().unwrap_or_default().to_string()
            } else if value.is_f64() {
                value.as_f64().unwrap_or_default().to_string()
            } else {
                value.to_string()
            };
            process_variable_replace(&mut resp, key, &VarValue::Str(&value), false);

            // calculate start and end time
            if key == TIMESTAMP_COL_NAME {
                let val = value.parse::<i64>().unwrap_or_default();
                if alert_start_time == 0 || val < alert_start_time {
                    alert_start_time = val;
                }
                if alert_end_time == 0 || val > alert_end_time {
                    alert_end_time = val;
                }
            }
            if key == "zo_sql_min_time" {
                let val = value.parse::<i64>().unwrap_or_default();
                if alert_start_time == 0 || val < alert_start_time {
                    alert_start_time = val;
                }
            }
            if key == "zo_sql_max_time" {
                let val = value.parse::<i64>().unwrap_or_default();
                if alert_end_time == 0 || val > alert_end_time {
                    alert_end_time = val;
                }
            }
        }
        let alert_start_time_str = if alert_start_time > 0 {
            Local
                .timestamp_nanos(alert_start_time * 1000)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        } else {
            String::from("N/A")
        };
        let alert_end_time_str = if alert_end_time > 0 {
            Local
                .timestamp_nanos(alert_end_time * 1000)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        } else {
            String::from("N/A")
        };

        let (stream_type_var, stream_name_var) =
            (alert.stream_type.as_str(), alert.stream_name.as_str());
        resp = resp
            .replace("{org_name}", org_name)
            .replace("{stream_type}", stream_type_var)
            .replace("{stream_name}", stream_name_var.as_ref())
            .replace("{alert_name}", &alert.name)
            .replace("{alert_type}", alert_type)
            .replace(
                "{alert_period}",
                &alert.trigger_condition.period.to_string(),
            )
            .replace(
                "{alert_operator}",
                &alert.trigger_condition.operator.to_string(),
            )
            .replace(
                "{alert_threshold}",
                &alert.trigger_condition.threshold.to_string(),
            )
            .replace("{alert_count}", &alert_count.to_string())
            .replace(
                "{alert_warning_threshold}",
                &alert
                    .trigger_condition
                    .warning_threshold
                    .map(|w| w.to_string())
                    .unwrap_or_default(),
            )
            .replace("{alert_start_time}", &alert_start_time_str)
            .replace("{alert_end_time}", &alert_end_time_str);

        if let Some(contidion) = &alert.query_condition.promql_condition {
            resp = resp
                .replace("{alert_promql_operator}", &contidion.operator.to_string())
                .replace("{alert_promql_value}", &contidion.value.to_string());
        }

        if let Some(attrs) = &alert.context_attributes {
            for (key, value) in attrs.iter() {
                process_variable_replace(&mut resp, key, &VarValue::Str(value), false);
            }
        }

        // If this is a JSON row template, try to parse it as JSON
        if is_json_template {
            match serde_json::from_str::<Value>(&resp) {
                Ok(json_value) => rows_tpl.push(json_value),
                Err(_) => {
                    // If parsing fails, treat it as string (fallback behavior)
                    rows_tpl.push(Value::String(resp));
                }
            }
        } else {
            // For string templates, wrap in Value::String
            rows_tpl.push(Value::String(resp));
        }
    }

    rows_tpl
}

struct ProcessTemplateOptions {
    pub rows_end_time: i64,
    pub start_time: Option<i64>,
    pub evaluation_timestamp: i64,
    /// Only read by the test-only [`process_dest_template`] wrapper; the live
    /// path derives `is_email` per destination at render time.
    #[cfg_attr(not(test), allow(dead_code))]
    pub is_email: bool,
    /// Severity classified by this evaluation, for `{alert_level}`.
    pub level: Option<config::meta::alerts::level::AlertLevel>,
    /// Exact evaluated observation (T-9); `{alert_count}` for count alerts.
    pub actual_value: Option<f64>,
}

/// Render an f64 that is usually an integral count without a trailing `.0`.
fn fmt_observed(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        v.to_string()
    }
}

/// Test-only wrapper preserving the pre-Task-9 call shape: build the context,
/// swap in `metadata`, apply the custom template. The live path calls
/// [`build_send_context`] + [`send_to_destination`] instead, which is the same
/// two steps with the context hoisted out of the destination loop.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
async fn process_dest_template(
    org_name: &str,
    tpl: &str,
    alert: &Alert,
    rows: &[Map<String, Value>],
    // The SLO's name, read from storage by `Alert::send_notification` for the
    // paths whose rows carry none (a manual trigger evaluates nothing, so
    // `rows` is empty). Taken as a parameter rather than read here so the read
    // happens once per notification instead of once per rendered template —
    // this function runs twice for every email destination — and so that this
    // function's own behaviour is observable without a database.
    rows_tpl_val: &[Value],
    options: ProcessTemplateOptions,
    metadata: &hashbrown::HashMap<String, String>,
    // Group labels for a per-group notification (M-4). `None` for every
    // ungrouped alert, which keeps their rendering byte-identical.
    group_labels: Option<&std::collections::BTreeMap<String, String>>,
) -> String {
    let is_email = options.is_email;
    let mut ctx =
        build_notification_context(org_name, alert, rows, rows_tpl_val, options, group_labels)
            .await;
    ctx.metadata = metadata
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    apply_custom_template(tpl, &ctx, is_email)
}

/// Build the [`NotificationContext`] for one notification.
///
/// Side-effecting: shortens the alert URL (a DB write) and may run
/// `build_sql`. Called **once per notification**, before the destination loop
/// (§5.1) — building it per destination would multiply both.
///
/// `metadata` is deliberately NOT a parameter: it is the only field that
/// differs per destination, and the caller swaps it in place on the returned
/// context (an O(1) `Vec` assignment) rather than rebuilding or cloning.
#[allow(clippy::too_many_arguments)]
async fn build_notification_context(
    org_name: &str,
    alert: &Alert,
    rows: &[Map<String, Value>],
    rows_tpl_val: &[Value],
    options: ProcessTemplateOptions,
    group_labels: Option<&std::collections::BTreeMap<String, String>>,
) -> NotificationContext {
    let cfg = get_config();
    let ProcessTemplateOptions {
        rows_end_time,
        start_time,
        evaluation_timestamp,
        is_email: _,
        level,
        actual_value,
    } = options;
    // {alert_count}: for count-family alerts, the EXACT evaluated count —
    // hybrid evaluation (§4.4c) samples only PAYLOAD_SAMPLE_ROWS rows for the
    // payload, so `rows.len()` would render 48,213 real matches as "100".
    // Aggregation/PromQL payloads are groups/series; their length stands.
    let is_count_family = alert.query_condition.aggregation.is_none()
        && alert.query_condition.promql_condition.is_none();
    let alert_count = match actual_value {
        Some(v) if is_count_family => fmt_observed(v),
        _ => rows.len().to_string(),
    };
    // T-5: family-aware threshold variables. `{alert_threshold}` keeps its
    // legacy meaning (the count threshold); `{alert_threshold_crit}` /
    // `{alert_threshold_warn}` resolve from the ACTIVE threshold family, so an
    // aggregation or PromQL notification reports the comparison it actually
    // made.
    let (family_crit, family_warn) = if let Some(agg) = alert.query_condition.aggregation.as_ref() {
        config::meta::alerts::aggregation_level::aggregation_thresholds(agg)
            .unwrap_or((alert.trigger_condition.threshold as f64, None))
    } else if let Some(pc) = alert.query_condition.promql_condition.as_ref() {
        (
            config::utils::json::get_float_value(&pc.value),
            alert.query_condition.promql_warning_value,
        )
    } else {
        (
            alert.trigger_condition.threshold as f64,
            alert.trigger_condition.warning_threshold.map(|w| w as f64),
        )
    };
    let mut vars = HashMap::with_capacity(rows.len());
    for row in rows.iter() {
        for (key, value) in row.iter() {
            let value = if value.is_string() {
                value.as_str().unwrap_or_default().to_string()
            } else if value.is_f64() {
                value.as_f64().unwrap_or_default().to_string()
            } else {
                value.to_string()
            };
            let entry = vars.entry(key.to_string()).or_insert_with(HashSet::new);
            entry.insert(value);
        }
    }

    // Use only the main alert time range if multi_time_range is enabled
    let use_given_time = alert
        .query_condition
        .multi_time_range
        .as_ref()
        .is_some_and(|tr| !tr.is_empty());
    // calculate start and end time
    let (alert_start_time, alert_end_time) = get_alert_start_end_time(
        &vars,
        alert.trigger_condition.period,
        rows_end_time,
        start_time,
        use_given_time,
    );

    let alert_start_time_str = if alert_start_time > 0 {
        Local
            .timestamp_nanos(alert_start_time * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    };
    let alert_end_time_str = if alert_end_time > 0 {
        Local
            .timestamp_nanos(alert_end_time * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    };
    let evaluation_timestamp_str = if evaluation_timestamp > 0 {
        Local
            .timestamp_nanos(evaluation_timestamp * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    };

    let alert_type = if alert.is_real_time {
        "realtime"
    } else {
        "scheduled"
    };

    let mut alert_query = String::new();
    let function_content = if let Some(v) = &alert.query_condition.vrl_function {
        format!("&functionContent={}", v.replace('+', "%2B"))
    } else {
        "".to_owned()
    };
    let alert_url = if alert.query_condition.query_type == QueryType::PromQL {
        if let Some(promql) = &alert.query_condition.promql {
            let condition = alert.query_condition.promql_condition.as_ref().unwrap();
            alert_query = format!(
                "({}) {} {}",
                promql,
                match condition.operator {
                    Operator::EqualTo => "==".to_string(),
                    _ => condition.operator.to_string(),
                },
                to_float(&condition.value)
            );
        }
        // http://localhost:5080/web/metrics?stream=zo_http_response_time_bucket&from=1705248000000000&to=1705334340000000&query=em9faHR0cF9yZXNwb25zZV90aW1lX2J1Y2tldHt9&org_identifier=default
        format!(
            "{}{}/web/metrics?stream_type={}&stream={}&stream_value={}&from={}&to={}&query={}&org_identifier={}{}&type={}&show_histogram=false",
            cfg.common.web_url,
            cfg.common.base_uri,
            alert.stream_type,
            alert.stream_name,
            alert.stream_name,
            alert_start_time,
            alert_end_time,
            base64::encode_url(&alert_query).replace('+', "%2B"),
            alert.org_id,
            function_content,
            SearchEventType::Alerts
        )
    } else if alert.query_condition.query_type == QueryType::Slo {
        // An SLO alert runs no query and has no stream, so a logs deep-link
        // would point at nothing. The useful destination for whoever is
        // reading the page at 3am is the SLO itself.
        match alert.query_condition.slo_condition.as_ref() {
            Some(cond) => format!(
                "{}{}/web/slos/{}?org_identifier={}",
                cfg.common.web_url, cfg.common.base_uri, cond.slo_id, alert.org_id
            ),
            // Cannot happen once validation is wired (Gap 3), and a missing
            // link must not cost a notification either way.
            None => String::new(),
        }
    } else {
        match alert.query_condition.query_type {
            QueryType::SQL => {
                if let Some(sql) = &alert.query_condition.sql {
                    alert_query = sql.clone();
                }
            }
            QueryType::Custom => {
                if let Some(conditions) = &alert.query_condition.conditions
                    && let Ok(v) = build_sql(
                        &alert.org_id,
                        &alert.stream_name,
                        alert.stream_type,
                        &alert.query_condition,
                        conditions,
                    )
                    .await
                {
                    alert_query = v;
                }
            }
            // NOT `unreachable!()`. It used to be, and adding the fourth
            // query type made it reachable — every SLO alert evaluation
            // panicked the scheduler worker. A query type this builder does
            // not know how to deep-link into is a missing link, never a
            // crash on the notification path.
            _ => {}
        };
        // http://localhost:5080/web/logs?stream_type=logs&stream=test&from=1708416534519324&to=1708416597898186&sql_mode=true&query=U0VMRUNUICogRlJPTSAidGVzdCIgd2hlcmUgbGV2ZWwgPSAnaW5mbyc=&org_identifier=default
        format!(
            "{}{}/web/logs?stream_type={}&stream={}&stream_value={}&from={}&to={}&sql_mode=true&query={}&org_identifier={}{}&type={}&show_histogram=false",
            cfg.common.web_url,
            cfg.common.base_uri,
            alert.stream_type,
            alert.stream_name,
            alert.stream_name,
            alert_start_time,
            alert_end_time,
            base64::encode_url(&alert_query),
            alert.org_id,
            function_content,
            SearchEventType::Alerts
        )
    };

    // Shorten the alert url
    let alert_url = match short_url::shorten(&alert.org_id, &alert_url).await {
        Ok(short_url) => short_url,
        Err(e) => {
            log::error!("Error shortening alert url: {e}");
            alert_url
        }
    };

    NotificationContext {
        org_name: org_name.to_string(),
        stream_type: alert.stream_type.as_str().to_string(),
        stream_name: alert.stream_name.clone(),
        alert_name: alert.name.clone(),
        alert_type: alert_type.to_string(),
        alert_period: alert.trigger_condition.period.to_string(),
        alert_operator: alert.trigger_condition.operator.to_string(),
        alert_threshold: alert.trigger_condition.threshold.to_string(),
        alert_count,
        alert_agg_value: format_agg_value(actual_value),
        alert_level: level.map(|l| l.to_string()).unwrap_or_default(),
        alert_priority: alert.priority.map(|p| p.to_string()).unwrap_or_default(),
        alert_tags: alert.tags.join(","),
        alert_threshold_crit: fmt_observed(family_crit),
        alert_threshold_warn: family_warn.map(fmt_observed).unwrap_or_default(),
        alert_start_time: alert_start_time_str,
        alert_end_time: alert_end_time_str,
        alert_url,
        alert_trigger_time: evaluation_timestamp,
        alert_trigger_time_str: evaluation_timestamp_str,
        alert_description: alert.description.clone(),
        promql_operator: alert
            .query_condition
            .promql_condition
            .as_ref()
            .map(|c| c.operator.to_string()),
        promql_value: alert
            .query_condition
            .promql_condition
            .as_ref()
            .map(|c| c.value.to_string()),
        rows: rows.to_vec(),
        rows_tpl_val: rows_tpl_val.to_vec(),
        row_columns: build_row_columns(rows),
        context_attributes: alert
            .context_attributes
            .as_ref()
            .map(|attrs| {
                attrs
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        // Swapped in per destination by the caller — see the doc comment.
        metadata: Vec::new(),
        group_labels: group_labels.cloned(),
        level,
        chart_url: None,
        chart_png: None,
    }
}
pub fn get_row_column_map(rows: &[Map<String, Value>]) -> HashMap<String, HashSet<String>> {
    let mut vars = HashMap::with_capacity(rows.len());
    for row in rows.iter() {
        for (key, value) in row.iter() {
            let value = if value.is_string() {
                value.as_str().unwrap_or_default().to_string()
            } else if value.is_f64() {
                value.as_f64().unwrap_or_default().to_string()
            } else {
                value.to_string()
            };
            let entry = vars.entry(key.to_string()).or_insert_with(HashSet::new);
            entry.insert(value);
        }
    }
    vars
}

pub fn get_alert_start_end_time(
    vars: &HashMap<String, HashSet<String>>,
    period: i64,
    rows_end_time: i64,
    start_time: Option<i64>,
    use_given_time: bool,
) -> (i64, i64) {
    if use_given_time {
        let start_time = match start_time {
            Some(start_time) => start_time,
            None => {
                rows_end_time
                    - Duration::try_minutes(period)
                        .unwrap()
                        .num_microseconds()
                        .unwrap()
            }
        };
        return (start_time, rows_end_time);
    }

    // calculate start and end time
    let mut alert_start_time = 0;
    let mut alert_end_time = 0;
    if let Some(values) = vars.get(TIMESTAMP_COL_NAME) {
        for val in values {
            let val = val.parse::<i64>().unwrap_or_default();
            if alert_start_time == 0 || val < alert_start_time {
                alert_start_time = val;
            }
            if alert_end_time == 0 || val > alert_end_time {
                alert_end_time = val;
            }
        }
    }
    if let Some(values) = vars.get("zo_sql_min_time") {
        for val in values {
            let val = val.parse::<i64>().unwrap_or_default();
            if alert_start_time == 0 || val < alert_start_time {
                alert_start_time = val;
            }
        }
    }
    if let Some(values) = vars.get("zo_sql_max_time") {
        for val in values {
            let val = val.parse::<i64>().unwrap_or_default();
            if alert_end_time == 0 || val > alert_end_time {
                alert_end_time = val;
            }
        }
    }

    // Hack time range for alert url
    alert_end_time = if alert_end_time == 0 {
        rows_end_time
    } else {
        // the frontend will drop the second, so we add 1 minute to the end time
        alert_end_time
            + Duration::try_minutes(1)
                .unwrap()
                .num_microseconds()
                .unwrap()
    };
    if alert_start_time == 0 {
        alert_start_time = match start_time {
            Some(start_time) => start_time,
            None => {
                alert_end_time
                    - Duration::try_minutes(period)
                        .unwrap()
                        .num_microseconds()
                        .unwrap()
            }
        };
    }
    if alert_end_time - alert_start_time
        < Duration::try_minutes(1)
            .unwrap()
            .num_microseconds()
            .unwrap()
    {
        alert_start_time = match start_time {
            Some(start_time) => start_time,
            None => {
                alert_end_time
                    - Duration::try_minutes(period)
                        .unwrap()
                        .num_microseconds()
                        .unwrap()
            }
        };
    }
    (alert_start_time, alert_end_time)
}
fn format_agg_value(actual_value: Option<f64>) -> String {
    actual_value.map(|v| v.to_string()).unwrap_or_default()
}

pub(super) fn to_float(val: &Value) -> f64 {
    if val.is_number() {
        val.as_f64().unwrap_or_default()
    } else {
        val.as_str().unwrap_or_default().parse().unwrap_or_default()
    }
}
#[cfg(not(feature = "enterprise"))]
pub async fn permitted_alerts(
    _org_id: &str,
    _user_id: Option<&str>,
    _folder_id: Option<&str>,
) -> Result<Option<Vec<String>>, AlertError> {
    Ok(None)
}

#[cfg(feature = "enterprise")]
pub async fn permitted_alerts(
    org_id: &str,
    user_id: Option<&str>,
    folder_id: Option<&str>,
) -> Result<Option<Vec<String>>, AlertError> {
    let Some(user_id) = user_id else {
        return Err(AlertError::PermittedAlertsMissingUser);
    };

    // If the list_only_permitted is true, then we will only return the alerts that the user has
    // `GET` permission on.
    if !get_openfga_config().list_only_permitted {
        return Ok(None);
    }

    // This function assumes the user already has `LIST` permission on the folder.
    // Otherwise, the user will not be able to see the folder in the first place.

    // So, we check for the `GET` permission on the folder.
    // If the user has `GET` permission on the folder, then they will be able to see the folder and
    // all its contents. This includes the dashboards inside the folder.

    use db::user::get as get_user;
    use o2_openfga::meta::mapping::OFGA_MODELS;

    use crate::auth::AuthExtractor;

    if let Some(folder_id) = folder_id {
        let user_role = match get_user(Some(org_id), user_id).await {
            Ok(Some(user)) => user.role,
            _ => return Err(AlertError::UserNotFound),
        };
        let permitted = crate::authz::check_permissions(
            user_id,
            AuthExtractor {
                org_id: org_id.to_string(),
                o2_type: format!(
                    "{}:{folder_id}",
                    OFGA_MODELS.get("alert_folders").unwrap().key,
                ),
                method: "GET".to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
                use_all_org: false,
                use_self_context: false,
                use_self_parent: true,
                auth: "".to_string(), // We don't need to pass the auth token here.
            },
            user_role,
            false,
        )
        .await;
        if permitted {
            // The user has `GET` permission on the folder.
            // So, they will be able to see all the dashboards inside the folder.
            return Ok(None);
        }
    }

    // We also check for the `GET_INDIVIDUAL_FROM_ROLE` permission on the dashboards.
    // If the user has `GET_INDIVIDUAL_FROM_ROLE` permission on a dashboard, then they will be able
    // to see the dashboard. This is used to check if the user has permission to see a specific
    // dashboard.

    let permitted_objects = crate::authz::list_objects_for_user(
        org_id,
        user_id,
        "GET_INDIVIDUAL_FROM_ROLE",
        OFGA_MODELS.get("alerts").unwrap().key,
    )
    .await
    .map_err(|err| AlertError::PermittedAlertsValidator(err.to_string()))?;

    Ok(permitted_objects)
}

#[cfg(test)]
mod threshold_validation_tests {
    //! Write-time validation of the warning/critical pair (alerts_2.md T-6).
    //! The pure matrix lives in `config::meta::alerts::level`; these cover the
    //! wiring — that the save path actually rejects, and maps to HTTP 400.

    use config::meta::alerts::{
        Operator,
        level::{ThresholdError, validate_thresholds},
    };

    use super::AlertError;

    /// The error must survive the wrap into `AlertError` with its cause intact,
    /// so the API can tell the user *why* the pair was rejected.
    #[test]
    fn test_invalid_pair_wraps_into_alert_error() {
        let err = validate_thresholds(Operator::GreaterThan, 50, Some(100)).unwrap_err();
        let wrapped = AlertError::InvalidWarningThreshold(err);
        let msg = wrapped.to_string();
        assert!(
            msg.contains("less severe"),
            "the reason must reach the user, got: {msg}"
        );
    }

    #[test]
    fn test_unorderable_operator_reason_reaches_the_user() {
        let err = validate_thresholds(Operator::EqualTo, 100, Some(50)).unwrap_err();
        assert_eq!(err, ThresholdError::OperatorNotOrderable(Operator::EqualTo));
        let msg = AlertError::InvalidWarningThreshold(err).to_string();
        assert!(msg.contains("no severity ordering"), "got: {msg}");
    }

    // ── Feature 2: tag validation reaches the API as a 400 (PT-7) ──────────

    /// The offending tag must survive the wrap into `AlertError`, so the user
    /// is told exactly which tag to fix rather than "invalid tags".
    #[test]
    fn test_invalid_tag_error_names_the_offending_tag() {
        use config::meta::alerts::tags::{TagError, normalize_tags};

        let err = normalize_tags(&["1bad".to_string()]).unwrap_err();
        assert_eq!(err, TagError::MustStartWithLetter("1bad".to_string()));

        let wrapped = AlertError::InvalidTag(err).to_string();
        assert!(
            wrapped.contains("1bad"),
            "the offending tag must reach the user, got: {wrapped}"
        );
    }

    /// Normalization is applied at save, not merely checked: the REPAIRED
    /// form is what gets stored, so a later filter compares like with like.
    #[test]
    fn test_save_stores_the_normalized_form_not_the_raw_input() {
        use config::meta::alerts::tags::normalize_tags;

        let stored = normalize_tags(&[
            "  Prod  ".to_string(),
            "SERVICE:Checkout".to_string(),
            "prod".to_string(),
            "".to_string(),
        ])
        .unwrap();
        assert_eq!(stored, vec!["prod", "service:checkout"]);
    }

    /// D13: on aggregation/PromQL alerts the count threshold is COVERAGE, not
    /// severity — a warning attached to it must be rejected with a message
    /// that points at the family's own warning field.
    #[test]
    fn test_coverage_gate_warning_error_names_the_right_field() {
        let msg = AlertError::WarningOnCoverageGate {
            family: "aggregation",
            field: "aggregation.warning_value",
        }
        .to_string();
        assert!(msg.contains("coverage"), "got: {msg}");
        assert!(msg.contains("aggregation.warning_value"), "got: {msg}");

        let msg = AlertError::WarningOnCoverageGate {
            family: "PromQL",
            field: "promql_warning_value",
        }
        .to_string();
        assert!(msg.contains("promql_warning_value"), "got: {msg}");
    }

    // ── Per-group alerting rules as `prepare_alert` applies them ───────────
    // (M-9/M-10, §5.5 MN-11.)
    //
    // SCOPE, stated plainly so these are not mistaken for boundary tests:
    // they call `validate_multi_alert_config` — the function `prepare_alert`
    // delegates to — with realistic whole-`Alert` inputs. They pin the RULES
    // and the HTTP mapping. They do NOT pin the WIRING: deleting
    // `validate_multi_alert_config(alert)?` from `prepare_alert` would leave
    // every one of them green.
    //
    // Closing that needs `prepare_alert` itself, which reaches for folders,
    // `get_by_id_db` and `infra::schema::get` — all through the global
    // `ORM_CLIENT` rather than an injectable connection. The infra SQLite
    // harness cannot reach it without first making that global overridable in
    // tests; until then the wiring is verified by review, not by test.

    use config::{meta::alerts::alert::Alert, utils::json::json};

    /// The **production** function `prepare_alert` delegates to — not a copy.
    /// Changing the rule therefore changes what these tests exercise. It does
    /// not, and cannot, prove `prepare_alert` still calls it.
    use super::validate_multi_alert_config as validate_rules;

    fn multi_alert_fixture() -> Alert {
        let mut alert = Alert::default();
        alert.trigger_condition.operator = config::meta::alerts::Operator::GreaterThanEquals;
        alert.trigger_condition.threshold = 1;
        alert.query_condition.aggregation = Some(config::meta::alerts::Aggregation {
            group_by: Some(vec!["host".to_string()]),
            function: config::meta::alerts::AggFunction::Avg,
            having: config::meta::alerts::Condition {
                column: "value".into(),
                operator: config::meta::alerts::Operator::GreaterThan,
                value: json!(90),
                ignore_case: false,
            },
            warning_value: None,
            multi_alert: true,
        });
        alert
    }

    /// A PromQL per-series alert. No `aggregation` at all — the grouping lives
    /// in the expression, which is the whole reason this family needed its own
    /// opt-in field.
    fn promql_multi_alert_fixture() -> Alert {
        let mut alert = Alert::default();
        alert.query_condition.query_type = config::meta::alerts::QueryType::PromQL;
        alert.query_condition.promql = Some("sum by (pod) (rate(errors[5m]))".to_string());
        alert.query_condition.promql_condition = Some(config::meta::alerts::Condition {
            column: "value".into(),
            operator: config::meta::alerts::Operator::GreaterThan,
            value: json!(10),
            ignore_case: false,
        });
        alert.query_condition.promql_multi_alert = true;
        alert.trigger_condition.operator = config::meta::alerts::Operator::GreaterThanEquals;
        alert.trigger_condition.threshold = 1;
        alert
    }

    #[test]
    fn test_a_valid_promql_multi_alert_passes_the_rules() {
        assert!(validate_rules(&promql_multi_alert_fixture()).is_ok());
    }

    /// The bug this whole family risked: `validate_multi_alert` used to return
    /// `Ok` the moment `aggregation` was `None`, so a PromQL alert could not be
    /// rejected for anything at all.
    #[test]
    fn test_promql_multi_alert_is_no_longer_waved_through_for_lacking_an_aggregation() {
        let mut alert = promql_multi_alert_fixture();
        alert.creates_incident = true;
        assert!(alert.query_condition.aggregation.is_none());
        let err = validate_rules(&alert).unwrap_err();
        assert!(
            format!("{err}").contains("incident"),
            "expected the MN-11 rejection, got: {err}"
        );
    }

    #[test]
    fn test_promql_multi_alert_rejects_an_unorderable_operator() {
        let mut alert = promql_multi_alert_fixture();
        alert
            .query_condition
            .promql_condition
            .as_mut()
            .unwrap()
            .operator = config::meta::alerts::Operator::EqualTo;
        assert!(validate_rules(&alert).is_err());
    }

    #[test]
    fn test_promql_multi_alert_rejects_a_series_count_threshold() {
        let mut alert = promql_multi_alert_fixture();
        alert.trigger_condition.threshold = 3;
        assert!(validate_rules(&alert).is_err());
    }

    /// Without a condition there is no threshold to classify a series against.
    #[test]
    fn test_promql_multi_alert_rejects_a_missing_condition() {
        let mut alert = promql_multi_alert_fixture();
        alert.query_condition.promql_condition = None;
        assert!(validate_rules(&alert).is_err());
    }

    /// The opt-in is the ONLY thing that turns per-series evaluation on — a
    /// PromQL alert that simply returns many series keeps collapsing (M-9).
    #[test]
    fn test_a_promql_alert_that_did_not_opt_in_is_unaffected_by_the_rules() {
        let mut alert = promql_multi_alert_fixture();
        alert.query_condition.promql_multi_alert = false;
        alert.creates_incident = true;
        alert.trigger_condition.threshold = 42;
        assert!(validate_rules(&alert).is_ok());
    }

    #[test]
    fn test_a_valid_multi_alert_passes_the_rules() {
        assert!(validate_rules(&multi_alert_fixture()).is_ok());
    }

    #[test]
    fn test_the_rules_reject_multi_alert_with_incidents() {
        // MN-11. Without this wiring the pure rule exists but every API
        // client can still create the unsupported combination.
        let mut alert = multi_alert_fixture();
        alert.creates_incident = true;

        let err = validate_rules(&alert).expect_err("must be rejected");
        assert!(matches!(err, AlertError::InvalidMultiAlert(_)));
        assert!(
            err.to_string().contains("creates_incident"),
            "the message must name the field: {err}"
        );
    }

    #[test]
    fn test_the_rules_reject_multi_alert_with_a_group_count_threshold() {
        // M-10: "at least 3 groups" and "any breaching group" are different
        // alerts; accepting both would leave the 3 doing nothing.
        let mut alert = multi_alert_fixture();
        alert.trigger_condition.threshold = 3;

        assert!(matches!(
            validate_rules(&alert),
            Err(AlertError::InvalidMultiAlert(_))
        ));
    }

    #[test]
    fn test_the_rules_reject_removing_the_last_group_by_from_a_multi_alert() {
        // The UPDATE path specifically: `prepare_alert` runs on both, so an
        // edit that empties group_by while the flag stays on is rejected.
        let mut alert = multi_alert_fixture();
        alert.query_condition.aggregation.as_mut().unwrap().group_by = Some(vec![]);

        assert!(matches!(
            validate_rules(&alert),
            Err(AlertError::InvalidMultiAlert(_))
        ));
    }

    #[test]
    fn test_the_rules_leave_ordinary_incident_alerts_alone() {
        // The guard is multi-only. An incident-creating alert with a group
        // count threshold and no opt-in stays perfectly valid.
        let mut alert = multi_alert_fixture();
        alert.creates_incident = true;
        alert.trigger_condition.threshold = 3;
        alert
            .query_condition
            .aggregation
            .as_mut()
            .unwrap()
            .multi_alert = false;

        assert!(validate_rules(&alert).is_ok());
    }

    /// §5.5: alert-level notification grouping would collapse per-group pages
    /// back into one batch — rejected at save time, never silently rerouted.
    #[test]
    fn test_multi_alert_rejects_notification_grouping() {
        let mut alert = multi_alert_fixture();
        alert.deduplication = Some(config::meta::alerts::deduplication::DeduplicationConfig {
            enabled: true,
            grouping: Some(config::meta::alerts::deduplication::GroupingConfig {
                enabled: true,
                ..serde_json::from_str("{}").expect("GroupingConfig defaults")
            }),
            ..Default::default()
        });

        let err = validate_rules(&alert).unwrap_err();
        assert!(matches!(
            err,
            AlertError::InvalidMultiAlert(
                config::meta::alerts::grouping::MultiAlertError::NotificationGroupingUnsupported
            )
        ));

        // Grouping configured but DISABLED must stay valid.
        alert
            .deduplication
            .as_mut()
            .unwrap()
            .grouping
            .as_mut()
            .unwrap()
            .enabled = false;
        assert!(validate_rules(&alert).is_ok());
    }

    #[test]
    fn test_multi_alert_rejection_is_a_bad_request() {
        // Misconfiguration is user input, not a server fault — the same 400
        // the other threshold validations produce.
        for variant in [
            config::meta::alerts::grouping::MultiAlertError::IncidentsUnsupported,
            config::meta::alerts::grouping::MultiAlertError::NotGrouped,
            config::meta::alerts::grouping::MultiAlertError::CountGateNotAnyGroup,
            config::meta::alerts::grouping::MultiAlertError::MultiTimeRangeUnsupported,
        ] {
            let resp: axum::response::Response = AlertError::InvalidMultiAlert(variant).into();
            assert_eq!(
                resp.status(),
                axum::http::StatusCode::BAD_REQUEST,
                "{variant:?} must be a 400, not a server error"
            );
        }
    }

    /// D12: realtime alerts are out of scope for levels entirely.
    #[test]
    fn test_realtime_rejection_has_its_own_error() {
        let msg = AlertError::WarningThresholdOnRealtimeAlert.to_string();
        assert!(
            msg.contains("real-time"),
            "realtime rejection must be distinguishable from a bad pair, got: {msg}"
        );
    }

    /// G5: an alert that configures no warning threshold must never be
    /// rejected, whatever its operator — including the unorderable ones.
    #[test]
    fn test_single_level_alerts_are_never_rejected() {
        for op in [
            Operator::EqualTo,
            Operator::NotEqualTo,
            Operator::GreaterThan,
            Operator::GreaterThanEquals,
            Operator::LessThan,
            Operator::LessThanEquals,
            Operator::Contains,
            Operator::NotContains,
        ] {
            assert!(
                validate_thresholds(op, 100, None).is_ok(),
                "operator {op:?} must stay valid with no warning threshold"
            );
        }
    }
}

#[cfg(test)]
mod send_path_tests {
    use config::meta::destinations::{Template, TemplateKind};

    use super::{NotificationOutcome, choose_template};

    fn tpl(name: &str) -> Template {
        Template {
            name: name.to_string(),
            kind: TemplateKind::Custom,
            ..Default::default()
        }
    }

    /// The alert-level template is an explicit override, so it wins even when
    /// the destination also carries one — otherwise setting a template on the
    /// alert would silently do nothing for any destination that has its own.
    #[test]
    fn alert_template_wins_over_destination_template() {
        let alert_tpl = tpl("from-alert");
        let dest_tpl = tpl("from-destination");
        let chosen = choose_template(Some(&alert_tpl), Some(&dest_tpl)).unwrap();
        assert_eq!(chosen.name, "from-alert");
    }

    /// An alert-level template also wins when the destination has none, which
    /// is the case that makes an alert-level template usable at all.
    #[test]
    fn alert_template_wins_when_destination_has_none() {
        let alert_tpl = tpl("from-alert");
        let chosen = choose_template(Some(&alert_tpl), None).unwrap();
        assert_eq!(chosen.name, "from-alert");
    }

    /// With no alert-level template the destination's is used — the legacy
    /// behaviour every existing alert relies on.
    #[test]
    fn destination_template_is_the_fallback() {
        let dest_tpl = tpl("from-destination");
        let chosen = choose_template(None, Some(&dest_tpl)).unwrap();
        assert_eq!(chosen.name, "from-destination");
    }

    /// Neither configured is not a panic and not a silent send: the caller
    /// turns `None` into a per-destination failure.
    #[test]
    fn no_template_anywhere_yields_none() {
        assert!(choose_template(None, None).is_none());
    }

    /// The retry ledger reads `succeeded`/`failed` by name, so a partial
    /// delivery must report BOTH lists rather than collapsing to one flag.
    #[test]
    fn outcome_separates_delivered_from_failed_destinations() {
        let outcome = NotificationOutcome {
            succeeded: vec!["slack".into()],
            failed: vec!["pagerduty".into()],
            success_message: " destination slack sent;".into(),
            error_message: " Error sending notification for destination pagerduty err: boom;"
                .into(),
        };
        assert_eq!(outcome.succeeded, vec!["slack".to_string()]);
        assert_eq!(outcome.failed, vec!["pagerduty".to_string()]);
        // A retry must re-send only what failed.
        assert!(!outcome.failed.contains(&"slack".to_string()));
    }

    /// `failed` is NOT in destination-declaration order: snapshot resolution
    /// failures are recorded before send failures. That is safe only because
    /// the ledger consumes it by MEMBERSHIP (`contains`), never by position —
    /// this test pins that contract, so a future reader cannot assume the
    /// order means anything.
    #[test]
    fn failed_is_consumed_as_a_membership_set_not_an_ordered_list() {
        // "b" failed to resolve (recorded first), "a" failed to send.
        let outcome = NotificationOutcome {
            succeeded: vec!["c".into()],
            failed: vec!["b".into(), "a".into()],
            ..Default::default()
        };
        // Declaration order was a, b, c — `failed` does not follow it.
        assert_ne!(outcome.failed, vec!["a".to_string(), "b".to_string()]);
        // What the ledger actually relies on: membership, order-independent.
        for name in ["a", "b"] {
            assert!(outcome.failed.contains(&name.to_string()));
        }
        assert!(!outcome.failed.contains(&"c".to_string()));
    }

    /// A default outcome is the "nothing attempted" state — no destination is
    /// reported as delivered, which is what keeps an empty send from marking
    /// a ledger entry.
    #[test]
    fn default_outcome_reports_no_deliveries() {
        let outcome = NotificationOutcome::default();
        assert!(outcome.succeeded.is_empty());
        assert!(outcome.failed.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use arrow_schema::DataType;
    use serde_json::json;

    use super::*;

    /// Live proof of the Slack image fallback: posts a payload whose image
    /// URL Slack's proxy cannot fetch (private IP), expects Slack's
    /// `400 invalid_attachments`, and asserts the send still succeeds via the
    /// strip-and-resend path — then that the process-wide flag makes the next
    /// send pre-strip (no second rejection round trip).
    ///
    /// Needs a real webhook: `TEST_SLACK_WEBHOOK=https://hooks.slack.com/...`
    /// `cargo test -p openobserve-core --lib slack_image_fallback -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn slack_image_fallback_delivers_without_image() {
        let Ok(webhook) = std::env::var("TEST_SLACK_WEBHOOK") else {
            panic!("set TEST_SLACK_WEBHOOK to run this live test");
        };
        let endpoint = config::meta::destinations::Endpoint {
            url: webhook,
            method: config::meta::destinations::HTTPType::POST,
            ..Default::default()
        };
        let msg = json!({
            "attachments": [
                {"color": "#2EB67D", "blocks": [
                    {"type": "section", "text": {"type": "mrkdwn",
                     "text": "*fallback live test* — this should arrive WITHOUT an image"}}
                ]},
                {"color": "#2EB67D", "blocks": [
                    {"type": "image",
                     "image_url": "http://10.123.45.67:5082/api/v2/default/alerts/charts/render?d=x&s=y",
                     "alt_text": "chart"}
                ]}
            ]
        })
        .to_string();

        let out = send_http_notification(&endpoint, msg.clone())
            .await
            .unwrap();
        assert!(out.contains("chart image stripped"), "got: {out}");

        // Flag is now set — the follow-up send must pre-strip and succeed on
        // the FIRST post (a rejection would mean pre-strip didn't happen).
        let out2 = send_http_notification(&endpoint, msg).await.unwrap();
        assert!(out2.contains("200"), "got: {out2}");
    }
    use crate::alerts::{
        Condition, build_expr,
        notifications::custom::{
            check_json_context, check_json_context_with_prefix, extract_limit_with_prefix,
            extract_rows_limit, extract_spread_rows_limit, format_variable_value, has_spread_rows,
            is_json_value_position,
        },
    };

    #[test]
    fn test_format_variable_value() {
        // Test common control characters
        assert_eq!(format_variable_value("\n".to_string()), "\\n");
        assert_eq!(format_variable_value("\t".to_string()), "\\t");
        assert_eq!(format_variable_value("\r".to_string()), "\\r");
        assert_eq!(format_variable_value("\"".to_string()), "\\\"");
        assert_eq!(format_variable_value("\\".to_string()), "\\\\");
        assert_eq!(format_variable_value("\0".to_string()), "\\u{0}");

        // Test other control characters
        assert_eq!(format_variable_value("\x1b".to_string()), "\\u{1b}"); // escape
        assert_eq!(format_variable_value("\x08".to_string()), "\\u{8}"); // backspace
        assert_eq!(format_variable_value("\x0c".to_string()), "\\u{c}"); // form feed
        assert_eq!(format_variable_value("\x0a".to_string()), "\\n"); // line feed
        assert_eq!(format_variable_value("\x0d".to_string()), "\\r"); // carriage return
        assert_eq!(format_variable_value("\x09".to_string()), "\\t"); // tab
        assert_eq!(format_variable_value("\x0b".to_string()), "\\u{b}"); // vertical tab

        // Test mixed content
        assert_eq!(
            format_variable_value("Hello\nWorld\tTest\r".to_string()),
            "Hello\\nWorld\\tTest\\r"
        );

        // Test string with quotes and backslashes
        assert_eq!(
            format_variable_value("Hello \"World\" \\ Test".to_string()),
            "Hello \\\"World\\\" \\\\ Test"
        );

        // Test other control characters (should be converted to Unicode escape)
        assert_eq!(format_variable_value("\x01".to_string()), "\\u{1}");
        assert_eq!(format_variable_value("\x02".to_string()), "\\u{2}");
        assert_eq!(format_variable_value("\x1f".to_string()), "\\u{1f}");

        // Test complex string with multiple special characters
        let complex = "Hello\n\"World\"\t\\Test\r\x1b[31mRed\x1b[0m";
        let expected = "Hello\\n\\\"World\\\"\\t\\\\Test\\r\\u{1b}[31mRed\\u{1b}[0m";
        assert_eq!(format_variable_value(complex.to_string()), expected);

        // Test empty string
        assert_eq!(format_variable_value("".to_string()), "");

        // Test string with no special characters
        assert_eq!(
            format_variable_value("Hello World".to_string()),
            "Hello World"
        );

        // Test emoji
        assert_eq!(
            format_variable_value("你好世界セメント한국어atīna👍".to_string()),
            "你好世界セメント한국어atīna👍"
        );
    }

    #[test]
    fn test_format_agg_value() {
        assert_eq!(format_agg_value(Some(42.5)), "42.5");
        assert_eq!(format_agg_value(Some(100.0)), "100");
        assert_eq!(format_agg_value(None), "");
    }

    #[tokio::test]
    async fn test_alert_create() {
        let org_id = "default";
        let stream_name = "default";
        let alert_name = "abc/alert";
        let mut alert: Alert = Default::default();
        alert.name = alert_name.to_string();
        let ret = save(org_id, stream_name, alert_name, alert, true, false).await;
        // alert name should not contain /
        assert!(ret.is_err());
    }

    #[tokio::test]
    async fn test_update_cron_expression_1() {
        let cron_exp = "* * * * * * *";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{now} * * * * * *");
        assert_eq!(new_cron_exp, updated);
    }

    #[tokio::test]
    async fn test_update_cron_expression_2() {
        let cron_exp = "47*/12 * * * * *";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        assert_eq!(new_cron_exp, "47*/12 * * * * *");
    }

    #[tokio::test]
    async fn test_update_cron_expression_3() {
        let cron_exp = "**/15 21-23,0-8 * * *";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{now} */15 21-23,0-8 * * *");
        assert_eq!(new_cron_exp, updated);
    }

    #[tokio::test]
    async fn test_update_cron_expression_4() {
        let cron_exp = "*10*****";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{now} 10*****");
        assert_eq!(new_cron_exp, updated);
    }

    #[tokio::test]
    async fn test_update_cron_expression_5() {
        let cron_exp = "* */10 2 * * * *";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{now} */10 2 * * * *");
        assert_eq!(new_cron_exp, updated);
    }

    #[tokio::test]
    async fn test_contains_operator_sql() {
        let condition = Condition {
            column: "auth_username".to_string(),
            operator: Operator::Contains,
            value: json!("enrique"),
            ignore_case: false,
        };
        let sql = build_expr(&condition, "", &DataType::Utf8).unwrap();
        assert_eq!(sql, "str_match(\"auth_username\", 'enrique')");
    }

    #[test]
    fn test_to_float_from_number() {
        let val = json!(42.5);
        assert_eq!(to_float(&val), 42.5);

        let val = json!(100);
        assert_eq!(to_float(&val), 100.0);

        let val = json!(0);
        assert_eq!(to_float(&val), 0.0);

        let val = json!(-50.25);
        assert_eq!(to_float(&val), -50.25);
    }

    #[test]
    fn test_to_float_from_string() {
        let val = json!("42.5");
        assert_eq!(to_float(&val), 42.5);

        let val = json!("100");
        assert_eq!(to_float(&val), 100.0);

        let val = json!("0");
        assert_eq!(to_float(&val), 0.0);

        let val = json!("-50.25");
        assert_eq!(to_float(&val), -50.25);
    }

    #[test]
    fn test_to_float_invalid_string() {
        let val = json!("not a number");
        assert_eq!(to_float(&val), 0.0);

        let val = json!("");
        assert_eq!(to_float(&val), 0.0);
    }

    #[test]
    fn test_to_float_null() {
        let val = json!(null);
        assert_eq!(to_float(&val), 0.0);
    }

    #[test]
    fn test_var_value_str_len() {
        let val = VarValue::Str("hello");
        assert_eq!(val.len(), 5);

        let val = VarValue::Str("");
        assert_eq!(val.len(), 0);

        let val = VarValue::Str("你好世界");
        assert_eq!(val.len(), 4);
    }

    #[test]
    fn test_var_value_json_array_len() {
        let values = vec![json!("one"), json!("two"), json!("three")];
        let val = VarValue::JsonArray(&values);
        assert_eq!(val.len(), 3);

        let empty: Vec<Value> = vec![];
        let val = VarValue::JsonArray(&empty);
        assert_eq!(val.len(), 0);
    }

    #[test]
    fn test_var_value_str_to_string_with_length() {
        let val = VarValue::Str("hello world");
        assert_eq!(val.to_string_with_length(5, false), "hello");
        assert_eq!(val.to_string_with_length(100, false), "hello world");
        assert_eq!(val.to_string_with_length(0, false), "hello world");
    }

    #[test]
    fn test_var_value_json_array_to_string_with_length() {
        let values = vec![json!("line1"), json!("line2"), json!("line3")];
        let val = VarValue::JsonArray(&values);

        // Test with separator for non-email
        assert_eq!(val.to_string_with_length(2, false), "line1\\nline2");
        assert_eq!(val.to_string_with_length(3, false), "line1\\nline2\\nline3");
        assert_eq!(
            val.to_string_with_length(100, false),
            "line1\\nline2\\nline3"
        );

        // Test with no separator for email
        assert_eq!(val.to_string_with_length(2, true), "line1line2");
        assert_eq!(val.to_string_with_length(3, true), "line1line2line3");
    }

    #[test]
    fn test_var_value_with_special_characters() {
        let val = VarValue::Str("hello\nworld\t!");
        let result = val.to_string_with_length(100, false);
        assert_eq!(result, "hello\\nworld\\t!");
    }

    #[test]
    fn test_process_variable_replace_simple() {
        let mut tpl = "Hello {name}, welcome!".to_string();
        process_variable_replace(&mut tpl, "name", &VarValue::Str("Alice"), false);
        assert_eq!(tpl, "Hello Alice, welcome!");
    }

    #[test]
    fn test_process_variable_replace_with_length() {
        let mut tpl = "Message: {msg:10}".to_string();
        process_variable_replace(
            &mut tpl,
            "msg",
            &VarValue::Str("This is a very long message"),
            false,
        );
        assert_eq!(tpl, "Message: This is a ");
    }

    #[test]
    fn test_process_variable_replace_json_array() {
        let values = vec![json!("row1"), json!("row2")];
        let mut tpl = "Rows: {rows}".to_string();
        process_variable_replace(&mut tpl, "rows", &VarValue::JsonArray(&values), false);
        assert_eq!(tpl, "Rows: row1\\nrow2");
    }

    #[test]
    fn test_process_variable_replace_no_match() {
        let mut tpl = "Hello {name}".to_string();
        let original = tpl.clone();
        process_variable_replace(&mut tpl, "age", &VarValue::Str("30"), false);
        assert_eq!(tpl, original); // Should remain unchanged
    }

    #[test]
    fn test_process_variable_replace_multiple_occurrences() {
        let mut tpl = "{name} says hello to {name}".to_string();
        process_variable_replace(&mut tpl, "name", &VarValue::Str("Bob"), false);
        assert_eq!(tpl, "Bob says hello to Bob");
    }

    #[test]
    fn test_get_row_column_map_empty() {
        let rows: Vec<Map<String, Value>> = vec![];
        let result = get_row_column_map(&rows);
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_row_column_map_single_row() {
        let mut row = Map::new();
        row.insert("name".to_string(), json!("Alice"));
        row.insert("age".to_string(), json!(30));
        let rows = vec![row];

        let result = get_row_column_map(&rows);
        assert_eq!(result.len(), 2);
        assert!(result.contains_key("name"));
        assert!(result.contains_key("age"));
        assert!(result.get("name").unwrap().contains("Alice"));
        assert!(result.get("age").unwrap().contains("30"));
    }

    #[test]
    fn test_get_row_column_map_multiple_rows() {
        let mut row1 = Map::new();
        row1.insert("name".to_string(), json!("Alice"));
        row1.insert("score".to_string(), json!(95.5));

        let mut row2 = Map::new();
        row2.insert("name".to_string(), json!("Bob"));
        row2.insert("score".to_string(), json!(87.3));

        let rows = vec![row1, row2];

        let result = get_row_column_map(&rows);
        assert_eq!(result.len(), 2);

        let names = result.get("name").unwrap();
        assert_eq!(names.len(), 2);
        assert!(names.contains("Alice"));
        assert!(names.contains("Bob"));

        let scores = result.get("score").unwrap();
        assert_eq!(scores.len(), 2);
        assert!(scores.contains("95.5"));
        assert!(scores.contains("87.3"));
    }

    #[test]
    fn test_get_row_column_map_duplicate_values() {
        let mut row1 = Map::new();
        row1.insert("status".to_string(), json!("active"));

        let mut row2 = Map::new();
        row2.insert("status".to_string(), json!("active"));

        let rows = vec![row1, row2];

        let result = get_row_column_map(&rows);
        let statuses = result.get("status").unwrap();
        // HashSet should deduplicate
        assert_eq!(statuses.len(), 1);
        assert!(statuses.contains("active"));
    }

    #[test]
    fn test_get_alert_start_end_time_with_given_time() {
        let vars = HashMap::new();
        let period = 5;
        let rows_end_time = 1000000;
        let start_time = Some(500000);
        let use_given_time = true;

        let (start, end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        assert_eq!(start, 500000);
        assert_eq!(end, 1000000);
    }

    #[test]
    fn test_get_alert_start_end_time_calculate_from_period() {
        let vars = HashMap::new();
        let period = 5; // 5 minutes
        let rows_end_time = 1000000;
        let start_time = None;
        let use_given_time = true;

        let (start, end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        assert_eq!(end, 1000000);
        assert!(start < end);
        // Should be approximately 5 minutes (300 seconds = 300,000,000 microseconds) before end
        assert!(end - start >= 299_000_000 && end - start <= 301_000_000);
    }

    #[test]
    fn test_get_alert_start_end_time_from_timestamp() {
        let mut vars = HashMap::new();
        let mut timestamps = HashSet::new();
        timestamps.insert("800000".to_string());
        timestamps.insert("900000".to_string());
        vars.insert(TIMESTAMP_COL_NAME.to_string(), timestamps);

        let period = 5;
        let rows_end_time = 1000000;
        let start_time = None;
        let use_given_time = false;

        let (start, end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        assert_eq!(start, 800000);
        // end should be 900000 + 1 minute (60,000,000 microseconds)
        assert_eq!(end, 60900000);
    }

    #[test]
    fn test_get_alert_start_end_time_from_sql_time() {
        let mut vars = HashMap::new();
        let mut min_times = HashSet::new();
        min_times.insert("700000".to_string());
        vars.insert("zo_sql_min_time".to_string(), min_times);

        let mut max_times = HashSet::new();
        max_times.insert("950000".to_string());
        vars.insert("zo_sql_max_time".to_string(), max_times);

        let period = 5;
        let rows_end_time = 1000000;
        let start_time = None;
        let use_given_time = false;

        let (start, end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        assert_eq!(start, 700000);
        // end should be 950000 + 1 minute (60,000,000 microseconds)
        assert_eq!(end, 60950000);
    }

    #[test]
    fn test_get_alert_start_end_time_no_data() {
        let vars = HashMap::new();
        let period = 10; // 10 minutes
        let rows_end_time = 2000000;
        let start_time = None;
        let use_given_time = false;

        let (start, end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        // Should use rows_end_time as end
        assert_eq!(end, 2000000);
        // Should calculate start from period
        assert!(end - start >= 599_000_000 && end - start <= 601_000_000); // ~10 minutes
    }

    #[test]
    fn test_get_alert_start_end_time_time_range_too_small() {
        let mut vars = HashMap::new();
        let mut timestamps = HashSet::new();
        // Very close timestamps (less than 1 minute apart)
        timestamps.insert("1000000".to_string());
        timestamps.insert("1001000".to_string());
        vars.insert(TIMESTAMP_COL_NAME.to_string(), timestamps);

        let period = 5;
        let rows_end_time = 1002000;
        let start_time = Some(1000000);
        let use_given_time = false;

        let (start, end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        // The end time will be max timestamp + 1 minute = 1001000 + 60,000,000
        assert_eq!(end, 61001000);
        // When time range is too small and start_time is provided, it should use provided
        // start_time
        assert_eq!(start, 1000000);
    }

    #[test]
    fn test_get_alert_start_end_time_with_explicit_start_time() {
        let vars = HashMap::new();
        let period = 15;
        let rows_end_time = 3000000;
        let start_time = Some(1500000);
        let use_given_time = false;

        let (start, _end) =
            get_alert_start_end_time(&vars, period, rows_end_time, start_time, use_given_time);
        // When range is too small, should use provided start_time
        assert!(start <= 1500000 || start == 3000000 - 15 * 60 * 1_000_000);
    }

    #[test]
    fn test_check_json_context_simple() {
        let tpl = r#"{"hits": "{rows}"}"#;
        assert!(check_json_context(tpl, "rows"));
    }

    #[test]
    fn test_check_json_context_with_spaces() {
        let tpl = r#"{"hits":  "{rows}"  }"#;
        assert!(check_json_context(tpl, "rows"));
    }

    #[test]
    fn test_check_json_context_not_json() {
        let tpl = r#"{"hits": "The hits got {rows}"}"#;
        assert!(!check_json_context(tpl, "rows"));
    }

    #[test]
    fn test_check_json_context_in_middle_of_text() {
        let tpl = r#"This is {rows} in text"#;
        assert!(!check_json_context(tpl, "rows"));
    }

    #[test]
    fn test_check_json_context_with_comma() {
        let tpl = r#"{"hits": "{rows}", "count": 5}"#;
        assert!(check_json_context(tpl, "rows"));
    }

    #[test]
    fn test_var_value_json_array() {
        let json_vals = vec![
            json!({"name": "Alice", "age": 30}),
            json!({"name": "Bob", "age": 25}),
        ];
        let val = VarValue::JsonArray(&json_vals);
        assert_eq!(val.len(), 2);
    }

    #[test]
    fn test_var_value_json_array_to_string() {
        let json_vals = vec![json!({"name": "Alice"}), json!({"name": "Bob"})];
        let val = VarValue::JsonArray(&json_vals);
        let result = val.to_string_with_length(2, false);
        assert!(result.contains("Alice"));
        assert!(result.contains("Bob"));
        assert!(result.contains("\\n"));
    }

    #[test]
    fn test_process_row_template_json_type() {
        let row_template = r#"{"user": "{name}", "score": "{score}"}"#.to_string();
        let mut row1 = Map::new();
        row1.insert("name".to_string(), json!("Alice"));
        row1.insert("score".to_string(), json!(95));
        let rows = vec![row1];

        let mut alert = Alert::default();
        alert.row_template_type = RowTemplateType::Json;

        let result = process_row_template(
            "test_org",
            &row_template,
            &alert,
            RowTemplateType::Json,
            &rows,
        );

        assert_eq!(result.len(), 1);
        assert!(result[0].is_object());

        let obj = result[0].as_object().unwrap();
        assert_eq!(obj.get("user").unwrap().as_str().unwrap(), "Alice");
        assert_eq!(obj.get("score").unwrap().as_str().unwrap(), "95");
    }

    #[test]
    fn test_process_row_template_string_type() {
        let row_template = "User: {name}, Score: {score}".to_string();
        let mut row1 = Map::new();
        row1.insert("name".to_string(), json!("Alice"));
        row1.insert("score".to_string(), json!(95));
        let rows = vec![row1];

        let mut alert = Alert::default();
        alert.row_template_type = RowTemplateType::String;

        let result = process_row_template(
            "test_org",
            &row_template,
            &alert,
            RowTemplateType::String,
            &rows,
        );

        assert_eq!(result.len(), 1);
        assert!(result[0].is_string());
        assert_eq!(result[0].as_str().unwrap(), "User: Alice, Score: 95");
    }

    #[test]
    fn test_process_row_template_json_type_invalid_json_fallback() {
        let row_template = "This is not valid JSON: {name}".to_string();
        let mut row1 = Map::new();
        row1.insert("name".to_string(), json!("Alice"));
        let rows = vec![row1];

        let mut alert = Alert::default();
        alert.row_template_type = RowTemplateType::Json;

        let result = process_row_template(
            "test_org",
            &row_template,
            &alert,
            RowTemplateType::Json,
            &rows,
        );

        assert_eq!(result.len(), 1);
        // Should fallback to string when JSON parsing fails
        assert!(result[0].is_string());
    }

    #[test]
    fn test_json_array_backward_compatibility_with_string_values() {
        // This test verifies that JsonArray with Value::String behaves identically
        // to the old Vector implementation with plain strings

        // Simulate what process_row_template returns for String type templates
        let string_values = vec![
            Value::String("Alert 1: User Alice logged in".to_string()),
            Value::String("Alert 2: User Bob logged out".to_string()),
            Value::String("Alert 3: System startup".to_string()),
        ];

        // Test that JsonArray handles these string values correctly
        let var_value = VarValue::JsonArray(&string_values);

        // Verify length
        assert_eq!(var_value.len(), 3);

        // Verify string conversion with newline separator (non-email)
        let result_non_email = var_value.to_string_with_length(3, false);
        assert_eq!(
            result_non_email,
            "Alert 1: User Alice logged in\\nAlert 2: User Bob logged out\\nAlert 3: System startup"
        );

        // Verify string conversion without separator (email)
        let result_email = var_value.to_string_with_length(3, true);
        assert_eq!(
            result_email,
            "Alert 1: User Alice logged inAlert 2: User Bob logged outAlert 3: System startup"
        );

        // Verify length limiting works
        let result_limited = var_value.to_string_with_length(2, false);
        assert_eq!(
            result_limited,
            "Alert 1: User Alice logged in\\nAlert 2: User Bob logged out"
        );
    }

    #[test]
    fn test_json_array_injection_with_string_values() {
        // Test that Value::String containing JSON gets properly parsed and injected
        // This simulates what happens when row_template_type is Json and the template
        // produces JSON strings that need to be injected as actual JSON objects

        let json_str1 = r#"{"level": "error", "job": "test"}"#;
        let json_str2 = r#"{"level": "warn", "job": "test2"}"#;

        // Simulate rows_tpl_val containing Value::String with JSON content
        let rows_tpl_val = [
            Value::String(json_str1.to_string()),
            Value::String(json_str2.to_string()),
        ];

        // Parse them as the fix does
        let mut parsed_values = Vec::new();
        for v in rows_tpl_val.iter() {
            if let Value::String(s) = v {
                if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                    parsed_values.push(parsed)
                }
            } else {
                parsed_values.push(v.clone());
            }
        }

        // Create the array and serialize
        let json_array = Value::Array(parsed_values);
        let json_str = serde_json::to_string(&json_array).unwrap();

        // Verify it's a proper JSON array (not escaped strings)
        let deserialized: Value = serde_json::from_str(&json_str).unwrap();
        assert!(deserialized.is_array());

        let arr = deserialized.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert!(arr[0].is_object());
        assert!(arr[1].is_object());

        // Verify the objects have the correct structure
        assert_eq!(arr[0]["level"], "error");
        assert_eq!(arr[0]["job"], "test");
        assert_eq!(arr[1]["level"], "warn");
        assert_eq!(arr[1]["job"], "test2");
    }

    #[test]
    fn test_check_json_context_valid_cases() {
        // Basic case with closing brace: "key": "{rows}"
        assert!(check_json_context(r#""data": "{rows}"}"#, "rows"));

        // Basic case with comma: "key": "{rows}",
        assert!(check_json_context(r#""data": "{rows}","#, "rows"));

        // With comma and more fields after
        assert!(check_json_context(
            r#""data": "{rows}", "other": "value""#,
            "rows"
        ));

        // With whitespace before colon
        assert!(check_json_context(r#""data" : "{rows}"}"#, "rows"));

        // With whitespace after colon
        assert!(check_json_context(r#""data":  "{rows}"}"#, "rows"));

        // With whitespace before comma
        assert!(check_json_context(r#""data": "{rows}" ,"#, "rows"));

        // With whitespace before closing brace
        assert!(check_json_context(r#""data": "{rows}" }"#, "rows"));

        // Nested in object
        assert!(check_json_context(
            r#"{"items": "{rows}", "count": 5}"#,
            "rows"
        ));

        // Multiple levels of nesting
        assert!(check_json_context(
            r#"{"outer": {"inner": "{rows}"}}"#,
            "rows"
        ));

        // Different variable names
        assert!(check_json_context(r#""items": "{data}"}"#, "data"));
        assert!(check_json_context(r#""result": "{result}"}"#, "result"));
        assert!(check_json_context(r#""count": "{count}"}"#, "count"));
    }

    #[test]
    fn test_check_json_context_invalid_cases() {
        // Variable with text before it (string interpolation)
        assert!(!check_json_context(r#""data": "prefix {rows}""#, "rows"));

        // Variable with text after it (string interpolation)
        assert!(!check_json_context(r#""data": "{rows} suffix""#, "rows"));

        // Variable with text on both sides
        assert!(!check_json_context(
            r#""data": "prefix {rows} suffix""#,
            "rows"
        ));

        // Missing quotes around variable
        assert!(!check_json_context(r#""data": {rows}"#, "rows"));

        // Not after a colon (not in value position)
        assert!(!check_json_context(r#""{rows}": "value""#, "rows"));

        // In middle of string with other content
        assert!(!check_json_context(
            r#""data": "Total: {rows} items""#,
            "rows"
        ));

        // Not followed by comma or closing brace
        assert!(!check_json_context(r#""data": "{rows}" "other""#, "rows"));

        // Variable not present
        assert!(!check_json_context(r#""data": "value""#, "rows"));

        // Variable without quotes
        assert!(!check_json_context(
            r#""data": {rows}, "other": "value""#,
            "rows"
        ));

        // Wrong variable name
        assert!(!check_json_context(r#""data": "{other}""#, "rows"));
    }

    #[test]
    fn test_check_json_context_edge_cases() {
        // Empty template
        assert!(!check_json_context("", "rows"));

        // Only the variable
        assert!(!check_json_context(r#""{rows}""#, "rows"));

        // Variable at start without proper JSON context
        assert!(!check_json_context(r#""{rows}", "other": "value""#, "rows"));

        // Multiple occurrences - should match the first valid one
        assert!(check_json_context(
            r#""data": "{rows}", "backup": "old {rows} data""#,
            "rows"
        ));

        // Tab characters instead of spaces
        assert!(check_json_context("\"data\":\t\"{rows}\"\t,", "rows"));

        // Newlines in template
        assert!(check_json_context("\"data\": \"{rows}\"\n,", "rows"));

        // Real-world webhook payload example
        assert!(check_json_context(
            r#"{"alert": "test", "rows": "{rows}", "count": 5}"#,
            "rows"
        ));

        // Array context (should still work)
        assert!(check_json_context(
            r#"{"items": [{"data": "{rows}"}]}"#,
            "rows"
        ));
    }

    #[test]
    fn test_check_json_context_special_characters() {
        // Variable name with underscores
        assert!(check_json_context(r#""data": "{row_data}"}"#, "row_data"));

        // Variable name with numbers
        assert!(check_json_context(r#""data": "{rows123}"}"#, "rows123"));

        // Escaped quotes in surrounding JSON (valid JSON)
        assert!(check_json_context(
            r#""data": "{rows}", "msg": "test\"quote""#,
            "rows"
        ));
    }

    #[test]
    fn test_check_json_context_with_limit() {
        // "{rows:1}" in JSON value position
        assert!(check_json_context(r#""fields": "{rows:1}"}"#, "rows"));

        // "{rows:10}" with larger number
        assert!(check_json_context(r#""data": "{rows:10}","#, "rows"));

        // "{rows:3}" nested in object
        assert!(check_json_context(
            r#"{"embeds": [{"fields": "{rows:3}"}]}"#,
            "rows"
        ));

        // "{rows:N}" not in value position — should be false
        assert!(!check_json_context(r#""{rows:2}": "value""#, "rows"));

        // "{rows:N}" with text around it — should be false
        assert!(!check_json_context(r#""data": "prefix {rows:1}""#, "rows"));
    }

    #[test]
    fn test_extract_rows_limit() {
        // Simple "{rows:1}"
        assert_eq!(extract_rows_limit(r#""fields": "{rows:1}""#), Some(1));

        // Larger limit
        assert_eq!(extract_rows_limit(r#""data": "{rows:25}""#), Some(25));

        // No limit — just "{rows}"
        assert_eq!(extract_rows_limit(r#""data": "{rows}""#), None);

        // No rows pattern at all
        assert_eq!(extract_rows_limit(r#""data": "something""#), None);
    }

    #[tokio::test]
    async fn test_process_dest_template_json_rows_single_objects() {
        // JSON row template producing single objects: "{rows}" → [obj1, obj2]
        let dest_tpl = r#"{"alert": "{alert_name}", "data": "{rows}"}"#;
        let rows_tpl_val = vec![
            json!({"user": "Alice", "score": 95}),
            json!({"user": "Bob", "score": 80}),
        ];
        let mut row1 = Map::new();
        row1.insert("user".to_string(), json!("Alice"));
        row1.insert("score".to_string(), json!(95));
        let mut row2 = Map::new();
        row2.insert("user".to_string(), json!("Bob"));
        row2.insert("score".to_string(), json!(80));
        let rows = vec![row1, row2];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        // The result should be valid JSON with rows as a JSON array of objects
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let data = &parsed["data"];
        assert!(data.is_array());
        let arr = data.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["user"], "Alice");
        assert_eq!(arr[1]["user"], "Bob");
    }

    #[tokio::test]
    async fn test_process_dest_template_json_rows_with_limit() {
        // "{rows:1}" should limit to 1 row
        let dest_tpl = r#"{"data": "{rows:1}"}"#;
        let rows_tpl_val = vec![
            json!({"user": "Alice"}),
            json!({"user": "Bob"}),
            json!({"user": "Charlie"}),
        ];
        let mut row1 = Map::new();
        row1.insert("user".to_string(), json!("Alice"));
        let mut row2 = Map::new();
        row2.insert("user".to_string(), json!("Bob"));
        let mut row3 = Map::new();
        row3.insert("user".to_string(), json!("Charlie"));
        let rows = vec![row1, row2, row3];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        let data = &parsed["data"];
        assert!(data.is_array());
        let arr = data.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["user"], "Alice");
    }

    #[tokio::test]
    async fn test_process_dest_template_json_rows_array_row_template() {
        // Row template produces an array of objects per row — result is array of arrays
        let dest_tpl = r#"{"embeds": [{"fields": "{rows}"}]}"#;
        let rows_tpl_val = vec![json!([
            {"name": "URL", "value": "/api/test"},
            {"name": "Method", "value": "GET"}
        ])];
        let mut row1 = Map::new();
        row1.insert("url".to_string(), json!("/api/test"));
        row1.insert("method".to_string(), json!("GET"));
        let rows = vec![row1];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        let fields = &parsed["embeds"][0]["fields"];
        assert!(fields.is_array());
        // Single row producing an array → result is [[obj, obj]]
        let outer = fields.as_array().unwrap();
        assert_eq!(outer.len(), 1);
        assert!(outer[0].is_array());
        let inner = outer[0].as_array().unwrap();
        assert_eq!(inner.len(), 2);
        assert_eq!(inner[0]["name"], "URL");
        assert_eq!(inner[1]["name"], "Method");
    }

    #[tokio::test]
    async fn test_process_dest_template_string_rows_unchanged() {
        // String row template values (Value::String) should use the old string replacement path
        let dest_tpl = r#"{"data": "{rows}"}"#;
        let rows_tpl_val = vec![
            Value::String("Alert 1: user Alice".to_string()),
            Value::String("Alert 2: user Bob".to_string()),
        ];
        let mut row1 = Map::new();
        row1.insert("user".to_string(), json!("Alice"));
        let mut row2 = Map::new();
        row2.insert("user".to_string(), json!("Bob"));
        let rows = vec![row1, row2];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        // String values should be joined with \n (non-email), not injected as JSON array
        assert!(result.contains("Alert 1: user Alice"));
        assert!(result.contains("Alert 2: user Bob"));
        // Should NOT be a JSON array
        assert!(!result.contains("[\"Alert 1"));
    }

    #[test]
    fn test_check_json_context_with_spread() {
        // "{...rows}" in JSON value position
        assert!(check_json_context(r#""fields": "{...rows}"}"#, "rows"));
        assert!(check_json_context(r#""fields": "{...rows}","#, "rows"));

        // "{...rows:N}" in JSON value position
        assert!(check_json_context(r#""fields": "{...rows:3}"}"#, "rows"));
        assert!(check_json_context(
            r#"{"embeds": [{"fields": "{...rows:1}"}]}"#,
            "rows"
        ));

        // Not in value position — should be false
        assert!(!check_json_context(r#""{...rows}": "value""#, "rows"));
        assert!(!check_json_context(r#""data": "prefix {...rows}""#, "rows"));
    }

    #[test]
    fn test_extract_spread_rows_limit() {
        assert_eq!(
            extract_spread_rows_limit(r#""fields": "{...rows:1}""#),
            Some(1)
        );
        assert_eq!(
            extract_spread_rows_limit(r#""data": "{...rows:10}""#),
            Some(10)
        );
        assert_eq!(extract_spread_rows_limit(r#""data": "{...rows}""#), None);
        assert_eq!(extract_spread_rows_limit(r#""data": "{rows:3}""#), None);
    }

    #[test]
    fn test_has_spread_rows() {
        assert!(has_spread_rows(r#""fields": "{...rows}""#));
        assert!(has_spread_rows(r#""fields": "{...rows:2}""#));
        assert!(!has_spread_rows(r#""fields": "{rows}""#));
        assert!(!has_spread_rows(r#""fields": "{rows:2}""#));
    }

    #[tokio::test]
    async fn test_process_dest_template_spread_rows_flattens_arrays() {
        // "{...rows}" should flatten array row templates into a single array
        let dest_tpl = r#"{"embeds": [{"fields": "{...rows}"}]}"#;
        let rows_tpl_val = vec![
            json!([
                {"name": "URL", "value": "/api/test"},
                {"name": "Method", "value": "GET"}
            ]),
            json!([
                {"name": "URL", "value": "/api/other"},
                {"name": "Method", "value": "POST"}
            ]),
        ];
        let mut row1 = Map::new();
        row1.insert("url".to_string(), json!("/api/test"));
        let mut row2 = Map::new();
        row2.insert("url".to_string(), json!("/api/other"));
        let rows = vec![row1, row2];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        let fields = &parsed["embeds"][0]["fields"];
        assert!(fields.is_array());
        // Flattened: 2 rows x 2 objects each = 4 objects in a flat array
        let arr = fields.as_array().unwrap();
        assert_eq!(arr.len(), 4);
        assert_eq!(arr[0]["name"], "URL");
        assert_eq!(arr[0]["value"], "/api/test");
        assert_eq!(arr[1]["name"], "Method");
        assert_eq!(arr[1]["value"], "GET");
        assert_eq!(arr[2]["name"], "URL");
        assert_eq!(arr[2]["value"], "/api/other");
        assert_eq!(arr[3]["name"], "Method");
        assert_eq!(arr[3]["value"], "POST");
    }

    #[tokio::test]
    async fn test_process_dest_template_spread_rows_with_limit() {
        // "{...rows:1}" should limit to 1 row then flatten
        let dest_tpl = r#"{"fields": "{...rows:1}"}"#;
        let rows_tpl_val = vec![
            json!([
                {"name": "URL", "value": "/api/test"},
                {"name": "Method", "value": "GET"}
            ]),
            json!([
                {"name": "URL", "value": "/api/other"},
                {"name": "Method", "value": "POST"}
            ]),
        ];
        let mut row1 = Map::new();
        row1.insert("url".to_string(), json!("/api/test"));
        let mut row2 = Map::new();
        row2.insert("url".to_string(), json!("/api/other"));
        let rows = vec![row1, row2];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        let fields = &parsed["fields"];
        assert!(fields.is_array());
        // Only 1 row (with 2 objects) flattened
        let arr = fields.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["name"], "URL");
        assert_eq!(arr[0]["value"], "/api/test");
        assert_eq!(arr[1]["name"], "Method");
        assert_eq!(arr[1]["value"], "GET");
    }

    #[tokio::test]
    async fn test_process_dest_template_spread_rows_single_objects() {
        // "{...rows}" with single object rows (no arrays) — works like "{rows}"
        let dest_tpl = r#"{"data": "{...rows}"}"#;
        let rows_tpl_val = vec![json!({"user": "Alice"}), json!({"user": "Bob"})];
        let mut row1 = Map::new();
        row1.insert("user".to_string(), json!("Alice"));
        let mut row2 = Map::new();
        row2.insert("user".to_string(), json!("Bob"));
        let rows = vec![row1, row2];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        let data = &parsed["data"];
        assert!(data.is_array());
        let arr = data.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["user"], "Alice");
        assert_eq!(arr[1]["user"], "Bob");
    }

    // ── update_cron_expression ──────────────────────────────────────────────

    #[test]
    fn test_update_cron_expression_no_star_prefix() {
        // Does not start with '*' → unchanged
        let cron_exp = "30 * * * * *";
        let result = update_cron_expression(cron_exp, 15);
        assert_eq!(result, "30 * * * * *");
    }

    #[test]
    fn test_update_cron_expression_empty_string() {
        // Empty string starts with '*'? No, it is empty → unchanged
        let result = update_cron_expression("", 10);
        assert_eq!(result, "");
    }

    #[test]
    fn test_update_cron_expression_star_only() {
        // "*" alone — after split on '*' rest is "" which trims to ""
        let result = update_cron_expression("*", 7);
        assert_eq!(result, "7 ");
    }

    #[test]
    fn test_update_cron_expression_leading_whitespace_not_star() {
        // Leading space means it does NOT start with '*'
        let cron_exp = " * * * * *";
        let result = update_cron_expression(cron_exp, 5);
        // trim() removes leading space, but the trimmed string starts with '*'
        assert_eq!(result, "5 * * * *");
    }

    #[test]
    fn test_update_cron_expression_zero_seconds() {
        let result = update_cron_expression("* */5 * * * *", 0);
        assert_eq!(result, "0 */5 * * * *");
    }

    // ── format_variable_value ──────────────────────────────────────────────

    #[test]
    fn test_format_variable_value_single_quote() {
        assert_eq!(format_variable_value("'".to_string()), "\\\\'");
    }

    #[test]
    fn test_format_variable_value_soh_stx_us() {
        // \x01 SOH, \x02 STX, \x1f US — each has a dedicated arm
        assert_eq!(format_variable_value("\x01".to_string()), "\\u{1}");
        assert_eq!(format_variable_value("\x02".to_string()), "\\u{2}");
        assert_eq!(format_variable_value("\x1f".to_string()), "\\u{1f}");
    }

    #[test]
    fn test_format_variable_value_mixed_unicode_and_control() {
        let input = "hi\x01\x02\x1fthere";
        let result = format_variable_value(input.to_string());
        assert_eq!(result, "hi\\u{1}\\u{2}\\u{1f}there");
    }

    #[test]
    fn test_format_variable_value_all_printable_ascii() {
        let input = "Hello, World! 123";
        assert_eq!(format_variable_value(input.to_string()), input);
    }

    // ── is_json_value_position ─────────────────────────────────────────────

    #[test]
    fn test_is_json_value_position_not_after_colon() {
        // Pattern present but not preceded by ':'
        assert!(!is_json_value_position(
            r#"some "{rows}" text"#,
            r#""{rows}""#
        ));
    }

    #[test]
    fn test_is_json_value_position_followed_by_other_char() {
        // Preceded by ':' but followed by a regular char, not ',' or '}'
        assert!(!is_json_value_position(
            r#""k": "{rows}" "other""#,
            r#""{rows}""#
        ));
    }

    #[test]
    fn test_is_json_value_position_pattern_absent() {
        assert!(!is_json_value_position(r#""k": "value"}"#, r#""{rows}""#));
    }

    #[test]
    fn test_is_json_value_position_valid_with_closing_brace() {
        assert!(is_json_value_position(r#""k": "{rows}"}"#, r#""{rows}""#));
    }

    // ── check_json_context_with_prefix ────────────────────────────────────

    #[test]
    fn test_check_json_context_with_prefix_non_numeric_suffix() {
        // Prefix found but the part between prefix and `}"` is not a number
        let tpl = r#""data": "{rows:abc}""#;
        assert!(!check_json_context_with_prefix(tpl, "\"{rows:"));
    }

    #[test]
    fn test_check_json_context_with_prefix_no_closing() {
        // Prefix present but no `}"` terminator
        let tpl = r#""data": "{rows:3"#;
        assert!(!check_json_context_with_prefix(tpl, "\"{rows:"));
    }

    #[test]
    fn test_check_json_context_with_prefix_valid() {
        let tpl = r#""data": "{rows:5}"}"#;
        assert!(check_json_context_with_prefix(tpl, "\"{rows:"));
    }

    // ── extract_limit_with_prefix ──────────────────────────────────────────

    #[test]
    fn test_extract_limit_with_prefix_no_prefix() {
        assert_eq!(
            extract_limit_with_prefix(r#""data": "{rows}""#, "\"{rows:"),
            None
        );
    }

    #[test]
    fn test_extract_limit_with_prefix_non_numeric() {
        // The value between prefix and `}"` is not a valid usize
        assert_eq!(
            extract_limit_with_prefix(r#""data": "{rows:xyz}""#, "\"{rows:"),
            None
        );
    }

    #[test]
    fn test_extract_limit_with_prefix_zero() {
        // "0" parses to 0 as usize
        assert_eq!(
            extract_limit_with_prefix(r#""data": "{rows:0}""#, "\"{rows:"),
            Some(0)
        );
    }

    #[test]
    fn test_extract_rows_limit_large_number() {
        assert_eq!(extract_rows_limit(r#""data": "{rows:1000}""#), Some(1000));
    }

    // ── process_variable_replace edge cases ───────────────────────────────

    #[test]
    fn test_process_variable_replace_with_zero_length_spec() {
        // {msg:0} → len is 0, which means no-op truncation (len guard: len > 0)
        let mut tpl = "Message: {msg:0}".to_string();
        process_variable_replace(&mut tpl, "msg", &VarValue::Str("hello"), false);
        // len == 0 parsed → no replacement (the guard `if len > 0` is false)
        assert_eq!(tpl, "Message: {msg:0}");
    }

    #[test]
    fn test_process_variable_replace_length_exceeds_value() {
        // Requested length larger than actual value length → full value
        let mut tpl = "Data: {val:100}".to_string();
        process_variable_replace(&mut tpl, "val", &VarValue::Str("short"), false);
        assert_eq!(tpl, "Data: short");
    }

    #[test]
    fn test_process_variable_replace_email_separator() {
        let values = vec![json!("a"), json!("b"), json!("c")];
        let mut tpl = "Items: {rows}".to_string();
        process_variable_replace(&mut tpl, "rows", &VarValue::JsonArray(&values), true);
        // email=true → empty separator
        assert_eq!(tpl, "Items: abc");
    }

    // ── VarValue edge cases ────────────────────────────────────────────────

    #[test]
    fn test_var_value_str_to_string_exact_length() {
        let val = VarValue::Str("abcde");
        assert_eq!(val.to_string_with_length(5, false), "abcde");
    }

    #[test]
    fn test_var_value_json_array_empty_to_string() {
        let empty: Vec<Value> = vec![];
        let val = VarValue::JsonArray(&empty);
        assert_eq!(val.to_string_with_length(0, false), "");
        assert_eq!(val.to_string_with_length(5, false), "");
    }

    #[test]
    fn test_var_value_json_null_and_bool() {
        let values = vec![json!(null), json!(true), json!(false)];
        let val = VarValue::JsonArray(&values);
        let result = val.to_string_with_length(3, false);
        // null → "null", true → "true", false → "false" (JSON serialisation)
        assert!(result.contains("null"));
        assert!(result.contains("true"));
        assert!(result.contains("false"));
    }

    // ── get_row_column_map with non-string values ──────────────────────────

    #[test]
    fn test_get_row_column_map_null_value() {
        let mut row = Map::new();
        row.insert("field".to_string(), json!(null));
        let result = get_row_column_map(&[row]);
        // null is not string / not f64 → value.to_string() → "null"
        assert!(result.get("field").unwrap().contains("null"));
    }

    #[test]
    fn test_get_row_column_map_bool_value() {
        let mut row = Map::new();
        row.insert("active".to_string(), json!(true));
        let result = get_row_column_map(&[row]);
        assert!(result.get("active").unwrap().contains("true"));
    }

    #[test]
    fn test_get_row_column_map_integer_value() {
        let mut row = Map::new();
        row.insert("count".to_string(), json!(42u64));
        let result = get_row_column_map(&[row]);
        // integers serialize as floats via as_f64: "42" or "42.0" depending on variant
        let set = result.get("count").unwrap();
        assert!(!set.is_empty());
    }

    // ── get_alert_start_end_time additional branches ───────────────────────

    #[test]
    fn test_get_alert_start_end_time_use_given_time_no_start() {
        // use_given_time=true, start_time=None → falls back to rows_end_time - period
        let vars = HashMap::new();
        let period = 10i64; // 10 minutes
        let rows_end_time = 1_000_000_000i64;
        let (start, end) = get_alert_start_end_time(&vars, period, rows_end_time, None, true);
        assert_eq!(end, rows_end_time);
        let expected_start = rows_end_time
            - Duration::try_minutes(period)
                .unwrap()
                .num_microseconds()
                .unwrap();
        assert_eq!(start, expected_start);
    }

    #[test]
    fn test_get_alert_start_end_time_only_min_time() {
        // Only zo_sql_min_time set, no max or timestamp.
        // alert_end_time stays 0 → falls back to rows_end_time.
        // Then end-start < 1 minute → start is reset to end - period_micros.
        let mut vars = HashMap::new();
        let mut min_times = HashSet::new();
        min_times.insert("5000000".to_string());
        vars.insert("zo_sql_min_time".to_string(), min_times);

        let period = 5i64;
        let rows_end_time = 10_000_000i64;
        let one_min_us = Duration::try_minutes(1)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let period_us = Duration::try_minutes(period)
            .unwrap()
            .num_microseconds()
            .unwrap();

        let (start, end) = get_alert_start_end_time(&vars, period, rows_end_time, None, false);
        // end: alert_end_time==0 → rows_end_time
        assert_eq!(end, rows_end_time);
        // end - start must be >= 1 minute (code resets start when it's too small)
        assert!(end - start >= one_min_us);
        // with start_time=None the reset puts start = end - period_us
        assert_eq!(start, end - period_us);
    }

    #[test]
    fn test_get_alert_start_end_time_only_max_time() {
        // Only zo_sql_max_time set. Use a value that parses cleanly (no underscores in string).
        let mut vars = HashMap::new();
        let mut max_times = HashSet::new();
        // 9 million microseconds — write without underscores so .parse::<i64>() succeeds
        max_times.insert("9000000".to_string());
        vars.insert("zo_sql_max_time".to_string(), max_times);

        let period = 2i64; // 2 minutes
        let rows_end_time = 10_000_000i64;
        let one_min_us = Duration::try_minutes(1)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let period_us = Duration::try_minutes(period)
            .unwrap()
            .num_microseconds()
            .unwrap();

        let (start, end) = get_alert_start_end_time(&vars, period, rows_end_time, None, false);
        // end = max_time + 1 minute = 9_000_000 + 60_000_000 = 69_000_000
        let expected_end = 9_000_000 + one_min_us;
        assert_eq!(end, expected_end);
        // end - start = period_us (reset because range < 1 min before adding 1 min)
        // Actually end-start = 69_000_000 - start. The code resets when end-start < one_min_us.
        // 69_000_000 - 9_000_000 = 60_000_000 = exactly one_min_us, NOT < one_min_us → no reset.
        // So start stays at alert_start_time=0 → reset to end - period_us.
        assert_eq!(start, expected_end - period_us);
    }

    // ── AlertError Display ─────────────────────────────────────────────────

    #[test]
    fn test_alert_error_display_messages() {
        assert_eq!(
            AlertError::AlertNameMissing.to_string(),
            "Alert name is required"
        );
        assert_eq!(
            AlertError::AlertDestinationMissing.to_string(),
            "Alert destination or workflows is required"
        );
        assert_eq!(AlertError::AlertNotFound.to_string(), "Alert not found");
        assert_eq!(
            AlertError::SqlMissingQuery.to_string(),
            "Alert with SQL mode should have a query"
        );
        assert_eq!(
            AlertError::PromqlMissingQuery.to_string(),
            "Alert with PromQL mode should have a query"
        );
        assert_eq!(
            AlertError::SqlContainsSelectStar.to_string(),
            "Alert with SQL can not contain SELECT * in the SQL query"
        );
        assert_eq!(
            AlertError::RealtimeMissingCustomQuery.to_string(),
            "Realtime alert should use Custom query type"
        );
        assert_eq!(
            AlertError::AlertIdMissing.to_string(),
            "Alert ID is required"
        );
        assert_eq!(
            AlertError::AlertNameContainsForwardSlash.to_string(),
            "Alert name cannot contain '/'"
        );
    }

    #[test]
    fn test_alert_error_display_with_params() {
        let e = AlertError::AlertDestinationNotFound {
            dest: "slack_channel".to_string(),
        };
        assert_eq!(e.to_string(), "Alert destination slack_channel not found");

        let e = AlertError::StreamNotFound {
            stream_name: "my_stream".to_string(),
        };
        assert_eq!(e.to_string(), "Stream my_stream not found");

        let e = AlertError::AlertTemplateNotFound {
            template: "default_tpl".to_string(),
        };
        assert_eq!(e.to_string(), "Alert template default_tpl not found");

        let e = AlertError::PeriodExceedsMaxQueryRange {
            max_query_range_hours: 24,
            stream_name: "events".to_string(),
        };
        assert!(e.to_string().contains("24"));
        assert!(e.to_string().contains("events"));

        let e = AlertError::SendNotificationError {
            error_message: "timeout".to_string(),
        };
        assert_eq!(e.to_string(), "timeout");

        let e = AlertError::PermissionDenied;
        assert_eq!(e.to_string(), "Permission denied");

        let e = AlertError::UserNotFound;
        assert_eq!(e.to_string(), "User not found");

        let e = AlertError::CreateFolderNotFound;
        assert_eq!(
            e.to_string(),
            "Error creating alert in folder that cannot be found"
        );
    }

    // ── has_spread_rows additional branches ───────────────────────────────

    #[test]
    fn test_has_spread_rows_with_and_without_limit() {
        // Both forms detected
        assert!(has_spread_rows(r#""{...rows}""#));
        assert!(has_spread_rows(r#""{...rows:5}""#));
        // Neither form
        assert!(!has_spread_rows(r#""{rows}""#));
        assert!(!has_spread_rows("no rows here"));
    }

    // ── check_json_context spread patterns ────────────────────────────────

    #[test]
    fn test_check_json_context_spread_with_limit_not_in_json_pos() {
        // "{...rows:3}" preceded by text prefix — not pure JSON value position
        assert!(!check_json_context(r#""data": "prefix {rows:3}""#, "rows"));
    }

    #[test]
    fn test_check_json_context_spread_different_var() {
        // spread pattern for a different variable name
        assert!(check_json_context(r#""fields": "{...items}"}"#, "items"));
        // should not match "rows"
        assert!(!check_json_context(r#""fields": "{...items}"}"#, "rows"));
    }

    // ── {var:N} length-suffix bug fixes (regression tests) ────────────────

    /// Bug 2 (`process_variable_replace`): a template that contains *only*
    /// `{var:N}` (no bare `{var}`) must still get truncated.
    #[test]
    fn test_process_variable_replace_only_length_form() {
        let mut tpl = "stack: {exception_stacktrace:5}".to_string();
        process_variable_replace(
            &mut tpl,
            "exception_stacktrace",
            &VarValue::Str("NullPointerException at line 42"),
            false,
        );
        assert_eq!(tpl, "stack: NullP");
    }

    /// Bug 2: when both `{var}` and `{var:N}` appear in the same template,
    /// both forms must be replaced (the old code returned early after the
    /// bare-form replacement, leaving `{var:N}` untouched).
    #[test]
    fn test_process_variable_replace_both_forms_same_template() {
        let mut tpl = "full={msg} short={msg:5}".to_string();
        process_variable_replace(&mut tpl, "msg", &VarValue::Str("hello world"), false);
        assert_eq!(tpl, "full=hello world short=hello");
    }

    /// Two distinct length suffixes for the same variable in one template.
    #[test]
    fn test_process_variable_replace_multiple_length_specs() {
        let mut tpl = "a={msg:3} b={msg:7}".to_string();
        process_variable_replace(&mut tpl, "msg", &VarValue::Str("abcdefghij"), false);
        assert_eq!(tpl, "a=abc b=abcdefg");
    }

    /// Multiple occurrences of the same `{var:N}` are all replaced.
    #[test]
    fn test_process_variable_replace_repeated_length_spec() {
        let mut tpl = "x={msg:3} y={msg:3}".to_string();
        process_variable_replace(&mut tpl, "msg", &VarValue::Str("abcdef"), false);
        assert_eq!(tpl, "x=abc y=abc");
    }

    /// Malformed `{var:abc}` (non-numeric length) must not loop forever and
    /// must leave the original substring untouched.
    #[test]
    fn test_process_variable_replace_invalid_length_is_skipped() {
        let mut tpl = "bad={msg:abc} good={msg:5}".to_string();
        process_variable_replace(&mut tpl, "msg", &VarValue::Str("hello world"), false);
        assert_eq!(tpl, "bad={msg:abc} good=hello");
    }

    /// `{var:0}` is treated as no-op truncation (preserves prior behavior).
    #[test]
    fn test_process_variable_replace_zero_length_then_bare() {
        let mut tpl = "z={msg:0} b={msg}".to_string();
        process_variable_replace(&mut tpl, "msg", &VarValue::Str("hello"), false);
        // {msg:0} is left as-is; {msg} is replaced.
        assert_eq!(tpl, "z={msg:0} b=hello");
    }

    /// Bug 1 (`process_dest_template` guard): when the destination template
    /// contains *only* `{field:N}` (no bare `{field}`), the row-derived value
    /// must still be substituted with truncation. Mirrors the user's Lark
    /// card template scenario.
    #[tokio::test]
    async fn test_process_dest_template_length_only_field() {
        let dest_tpl = r#"{"text": "stacktrace: {exception_stacktrace:10}"}"#;
        let rows_tpl_val = vec![Value::String(
            "exception_stacktrace=NullPointerException at line 42".to_string(),
        )];
        let mut row = Map::new();
        row.insert(
            "exception_stacktrace".to_string(),
            json!("NullPointerException at line 42"),
        );
        let rows = vec![row];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["text"], "stacktrace: NullPointe");
    }

    /// Bug 1 + Bug 2 combined: destination template containing both `{field}`
    /// and `{field:N}` for the *same* variable. Both must be replaced.
    #[tokio::test]
    async fn test_process_dest_template_both_forms_same_field() {
        let dest_tpl = r#"{"full": "{msg}", "short": "{msg:5}"}"#;
        let rows_tpl_val = vec![Value::String("msg=hello world".to_string())];
        let mut row = Map::new();
        row.insert("msg".to_string(), json!("hello world"));
        let rows = vec![row];

        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            dest_tpl,
            &alert,
            &rows,
            &rows_tpl_val,
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["full"], "hello world");
        assert_eq!(parsed["short"], "hello");
    }

    /// §4.4c: hybrid evaluation samples only 100 payload rows but knows the
    /// exact count. `{alert_count}` must render the exact count, not the
    /// sample size.
    #[tokio::test]
    async fn test_alert_count_uses_exact_count_for_count_alerts() {
        let mut row = Map::new();
        row.insert("x".to_string(), json!(1));
        let rows = vec![row; 3]; // payload sample: 3 rows
        let alert = Alert::default(); // count family: no aggregation, no promql
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: Some(48213.0), // exact COUNT(*)
        };
        let result = process_dest_template(
            "test_org",
            "count={alert_count}",
            &alert,
            &rows,
            &[Value::String("".into())],
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;
        assert_eq!(result, "count=48213");
    }

    /// Without an exact count (legacy single-query path may not set it),
    /// `{alert_count}` falls back to the payload length.
    #[tokio::test]
    async fn test_alert_count_falls_back_to_rows_len() {
        let mut row = Map::new();
        row.insert("x".to_string(), json!(1));
        let rows = vec![row; 3];
        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };
        let result = process_dest_template(
            "test_org",
            "count={alert_count}",
            &alert,
            &rows,
            &[Value::String("".into())],
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;
        assert_eq!(result, "count=3");
    }

    /// PT-4/PT-9: priority and tags reach destination templates.
    #[tokio::test]
    async fn test_priority_and_tags_render_into_templates() {
        // `Alert` has private fields, so a functional-update literal is not
        // available outside the `config` crate.
        let mut alert = Alert::default();
        alert.priority = Some(config::meta::alerts::priority::AlertPriority::P2);
        alert.tags = vec!["prod".to_string(), "service:checkout".to_string()];
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };
        let result = process_dest_template(
            "test_org",
            "p={alert_priority} tags={alert_tags}",
            &alert,
            &[],
            &[Value::String("".into())],
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;
        // `P2`, not `2`: templates and UI use the human form (PT-4).
        assert_eq!(result, "p=P2 tags=prod,service:checkout");
    }

    /// Unset priority and empty tags render as EMPTY, never "P0" or "null" —
    /// a template that always interpolates them must still read cleanly.
    #[tokio::test]
    async fn test_unset_priority_and_empty_tags_render_empty() {
        let alert = Alert::default();
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };
        let result = process_dest_template(
            "test_org",
            "p=[{alert_priority}] tags=[{alert_tags}]",
            &alert,
            &[],
            &[Value::String("".into())],
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;
        assert_eq!(result, "p=[] tags=[]");
    }

    /// T-5: `{alert_threshold_crit}`/`{alert_threshold_warn}` resolve from the
    /// ACTIVE threshold family — for an aggregation alert that is
    /// `having.value`/`warning_value`, not the count pair.
    #[tokio::test]
    async fn test_threshold_vars_resolve_from_aggregation_family() {
        let mut alert = Alert::default();
        alert.trigger_condition.threshold = 1; // count gate — NOT the answer
        alert.query_condition.aggregation = Some(config::meta::alerts::Aggregation {
            group_by: None,
            function: config::meta::alerts::AggFunction::Avg,
            having: config::meta::alerts::Condition {
                column: "value".into(),
                operator: config::meta::alerts::Operator::GreaterThanEquals,
                value: json!(85.5),
                ignore_case: false,
            },
            warning_value: Some(70.0),
            multi_alert: false,
        });
        let options = ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: Some(91.2),
        };
        let result = process_dest_template(
            "test_org",
            "crit={alert_threshold_crit} warn={alert_threshold_warn} count={alert_count}",
            &alert,
            &[],
            &[Value::String("".into())],
            options,
            &hashbrown::HashMap::new(),
            None,
        )
        .await;
        // aggregation family: crit/warn come from having/warning_value; and
        // alert_count stays payload-length (groups), NOT actual_value.
        assert_eq!(result, "crit=85.5 warn=70 count=0");
    }

    // ── M-4: group variables, and why position matters ──────────────────────

    #[tokio::test]
    async fn test_group_labels_render_as_prefixed_variables() {
        let mut alert = Alert::default();
        alert.name = "disk".into();
        let labels: std::collections::BTreeMap<String, String> =
            [("host".to_string(), "web-1".to_string())]
                .into_iter()
                .collect();

        let result = process_dest_template(
            "test_org",
            "host={group.host}",
            &alert,
            &[],
            &[Value::String("".into())],
            ProcessTemplateOptions {
                rows_end_time: 0,
                start_time: None,
                evaluation_timestamp: 0,
                is_email: false,
                level: None,
                actual_value: None,
            },
            &hashbrown::HashMap::new(),
            Some(&labels),
        )
        .await;

        assert_eq!(result, "host=web-1");
    }

    #[tokio::test]
    async fn test_a_group_value_containing_a_variable_is_not_expanded() {
        // THE injection guarantee, and the reason group variables are
        // substituted LAST. Label values are user data — a pod really can be
        // named `{alert_name}`. Because nothing runs after this substitution,
        // the value is written literally; if group vars were applied earlier
        // (say through `context_attributes`, which is position 5 of 7), the
        // built-in pass would then rewrite it into the alert's own name.
        let mut alert = Alert::default();
        alert.name = "disk-usage".into();
        let labels: std::collections::BTreeMap<String, String> =
            [("pod".to_string(), "{alert_name}".to_string())]
                .into_iter()
                .collect();

        let result = process_dest_template(
            "test_org",
            "pod={group.pod}",
            &alert,
            &[],
            &[Value::String("".into())],
            ProcessTemplateOptions {
                rows_end_time: 0,
                start_time: None,
                evaluation_timestamp: 0,
                is_email: false,
                level: None,
                actual_value: None,
            },
            &hashbrown::HashMap::new(),
            Some(&labels),
        )
        .await;

        assert_eq!(
            result, "pod={alert_name}",
            "a label value must render literally, never expand into another variable"
        );
        assert!(
            !result.contains("disk-usage"),
            "the alert name leaked into a user-controlled label value"
        );
    }

    #[tokio::test]
    async fn test_a_group_label_cannot_shadow_a_builtin_variable() {
        // A label literally called `alert_name` must not overwrite the alert's
        // own `{alert_name}`. The `group.` prefix is the whole defence.
        let mut alert = Alert::default();
        alert.name = "real-alert".into();
        let labels: std::collections::BTreeMap<String, String> =
            [("alert_name".to_string(), "spoofed".to_string())]
                .into_iter()
                .collect();

        let result = process_dest_template(
            "test_org",
            "name={alert_name}",
            &alert,
            &[],
            &[Value::String("".into())],
            ProcessTemplateOptions {
                rows_end_time: 0,
                start_time: None,
                evaluation_timestamp: 0,
                is_email: false,
                level: None,
                actual_value: None,
            },
            &hashbrown::HashMap::new(),
            Some(&labels),
        )
        .await;

        assert_eq!(result, "name=real-alert");
    }

    #[tokio::test]
    async fn test_an_ungrouped_alert_renders_exactly_as_before() {
        // `None` must leave rendering byte-identical, or every existing alert's
        // notification changes on upgrade.
        let mut alert = Alert::default();
        alert.name = "legacy".into();
        let opts = || ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        };

        let result = process_dest_template(
            "test_org",
            "n={alert_name} g={group.host}",
            &alert,
            &[],
            &[Value::String("".into())],
            opts(),
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        assert_eq!(
            result, "n=legacy g={group.host}",
            "with no group context the placeholder is left untouched, as it is today"
        );
    }

    /// An SLO alert reaching the notification path must not PANIC.
    ///
    /// Found by live testing: the alert-URL builder matched `query_type` with
    /// `_ => unreachable!()`, so every evaluation of a real SLO alert killed
    /// the scheduler job — no notification, no state, no trigger record, just
    /// a panicking worker every cycle. Adding a fourth query type made that
    /// arm reachable.
    #[tokio::test]
    async fn rendering_a_notification_for_an_slo_alert_does_not_panic() {
        let mut alert = Alert::default();
        alert.name = "slo-alert".into();
        alert.org_id = "default".into();
        alert.query_condition.query_type = config::meta::alerts::QueryType::Slo;
        alert.query_condition.slo_condition = Some(config::meta::slo::condition::SloCondition {
            slo_id: "slo123".into(),
            kind: config::meta::slo::condition::SloAlertKind::BurnRate,
            operator: config::meta::alerts::Operator::GreaterThan,
            critical: 1.2,
            warning: None,
            long_window_secs: Some(3600),
            short_window_secs: Some(600),
            multi_alert: false,
        });

        let rendered = process_dest_template(
            "default",
            "{alert_name} {alert_url}",
            &alert,
            &[],
            &[Value::String("".into())],
            ProcessTemplateOptions {
                rows_end_time: 0,
                start_time: None,
                evaluation_timestamp: 0,
                is_email: false,
                level: None,
                actual_value: None,
            },
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        // Reaching this line at all IS the assertion: before the fix the
        // call panicked and took the scheduler worker with it.
        assert!(rendered.contains("slo-alert"));
        // A link is still produced. Its target is the SLO page, but the
        // notification path runs it through the short-URL service, so the
        // rendered form is `/web/short/<hash>` rather than the raw link —
        // asserting the raw path here would pin the shortener, not this fix.
        assert!(
            rendered.contains("http"),
            "expected an alert_url to be rendered, got: {rendered}"
        );
    }

    // ── `{stream_name}` / `{stream_type}` for a stream-less family ──────────
    //
    // Every one of the eight shipped default destination templates
    // (`config/prebuilt-destinations.json`) carries a Stream row built from
    // `{stream_name}`, and `{stream_type}`. An SLO alert has neither: its
    // `stream_name` is `""` (save validation waives it) and its `stream_type`
    // is left at the `StreamType::Logs` default. Rendered verbatim that gives
    // every SLO notification a blank "Stream: " and a "Type: logs" that is
    // simply untrue — a Slack/PagerDuty payload that names the wrong thing.
    //
    // The SLO's NAME is not on the `Alert` at all (only `slo_condition.slo_id`
    // is), but `build_slo_eval_results` puts the resolved name on the payload
    // row, and that row is in scope at both substitution sites.

    /// The evaluation payload row an SLO alert actually notifies with.
    fn slo_payload_row(slo_name: &str) -> Map<String, Value> {
        let mut row = Map::new();
        row.insert("slo_id".to_string(), json!("slo123"));
        if !slo_name.is_empty() {
            row.insert("slo_name".to_string(), json!(slo_name));
        }
        row.insert("slo_window".to_string(), json!("30d"));
        row.insert("burn_rate".to_string(), json!(14.4));
        row
    }

    fn slo_alert_fixture() -> Alert {
        let mut alert = Alert::default();
        alert.name = "checkout-burn".into();
        alert.org_id = "default".into();
        alert.query_condition.query_type = config::meta::alerts::QueryType::Slo;
        alert.query_condition.slo_condition = Some(config::meta::slo::condition::SloCondition {
            slo_id: "slo123".into(),
            kind: config::meta::slo::condition::SloAlertKind::BurnRate,
            operator: config::meta::alerts::Operator::GreaterThan,
            critical: 1.2,
            warning: None,
            long_window_secs: Some(3600),
            short_window_secs: Some(600),
            multi_alert: false,
        });
        alert
    }

    fn default_template_options() -> ProcessTemplateOptions {
        ProcessTemplateOptions {
            rows_end_time: 0,
            start_time: None,
            evaluation_timestamp: 0,
            is_email: false,
            level: None,
            actual_value: None,
        }
    }

    const STREAM_TPL: &str = "Stream: {stream_name} Type: {stream_type}";

    // The counterpart, and the reason the branch is on `query_type` rather than
    // on "stream_name is empty": an ordinary alert must be untouched, including
    // one that happens to carry a `slo_name` column in its result rows.
    #[tokio::test]
    async fn an_ordinary_alert_still_renders_its_own_stream() {
        let mut alert = Alert::default();
        alert.name = "cpu-high".into();
        alert.org_id = "default".into();
        alert.stream_name = "default".into();
        alert.stream_type = config::meta::stream::StreamType::Traces;

        let rendered = process_dest_template(
            "default",
            STREAM_TPL,
            &alert,
            &[slo_payload_row("checkout-availability")],
            &[Value::String("".into())],
            default_template_options(),
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        assert_eq!(rendered, "Stream: default Type: traces");
    }

    #[tokio::test]
    async fn a_hostile_slo_name_does_not_expand_through_the_template() {
        let alert = slo_alert_fixture();
        let rows = vec![slo_payload_row("{alert_name}")];

        let rendered = process_dest_template(
            "default",
            "Stream: {stream_name}",
            &alert,
            &rows,
            &[Value::String("".into())],
            default_template_options(),
            &hashbrown::HashMap::new(),
            None,
        )
        .await;

        // `checkout-burn` is the alert's name — seeing it here would mean the
        // SLO name had been re-read as a placeholder by the `{alert_name}` pass.
        assert!(!rendered.contains("checkout-burn"), "got: {rendered}");
    }

    #[test]
    fn a_row_template_leaves_an_ordinary_alert_alone() {
        let mut alert = Alert::default();
        alert.stream_name = "default".into();
        alert.stream_type = config::meta::stream::StreamType::Metrics;
        let mut row = Map::new();
        row.insert("k".to_string(), json!("v"));

        let out = process_row_template(
            "default",
            &STREAM_TPL.to_string(),
            &alert,
            RowTemplateType::String,
            &[row],
        );

        assert_eq!(out[0].as_str().unwrap(), "Stream: default Type: metrics");
    }

    // ── The SLO alert-level collapse (§6b.3, D34) ───────────────────────────

    use config::meta::slo::{condition::SloClassification, coverage::UnobservedReason};

    fn slo_eval(classification: SloClassification) -> crate::slo::evaluate::SloEvalResult {
        crate::slo::evaluate::SloEvalResult {
            classification,
            actual_value: None,
            group_key: None,
            sli: None,
            coverage: 0.0,
            slo_name: "s".into(),
            slo_target: 99.0,
            slo_window_secs: 604_800,
            error_budget_remaining: None,
        }
    }

    fn frozen_eval() -> crate::slo::evaluate::SloEvalResult {
        slo_eval(SloClassification::Frozen(
            UnobservedReason::BelowCoverageFloor,
        ))
    }

    fn observed(
        level: config::meta::alerts::level::AlertLevel,
    ) -> crate::slo::evaluate::SloEvalResult {
        slo_eval(SloClassification::Observed(level))
    }

    /// D34: only when EVERY group is frozen is the evaluation frozen.
    #[test]
    fn every_group_frozen_collapses_to_frozen() {
        let evals = vec![frozen_eval(), frozen_eval()];
        assert!(matches!(collapse_slo_evals(&evals), SloCollapse::Frozen));
    }

    /// Zero results means nothing was measured — same as all-frozen, and the
    /// safe direction for the degenerate case.
    #[test]
    fn no_results_collapses_to_frozen() {
        assert!(matches!(collapse_slo_evals(&[]), SloCollapse::Frozen));
    }

    /// One frozen group must not drag an observed-healthy alert to frozen —
    /// something WAS measured, and it was fine.
    #[test]
    fn a_frozen_group_does_not_drag_an_observed_ok_to_frozen() {
        use config::meta::alerts::level::AlertLevel;
        let evals = vec![frozen_eval(), observed(AlertLevel::Ok)];
        assert!(matches!(collapse_slo_evals(&evals), SloCollapse::Healthy));
    }

    /// The inverse direction: a frozen group must not suppress a firing one.
    #[test]
    fn a_frozen_group_does_not_suppress_a_firing_group() {
        use config::meta::alerts::level::AlertLevel;
        let evals = vec![frozen_eval(), observed(AlertLevel::Warning)];
        match collapse_slo_evals(&evals) {
            SloCollapse::Firing(e) => {
                assert_eq!(e.classification.level(), Some(AlertLevel::Warning));
            }
            other => panic!("expected Firing, got {other:?}"),
        }
    }

    /// The most severe observed level wins, regardless of order.
    #[test]
    fn the_most_severe_observed_level_wins() {
        use config::meta::alerts::level::AlertLevel;
        for evals in [
            vec![
                observed(AlertLevel::Warning),
                observed(AlertLevel::Critical),
            ],
            vec![
                observed(AlertLevel::Critical),
                observed(AlertLevel::Warning),
            ],
            vec![
                observed(AlertLevel::Ok),
                observed(AlertLevel::Critical),
                frozen_eval(),
            ],
        ] {
            match collapse_slo_evals(&evals) {
                SloCollapse::Firing(e) => {
                    assert_eq!(e.classification.level(), Some(AlertLevel::Critical));
                }
                other => panic!("expected Firing(Critical), got {other:?}"),
            }
        }
    }

    /// Observed-Ok alone is Healthy — a real measurement, categorically
    /// different from frozen.
    #[test]
    fn all_ok_collapses_to_healthy() {
        use config::meta::alerts::level::AlertLevel;
        let evals = vec![observed(AlertLevel::Ok), observed(AlertLevel::Ok)];
        assert!(matches!(collapse_slo_evals(&evals), SloCollapse::Healthy));
    }

    /// A `query_type: slo` alert with no stored condition is a configuration
    /// error and must surface as an ERROR — an empty result is a completed
    /// evaluation, which the scheduler would record as a healthy `Ok`.
    /// (Runs with no database: the bail must precede everything else.)
    #[tokio::test]
    async fn a_slo_alert_without_a_condition_errors_rather_than_reading_healthy() {
        let mut alert = Alert::default();
        alert.name = "broken".into();
        alert.query_condition.query_type = config::meta::alerts::QueryType::Slo;
        assert!(alert.query_condition.slo_condition.is_none());
        let err = evaluate_slo_alert(&alert, 0).await.unwrap_err();
        assert!(
            err.to_string().contains("no slo_condition"),
            "expected the missing-condition error, got: {err}"
        );
    }

    // ── Feature 5 save-path wiring (Gap 3) ──────────────────────────────────

    /// The invariant's forward direction is decided with NO lookup, so a
    /// misconfigured alert is rejected identically whether or not the caller
    /// has a database. (This test runs without one.)
    #[tokio::test]
    async fn saving_a_slo_alert_without_a_condition_is_rejected_without_a_lookup() {
        let mut alert = Alert::default();
        alert.query_condition.query_type = config::meta::alerts::QueryType::Slo;
        let err = validate_slo_alert_wiring("org", &alert, true)
            .await
            .unwrap_err();
        assert!(
            matches!(
                err,
                AlertError::InvalidSloAlert(
                    config::meta::slo::condition::SloAlertError::MissingCondition
                )
            ),
            "got: {err}"
        );
    }

    /// B3's payload. Without this, the infra-layer exclusion can be fully
    /// implemented and fully tested while the save path still passes `None` —
    /// every test green and the user-visible bug (editing an at-cap alert to a
    /// new window pair is rejected) completely unfixed.
    #[test]
    fn an_update_excludes_its_own_alert_from_the_pair_count() {
        use svix_ksuid::KsuidLike as _;
        let id = svix_ksuid::Ksuid::new(None, None);
        let mut alert = Alert::default();
        alert.id = Some(id);

        assert_eq!(
            slo_pair_exclusion_id(&alert, false),
            Some(id.to_string()),
            "an update must exclude itself, in the stored ksuid string form"
        );
    }

    /// A create must count every pair already in use — excluding one would
    /// hand the create path a free slot above the cap.
    #[test]
    fn a_create_excludes_nothing_from_the_pair_count() {
        let alert = Alert::default();
        assert!(alert.id.is_none());
        assert_eq!(slo_pair_exclusion_id(&alert, true), None);
    }

    /// A create may carry an id: `Alert::id` is `#[serde(default)]`, so a
    /// request body can supply one, and `prepare_alert` lets it through when
    /// `overwrite` is set. It still creates a NEW row (the infra layer only
    /// ever INSERTs), so nothing is being replaced and nothing may be
    /// excluded — otherwise an at-cap SLO would admit one pair too many.
    #[test]
    fn a_create_carrying_an_id_still_excludes_nothing() {
        use svix_ksuid::KsuidLike as _;
        let mut alert = Alert::default();
        alert.id = Some(svix_ksuid::Ksuid::new(None, None));

        assert_eq!(slo_pair_exclusion_id(&alert, true), None);
    }

    /// An ordinary alert must not pay a database round-trip for a feature it
    /// does not use — and must never be rejected by it.
    #[tokio::test]
    async fn an_ordinary_alert_passes_the_slo_wiring_without_a_lookup() {
        let alert = Alert::default();
        assert!(validate_slo_alert_wiring("org", &alert, true).await.is_ok());
    }

    /// The reverse direction, also lookup-free: a stray condition on a
    /// non-SLO alert is config that would be silently ignored.
    #[tokio::test]
    async fn a_condition_on_a_non_slo_alert_is_rejected_before_any_lookup() {
        let mut alert = Alert::default();
        // query_type stays Custom.
        alert.query_condition.slo_condition = Some(config::meta::slo::condition::SloCondition {
            slo_id: "slo1".into(),
            kind: config::meta::slo::condition::SloAlertKind::BurnRate,
            operator: config::meta::alerts::Operator::GreaterThan,
            critical: 14.4,
            warning: None,
            long_window_secs: Some(3600),
            short_window_secs: Some(300),
            multi_alert: false,
        });
        let err = validate_slo_alert_wiring("org", &alert, true)
            .await
            .unwrap_err();
        assert!(
            matches!(
                err,
                AlertError::InvalidSloAlert(
                    config::meta::slo::condition::SloAlertError::ConditionOnNonSloAlert
                )
            ),
            "got: {err}"
        );
    }

    /// Equal severity keeps the FIRST group seen — the notification's group
    /// identity must not flap between passes when two groups tie.
    #[test]
    fn equal_severity_keeps_the_first_group_seen() {
        use config::meta::alerts::level::AlertLevel;
        let mut a = observed(AlertLevel::Warning);
        a.group_key = Some("host=a".into());
        let mut b = observed(AlertLevel::Warning);
        b.group_key = Some("host=b".into());
        match collapse_slo_evals(&[a, b]) {
            SloCollapse::Firing(e) => assert_eq!(e.group_key.as_deref(), Some("host=a")),
            other => panic!("expected Firing, got {other:?}"),
        }
    }

    // ── build_slo_eval_results: the wiring the collapse feeds (§6b.3, §7) ──

    fn slo_cond(
        kind: config::meta::slo::condition::SloAlertKind,
    ) -> config::meta::slo::condition::SloCondition {
        config::meta::slo::condition::SloCondition {
            slo_id: "slo1".into(),
            kind,
            operator: config::meta::alerts::Operator::GreaterThan,
            critical: 14.4,
            warning: None,
            long_window_secs: None,
            short_window_secs: None,
            multi_alert: false,
        }
    }

    /// The D34 wiring itself: an all-frozen evaluation must come back with
    /// the `frozen` flag SET and no level — this is what the mutant test
    /// found unpinned (deleting `results.frozen = true` survived every test).
    #[test]
    fn a_fully_frozen_evaluation_sets_the_frozen_flag_and_no_level() {
        let r = build_slo_eval_results(
            &[frozen_eval(), frozen_eval()],
            &slo_cond(config::meta::slo::condition::SloAlertKind::ErrorBudget),
            5_000_000,
        );
        assert!(r.frozen, "the frozen flag is the whole point (D34)");
        assert_eq!(r.level, None);
        assert!(r.data.is_none());
        assert_eq!(r.end_time, 5_000_000);
    }

    #[test]
    fn a_healthy_evaluation_records_ok_and_is_not_frozen() {
        use config::meta::alerts::level::AlertLevel;
        let r = build_slo_eval_results(
            &[frozen_eval(), observed(AlertLevel::Ok)],
            &slo_cond(config::meta::slo::condition::SloAlertKind::ErrorBudget),
            0,
        );
        assert!(!r.frozen);
        assert_eq!(r.level, Some(AlertLevel::Ok));
        assert!(r.data.is_none());
    }

    /// §7: the template row IS the notification contract — every documented
    /// key must be present, with the kind-specific alias for the value.
    #[test]
    fn a_firing_burn_rate_evaluation_populates_the_template_row() {
        use config::meta::alerts::level::AlertLevel;
        let mut e = observed(AlertLevel::Critical);
        e.actual_value = Some(14.4);
        e.sli = Some(98.5);
        e.error_budget_remaining = Some(-40.0);
        e.group_key = Some("host=a".into());
        let r = build_slo_eval_results(
            &[e],
            &slo_cond(config::meta::slo::condition::SloAlertKind::BurnRate),
            0,
        );
        assert_eq!(r.level, Some(AlertLevel::Critical));
        assert_eq!(r.actual_value, Some(14.4));
        assert_eq!(r.group_label.as_deref(), Some("host=a"));
        let data = r.data.expect("a firing evaluation carries a payload row");
        let row = &data[0];
        for key in [
            "slo_id",
            "slo_name",
            "slo_window",
            "group",
            "slo_target",
            "value",
            "burn_rate",
            "sli",
            "error_budget_remaining",
        ] {
            assert!(row.contains_key(key), "template key `{key}` missing");
        }
        // VALUES, not just presence — a wrong-value mutant survived the
        // presence-only form of this test.
        assert_eq!(row["slo_id"], "slo1");
        assert_eq!(row["slo_name"], "s");
        assert_eq!(row["slo_window"], "7d");
        assert_eq!(row["group"], "host=a");
        assert_eq!(row["slo_target"], 99.0);
        assert_eq!(row["burn_rate"], 14.4);
        assert_eq!(row["value"], 14.4);
        assert_eq!(row["sli"], 98.5);
        assert_eq!(row["error_budget_remaining"], -40.0);
    }

    /// The alias follows the KIND: an error-budget alert's template speaks in
    /// `error_budget_consumed`, never `burn_rate`.
    #[test]
    fn the_kind_alias_matches_the_condition_kind() {
        use config::meta::alerts::level::AlertLevel;
        let mut e = observed(AlertLevel::Warning);
        e.actual_value = Some(85.0);
        let r = build_slo_eval_results(
            &[e],
            &slo_cond(config::meta::slo::condition::SloAlertKind::ErrorBudget),
            0,
        );
        let data = r.data.expect("firing");
        let row = &data[0];
        assert_eq!(row["error_budget_consumed"], 85.0);
        assert!(
            !row.contains_key("burn_rate"),
            "an error-budget alert must not emit a burn_rate variable"
        );
        assert!(
            !row.contains_key("group"),
            "an ungrouped evaluation must not emit a group variable"
        );
    }
}

/// Evaluate an SLO alert from stored status (`alerts_2.md` §6b.3).
///
/// A **frozen** classification returns `data: None` and `level: None`,
/// which is what makes the caller leave `level`, `level_since` and
/// `level_at` untouched (§7.6). That is the whole safety property: an
/// unmeasurable window must never be reported as a recovery, or a search
/// outage resolves every burn-rate alert in the org at once (D34).
async fn evaluate_slo_alert(
    alert: &Alert,
    end_time: i64,
) -> Result<TriggerEvalResults, anyhow::Error> {
    let Some(cond) = alert.query_condition.slo_condition.as_ref() else {
        // query_type says slo but no condition was stored — a misconfigured
        // alert, savable today because create/update validation is not yet
        // wired. This must be an ERROR, not an empty result: an empty result
        // is a completed evaluation, which the scheduler records as a healthy
        // `Ok` — inventing a level for an alert that cannot evaluate at all.
        // The error path records the outcome as Error and leaves the level
        // axis untouched, which is both visible and safe.
        anyhow::bail!(
            "alert {}/{} has query_type slo but no slo_condition stored",
            alert.org_id,
            alert.name
        );
    };

    let now_secs = end_time / 1_000_000;
    let evals = crate::slo::evaluate::evaluate(cond, &alert.org_id, now_secs).await?;
    Ok(build_slo_eval_results(&evals, cond, end_time))
}

/// Turn per-group SLO evaluations into the alert's `TriggerEvalResults` —
/// the collapse (§6b.3) plus the §7 template row.
///
/// Pure and synchronous, split from [`evaluate_slo_alert`] so the D34-critical
/// wiring is testable without a database: the mutation-test pass found that
/// deleting `results.frozen = true` survived every test while the logic lived
/// inside the async fn.
fn build_slo_eval_results(
    evals: &[crate::slo::evaluate::SloEvalResult],
    cond: &config::meta::slo::condition::SloCondition,
    end_time: i64,
) -> TriggerEvalResults {
    let mut results = TriggerEvalResults {
        end_time,
        ..Default::default()
    };

    let e = match collapse_slo_evals(evals) {
        SloCollapse::Frozen => {
            // Nothing was measured. `frozen` is what stops the scheduler from
            // collapsing this into `Ok` (`level_for_completed_evaluation`) —
            // without it, the handler records a healthy run and the level
            // resets (D34).
            results.frozen = true;
            return results;
        }
        SloCollapse::Healthy => {
            // Observed and healthy. A real measurement, categorically
            // different from frozen — the level is recorded as Ok.
            results.level = Some(config::meta::alerts::level::AlertLevel::Ok);
            return results;
        }
        SloCollapse::Firing(e) => e,
    };

    {
        results.level = e.classification.level();
        results.actual_value = e.actual_value;
        results.group_label = e.group_key.clone();
        // These keys become notification template variables verbatim —
        // `{slo_name}`, `{burn_rate}` and so on — because the template engine
        // substitutes from the row map.
        let mut row = Map::new();
        row.insert("slo_id".to_string(), Value::String(cond.slo_id.clone()));
        row.insert("slo_name".to_string(), Value::String(e.slo_name.clone()));
        row.insert(
            "slo_window".to_string(),
            Value::String(format!("{}d", e.slo_window_secs / 86_400)),
        );
        if let Some(g) = &e.group_key {
            row.insert("group".to_string(), Value::String(g.clone()));
        }

        let put = |row: &mut Map<String, Value>, key: &str, v: f64| {
            if let Some(n) = serde_json::Number::from_f64(v) {
                row.insert(key.to_string(), Value::Number(n));
            }
        };
        put(&mut row, "slo_target", e.slo_target);
        if let Some(v) = e.actual_value {
            put(&mut row, "value", v);
            // Also named for the kind, so a template written for a burn-rate
            // alert reads as one rather than referring to a generic `value`.
            match cond.kind {
                config::meta::slo::condition::SloAlertKind::BurnRate => {
                    put(&mut row, "burn_rate", v)
                }
                config::meta::slo::condition::SloAlertKind::ErrorBudget => {
                    put(&mut row, "error_budget_consumed", v)
                }
            }
        }
        if let Some(s) = e.sli {
            put(&mut row, "sli", s);
        }
        if let Some(b) = e.error_budget_remaining {
            put(&mut row, "error_budget_remaining", b);
        }
        results.data = Some(vec![row]);
    }
    results
}

/// Gather what only the database knows, then apply the pure Feature 5 rules
/// (`slo::condition::validate_slo_alert`).
///
/// Split this way so the rules themselves stay unit-tested without a database;
/// this function is only the lookup.
/// The alert id save-validation excludes from the SLO burn-pair count (B3).
///
/// `Some` on update, so the alert being edited does not count its own stored
/// pair against the cap it is about to vacate.
///
/// **Always `None` on create, even when the alert carries an id.** `Alert::id`
/// is `#[serde(default)]`, so a request body can supply one, and
/// `prepare_alert` accepts it when `overwrite` is set. A create still INSERTs a
/// new row — `infra::table::alerts::create` never upserts — so no existing row
/// is being replaced and excluding one would let an at-cap SLO admit a pair too
/// many. (Today that request dies on the primary key instead, but the cap must
/// be upheld by this check, not by a constraint elsewhere.)
///
/// Returned as the **stored** string form. The column holds `Ksuid::to_string`
/// (see `get_by_id_db`'s filter), so any other rendering would match no row
/// and silently degrade to "excludes nothing" — indistinguishable from the bug
/// this exists to fix.
fn slo_pair_exclusion_id(alert: &Alert, create: bool) -> Option<String> {
    if create {
        return None;
    }
    alert.id.map(|id| id.to_string())
}

async fn validate_slo_alert_wiring(
    org_id: &str,
    alert: &Alert,
    create: bool,
) -> Result<(), AlertError> {
    use config::meta::slo::condition::{SloFacts, validate_slo_alert};

    let is_slo = alert.query_condition.query_type == QueryType::Slo;
    let cond = alert.query_condition.slo_condition.as_ref();

    // Only a well-formed SLO alert needs anything looked up. Every other
    // case — an ordinary alert, a missing condition, a stray condition on a
    // non-SLO alert — is decided by the pure rules alone, so it costs no DB
    // round-trip AND cannot be masked by an infrastructure error.
    let Some(cond) = cond.filter(|_| is_slo) else {
        return validate_slo_alert(is_slo, cond, None, true, &[], 0)
            .map_err(AlertError::InvalidSloAlert);
    };

    let db = infra::db::ORM_CLIENT.get().ok_or_else(|| {
        AlertError::InfraError(infra::errors::Error::Message(
            "database not initialized".into(),
        ))
    })?;

    let slo = infra::table::slos::get(db, org_id, &cond.slo_id)
        .await
        .map_err(|e| AlertError::InfraError(infra::errors::Error::Message(e.to_string())))?;
    let facts = slo.as_ref().map(|s| SloFacts {
        target: s.target,
        window_secs: s.definition.window_secs,
        slice_interval_secs: s.definition.slice_interval_secs,
        is_grouped: s.is_grouped(),
    });

    // SA-4: the count gate must be untouched. `warning_threshold` counts as
    // part of the gate — a warning on a group-count gate has no meaning for a
    // family that has no gate at all.
    let default_gate = config::meta::alerts::TriggerCondition::default();
    let count_gate_is_default = alert.trigger_condition.threshold == default_gate.threshold
        && alert.trigger_condition.operator == default_gate.operator
        && alert.trigger_condition.warning_threshold.is_none();

    // SA-19 / D60: existing pairs come from the indexed column, never the
    // alert cache. The alert being edited is excluded (B3) so it does not
    // count its own stored pair against the cap it is about to vacate.
    // Bound to a local rather than inlined, so the borrow does not depend on
    // temporary-lifetime rules inside the call expression.
    let exclude_id = slo_pair_exclusion_id(alert, create);
    let existing: Vec<(i64, i64)> = if slo.is_some() {
        infra::table::alerts::list_slo_burn_window_pairs(
            db,
            org_id,
            &cond.slo_id,
            exclude_id.as_deref(),
        )
        .await
        .map_err(|e| AlertError::InfraError(infra::errors::Error::Message(e.to_string())))?
    } else {
        Vec::new()
    };

    validate_slo_alert(
        is_slo,
        Some(cond),
        facts,
        count_gate_is_default,
        &existing,
        get_config().slo.max_burn_window_pairs as usize,
    )
    .map_err(AlertError::InvalidSloAlert)
}

/// The outcome of collapsing per-group SLO evaluations to one alert-level
/// answer.
#[derive(Debug)]
enum SloCollapse<'a> {
    /// Nothing was measured at all: no level, no data, state untouched.
    Frozen,
    /// Something was measured and nothing is firing — records `Ok`.
    Healthy,
    /// The most severe firing result; owns the level and the template row.
    Firing(&'a crate::slo::evaluate::SloEvalResult),
}

/// Collapse per-group SLO evaluations to the alert level (§6b.3).
///
/// Pure, so the D34-critical rules are testable without a database:
/// * `Frozen` only when EVERY result is frozen (zero results included) — one frozen group must
///   neither drag an observed alert to no-level, nor read as Ok and dilute a firing group.
/// * Otherwise the most severe OBSERVED level wins; ties keep the first seen.
fn collapse_slo_evals(evals: &[crate::slo::evaluate::SloEvalResult]) -> SloCollapse<'_> {
    use config::meta::alerts::level::AlertLevel;

    let mut best: Option<&crate::slo::evaluate::SloEvalResult> = None;
    for e in evals {
        let Some(level) = e.classification.level() else {
            continue;
        };
        if level == AlertLevel::Ok {
            continue;
        }
        let better = match best.and_then(|b| b.classification.level()) {
            Some(AlertLevel::Critical) => false,
            Some(_) => level == AlertLevel::Critical,
            None => true,
        };
        if better {
            best = Some(e);
        }
    }
    if let Some(e) = best {
        return SloCollapse::Firing(e);
    }
    // `.all` on an empty slice is true, and that is the right reading: zero
    // results means nothing was measured.
    if evals.iter().all(|e| e.classification.is_frozen()) {
        return SloCollapse::Frozen;
    }
    SloCollapse::Healthy
}
