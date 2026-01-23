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
use config::{
    SMTP_CLIENT, TIMESTAMP_COL_NAME, get_config,
    meta::{
        alerts::{
            FrequencyType, Operator, QueryType, TriggerEvalResults,
            alert::{Alert, AlertListFilter, ListAlertsParams, RowTemplateType},
        },
        destinations::{
            AwsSns, DestinationType, Email, Endpoint, HTTPType, Module, Template, TemplateType,
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
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    schema::unwrap_stream_settings,
    table,
};
use itertools::Itertools;
use lettre::{AsyncTransport, Message, message::MultiPart};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::meta::{TriggerActionRequest, TriggerSource};
#[cfg(feature = "enterprise")]
use o2_openfga::{
    authorizer::authz::{get_ofga_type, remove_parent_relation, set_parent_relation},
    config::get_config as get_openfga_config,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use svix_ksuid::Ksuid;
#[cfg(feature = "enterprise")]
use tracing::{Level, span};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
#[cfg(feature = "enterprise")]
use crate::common::utils::http::get_or_create_trace_id;
use crate::{
    common::{
        infra::config::ORGANIZATIONS,
        meta::authz::Authz,
        utils::auth::{is_ofga_unsupported, remove_ownership, set_ownership},
    },
    service::{
        alerts::{QueryConditionExt, build_sql, destinations},
        db, folders,
        search::sql::RE_ONLY_SELECT,
        short_url,
    },
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

    #[error("Alert destinations is required")]
    AlertDestinationMissing,

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

    /// An error occured trying to get the list of permitted alerts in
    /// enterprise mode because no user_id was provided.
    #[error("user_id required to get permitted alerts in enterprise mode")]
    PermittedAlertsMissingUser,

    /// An error occured trying to get the list of permitted alerts in
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
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

async fn create_default_alerts_folder(org_id: &str) -> Result<Folder, AlertError> {
    let default_folder = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: "default".to_owned(),
        description: "default".to_owned(),
    };
    folders::save_folder(org_id, default_folder, FolderType::Alerts, true)
        .await
        .map_err(|_| AlertError::CreateDefaultFolderError)
}

/// Validates the alert and prepares it before it is written to the database.
async fn prepare_alert(
    org_id: &str,
    stream_name: &str,
    name: &str,
    alert: &mut Alert,
    create: bool,
    overwrite: bool,
) -> Result<(), AlertError> {
    if !name.is_empty() {
        alert.name = name.to_string();
    }
    alert.name = alert.name.trim().to_string();

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

    if let Some(alert_id) = alert.id {
        match get_by_id_db(org_id, alert_id).await {
            Ok(old_alert) => {
                if create && !overwrite {
                    return Err(AlertError::CreateAlreadyExists);
                }
                alert.owner = old_alert.owner;
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

    if alert.name.is_empty() || alert.stream_name.is_empty() {
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

    // before saving alert check alert destination
    if alert.destinations.is_empty() {
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

    if alert.is_real_time && alert.query_condition.query_type != QueryType::Custom {
        return Err(AlertError::RealtimeMissingCustomQuery);
    }

    match alert.query_condition.query_type {
        QueryType::Custom => {
            if alert.query_condition.aggregation.is_some() {
                // if it has result we should fire the alert when enable aggregation
                alert.trigger_condition.operator = Operator::GreaterThanEquals;
                alert.trigger_condition.threshold = 1;
            }
        }
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
        QueryType::PromQL => {
            if alert.query_condition.promql.is_none()
                || alert.query_condition.promql.as_ref().unwrap().is_empty()
                || alert.query_condition.promql_condition.is_none()
            {
                return Err(AlertError::PromqlMissingQuery);
            }
        }
    }

    // Commented intentionally - in case the alert period is big and there
    // is huge amount of data within the time period, the below can timeout and return error.
    // // test the alert
    // if let Err(e) = &alert.evaluate(None).await {
    //     return Err(anyhow::anyhow!("Alert test failed: {}", e));
    // }

    Ok(())
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
    prepare_alert(
        org_id,
        &stream_name,
        &alert_name,
        &mut alert,
        true,
        overwrite,
    )
    .await?;

    let alert = db::alerts::alert::create(conn, org_id, folder_id, alert, overwrite).await?;

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

    prepare_alert(org_id, &stream_name, &alert_name, &mut alert, false, false).await?;

    let alert = db::alerts::alert::update(conn, org_id, dst_folder_id_info, alert).await?;
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

pub async fn get_folder_alert_by_id_db(
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(Folder, Alert), AlertError> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match table::alerts::get_by_id(conn, org_id, alert_id).await? {
        Some(f_a) => Ok(f_a),
        None => Err(AlertError::AlertNotFound),
    }
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

/// Deletes an alert by its KSUID primary key.
pub async fn delete_by_id<C: ConnectionTrait>(
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
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

pub async fn delete_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), AlertError> {
    if db::alerts::alert::get_by_name(org_id, stream_type, stream_name, name)
        .await
        .is_err()
    {
        return Err(AlertError::AlertNotFound);
    }
    match db::alerts::alert::delete_by_name(org_id, stream_type, stream_name, name).await {
        Ok(_) => {
            remove_ownership(org_id, "alerts", Authz::new(name)).await;
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
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
    let (success_message, err_message) = alert.send_notification(&[], now, None, now).await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .incidents
        .enabled
    {
        // Create synthetic result row with alert metadata
        let synthetic_row = config::utils::json::json!({
            "stream_name": alert.stream_name,
            "stream_type": alert.stream_type.to_string(),
            "alert_name": alert.name,
            "alert_id": alert_id.to_string(),
            "trigger_type": "manual"
        });
        let synthetic_row = synthetic_row.as_object().unwrap();

        match crate::service::alerts::incidents::correlate_alert_to_incident(
            &alert,
            synthetic_row,
            now,
            None,
            None,
        )
        .await
        {
            Ok(Some((incident_id, service_name))) => {
                log::info!(
                    "Manual trigger for alert {}/{} correlated to incident {} (service: {})",
                    org_id,
                    &alert.name,
                    incident_id,
                    service_name
                );
            }
            Ok(None) => {
                log::debug!(
                    "No incident correlation for manually triggered alert {}/{}",
                    org_id,
                    &alert.name
                );
            }
            Err(e) => {
                log::error!("Error correlating manual trigger to incident: {e}");
                // Don't fail the trigger if incident correlation fails
            }
        }
    }

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
    let (success_message, err_message) = alert.send_notification(&[], now, None, now).await?;

    // [ENTERPRISE] Create incident for manual trigger
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .incidents
        .enabled
    {
        // Create synthetic result row with alert metadata
        let synthetic_row = config::utils::json::json!({
            "stream_name": alert.stream_name,
            "stream_type": alert.stream_type.to_string(),
            "alert_name": alert.name,
            "trigger_type": "manual"
        });
        let synthetic_row = synthetic_row.as_object().unwrap();

        match crate::service::alerts::incidents::correlate_alert_to_incident(
            &alert,
            synthetic_row,
            now,
            None,
            None,
        )
        .await
        {
            Ok(Some((incident_id, service_name))) => {
                log::info!(
                    "Manual trigger for alert {}/{} correlated to incident {} (service: {})",
                    org_id,
                    &alert.name,
                    incident_id,
                    service_name
                );
            }
            Ok(None) => {
                log::debug!(
                    "No incident correlation for manually triggered alert {}/{}",
                    org_id,
                    &alert.name
                );
            }
            Err(e) => {
                log::error!("Error correlating manual trigger to incident: {e}");
                // Don't fail the trigger if incident correlation fails
            }
        }
    }

    Ok((success_message, err_message))
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
    async fn send_notification(
        &self,
        rows: &[Map<String, Value>],
        rows_end_time: i64,
        start_time: Option<i64>,
        evaluation_timestamp: i64,
    ) -> Result<(String, String), AlertError>;
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
        rows: &[Map<String, Value>],
        rows_end_time: i64,
        start_time: Option<i64>,
        evaluation_timestamp: i64,
    ) -> Result<(String, String), AlertError> {
        let mut err_message = "".to_string();
        let mut success_message = "".to_string();
        let mut no_of_error = 0;

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

        for dest_name in self.destinations.iter() {
            let (dest, dest_template) =
                destinations::get_with_template(&self.org_id, dest_name).await?;
            let Module::Alert {
                destination_type, ..
            } = dest.module
            else {
                return Err(AlertError::GetDestinationWithTemplateError(
                    db::alerts::destinations::DestinationError::UnsupportedType,
                ));
            };

            // Use alert-level template if specified, otherwise fall back to destination template
            let template = match (&alert_template, &dest_template) {
                (Some(alert_tpl), _) => alert_tpl,
                (None, Some(dest_tpl)) => dest_tpl,
                (None, None) => {
                    no_of_error += 1;
                    err_message = format!(
                        "{err_message} No template configured for destination {};",
                        dest.name
                    );
                    log::error!(
                        "No template configured for alert {}/{}/{}/{} destination {}",
                        self.org_id,
                        self.stream_type,
                        self.stream_name,
                        self.name,
                        dest.name
                    );
                    continue;
                }
            };

            match send_notification(
                self,
                &destination_type,
                template,
                rows,
                rows_end_time,
                start_time,
                evaluation_timestamp,
            )
            .await
            {
                Ok(resp) => {
                    success_message =
                        format!("{success_message} destination {} {resp};", dest.name);
                }
                Err(e) => {
                    log::error!(
                        "Error sending notification for {}/{}/{}/{} for destination {} err: {}",
                        self.org_id,
                        self.stream_type,
                        self.stream_name,
                        self.name,
                        dest.name,
                        e
                    );
                    no_of_error += 1;
                    err_message = format!(
                        "{err_message} Error sending notification for destination {} err: {e};",
                        dest.name
                    );
                }
            }
        }
        if no_of_error == self.destinations.len() {
            Err(AlertError::SendNotificationError {
                error_message: err_message,
            })
        } else {
            Ok((success_message, err_message))
        }
    }
}

async fn send_notification(
    alert: &Alert,
    dest_type: &DestinationType,
    template: &Template,
    rows: &[Map<String, Value>],
    rows_end_time: i64,
    start_time: Option<i64>,
    evaluation_timestamp: i64,
) -> Result<String, anyhow::Error> {
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
    let is_email = matches!(dest_type, DestinationType::Email(_));
    let msg: String = process_dest_template(
        &org_name,
        &template.body,
        alert,
        rows,
        &rows_tpl_val,
        ProcessTemplateOptions {
            rows_end_time,
            start_time,
            evaluation_timestamp,
            is_email,
        },
    )
    .await;

    let email_subject = if let TemplateType::Email { title } = &template.template_type {
        process_dest_template(
            &org_name,
            title,
            alert,
            rows,
            &rows_tpl_val,
            ProcessTemplateOptions {
                rows_end_time,
                start_time,
                evaluation_timestamp,
                is_email,
            },
        )
        .await
    } else {
        template.name.clone()
    };

    match dest_type {
        DestinationType::Http(endpoint) => send_http_notification(endpoint, msg).await,
        DestinationType::Email(email) => send_email_notification(&email_subject, email, msg).await,
        DestinationType::Sns(aws_sns) => send_sns_notification(&alert.name, aws_sns, msg).await,
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

    let client = if endpoint.skip_tls_verify {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()?
    } else {
        reqwest::Client::new()
    };
    let url = url::Url::parse(&endpoint.url)?;
    let mut req = match endpoint.method {
        HTTPType::POST => client.post(url),
        HTTPType::PUT => client.put(url),
        HTTPType::GET => client.get(url),
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

    let resp = req.body(msg.clone()).send().await?;
    let resp_status = resp.status();
    let resp_body = resp.text().await?;

    log::debug!(
        "Alert sent to destination {} with status: {}, body:\n{}",
        endpoint.url,
        resp_status,
        resp_body,
    );

    if !resp_status.is_success() {
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

async fn send_email_notification(
    email_subject: &str,
    email: &Email,
    msg: String,
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

    let email = email
        .multipart(MultiPart::alternative_plain_html(msg.clone(), msg))
        .unwrap();

    // Send the email
    match SMTP_CLIENT.as_ref().unwrap().send(email).await {
        Ok(resp) => Ok(format!("sent email response code: {}", resp.code())),
        Err(e) => Err(anyhow::anyhow!("Error sending email: {e}")),
    }
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

        resp = resp
            .replace("{org_name}", org_name)
            .replace("{stream_type}", alert.stream_type.as_str())
            .replace("{stream_name}", &alert.stream_name)
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
    pub is_email: bool,
}

async fn process_dest_template(
    org_name: &str,
    tpl: &str,
    alert: &Alert,
    rows: &[Map<String, Value>],
    rows_tpl_val: &[Value],
    options: ProcessTemplateOptions,
) -> String {
    let cfg = get_config();
    let ProcessTemplateOptions {
        rows_end_time,
        start_time,
        evaluation_timestamp,
        is_email,
    } = options;
    // format values
    let alert_count = rows.len();
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
    let function_content = if alert.query_condition.vrl_function.is_none() {
        "".to_owned()
    } else {
        format!(
            "&functionContent={}",
            alert
                .query_condition
                .vrl_function
                .as_ref()
                .unwrap()
                .replace('+', "%2B")
        )
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
            _ => unreachable!(),
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

    let evaluation_timestamp_millis = evaluation_timestamp / 1000;
    let evaluation_timestamp_seconds = evaluation_timestamp_millis / 1000;
    let mut resp = tpl
        .replace("{org_name}", org_name)
        .replace("{stream_type}", alert.stream_type.as_str())
        .replace("{stream_name}", &alert.stream_name)
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
        .replace("{alert_start_time}", &alert_start_time_str)
        .replace("{alert_end_time}", &alert_end_time_str)
        .replace("{alert_url}", &alert_url)
        .replace("{alert_trigger_time}", &evaluation_timestamp.to_string())
        .replace(
            "{alert_trigger_time_millis}",
            &evaluation_timestamp_millis.to_string(),
        )
        .replace(
            "{alert_trigger_time_seconds}",
            &evaluation_timestamp_seconds.to_string(),
        )
        .replace("{alert_trigger_time_str}", &evaluation_timestamp_str)
        .replace("{alert_description}", &alert.description);

    if let Some(contidion) = &alert.query_condition.promql_condition {
        resp = resp
            .replace("{alert_promql_operator}", &contidion.operator.to_string())
            .replace("{alert_promql_value}", &contidion.value.to_string());
    }

    // Check if {rows} is being used in a JSON context
    let is_json_rows_context = check_json_context(&resp, "rows");

    if is_json_rows_context {
        // If the row template type is json, then all row_tpl_val elements are JSON values, inject
        // as JSON array Otherwise, the row_tpl_val is a normal string, so inject as a
        // single string joined with \n
        let mut all_json = true;

        for v in rows_tpl_val.iter() {
            if let Value::String(_) = v {
                all_json = false;
                break;
            }
        }

        if all_json {
            // Create JSON array representation with actual JSON objects
            let json_array = Value::Array(rows_tpl_val.to_vec());
            let json_str = serde_json::to_string(&json_array).unwrap_or_else(|_| "[]".to_string());
            resp = resp.replace("\"{rows}\"", &json_str);
        } else {
            // Fallback to string behavior
            process_variable_replace(
                &mut resp,
                "rows",
                &VarValue::JsonArray(rows_tpl_val),
                is_email,
            );
        }
    } else {
        // Normal string replacement
        process_variable_replace(
            &mut resp,
            "rows",
            &VarValue::JsonArray(rows_tpl_val),
            is_email,
        );
    }

    for (key, value) in vars.iter() {
        if resp.contains(&format!("{{{key}}}")) {
            let val = value.iter().cloned().collect::<Vec<_>>();
            process_variable_replace(&mut resp, key, &VarValue::Str(&val.join(", ")), is_email);
        }
    }
    if let Some(attrs) = &alert.context_attributes {
        for (key, value) in attrs.iter() {
            process_variable_replace(&mut resp, key, &VarValue::Str(value), is_email);
        }
    }

    resp
}

/// Checks if a variable is being used in a JSON context (i.e., as a direct value in JSON)
/// For example, {"key": "{var}"} returns true, but {"key": "text {var} text"} returns false
fn check_json_context(tpl: &str, var_name: &str) -> bool {
    let pattern_with_quotes = format!("\"{{{var_name}}}\"");

    if let Some(pos) = tpl.find(&pattern_with_quotes) {
        let before = &tpl[..pos];
        let after = &tpl[pos + pattern_with_quotes.len()..];

        // Pattern should be: "key": "{var_name}" followed by , or }
        // Check for colon before (with optional whitespace)
        let before_trimmed = before.trim_end();
        let after_trimmed = after.trim_start();

        if before_trimmed.ends_with(':')
            && (after_trimmed.starts_with(',') || after_trimmed.starts_with('}'))
        {
            return true;
        }
    }
    false
}

fn process_variable_replace(tpl: &mut String, var_name: &str, var_val: &VarValue, is_email: bool) {
    let pattern = "{".to_owned() + var_name + "}";
    if tpl.contains(&pattern) {
        *tpl = tpl.replace(&pattern, &var_val.to_string_with_length(0, is_email));
        return;
    }
    let pattern = "{".to_owned() + var_name + ":";
    if let Some(start) = tpl.find(&pattern) {
        // find } start from position v
        let p = start + pattern.len();
        if let Some(end) = tpl[p..].find('}') {
            let len = tpl[p..p + end].parse::<usize>().unwrap_or_default();
            if len > 0 {
                *tpl = tpl.replace(
                    &tpl[start..p + end + 1],
                    &var_val.to_string_with_length(len, is_email),
                );
            }
        }
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
fn format_variable_value(val: String) -> String {
    val.chars()
        .map(|c| match c {
            '\'' => "\\\\'".to_string(),
            '"' => "\\\"".to_string(),
            '\\' => "\\\\".to_string(),
            '\n' => "\\n".to_string(),
            '\r' => "\\r".to_string(),
            '\t' => "\\t".to_string(),
            '\0' => "\\u{0}".to_string(),
            '\x1b' => "\\u{1b}".to_string(),
            '\x08' => "\\u{8}".to_string(),
            '\x0c' => "\\u{c}".to_string(),
            '\x0b' => "\\u{b}".to_string(),
            '\x01' => "\\u{1}".to_string(),
            '\x02' => "\\u{2}".to_string(),
            '\x1f' => "\\u{1f}".to_string(),
            _ => c.to_string(),
        })
        .collect::<String>()
}

pub(super) fn to_float(val: &Value) -> f64 {
    if val.is_number() {
        val.as_f64().unwrap_or_default()
    } else {
        val.as_str().unwrap_or_default().parse().unwrap_or_default()
    }
}

enum VarValue<'a> {
    Str(&'a str),
    JsonArray(&'a [Value]),
}

impl VarValue<'_> {
    fn len(&self) -> usize {
        match self {
            VarValue::Str(v) => v.chars().count(),
            VarValue::JsonArray(v) => v.len(),
        }
    }

    fn to_string_with_length(&self, n: usize, is_email: bool) -> String {
        let n = if n > 0 && n < self.len() {
            n
        } else {
            self.len()
        };
        match self {
            VarValue::Str(v) => format_variable_value(v.chars().take(n).collect()),
            VarValue::JsonArray(v) => {
                // Convert JSON values to strings
                let strings: Vec<String> = v[0..n]
                    .iter()
                    .map(|val| {
                        if val.is_string() {
                            format_variable_value(val.as_str().unwrap_or("").to_string())
                        } else {
                            format_variable_value(val.to_string())
                        }
                    })
                    .collect();
                strings.join(if is_email { "" } else { "\\n" })
            }
        }
    }
}

#[cfg(not(feature = "enterprise"))]
async fn permitted_alerts(
    _org_id: &str,
    _user_id: Option<&str>,
    _folder_id: Option<&str>,
) -> Result<Option<Vec<String>>, AlertError> {
    Ok(None)
}

#[cfg(feature = "enterprise")]
async fn permitted_alerts(
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

    use o2_openfga::meta::mapping::OFGA_MODELS;

    use crate::{common::utils::auth::AuthExtractor, service::db::user::get as get_user};

    if let Some(folder_id) = folder_id {
        let user_role = match get_user(Some(org_id), user_id).await {
            Ok(Some(user)) => user.role,
            _ => return Err(AlertError::UserNotFound),
        };
        let permitted = crate::handler::http::auth::validator::check_permissions(
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

    // We also check for the `GET_INDIVIDUAL` permission on the dashboards.
    // If the user has `GET_INDIVIDUAL` permission on a dashboard, then they will be able to see the
    // dashboard. This is used to check if the user has permission to see a specific dashboard.

    let permitted_objects = crate::handler::http::auth::validator::list_objects_for_user(
        org_id,
        user_id,
        "GET_INDIVIDUAL",
        OFGA_MODELS.get("alerts").unwrap().key,
    )
    .await
    .map_err(|err| AlertError::PermittedAlertsValidator(err.to_string()))?;

    Ok(permitted_objects)
}

#[cfg(test)]
mod tests {
    use arrow_schema::DataType;
    use serde_json::json;

    use super::*;
    use crate::service::alerts::{Condition, build_expr};

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
}
