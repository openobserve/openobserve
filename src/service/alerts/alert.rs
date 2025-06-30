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

use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};

#[cfg(feature = "enterprise")]
use actix_http::header::HeaderMap;
use async_trait::async_trait;
use chrono::{Duration, Local, TimeZone, Timelike, Utc};
use config::{
    SMTP_CLIENT, TIMESTAMP_COL_NAME, get_config,
    meta::{
        alerts::{
            FrequencyType, Operator, QueryType, TriggerEvalResults,
            alert::{Alert, AlertListFilter, ListAlertsParams},
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
) -> Result<(), AlertError> {
    // Currently all alerts are stored in the default folder so create the
    // default folder for the org if it doesn't exist yet.
    if !table::folders::exists(org_id, DEFAULT_FOLDER, FolderType::Alerts).await? {
        create_default_alerts_folder(org_id).await?;
    };

    prepare_alert(org_id, stream_name, name, &mut alert, create).await?;

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
                if create {
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
                if !stream.eq(stream_name) {
                    if let Some(settings) =
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
    prepare_alert(org_id, &stream_name, &alert_name, &mut alert, true).await?;

    let alert = db::alerts::alert::create(conn, org_id, folder_id, alert).await?;

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
                Some(_alert_id_str.clone()),
                org_id,
                _user_id,
                "alerts",
                "PUT",
                &curr_folder.folder_id,
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

    prepare_alert(org_id, &stream_name, &alert_name, &mut alert, false).await?;

    let alert = db::alerts::alert::update(conn, org_id, dst_folder_id_info, alert).await?;
    #[cfg(feature = "enterprise")]
    if _folder_info.is_some() && get_openfga_config().enabled {
        let alert_id = alert.id.unwrap().to_string();
        let (curr_folder_id, dst_folder_id) = _folder_info.unwrap();
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
) -> Result<Alert, AlertError> {
    match table::alerts::get_by_id(conn, org_id, alert_id).await? {
        Some((_f, a)) => Ok(a),
        None => Err(AlertError::AlertNotFound),
    }
}

pub async fn get_by_id_db(org_id: &str, alert_id: Ksuid) -> Result<Alert, AlertError> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match table::alerts::get_by_id(conn, org_id, alert_id).await? {
        Some((_f, a)) => Ok(a),
        None => Err(AlertError::AlertNotFound),
    }
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
                        .contains(&format!("alert:_all_{}", org_id))
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
            let search_event_ctx = SearchEventContext::with_alert(Some(format!(
                "/alerts/{}/{}/{}/{}",
                self.org_id, self.stream_type, self.stream_name, self.name
            )));
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
        for dest in self.destinations.iter() {
            let (dest, template) = destinations::get_with_template(&self.org_id, dest).await?;
            let Module::Alert {
                destination_type, ..
            } = dest.module
            else {
                return Err(AlertError::GetDestinationWithTemplateError(
                    db::alerts::destinations::DestinationError::UnsupportedType,
                ));
            };
            match send_notification(
                self,
                &destination_type,
                &template,
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
        vec!["".to_string()]
    } else {
        process_row_template(&org_name, &alert.row_template, alert, rows)
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
        "Alert sent to destination {} with status: {}, body: {:?}",
        endpoint.url,
        resp_status,
        resp_body,
    );
    if !resp_status.is_success() {
        log::error!(
            "Alert http notification failed with status: {}, body: {}, payload: {}",
            resp_status,
            resp_body,
            msg
        );
        return Err(anyhow::anyhow!(
            "sent error status: {}, err: {}",
            resp_status,
            resp_body
        ));
    }

    Ok(format!("sent status: {}, body: {}", resp_status, resp_body))
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
    rows: &[Map<String, Value>],
) -> Vec<String> {
    let alert_type = if alert.is_real_time {
        "realtime"
    } else {
        "scheduled"
    };
    let alert_count = rows.len();
    let mut rows_tpl = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        let mut resp = tpl.to_string();
        let mut alert_start_time = 0;
        let mut alert_end_time = 0;
        for (key, value) in row.iter() {
            let value = if value.is_string() {
                value.as_str().unwrap_or_default().to_string()
            } else if value.is_f64() {
                format!("{:.2}", value.as_f64().unwrap_or_default())
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

        rows_tpl.push(resp);
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
    rows_tpl_val: &[String],
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
                format!("{:.2}", value.as_f64().unwrap_or_default())
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
                if let Some(conditions) = &alert.query_condition.conditions {
                    if let Ok(v) = build_sql(
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
        .replace("{alert_trigger_time_str}", &evaluation_timestamp_str);

    if let Some(contidion) = &alert.query_condition.promql_condition {
        resp = resp
            .replace("{alert_promql_operator}", &contidion.operator.to_string())
            .replace("{alert_promql_value}", &contidion.value.to_string());
    }

    process_variable_replace(&mut resp, "rows", &VarValue::Vector(rows_tpl_val), is_email);
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
                format!("{:.2}", value.as_f64().unwrap_or_default())
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
    Vector(&'a [String]),
}

impl VarValue<'_> {
    fn len(&self) -> usize {
        match self {
            VarValue::Str(v) => v.chars().count(),
            VarValue::Vector(v) => v.len(),
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
            VarValue::Vector(v) => v[0..n].join(if is_email { "" } else { "\\n" }),
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
    use super::*;

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
        let ret = save(org_id, stream_name, alert_name, alert, true).await;
        // alert name should not contain /
        assert!(ret.is_err());
    }

    #[tokio::test]
    async fn test_update_cron_expression_1() {
        let cron_exp = "* * * * * * *";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{} * * * * * *", now);
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
        let updated = format!("{} */15 21-23,0-8 * * *", now);
        assert_eq!(new_cron_exp, updated);
    }

    #[tokio::test]
    async fn test_update_cron_expression_4() {
        let cron_exp = "*10*****";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{} 10*****", now);
        assert_eq!(new_cron_exp, updated);
    }

    #[tokio::test]
    async fn test_update_cron_expression_5() {
        let cron_exp = "* */10 2 * * * *";
        let now = Utc::now().second();
        let new_cron_exp = update_cron_expression(cron_exp, now);
        let updated = format!("{} */10 2 * * * *", now);
        assert_eq!(new_cron_exp, updated);
    }
}
