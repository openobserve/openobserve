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

use std::str::FromStr;

use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use config::meta::{
    alerts::{
        QueryCondition as MetaQueryCondition, TriggerCondition as MetaTriggerCondition,
        alert::{
            Alert as MetaAlert, AlertSortField as MetaAlertSortField, AlertTypeFilter,
            ListAlertsParams,
        },
        deduplication::DeduplicationConfig as MetaDeduplicationConfig,
    },
    folder::{Folder as MetaFolder, FolderType},
    stream::StreamType as MetaStreamType,
};
use hashbrown::HashMap;
use itertools::Itertools;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DeriveIden, EntityTrait, ModelTrait,
    Order, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait, TryIntoModel,
    prelude::Expr, sea_query::Func,
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::{
    entity::{alerts, folders},
    folders::folder_type_into_i16,
};
use crate::{
    db::get_orm_client_rw,
    errors::{self, FromStrError, PutAlertError},
};

pub mod intermediate;

impl TryFrom<alerts::Model> for MetaAlert {
    type Error = errors::Error;

    fn try_from(value: alerts::Model) -> Result<Self, Self::Error> {
        let id: Ksuid = Ksuid::from_str(&value.id).map_err(|_| FromStrError {
            value: value.id,
            ty: "svix_ksuid::Ksuid".to_owned(),
        })?;

        // Transform database string values into intermediate types which can be
        // directly translated into service layer types.
        let stream_type: intermediate::StreamType = value.stream_type.parse()?;
        let trigger_threshold_operator: intermediate::TriggerThresholdOperator =
            value.trigger_threshold_operator.parse()?;

        // Transform database i16 values into intermediate types which can be
        // directly translated into service layer types.
        let query_type: intermediate::QueryType = value.query_type.try_into()?;
        let query_search_event_type: Option<intermediate::QuerySearchEventType> = value
            .query_search_event_type
            .map(|i| i.try_into())
            .transpose()?;
        let trigger_frequency_type: intermediate::TriggerFrequencyType =
            value.trigger_frequency_type.try_into()?;
        let row_template_type: intermediate::RowTemplateTypeDb =
            value.row_template_type.try_into()?;

        // Transform database JSON values into intermediate types which can be
        // directly translated into service layer types.
        let destinations: Vec<String> = serde_json::from_value(value.destinations)?;
        let context_attributes: Option<HashMap<String, String>> = value
            .context_attributes
            .map(serde_json::from_value)
            .transpose()?;
        let query_conditions: Option<config::meta::alerts::AlertConditionParams> = value
            .query_conditions
            .map(serde_json::from_value)
            .transpose()?;
        let query_promql_condition: Option<intermediate::QueryCondition> = value
            .query_promql_condition
            .map(serde_json::from_value)
            .transpose()?;
        let query_aggregation: Option<intermediate::QueryAggregation> = value
            .query_aggregation
            .map(serde_json::from_value)
            .transpose()?;
        let query_multi_time_range: Option<Vec<intermediate::QueryCompareHistoricData>> = value
            .query_multi_time_range
            .map(serde_json::from_value)
            .transpose()?;
        let workflows: Vec<String> = serde_json::from_value(value.workflows)?;

        // Transform the Unix timestamp into a date time that will always use
        // the UTC timezone.
        let updated_at_utc: Option<DateTime<FixedOffset>> = value
            .updated_at
            .and_then(|secs| Utc.timestamp_opt(secs, 0).single())
            .map(|dt: DateTime<Utc>| dt.into());

        let mut alert: MetaAlert = Default::default();
        alert.id = Some(id);
        alert.name = value.name;
        alert.org_id = value.org;
        alert.stream_type = stream_type.into();
        alert.stream_name = value.stream_name;
        alert.is_real_time = value.is_real_time;
        alert.destinations = destinations;
        alert.template = value.template;
        alert.context_attributes = context_attributes;
        alert.row_template = value.row_template.unwrap_or_default();
        alert.row_template_type = row_template_type.into();
        alert.description = value.description.unwrap_or_default();
        alert.enabled = value.enabled;
        alert.tz_offset = value.tz_offset;
        alert.owner = value.owner;
        alert.last_edited_by = value.last_edited_by;
        alert.updated_at = updated_at_utc;
        alert.query_condition = MetaQueryCondition {
            query_type: query_type.into(),
            conditions: query_conditions,
            sql: value.query_sql,
            promql: value.query_promql,
            promql_condition: query_promql_condition.map(|c| c.into()),
            // Rides `trigger_thresholds` alongside the other level knobs (D1),
            // so no further schema change is needed.
            promql_warning_value: value
                .trigger_thresholds
                .clone()
                .and_then(|v| {
                    serde_json::from_value::<config::meta::alerts::level::ThresholdConfig>(v).ok()
                })
                .and_then(|t| t.promql_warning),
            // NULL is `false`: every alert written before the column existed
            // keeps its collapsed evaluation.
            promql_multi_alert: value.query_promql_multi_alert.unwrap_or(false),
            aggregation: query_aggregation.map(|a| a.into()),
            vrl_function: value.query_vrl_function,
            search_event_type: query_search_event_type.map(|t| t.into()),
            multi_time_range: query_multi_time_range
                .map(|ds| ds.into_iter().map(|d| d.into()).collect()),
            // Feature 5 (D42). An unparseable blob degrades to `None` rather
            // than failing the load — one bad row must not take the alert
            // list down, the same rule `trigger_thresholds` follows above.
            slo_condition: value
                .query_slo_condition
                .and_then(|v| serde_json::from_value(v).ok()),
        };
        alert.trigger_condition = MetaTriggerCondition {
            align_time: value.align_time,
            // DB model stores period in seconds, but service layer stores
            // minutes.
            period: value.trigger_period_seconds / 60,
            operator: trigger_threshold_operator.into(),
            threshold: value.trigger_threshold_count,
            // Unpack the level axis from `trigger_thresholds` (D1). A missing
            // or unparseable blob degrades to a single-level alert rather than
            // failing the load — one bad row must not take the alert list down.
            warning_threshold: value
                .trigger_thresholds
                .clone()
                .and_then(|v| {
                    serde_json::from_value::<config::meta::alerts::level::ThresholdConfig>(v).ok()
                })
                .and_then(|t| t.warning),
            notify_on_warning: value
                .trigger_thresholds
                .clone()
                .and_then(|v| {
                    serde_json::from_value::<config::meta::alerts::level::ThresholdConfig>(v).ok()
                })
                .and_then(|t| t.notify_on_warning),
            frequency: value.trigger_frequency_seconds,
            cron: value.trigger_frequency_cron.unwrap_or_default(),
            frequency_type: trigger_frequency_type.into(),
            silence: value.trigger_silence_seconds / 60,
            timezone: value.trigger_frequency_cron_timezone,
            tolerance_in_secs: value.trigger_tolerance_seconds,
        };
        alert.set_last_satisfied_at(value.last_satisfied_at);
        alert.set_last_triggered_at(value.last_triggered_at);

        // Load deduplication configuration if enabled
        if value.dedup_enabled {
            let dedup_config_json = value.dedup_config.unwrap_or_else(|| serde_json::json!({}));
            let mut dedup_config: MetaDeduplicationConfig =
                serde_json::from_value(dedup_config_json)?;
            dedup_config.enabled = true;
            dedup_config.time_window_minutes = value.dedup_time_window_minutes;
            alert.deduplication = Some(dedup_config);
        }

        alert.creates_incident = value.creates_incident;
        alert.workflows = workflows;

        // Feature 2 (PT-2 / PT-6). Both degrade to "unset" rather than failing
        // the load: one row with a junk priority id or a malformed tags blob
        // must not take the whole alert list down.
        alert.priority = value
            .priority
            .and_then(config::meta::alerts::priority::AlertPriority::from_i32);
        alert.tags = value
            .tags
            .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
            .unwrap_or_default();

        Ok(alert)
    }
}

/// Gets an alert by its ID.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<Option<(MetaFolder, MetaAlert)>, errors::Error> {
    let models = get_model_by_id(conn, org_id, alert_id).await?;

    if let Some((folder_model, alert_model)) = models {
        let folder = folder_model.into();
        let alert = alert_model.try_into()?;
        Ok(Some((folder, alert)))
    } else {
        Ok(None)
    }
}

/// Gets an alert by its name.
pub async fn get_by_name<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    stream_type: MetaStreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<Option<(MetaFolder, MetaAlert)>, errors::Error> {
    let models = get_model_by_name(
        conn,
        org_id,
        folder_id,
        stream_type,
        stream_name,
        alert_name,
    )
    .await?
    .and_then(|(f, maybe_a)| maybe_a.map(|a| (f, a)));

    if let Some((folder_model, alert_model)) = models {
        let folder = folder_model.into();
        let alert = alert_model.try_into()?;
        Ok(Some((folder, alert)))
    } else {
        Ok(None)
    }
}

/// Creates a new alert or updates an existing alert in the database. Returns
/// the new or updated alert.
pub async fn put<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    alert: MetaAlert,
) -> Result<MetaAlert, errors::Error> {
    let txn = conn.begin().await?;
    let rslt: Result<alerts::Model, errors::Error> = match get_model_by_name(
        &txn,
        org_id,
        folder_id,
        alert.stream_type,
        &alert.stream_name,
        &alert.name,
    )
    .await?
    {
        None => {
            // Destination folder does not exist so the alert can neither be
            // created nor updated.
            return Err(
                errors::DbError::PutAlert(errors::PutAlertError::FolderDoesNotExist).into(),
            );
        }
        Some((_folder_m, Some(alert_m))) => {
            // Destination folder exists and alert already exists, so convert
            // the alert model to an active model and update it.
            let mut alert_am: alerts::ActiveModel = alert_m.into();
            update_mutable_fields(&mut alert_am, alert)?;
            let model: alerts::Model = alert_am.update(&txn).await?.try_into_model()?;
            Ok(model)
        }
        Some((folder_m, None)) => {
            // Destination folder exists and alert does not exist, so create an
            // active model for creating a new record.
            let id = svix_ksuid::Ksuid::new(None, None).to_string();
            let stream_type = intermediate::StreamType::from(alert.stream_type).to_string();
            let stream_name = alert.stream_name.clone();
            let mut alert_am = alerts::ActiveModel {
                // The following fields can only be set on creation.
                id: Set(id),
                org: Set(org_id.to_owned()),
                folder_id: Set(folder_m.id),
                stream_type: Set(stream_type),
                stream_name: Set(stream_name),
                // All remaining fields can be set on creation or updated so
                // they are set below.
                ..Default::default()
            };
            update_mutable_fields(&mut alert_am, alert)?;

            // Triggered and satisfied timestamps should always be initialized
            // to None.
            alert_am.last_triggered_at = Set(None);
            alert_am.last_satisfied_at = Set(None);

            let model: alerts::Model = alert_am.insert(&txn).await?.try_into_model()?;
            Ok(model)
        }
    };
    let alert = rslt?.try_into()?;
    txn.commit().await?;
    Ok(alert)
}

/// Creates a new alert in the database. Returns the new alert.
pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    alert: MetaAlert,
    use_given_id: bool,
) -> Result<MetaAlert, errors::Error> {
    let txn = conn.begin().await?;

    // Get the destination folder.
    let Some(folder_m) =
        super::folders::get_model(&txn, org_id, folder_id, FolderType::Alerts).await?
    else {
        return Err(errors::DbError::PutAlert(PutAlertError::FolderDoesNotExist).into());
    };

    let id = if use_given_id {
        alert
            .id
            .unwrap_or_else(|| svix_ksuid::Ksuid::new(None, None))
            .to_string()
    } else {
        svix_ksuid::Ksuid::new(None, None).to_string()
    };
    let stream_type = intermediate::StreamType::from(alert.stream_type).to_string();
    let mut alert_am = alerts::ActiveModel {
        id: Set(id),
        org: Set(org_id.to_owned()),
        folder_id: Set(folder_m.id),
        stream_type: Set(stream_type),
        stream_name: Set(alert.stream_name.clone()),
        // All remaining fields can be set on creation or updated so
        // they are set below.
        ..Default::default()
    };
    update_mutable_fields(&mut alert_am, alert)?;

    // Triggered and satisfied timestamps should always be initialized
    // to None so overwrite any value that might have been set already.
    alert_am.last_triggered_at = Set(None);
    alert_am.last_satisfied_at = Set(None);

    let alert_m: alerts::Model = alert_am.insert(&txn).await?.try_into_model()?;
    let alert = alert_m.try_into()?;
    txn.commit().await?;
    log::debug!("Alert created: {alert:?}");
    Ok(alert)
}

/// Updates an alert in the database. Returns the new alert.
pub async fn update<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: Option<&str>,
    alert: MetaAlert,
) -> Result<MetaAlert, errors::Error> {
    // Ensure that ID is provided.
    let Some(alert_id) = alert.id else {
        return Err(errors::DbError::PutAlert(PutAlertError::UpdateAlertMissingID).into());
    };

    let txn = conn.begin().await?;

    // Try to get the new parent folder if a folder ID is provided.
    let maybe_folder_m = match folder_id {
        Some(f_id) => {
            let Some(folder_m) =
                super::folders::get_model(&txn, org_id, f_id, FolderType::Alerts).await?
            else {
                return Err(errors::DbError::PutAlert(PutAlertError::FolderDoesNotExist).into());
            };
            Some(folder_m)
        }
        None => None,
    };

    // Try to get the alert to update.
    let Some((_, alert_m)) = get_model_by_id(&txn, org_id, alert_id).await? else {
        return Err(errors::DbError::PutAlert(PutAlertError::UpdateAlertNotFound).into());
    };

    // Update fields using values from the given alert.
    let mut alert_am: alerts::ActiveModel = alert_m.into();
    update_mutable_fields(&mut alert_am, alert)?;

    // Update the folder if a new parent folder was provided.
    if let Some(folder_m) = maybe_folder_m {
        alert_am.folder_id = Set(folder_m.id);
    }

    let alert_m: alerts::Model = alert_am.update(&txn).await?.try_into_model()?;
    let alert = alert_m.try_into()?;
    txn.commit().await?;
    Ok(alert)
}

/// Deletes an alert by its ID.
pub async fn delete_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(), errors::Error> {
    alerts::Entity::delete_many()
        .filter(alerts::Column::Org.eq(org_id))
        .filter(alerts::Column::Id.eq(alert_id.to_string()))
        .exec(conn)
        .await?;
    Ok(())
}

/// Deletes an alert by its name.
pub async fn delete_by_name<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    stream_type: MetaStreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<(), errors::Error> {
    let model = get_model_by_name(
        conn,
        org_id,
        folder_id,
        stream_type,
        stream_name,
        alert_name,
    )
    .await?
    .and_then(|(_folder, maybe_alert)| maybe_alert);

    if let Some(model) = model {
        let _ = model.delete(conn).await?;
    }

    Ok(())
}

/// Lists alerts.
pub async fn list<C: ConnectionTrait>(
    conn: &C,
    params: ListAlertsParams,
) -> Result<Vec<(MetaFolder, MetaAlert)>, errors::Error> {
    let alerts = list_models(conn, params)
        .await?
        .into_iter()
        .map(|(f, a)| {
            let f = MetaFolder::from(f);
            let a = MetaAlert::try_from(a)?;
            Ok((f, a))
        })
        .collect::<Result<_, errors::Error>>()?;
    Ok(alerts)
}

/// The `(long, short)` burn-window pairs of every alert pointing at this SLO.
///
/// The reverse lookup D60 put the indexed `slo_id` column there for: it runs
/// on every ingest pass (SA-19) to decide which windows to precompute, so it
/// reads the **column**, never the alert cache — a cache miss would silently
/// stop precomputing a window and freeze the alerts that need it.
///
/// Error-budget alerts have no windows and contribute nothing; only alerts
/// that are actually enabled are counted, so a disabled alert costs no
/// aggregate.
///
/// `exclude_alert_id` omits one alert's row (B3). Save-validation passes the
/// alert being edited, so it does not count its own stored pair against the
/// cap it is about to vacate; **the ingest pass must pass `None`**, because
/// under-counting there stops precomputing a window some alert still needs.
///
/// Pairs are returned **once per alert**, not deduplicated — two alerts on the
/// same windows yield two entries. Both callers collapse them
/// (`validate_pair_budget` through a `BTreeSet`, `durations_for_pairs` through
/// sort+dedup), and the cap is defined on distinct pairs, so do not "tidy" this
/// into a `DISTINCT` on the assumption that the count means anything by itself.
pub async fn list_slo_burn_window_pairs<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    slo_id: &str,
    exclude_alert_id: Option<&str>,
) -> Result<Vec<(i64, i64)>, errors::Error> {
    let query = alerts::Entity::find()
        .filter(alerts::Column::Org.eq(org))
        .filter(alerts::Column::SloId.eq(slo_id))
        .filter(alerts::Column::Enabled.eq(true));

    // B3: save-validation excludes the alert being edited so it does not count
    // its own stored pair against the cap it is about to vacate. Keyed on the
    // row's identity, NOT on its pair value — another alert may legitimately
    // use the same windows, and that pair stays consumed.
    //
    // Safe as a `<>` predicate: `id` is the non-nullable primary key, so this
    // cannot silently drop rows the way `<>` does against a nullable column.
    //
    // The ingest pass passes `None` and must keep seeing everything.
    let query = match exclude_alert_id {
        Some(id) => query.filter(alerts::Column::Id.ne(id)),
        None => query,
    };

    let models = query.all(conn).await?;

    Ok(models
        .into_iter()
        .filter_map(|m| {
            let cond: config::meta::slo::condition::SloCondition =
                serde_json::from_value(m.query_slo_condition?).ok()?;
            Some((cond.long_window_secs?, cond.short_window_secs?))
        })
        .collect())
}

/// Every alert pointing at this SLO as `(id, name)`, enabled or not.
///
/// The other half of the D60 reverse lookup: S-12 needs it on delete, where a
/// **disabled** alert counts just as much as an enabled one — it would be just
/// as broken the moment it was re-enabled. The name rides along so the cascade
/// can log what it removed; an id alone tells the operator nothing.
pub async fn list_alerts_by_slo<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    slo_id: &str,
) -> Result<Vec<(String, String)>, errors::Error> {
    Ok(alerts::Entity::find()
        .filter(alerts::Column::Org.eq(org))
        .filter(alerts::Column::SloId.eq(slo_id))
        .all(conn)
        .await?
        .into_iter()
        .map(|m| (m.id, m.name))
        .collect())
}

/// When this alert was last written, epoch **microseconds** — the raw stored
/// column, not `MetaAlert::updated_at`.
///
/// Read raw deliberately. `update_mutable_fields` writes `timestamp_micros()`
/// here while the `Model -> MetaAlert` conversion above parses the same integer
/// as *seconds*, which `chrono` refuses as out of range — so `updated_at` on the
/// domain type is `None` for every alert this codebase has ever saved. That
/// pre-existing mismatch is not this function's to fix, but the SLO backfill
/// clamp (S-16 PR 4) genuinely needs the value, so it takes the column as
/// written.
///
/// One caveat, and it points the safe way: rows untouched since the 2024
/// `populate_alerts_table` migration hold *seconds*, which read back as ~1970
/// and therefore clamp nothing. That is the right answer anyway — an alert
/// unedited since 2024 has no recent edit to clamp against.
pub async fn last_written_us<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    alert_id: &str,
) -> Result<Option<i64>, errors::Error> {
    Ok(alerts::Entity::find_by_id(alert_id.to_string())
        .filter(alerts::Column::Org.eq(org))
        .one(conn)
        .await?
        .and_then(|m| m.updated_at))
}

/// Lists all alerts.
pub async fn list_all<C: ConnectionTrait>(conn: &C) -> Result<Vec<MetaAlert>, errors::Error> {
    let alerts = list_all_models(conn)
        .await?
        .into_iter()
        .map(MetaAlert::try_from)
        .collect::<Result<_, errors::Error>>()?;
    Ok(alerts)
}

/// Tries to get an alert ORM entity and its parent folder ORM entity.
async fn get_model_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<Option<(folders::Model, alerts::Model)>, sea_orm::DbErr> {
    let maybe_f_a = alerts::Entity::find_by_id(alert_id.to_string())
        .filter(alerts::Column::Org.eq(org_id))
        .find_also_related(folders::Entity)
        .one(conn)
        .await?
        .and_then(|(a, maybe_f)| maybe_f.map(|f| (f, a)));
    Ok(maybe_f_a)
}

/// Tries to get an alert ORM entity and its parent folder ORM entity.
async fn get_model_by_name<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    stream_type: MetaStreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<Option<(folders::Model, Option<alerts::Model>)>, sea_orm::DbErr> {
    let select_folders = folders::Entity::find()
        .filter(folders::Column::Org.eq(org_id))
        .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Alerts)))
        .filter(folders::Column::FolderId.eq(folder_id));

    let Some(folder) = select_folders.one(conn).await? else {
        return Ok(None);
    };

    let stream_type_str = intermediate::StreamType::from(stream_type).to_string();
    let maybe_alert = folder
        .find_related(alerts::Entity)
        .filter(alerts::Column::StreamType.eq(stream_type_str))
        .filter(alerts::Column::StreamName.eq(stream_name))
        .filter(alerts::Column::Name.eq(alert_name))
        .one(conn)
        .await?;

    Ok(Some((folder, maybe_alert)))
}

/// Chunk size for the tag-resolved ID predicate, so a broad tag filter cannot
/// emit an unbounded `IN (...)` that some drivers reject outright.
const TAG_ID_PREDICATE_CHUNK: usize = 500;

/// Stands in for an empty resolved ID set. `id IN ()` is not portable, and
/// dropping the filter would turn "nothing matches" into "everything matches".
const TAG_FILTER_NO_MATCH_SENTINEL: &str = "";

/// Lists alert ORM models using the given parameters. Returns each alert and
/// its parent folder.
async fn list_models<C: ConnectionTrait>(
    conn: &C,
    params: ListAlertsParams,
) -> Result<Vec<(folders::Model, alerts::Model)>, sea_orm::DbErr> {
    let query = alerts::Entity::find()
        .find_also_related(folders::Entity)
        .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Alerts)))
        .filter(folders::Column::Org.eq(params.org_id));

    // Apply the optional folder_id filter.
    let query = if let Some(folder_id) = &params.folder_id {
        query.filter(folders::Column::FolderId.eq(folder_id))
    } else {
        query
    };

    // Apply the optional alert name substring filter.
    let name_substring = params.name_substring.filter(|n| !n.is_empty());
    let query = if let Some(name_substring) = name_substring {
        let name_pattern = format!("%{}%", name_substring.to_lowercase());
        query.filter(
            Expr::expr(Func::lower(Expr::col((Alerts::Table, Alerts::Name)))).like(name_pattern),
        )
    } else {
        query
    };

    // Apply the optional stream filter.
    let query = if let Some((stream_type, maybe_stream_name)) = &params.stream_type_and_name {
        let stream_type_str = intermediate::StreamType::from(*stream_type).to_string();

        if let Some(stream_name) = maybe_stream_name {
            query
                .filter(alerts::Column::StreamType.eq(stream_type_str))
                .filter(alerts::Column::StreamName.eq(stream_name))
        } else {
            query.filter(alerts::Column::StreamType.eq(stream_type_str))
        }
    } else {
        query
    };

    // Apply the optional enabled filter.
    let query = if let Some(enabled) = &params.enabled {
        query.filter(alerts::Column::Enabled.eq(*enabled))
    } else {
        query
    };

    // Apply the optional SLO filter (B1).
    //
    // A SQL predicate on the indexed `slo_id` column, not an app-side pass
    // over the fetched rows: `paginate` runs on this statement, so filtering
    // afterwards would return short or empty pages. It reads the COLUMN, never
    // the JSON payload — D60 added the column precisely so this could be a
    // predicate, and rows can carry the column without a parseable condition.
    //
    // Its own `.filter()` call, deliberately NOT folded into the tag filter's
    // `Condition::any()` below, which would turn AND into OR.
    let query = match &params.slo_id {
        None => query,
        // Empty means "no SLO was named" and must match NOTHING. This follows
        // the priority/tag precedent rather than `name_substring`'s
        // empty-means-unfiltered: the id arrives from a path segment, and
        // listing the whole org on a page that promises one SLO's alerts is
        // the failure worth designing against.
        Some(slo_id) if slo_id.is_empty() => {
            query.filter(alerts::Column::Id.eq(TAG_FILTER_NO_MATCH_SENTINEL))
        }
        Some(slo_id) => query.filter(alerts::Column::SloId.eq(slo_id)),
    };

    // Apply ordinary-alert type predicates before pagination. Composite rows
    // live in their own table, while scheduled/realtime query alerts exclude
    // SLO rows even if old data happens to carry an unexpected realtime bit.
    let query = match params.alert_type {
        AlertTypeFilter::Scheduled => query
            .filter(alerts::Column::IsRealTime.eq(false))
            .filter(alerts::Column::SloId.is_null()),
        AlertTypeFilter::Realtime => query
            .filter(alerts::Column::IsRealTime.eq(true))
            .filter(alerts::Column::SloId.is_null()),
        AlertTypeFilter::Slo => query.filter(alerts::Column::SloId.is_not_null()),
        AlertTypeFilter::Composite => {
            query.filter(alerts::Column::Id.eq(TAG_FILTER_NO_MATCH_SENTINEL))
        }
        AlertTypeFilter::All | AlertTypeFilter::AnomalyDetection => query,
    };

    // Apply the optional priority filter (PT-3). Multiple values OR together;
    // alerts with no priority are excluded, because "show me the P1s" must not
    // surface unprioritized alerts.
    let query = match &params.priority {
        None => query,
        // The caller filtered by priority but nothing valid survived parsing.
        // This must match NOTHING: treating it as "no filter" would make
        // `?priority=P9` return every alert.
        Some(p) if p.is_empty() => {
            query.filter(alerts::Column::Id.eq(TAG_FILTER_NO_MATCH_SENTINEL))
        }
        Some(p) => {
            let ids: Vec<i32> = p.iter().map(|v| v.to_i32()).collect();
            query.filter(alerts::Column::Priority.is_in(ids))
        }
    };

    // Apply the optional tag filter (PT-8) as an ID predicate resolved by the
    // caller. Chunked so a broad filter cannot emit an unbounded `IN (...)`;
    // an empty resolved set must match nothing, NOT everything.
    let query = match &params.tag_alert_ids {
        None => query,
        Some(ids) if ids.is_empty() => {
            // Deliberate: `id IN ()` is not portable, and omitting the filter
            // would turn "no alert carries these tags" into "return them all".
            query.filter(alerts::Column::Id.eq(TAG_FILTER_NO_MATCH_SENTINEL))
        }
        Some(ids) => {
            let mut cond = Condition::any();
            for chunk in ids.chunks(TAG_ID_PREDICATE_CHUNK) {
                cond = cond.add(alerts::Column::Id.is_in(chunk.to_vec()));
            }
            query.filter(cond)
        }
    };

    // Apply ordering (PT-3).
    //
    // Unset priority always sorts LAST, in BOTH directions, and it is spelled
    // out rather than left to the database: PostgreSQL puts NULLs last on
    // ascending while SQLite/MySQL put them first, so native ordering would
    // give three supported databases two different list orders.
    //
    // Ties break on (name, folder name) so pagination is stable — without a
    // total order, two pages can repeat or skip a row.
    let query = match params.sort_by {
        Some(MetaAlertSortField::Priority) => {
            let nulls_last =
                Expr::expr(Expr::case(alerts::Column::Priority.is_null(), 1).finally(0));
            let query = query.order_by(nulls_last, Order::Asc);
            let query = if params.sort_desc {
                query.order_by_desc(alerts::Column::Priority)
            } else {
                query.order_by_asc(alerts::Column::Priority)
            };
            // `id` last so the order is TOTAL: without it, alerts sharing a
            // priority and name can repeat or vanish across pages.
            query
                .order_by_asc(alerts::Column::Name)
                .order_by_asc(folders::Column::Name)
                .order_by_asc(alerts::Column::Id)
        }
        Some(MetaAlertSortField::Name) => {
            let query = if params.sort_desc {
                query.order_by_desc(alerts::Column::Name)
            } else {
                query.order_by_asc(alerts::Column::Name)
            };
            query
                .order_by_asc(folders::Column::Name)
                .order_by_asc(alerts::Column::Id)
        }
        // Historical default, unchanged.
        None => query
            .order_by_asc(alerts::Column::Name)
            .order_by_asc(folders::Column::Name),
    };

    // Execute the query, either getting all results or a specific page of results.
    let results = if let Some((page_size, page_idx)) = params.page_size_and_idx
        && page_size > 0
        && page_size.checked_mul(page_idx).is_some()
    {
        query.paginate(conn, page_size).fetch_page(page_idx).await?
    } else {
        query.all(conn).await?
    };

    // Flatten the results so that each dashboard is returned alongside its
    // parent folder.
    let folders_and_dashboards = results
        .into_iter()
        .filter_map(|(d, maybe_f)| maybe_f.map(|f| (f, d)))
        .collect();
    Ok(folders_and_dashboards)
}

/// Lists all alert ORM models.
async fn list_all_models<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<alerts::Model>, sea_orm::DbErr> {
    let alerts = alerts::Entity::find()
        .all(conn)
        .await?
        .into_iter()
        .collect();
    Ok(alerts)
}

/// Updates all mutable fields on the [alerts::ActiveModel].
///
/// For some fields the values will be extracted from and transformed from the
/// given [MetaAlert] or [folders::Model]. Other fields such as updated
/// timestamps may be generated from the current timestamp.
///
/// Fields which should only be set on initial creation of an alert and which
/// should be treated as immutable will not be updated.
fn update_mutable_fields(
    alert_am: &mut alerts::ActiveModel,
    alert: MetaAlert,
) -> Result<(), errors::Error> {
    let last_triggered_at = alert.get_last_triggered_at_from_table();
    let last_satisfied_at = alert.get_last_satisfied_at_from_table();
    let name = alert.name;
    let is_real_time = alert.is_real_time;
    let destinations = serde_json::to_value(alert.destinations)?;
    let template = alert.template.filter(|s| !s.is_empty());
    let context_attributes = alert
        .context_attributes
        .map(serde_json::to_value)
        .transpose()?;
    let row_template = Some(alert.row_template).filter(|s| !s.is_empty());
    let row_template_type: i16 =
        intermediate::RowTemplateTypeDb::from(alert.row_template_type).into();
    let description = Some(alert.description).filter(|s| !s.is_empty());
    let enabled = alert.enabled;
    let tz_offset = alert.tz_offset;
    let query_type: i16 = intermediate::QueryType::from(alert.query_condition.query_type).into();
    let query_conditions = alert
        .query_condition
        .conditions
        .map(serde_json::to_value)
        .transpose()?;
    let query_sql = alert.query_condition.sql.filter(|s| !s.is_empty());
    let query_promql = alert.query_condition.promql.filter(|s| !s.is_empty());
    let query_promql_condition = alert
        .query_condition
        .promql_condition
        .map(intermediate::QueryCondition::from)
        .map(serde_json::to_value)
        .transpose()?;
    let query_aggregation = alert
        .query_condition
        .aggregation
        .map(intermediate::QueryAggregation::from)
        .map(serde_json::to_value)
        .transpose()?;
    let promql_multi_alert = alert.query_condition.promql_multi_alert;
    let query_slo_condition = alert
        .query_condition
        .slo_condition
        .as_ref()
        .map(serde_json::to_value)
        .transpose()?;
    // D60: the id is ALSO written to its own indexed column, which is
    // authoritative for reverse lookup. The copy inside the payload keeps the
    // block self-describing; they are written together so they cannot drift.
    let slo_id = alert
        .query_condition
        .slo_condition
        .as_ref()
        .map(|c| c.slo_id.clone());
    let query_vrl_function = alert.query_condition.vrl_function.filter(|s| !s.is_empty());
    let query_search_event_type: Option<i16> = alert
        .query_condition
        .search_event_type
        .map(intermediate::QuerySearchEventType::from)
        .map(|t| t.into());
    let query_multi_time_range = alert
        .query_condition
        .multi_time_range
        .map(|ds| {
            ds.into_iter()
                .map(intermediate::QueryCompareHistoricData::from)
                .collect_vec()
        })
        .map(serde_json::to_value)
        .transpose()?;
    let trigger_threshold_operator: String =
        intermediate::TriggerThresholdOperator::try_from(alert.trigger_condition.operator)
            .map_err(|_| {
                errors::DbError::PutAlert(errors::PutAlertError::IntoTriggerThresholdOperator(
                    alert.trigger_condition.operator,
                ))
            })?
            .to_string();
    let trigger_period_seconds = alert.trigger_condition.period * 60;
    let trigger_threshold_count = alert.trigger_condition.threshold;
    // Level axis -> `trigger_thresholds` JSON (decision D1). Stored as NULL
    // rather than an empty object when nothing is configured, so a
    // single-level alert has no column value at all.
    let threshold_config = config::meta::alerts::level::ThresholdConfig {
        warning: alert.trigger_condition.warning_threshold,
        notify_on_warning: alert.trigger_condition.notify_on_warning,
        promql_warning: alert.query_condition.promql_warning_value,
    };
    let trigger_thresholds = if threshold_config.is_empty() {
        None
    } else {
        Some(serde_json::to_value(&threshold_config)?)
    };
    let trigger_frequency_type: i16 =
        intermediate::TriggerFrequencyType::from(alert.trigger_condition.frequency_type).into();
    let trigger_frequency_seconds = alert.trigger_condition.frequency;
    let trigger_frequency_cron = Some(alert.trigger_condition.cron).filter(|s| !s.is_empty());
    let trigger_frequency_cron_timezone =
        alert.trigger_condition.timezone.filter(|s| !s.is_empty());
    let trigger_silence_seconds = alert.trigger_condition.silence * 60;
    let trigger_tolerance_seconds = alert.trigger_condition.tolerance_in_secs;
    let owner = alert.owner.filter(|s| !s.is_empty());
    let last_edited_by = alert.last_edited_by.filter(|s| !s.is_empty());
    let align_time = alert.trigger_condition.align_time;
    let updated_at: i64 = chrono::Utc::now().timestamp_micros();
    let workflows = serde_json::to_value(alert.workflows)?;

    // Handle deduplication configuration
    // Note: time_window_minutes is stored in a separate column, not in the JSON config
    let (dedup_enabled, dedup_time_window_minutes, dedup_config) =
        if let Some(mut dedup) = alert.deduplication {
            let dedup_enabled = dedup.enabled;
            let time_window = dedup.time_window_minutes;
            // Remove time_window_minutes from the config before serializing to avoid redundancy
            dedup.time_window_minutes = None;

            let dedup_config_json = serde_json::to_value(dedup)?;
            (dedup_enabled, time_window, Some(dedup_config_json))
        } else {
            (false, None, None)
        };

    alert_am.name = Set(name);
    alert_am.is_real_time = Set(is_real_time);
    alert_am.destinations = Set(destinations);
    alert_am.template = Set(template);
    alert_am.context_attributes = Set(context_attributes);
    alert_am.row_template = Set(row_template);
    alert_am.row_template_type = Set(row_template_type);
    alert_am.description = Set(description);
    alert_am.enabled = Set(enabled);
    alert_am.tz_offset = Set(tz_offset);
    alert_am.last_triggered_at = Set(last_triggered_at);
    alert_am.last_satisfied_at = Set(last_satisfied_at);
    alert_am.query_type = Set(query_type);
    alert_am.query_conditions = Set(query_conditions);
    alert_am.query_sql = Set(query_sql);
    alert_am.query_promql = Set(query_promql);
    alert_am.query_promql_condition = Set(query_promql_condition);
    alert_am.query_aggregation = Set(query_aggregation);
    // Written as NULL when off, so the column reads the same for an alert that
    // opted out and one that predates the feature.
    alert_am.query_promql_multi_alert = Set(promql_multi_alert.then_some(true));
    alert_am.query_slo_condition = Set(query_slo_condition);
    alert_am.slo_id = Set(slo_id);
    alert_am.query_vrl_function = Set(query_vrl_function);
    alert_am.query_search_event_type = Set(query_search_event_type);
    alert_am.query_multi_time_range = Set(query_multi_time_range);
    alert_am.trigger_threshold_operator = Set(trigger_threshold_operator);
    alert_am.trigger_period_seconds = Set(trigger_period_seconds);
    alert_am.trigger_threshold_count = Set(trigger_threshold_count);
    alert_am.trigger_thresholds = Set(trigger_thresholds);
    // Feature 2: NULL rather than 0/[] when unset, so an alert that sets
    // neither field is byte-identical to its pre-Feature-2 row (G5).
    alert_am.priority = Set(alert.priority.map(|p| p.to_i32()));
    alert_am.tags = Set(if alert.tags.is_empty() {
        None
    } else {
        Some(serde_json::json!(alert.tags))
    });
    alert_am.trigger_frequency_type = Set(trigger_frequency_type);
    alert_am.trigger_frequency_seconds = Set(trigger_frequency_seconds);
    alert_am.trigger_frequency_cron = Set(trigger_frequency_cron);
    alert_am.trigger_frequency_cron_timezone = Set(trigger_frequency_cron_timezone);
    alert_am.trigger_silence_seconds = Set(trigger_silence_seconds);
    alert_am.trigger_tolerance_seconds = Set(trigger_tolerance_seconds);
    alert_am.owner = Set(owner);
    alert_am.last_edited_by = Set(last_edited_by);
    alert_am.updated_at = Set(Some(updated_at));
    alert_am.align_time = Set(align_time);
    alert_am.dedup_enabled = Set(dedup_enabled);
    alert_am.dedup_time_window_minutes = Set(dedup_time_window_minutes);
    alert_am.dedup_config = Set(dedup_config);
    alert_am.creates_incident = Set(alert.creates_incident);
    alert_am.workflows = Set(workflows);
    Ok(())
}

/// Deletes all alerts belonging to the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    alerts::Entity::delete_many()
        .filter(alerts::Column::Org.eq(org_id))
        .exec(client)
        .await?;
    Ok(())
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    Name,
}

#[cfg(test)]
pub(super) mod tests {
    use svix_ksuid::KsuidLike as _;

    use super::*;
    use crate::table::entity::alerts::Model;

    pub(in crate::table) fn make_model(id: &str) -> Model {
        Model {
            id: id.to_string(),
            org: "myorg".to_string(),
            folder_id: "folder-1".to_string(),
            name: "Test Alert".to_string(),
            stream_type: "logs".to_string(),
            stream_name: "default".to_string(),
            is_real_time: false,
            destinations: serde_json::json!(["dest-1"]),
            template: None,
            context_attributes: None,
            row_template: None,
            row_template_type: 0, // String
            description: None,
            enabled: true,
            tz_offset: 0,
            last_triggered_at: None,
            last_satisfied_at: None,
            query_type: 0, // Custom
            query_conditions: None,
            query_sql: None,
            query_promql: None,
            query_promql_condition: None,
            query_aggregation: None,
            query_promql_multi_alert: None,
            query_vrl_function: None,
            query_search_event_type: None,
            query_multi_time_range: None,
            trigger_threshold_operator: ">".to_string(),
            trigger_period_seconds: 900, // 15 min × 60
            trigger_threshold_count: 100,
            trigger_thresholds: None,
            priority: None,
            tags: None,
            slo_id: None,
            query_slo_condition: None,
            trigger_frequency_type: 1, // Seconds
            trigger_frequency_seconds: 300,
            trigger_frequency_cron: None,
            trigger_frequency_cron_timezone: None,
            trigger_silence_seconds: 3600, // 60 min × 60
            trigger_tolerance_seconds: None,
            owner: None,
            last_edited_by: None,
            updated_at: None,
            align_time: false,
            dedup_enabled: false,
            dedup_time_window_minutes: None,
            dedup_config: None,
            creates_incident: false,
            workflows: serde_json::json!(["abc123"]),
        }
    }

    #[test]
    fn test_try_from_model_valid() {
        let id = Ksuid::new(None, None).to_string();
        let alert = MetaAlert::try_from(make_model(&id)).unwrap();
        assert_eq!(alert.name, "Test Alert");
        assert_eq!(alert.org_id, "myorg");
        assert!(alert.enabled);
        assert!(!alert.creates_incident);
    }

    // ── Feature 2: priority & tags storage mapping (PT-2, PT-6) ────────────

    #[test]
    fn test_update_mutable_fields_updates_alert_name() {
        let id = Ksuid::new(None, None).to_string();
        let mut alert_am: alerts::ActiveModel = make_model(&id).into();
        let mut alert = MetaAlert::default();
        alert.name = "Renamed Alert".to_string();

        update_mutable_fields(&mut alert_am, alert).unwrap();

        assert_eq!(alert_am.name, Set("Renamed Alert".to_string()));
    }

    #[test]
    fn test_priority_and_tags_unpack_from_model() {
        let id = Ksuid::new(None, None).to_string();
        let mut model = make_model(&id);
        model.priority = Some(2);
        model.tags = Some(serde_json::json!(["prod", "service:checkout"]));

        let alert = MetaAlert::try_from(model).unwrap();
        assert_eq!(
            alert.priority,
            Some(config::meta::alerts::priority::AlertPriority::P2)
        );
        assert_eq!(alert.tags, vec!["prod", "service:checkout"]);
    }

    #[test]
    fn test_null_priority_and_tags_unpack_as_unset() {
        let id = Ksuid::new(None, None).to_string();
        let alert = MetaAlert::try_from(make_model(&id)).unwrap();
        assert_eq!(alert.priority, None);
        assert!(alert.tags.is_empty());
    }

    /// One corrupt row must not take the alert list down: a priority id
    /// outside 1..=5 (or a tags blob that is not an array of strings) degrades
    /// to unset instead of failing the whole load.
    #[test]
    fn test_corrupt_priority_or_tags_degrade_to_unset() {
        let id = Ksuid::new(None, None).to_string();

        let mut bad_priority = make_model(&id);
        bad_priority.priority = Some(99);
        assert_eq!(MetaAlert::try_from(bad_priority).unwrap().priority, None);

        let mut bad_tags = make_model(&id);
        bad_tags.tags = Some(serde_json::json!({"not": "an array"}));
        assert!(MetaAlert::try_from(bad_tags).unwrap().tags.is_empty());
    }

    #[test]
    fn test_try_from_model_invalid_ksuid() {
        assert!(MetaAlert::try_from(make_model("not-a-ksuid")).is_err());
    }

    #[test]
    fn test_try_from_model_invalid_stream_type() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.stream_type = "invalid_stream".to_string();
        assert!(MetaAlert::try_from(m).is_err());
    }

    #[test]
    fn test_try_from_model_invalid_operator() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.trigger_threshold_operator = "INVALID".to_string();
        assert!(MetaAlert::try_from(m).is_err());
    }

    #[test]
    fn test_try_from_model_period_seconds_to_minutes() {
        let id = Ksuid::new(None, None).to_string();
        let alert = MetaAlert::try_from(make_model(&id)).unwrap();
        assert_eq!(alert.trigger_condition.period, 15); // 900 / 60
    }

    #[test]
    fn test_try_from_model_silence_seconds_to_minutes() {
        let id = Ksuid::new(None, None).to_string();
        let alert = MetaAlert::try_from(make_model(&id)).unwrap();
        assert_eq!(alert.trigger_condition.silence, 60); // 3600 / 60
    }

    #[test]
    fn test_try_from_model_invalid_query_type() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.query_type = 99;
        assert!(MetaAlert::try_from(m).is_err());
    }

    #[test]
    fn test_try_from_model_invalid_frequency_type() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.trigger_frequency_type = 99;
        assert!(MetaAlert::try_from(m).is_err());
    }

    #[test]
    fn test_try_from_model_creates_incident() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.creates_incident = true;
        let alert = MetaAlert::try_from(m).unwrap();
        assert!(alert.creates_incident);
    }

    #[test]
    fn test_try_from_model_destinations_parsed() {
        let id = Ksuid::new(None, None).to_string();
        let alert = MetaAlert::try_from(make_model(&id)).unwrap();
        assert_eq!(alert.destinations, vec!["dest-1"]);
    }

    // ── promql_multi_alert: column ⇄ meta ───────────────────────────────────

    #[test]
    fn test_try_from_model_reads_the_promql_multi_alert_column() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.query_promql_multi_alert = Some(true);
        let alert = MetaAlert::try_from(m).unwrap();
        assert!(alert.query_condition.promql_multi_alert);
    }

    /// NULL is the shape every alert written before the column existed has.
    /// Reading it as anything but `false` would flip all of them to per-series
    /// evaluation on the deploy that adds the column.
    #[test]
    fn test_a_null_promql_multi_alert_column_reads_as_off() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.query_promql_multi_alert = None;
        let alert = MetaAlert::try_from(m).unwrap();
        assert!(!alert.query_condition.promql_multi_alert);
    }

    #[test]
    fn test_an_explicit_false_column_also_reads_as_off() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.query_promql_multi_alert = Some(false);
        let alert = MetaAlert::try_from(m).unwrap();
        assert!(!alert.query_condition.promql_multi_alert);
    }

    /// The flag must not depend on the aggregation blob, which a real PromQL
    /// alert does not have at all.
    #[test]
    fn test_the_promql_flag_survives_a_model_with_no_aggregation() {
        let id = Ksuid::new(None, None).to_string();
        let mut m = make_model(&id);
        m.query_aggregation = None;
        m.query_promql_multi_alert = Some(true);
        let alert = MetaAlert::try_from(m).unwrap();
        assert!(alert.query_condition.promql_multi_alert);
        assert!(alert.query_condition.aggregation.is_none());
    }

    // ===================================================================
    // SLO reverse-lookup tests (B1 / B3)
    //
    // These run against a real in-memory SQLite with the alerts + folders
    // schema applied, because every behaviour under test is a SQL predicate:
    // a mock connection replays canned rows and would assert nothing about
    // the WHERE clause, which is the entire subject.
    // ===================================================================

    mod slo_lookups {
        use config::meta::{
            alerts::{
                Operator,
                alert::{AlertSortField as MetaAlertSortField, AlertTypeFilter, ListAlertsParams},
            },
            folder::FolderType,
            slo::condition::{SloAlertKind, SloCondition},
        };
        use sea_orm::{
            ActiveValue::Set, ConnectionTrait, Database, DatabaseConnection, EntityTrait, Schema,
        };
        use svix_ksuid::{Ksuid, KsuidLike as _};

        // `make_model` lives in the parent test module. `list_models` is
        // private to the alerts module; `list_slo_burn_window_pairs` is public
        // and called from `core` (save validation and the SLO ingest pass).
        use super::make_model;
        use crate::table::{
            alerts::{intermediate, list_models, list_slo_burn_window_pairs},
            entity::{alerts, folders},
            folders::folder_type_into_i16,
        };

        const ORG: &str = "test_org";
        const OTHER_ORG: &str = "other_org";
        const SLO_A: &str = "slo_a0000000000000000000000";
        const SLO_B: &str = "slo_b0000000000000000000000";

        /// Real KSUIDs, not readable stubs like `"a1"`.
        ///
        /// `MetaAlert::try_from` parses the id column with `Ksuid::from_str`
        /// (see the top of this file), and the public `list()` maps every row
        /// through it — so a stub id would make these tests impossible to
        /// retarget at the API-facing entry point. Production also stores the
        /// column as `char(27)`, which blank-pads short values on Postgres.
        fn alert_id() -> String {
            Ksuid::new(None, None).to_string()
        }

        /// Tables built from the **entity definitions** rather than by
        /// replaying migrations.
        ///
        /// The migration chain cannot be used here: `folders.id` is created as
        /// an auto-increment integer and only becomes a KSUID string much
        /// later, in `m20250109_092400_recreate_tables_with_ksuids`, which
        /// recreates several unrelated tables and would drag their whole
        /// history into this fixture. Building from the entity also keeps the
        /// schema in step with the structs these queries select into.
        ///
        /// Two known divergences from production, both checked and harmless
        /// here: the fixture creates **no indexes** (production has UNIQUE
        /// indexes on folders `(org, type, folder_id)` and `(org, type,
        /// name)`, so folder seeding must stay unique on both), and it applies
        /// no column DEFAULTs, which makes it stricter rather than looser.
        /// Nothing verifies that the migrations actually produce this schema —
        /// the migration tests are per-statement SQL snapshots and no test
        /// runs the migrator.
        async fn db() -> DatabaseConnection {
            let db = Database::connect("sqlite::memory:")
                .await
                .expect("in-memory sqlite");
            let backend = db.get_database_backend();
            let schema = Schema::new(backend);
            // Folders first: the entity FK is emitted and sqlx enables
            // `PRAGMA foreign_keys`.
            for (label, stmt) in [
                (
                    "folders",
                    backend.build(&schema.create_table_from_entity(folders::Entity)),
                ),
                (
                    "alerts",
                    backend.build(&schema.create_table_from_entity(alerts::Entity)),
                ),
            ] {
                db.execute(stmt)
                    .await
                    .unwrap_or_else(|e| panic!("create {label} table: {e}"));
            }
            db
        }

        /// `slug` is the user-facing folder id the `folder_id` filter matches
        /// on; `pk` is the surrogate key `alerts.folder_id` references. They
        /// are different things and tests that conflate them cannot tell a
        /// working folder filter from a broken one.
        async fn seed_folder(db: &DatabaseConnection, pk: &str, org: &str, slug: &str) {
            folders::Entity::insert(folders::ActiveModel {
                id: Set(pk.to_string()),
                org: Set(org.to_string()),
                folder_id: Set(slug.to_string()),
                name: Set(format!("folder-{slug}")),
                description: Set(None),
                r#type: Set(folder_type_into_i16(FolderType::Alerts)),
                icon: Set(None),
            })
            .exec(db)
            .await
            .unwrap_or_else(|e| panic!("seed folder {slug} in {org}: {e}"));
        }

        /// Serialized through the real struct rather than a hand-written JSON
        /// literal: `list_slo_burn_window_pairs` deserializes into
        /// `SloCondition` and silently drops rows that fail, so a literal with
        /// a wrong enum spelling would make these tests pass for the wrong
        /// reason (empty result rather than filtered result).
        fn slo_condition_json(
            slo_id: &str,
            kind: SloAlertKind,
            windows: Option<(i64, i64)>,
        ) -> serde_json::Value {
            serde_json::to_value(SloCondition {
                slo_id: slo_id.to_string(),
                kind,
                operator: Operator::GreaterThan,
                critical: 2.0,
                warning: None,
                long_window_secs: windows.map(|(l, _)| l),
                short_window_secs: windows.map(|(_, s)| s),
                multi_alert: false,
            })
            .expect("serialize SloCondition")
        }

        struct AlertSpec<'a> {
            id: &'a str,
            /// Drives the row name, which is what `list_models` orders by.
            /// Kept separate from the id so ordering stays readable even
            /// though ids are random KSUIDs.
            label: &'a str,
            org: &'a str,
            folder_pk: &'a str,
            slo: Option<SloShape<'a>>,
            enabled: bool,
            is_real_time: bool,
            priority: Option<i32>,
        }

        /// Which SLO an alert points at, and the windows it consumes.
        /// `None` windows = an error-budget alert, which claims no pair.
        struct SloShape<'a> {
            slo_id: &'a str,
            kind: SloAlertKind,
            windows: Option<(i64, i64)>,
        }

        impl<'a> AlertSpec<'a> {
            fn base(id: &'a str, label: &'a str) -> Self {
                Self {
                    id,
                    label,
                    org: ORG,
                    folder_pk: FOLDER_A_PK,
                    slo: None,
                    enabled: true,
                    is_real_time: false,
                    priority: None,
                }
            }

            /// A burn-rate SLO alert: the only shape that consumes a window
            /// pair.
            fn burn(id: &'a str, label: &'a str, slo_id: &'a str, long: i64, short: i64) -> Self {
                Self {
                    slo: Some(SloShape {
                        slo_id,
                        kind: SloAlertKind::BurnRate,
                        windows: Some((long, short)),
                    }),
                    ..Self::base(id, label)
                }
            }

            /// An error-budget SLO alert: belongs to the SLO, consumes no
            /// window pair.
            fn error_budget(id: &'a str, label: &'a str, slo_id: &'a str) -> Self {
                Self {
                    slo: Some(SloShape {
                        slo_id,
                        kind: SloAlertKind::ErrorBudget,
                        windows: None,
                    }),
                    ..Self::base(id, label)
                }
            }

            fn plain(id: &'a str, label: &'a str) -> Self {
                Self::base(id, label)
            }

            fn disabled(mut self) -> Self {
                self.enabled = false;
                self
            }

            fn realtime(mut self) -> Self {
                self.is_real_time = true;
                self
            }

            fn in_folder(mut self, org: &'a str, folder_pk: &'a str) -> Self {
                self.org = org;
                self.folder_pk = folder_pk;
                self
            }

            fn with_priority(mut self, priority: Option<i32>) -> Self {
                self.priority = priority;
                self
            }
        }

        async fn insert_alert(db: &DatabaseConnection, spec: AlertSpec<'_>) {
            let mut model = make_model(spec.id);
            model.org = spec.org.to_string();
            model.folder_id = spec.folder_pk.to_string();
            model.name = format!("alert-{}", spec.label);
            model.enabled = spec.enabled;
            model.is_real_time = spec.is_real_time;
            model.priority = spec.priority;
            if let Some(SloShape {
                slo_id,
                kind,
                windows,
            }) = spec.slo
            {
                // Both are written together in the real save path: they are
                // derived from the same `slo_condition` Option and `Set` in
                // adjacent statements, so one without the other is a state
                // production cannot produce.
                model.slo_id = Some(slo_id.to_string());
                model.query_slo_condition = Some(slo_condition_json(slo_id, kind, windows));
                // Through the conversion, never a literal: the stored
                // discriminant is append-only and a hardcoded number here
                // would silently describe a different query type if the enum
                // ever grows.
                model.query_type = i16::from(intermediate::QueryType::Slo);
            }
            alerts::Entity::insert(alerts::ActiveModel::from(model))
                .exec(db)
                .await
                .unwrap_or_else(|e| panic!("seed alert {}: {e}", spec.label));
        }

        /// Insert a row whose `slo_id` column is set but whose stored JSON
        /// condition is absent, and whose `query_type` is left at Custom.
        ///
        /// **Synthetic on purpose.** The save path derives `slo_id` and
        /// `query_slo_condition` from one Option, so this shape is
        /// unreachable through `create`/`update`. It exists as a probe: it is
        /// the only way to tell an implementation that filters on the indexed
        /// `slo_id` column from one that filters on the JSON payload or on
        /// `query_type`, which are indistinguishable on every real row.
        async fn insert_column_only_slo_row(
            db: &DatabaseConnection,
            id: &str,
            label: &str,
            slo: &str,
        ) {
            let mut model = make_model(id);
            model.org = ORG.to_string();
            model.folder_id = FOLDER_A_PK.to_string();
            model.name = format!("alert-{label}");
            model.slo_id = Some(slo.to_string());
            model.query_slo_condition = None;
            alerts::Entity::insert(alerts::ActiveModel::from(model))
                .exec(db)
                .await
                .unwrap_or_else(|e| panic!("seed column-only row {label}: {e}"));
        }

        /// `list_slo_burn_window_pairs` applies no `ORDER BY`, so every
        /// multi-element assertion on it must sort first.
        fn sorted(mut pairs: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
            pairs.sort_unstable();
            pairs
        }

        async fn ids_of(db: &DatabaseConnection, params: ListAlertsParams) -> Vec<String> {
            list_models(db, params)
                .await
                .unwrap()
                .into_iter()
                .map(|(_, a)| a.id)
                .collect()
        }

        fn sorted_ids(mut ids: Vec<String>) -> Vec<String> {
            ids.sort();
            ids
        }

        const FOLDER_A_PK: &str = "folder_pk_00000000000000001";
        const FOLDER_B_PK: &str = "folder_pk_00000000000000002";
        const FOLDER_OTHER_ORG_PK: &str = "folder_pk_00000000000000003";

        /// The default fixture: one org, one folder.
        async fn db_with_folder() -> DatabaseConnection {
            let db = db().await;
            seed_folder(&db, FOLDER_A_PK, ORG, "default").await;
            db
        }

        // ---------- B3: excluding the alert being edited ------------------

        /// The ingest pass (`slo/job.rs`) passes `None` and must keep seeing
        /// every enabled alert's pair — under-counting there silently stops
        /// precomputing a window and freezes the alerts that need it.
        #[tokio::test]
        async fn no_exclusion_returns_every_enabled_alerts_pair() {
            let db = db_with_folder().await;
            let (a1, a2) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;

            let pairs = list_slo_burn_window_pairs(&db, ORG, SLO_A, None)
                .await
                .unwrap();

            assert_eq!(sorted(pairs), vec![(3600, 300), (7200, 600)]);
        }

        /// The B3 fix: save-validation excludes the alert being edited, so its
        /// own stored pair does not count against the cap it is about to
        /// vacate.
        #[tokio::test]
        async fn excluding_an_alert_omits_only_its_own_pair() {
            let db = db_with_folder().await;
            let (a1, a2) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;

            let pairs = list_slo_burn_window_pairs(&db, ORG, SLO_A, Some(&a1))
                .await
                .unwrap();

            assert_eq!(pairs, vec![(7200, 600)]);
        }

        /// Two alerts sharing a pair: excluding one must NOT free the pair,
        /// because the other still consumes it. This is the case a naive
        /// "remove this pair value from the result" implementation gets wrong.
        #[tokio::test]
        async fn excluding_an_alert_keeps_a_pair_another_alert_still_uses() {
            let db = db_with_folder().await;
            let (a1, a2) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 3600, 300)).await;

            let pairs = list_slo_burn_window_pairs(&db, ORG, SLO_A, Some(&a1))
                .await
                .unwrap();

            assert_eq!(
                pairs,
                vec![(3600, 300)],
                "the shared pair is still consumed by a2"
            );
        }

        /// Creating a NEW alert passes an id that matches nothing. That must
        /// behave exactly like no exclusion — otherwise create-path validation
        /// would silently gain a free slot.
        ///
        /// The unknown id is a well-formed KSUID, so this asserts "matches no
        /// row" rather than "is not a valid id" — an implementation that
        /// parsed the id would otherwise diverge here from production.
        #[tokio::test]
        async fn excluding_an_unknown_id_changes_nothing() {
            let db = db_with_folder().await;
            let (a1, a2) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;

            let pairs = list_slo_burn_window_pairs(&db, ORG, SLO_A, Some(&alert_id()))
                .await
                .unwrap();

            assert_eq!(sorted(pairs), vec![(3600, 300), (7200, 600)]);
        }

        /// Regression guard on the pre-existing `enabled = true` filter, which
        /// the exclusion parameter must not disturb — "disable frees a slot"
        /// is documented UI behaviour.
        #[tokio::test]
        async fn disabled_alerts_contribute_no_pair_with_or_without_exclusion() {
            let db = db_with_folder().await;
            let (a1, a2) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300).disabled()).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;

            assert_eq!(
                list_slo_burn_window_pairs(&db, ORG, SLO_A, None)
                    .await
                    .unwrap(),
                vec![(7200, 600)]
            );
            assert_eq!(
                list_slo_burn_window_pairs(&db, ORG, SLO_A, Some(&a2))
                    .await
                    .unwrap(),
                vec![]
            );
        }

        /// An error-budget alert has no windows, so it consumes no pair.
        /// Without this guard, an implementation that defaulted missing
        /// windows to `(0, 0)` would pass every other test here while
        /// corrupting the ingest pass's precompute list.
        #[tokio::test]
        async fn error_budget_alerts_contribute_no_pair() {
            let db = db_with_folder().await;
            let (eb, a1) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::error_budget(&eb, "eb", SLO_A)).await;
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;

            assert_eq!(
                list_slo_burn_window_pairs(&db, ORG, SLO_A, None)
                    .await
                    .unwrap(),
                vec![(3600, 300)]
            );
        }

        /// The exclusion must key on the alert's identity, not on its pair
        /// value, and must not reach across SLO or org boundaries.
        ///
        /// `b1` deliberately carries the SAME pair as `a1` under a different
        /// SLO: an implementation that looked up the excluded alert's windows
        /// and subtracted that value from the result would wrongly free
        /// `a1`'s pair here.
        #[tokio::test]
        async fn exclusion_keys_on_identity_not_on_the_pair_value() {
            let db = db_with_folder().await;
            seed_folder(&db, FOLDER_OTHER_ORG_PK, OTHER_ORG, "default").await;
            let (a1, a2, b1, c1) = (alert_id(), alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;
            insert_alert(&db, AlertSpec::burn(&b1, "b1", SLO_B, 3600, 300)).await;
            insert_alert(
                &db,
                AlertSpec::burn(&c1, "c1", SLO_A, 14400, 1200)
                    .in_folder(OTHER_ORG, FOLDER_OTHER_ORG_PK),
            )
            .await;

            // Excluding an alert from another SLO removes nothing here, even
            // though it shares a1's pair value.
            assert_eq!(
                sorted(
                    list_slo_burn_window_pairs(&db, ORG, SLO_A, Some(&b1))
                        .await
                        .unwrap()
                ),
                vec![(3600, 300), (7200, 600)]
            );
            // The other org's alert never appears in this org's results.
            assert_eq!(
                sorted(
                    list_slo_burn_window_pairs(&db, ORG, SLO_A, None)
                        .await
                        .unwrap()
                ),
                vec![(3600, 300), (7200, 600)]
            );
        }

        /// The arithmetic the B3 fix exists to correct, tied to the validator
        /// that actually enforces the cap: at 8 distinct pairs a new pair is
        /// rejected, but once the alert being edited is excluded the same new
        /// pair fits.
        #[tokio::test]
        async fn excluding_the_edited_alert_is_what_lets_an_at_cap_edit_validate() {
            use config::meta::slo::condition::validate_pair_budget;

            let db = db_with_folder().await;
            let mut ids = Vec::new();
            for i in 0..8i64 {
                let id = alert_id();
                let long = 3600 * (i + 1);
                insert_alert(
                    &db,
                    AlertSpec::burn(&id, &format!("cap{i}"), SLO_A, long, long / 12),
                )
                .await;
                ids.push(id);
            }

            let all = list_slo_burn_window_pairs(&db, ORG, SLO_A, None)
                .await
                .unwrap();
            assert_eq!(all.len(), 8, "precondition: 8 distinct pairs are in use");

            let excluding_edited = list_slo_burn_window_pairs(&db, ORG, SLO_A, Some(&ids[0]))
                .await
                .unwrap();
            assert_eq!(excluding_edited.len(), 7);
            assert!(
                !excluding_edited.contains(&(3600, 300)),
                "the edited alert's own pair must be the one released"
            );

            // The point of the whole change: the same replacement pair is
            // rejected against the unfiltered set and accepted against the
            // set that excludes the alert being edited.
            let replacement = SloCondition {
                slo_id: SLO_A.to_string(),
                kind: SloAlertKind::BurnRate,
                operator: Operator::GreaterThan,
                critical: 2.0,
                warning: None,
                long_window_secs: Some(36_000),
                short_window_secs: Some(3_000),
                multi_alert: false,
            };
            assert!(
                validate_pair_budget(&replacement, &all, 8).is_err(),
                "today's behaviour: the edited alert's own pair blocks it"
            );
            assert!(
                validate_pair_budget(&replacement, &excluding_edited, 8).is_ok(),
                "after B3: the replacement lands on exactly 8"
            );
        }

        // ---------- B1: listing an SLO's alerts ---------------------------

        /// The endpoint backing the SLO page's Alerts tab.
        #[tokio::test]
        async fn list_models_filters_by_slo_id() {
            let db = db_with_folder().await;
            let (a1, a2, b1, p1) = (alert_id(), alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;
            insert_alert(&db, AlertSpec::burn(&b1, "b1", SLO_B, 3600, 300)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(SLO_A.to_string());

            assert_eq!(
                sorted_ids(ids_of(&db, params).await),
                sorted_ids(vec![a1, a2])
            );
        }

        /// Disabled alerts belong to the SLO page (you must be able to see and
        /// re-enable them), so this filter — unlike the burn-pair lookup —
        /// must NOT filter on enabled.
        #[tokio::test]
        async fn list_models_slo_filter_includes_disabled_alerts() {
            let db = db_with_folder().await;
            let (a1, b1, p1) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300).disabled()).await;
            // Non-matching rows, so "returns the disabled one" cannot pass by
            // virtue of being the only row in the table.
            insert_alert(&db, AlertSpec::burn(&b1, "b1", SLO_B, 7200, 600)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(SLO_A.to_string());

            assert_eq!(ids_of(&db, params).await, vec![a1]);
        }

        /// ...but it must not SUPPRESS an explicitly requested enabled filter
        /// either. A "the SLO page always wants everything" shortcut that
        /// clears `params.enabled` would break `?slo_id=X&enabled=false`.
        #[tokio::test]
        async fn slo_filter_still_honours_an_explicit_enabled_filter() {
            let db = db_with_folder().await;
            let (on, off) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&on, "on", SLO_A, 3600, 300)).await;
            insert_alert(
                &db,
                AlertSpec::burn(&off, "off", SLO_A, 7200, 600).disabled(),
            )
            .await;

            let mut only_disabled = ListAlertsParams::new(ORG);
            only_disabled.slo_id = Some(SLO_A.to_string());
            only_disabled.enabled = Some(false);
            assert_eq!(ids_of(&db, only_disabled).await, vec![off]);

            let mut only_enabled = ListAlertsParams::new(ORG);
            only_enabled.slo_id = Some(SLO_A.to_string());
            only_enabled.enabled = Some(true);
            assert_eq!(ids_of(&db, only_enabled).await, vec![on]);
        }

        /// No filter = historical behaviour, including non-SLO alerts.
        #[tokio::test]
        async fn list_models_without_slo_filter_returns_everything() {
            let db = db_with_folder().await;
            let (a1, p1) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            assert_eq!(ids_of(&db, ListAlertsParams::new(ORG)).await.len(), 2);
        }

        /// An empty `slo_id` must match NOTHING, not everything.
        ///
        /// This file holds two opposite precedents — `name_substring` treats
        /// empty as "no filter", while `priority` and `tag_alert_ids` treat it
        /// as "match nothing" and say in comments that the other choice is a
        /// bug. The SLO id arrives from a path segment, so an empty one is
        /// reachable, and listing the whole org on a page titled "this SLO's
        /// alerts" is the failure to avoid.
        #[tokio::test]
        async fn an_empty_slo_id_matches_nothing_rather_than_everything() {
            let db = db_with_folder().await;
            let (a1, p1) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(String::new());

            assert!(ids_of(&db, params).await.is_empty());
        }

        /// The filter must enter the SQL statement, not be applied to the
        /// fetched page.
        ///
        /// A post-fetch `retain` passes every other test in this module and
        /// then returns short or empty pages in production: page 0 would hold
        /// whatever subset of the first N org-wide alerts happened to match.
        /// The codebase already has that anti-pattern live for the
        /// `Scheduled`/`Realtime` filters, so it is an easy one to copy.
        #[tokio::test]
        async fn slo_filter_is_applied_before_pagination() {
            let db = db_with_folder().await;
            // Interleaved by name so a post-fetch filter and a SQL filter
            // disagree on both pages.
            let (a1, a2, a3) = (alert_id(), alert_id(), alert_id());
            let (p1, p2, p3) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a-1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "b-1")).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a-2", SLO_A, 7200, 600)).await;
            insert_alert(&db, AlertSpec::plain(&p2, "b-2")).await;
            insert_alert(&db, AlertSpec::burn(&a3, "a-3", SLO_A, 14400, 1200)).await;
            insert_alert(&db, AlertSpec::plain(&p3, "b-3")).await;

            let page = |idx: u64| {
                let mut params = ListAlertsParams::new(ORG);
                params.slo_id = Some(SLO_A.to_string());
                params.page_size_and_idx = Some((2, idx));
                params
            };

            assert_eq!(
                ids_of(&db, page(0)).await,
                vec![a1, a2],
                "page 0 must hold the first two MATCHING alerts"
            );
            assert_eq!(ids_of(&db, page(1)).await, vec![a3]);
        }

        /// `AlertTypeFilter::Slo` is declared but was never implemented, so
        /// `?alert_type=slo` silently returned every alert.
        #[tokio::test]
        async fn alert_type_filter_slo_returns_only_slo_alerts() {
            let db = db_with_folder().await;
            let (a1, b1, p1, p2) = (alert_id(), alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&b1, "b1", SLO_B, 7200, 600)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;
            insert_alert(&db, AlertSpec::plain(&p2, "p2")).await;

            let mut params = ListAlertsParams::new(ORG);
            params.alert_type = AlertTypeFilter::Slo;

            assert_eq!(
                sorted_ids(ids_of(&db, params).await),
                sorted_ids(vec![a1, b1])
            );
        }

        #[tokio::test]
        async fn scheduled_and_realtime_predicates_are_mutually_exclusive_with_slo() {
            let db = db_with_folder().await;
            let scheduled = alert_id();
            let realtime = alert_id();
            let slo_scheduled = alert_id();
            let slo_realtime = alert_id();
            insert_alert(&db, AlertSpec::plain(&scheduled, "scheduled")).await;
            insert_alert(&db, AlertSpec::plain(&realtime, "realtime").realtime()).await;
            insert_alert(
                &db,
                AlertSpec::burn(&slo_scheduled, "slo-scheduled", SLO_A, 3600, 300),
            )
            .await;
            insert_alert(
                &db,
                AlertSpec::burn(&slo_realtime, "slo-realtime", SLO_A, 7200, 600).realtime(),
            )
            .await;

            let mut scheduled_params = ListAlertsParams::new(ORG);
            scheduled_params.alert_type = AlertTypeFilter::Scheduled;
            assert_eq!(ids_of(&db, scheduled_params).await, vec![scheduled.clone()]);

            let mut realtime_params = ListAlertsParams::new(ORG);
            realtime_params.alert_type = AlertTypeFilter::Realtime;
            assert_eq!(ids_of(&db, realtime_params).await, vec![realtime.clone()]);

            let mut slo_params = ListAlertsParams::new(ORG);
            slo_params.alert_type = AlertTypeFilter::Slo;
            assert_eq!(
                sorted_ids(ids_of(&db, slo_params).await),
                sorted_ids(vec![slo_scheduled, slo_realtime])
            );

            let mut all_params = ListAlertsParams::new(ORG);
            all_params.alert_type = AlertTypeFilter::All;
            assert_eq!(ids_of(&db, all_params).await.len(), 4);

            let mut composite_params = ListAlertsParams::new(ORG);
            composite_params.alert_type = AlertTypeFilter::Composite;
            assert!(ids_of(&db, composite_params).await.is_empty());
        }

        #[tokio::test]
        async fn scheduled_filter_is_applied_before_database_pagination() {
            let db = db_with_folder().await;
            let first = alert_id();
            let second = alert_id();
            let third = alert_id();

            // SLO rows sort between the scheduled rows. A post-fetch filter
            // would produce short pages and lose `third` from page 1.
            insert_alert(&db, AlertSpec::burn(&alert_id(), "a-slo", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::plain(&first, "b-first")).await;
            insert_alert(&db, AlertSpec::burn(&alert_id(), "c-slo", SLO_A, 7200, 600)).await;
            insert_alert(&db, AlertSpec::plain(&second, "d-second")).await;
            insert_alert(&db, AlertSpec::plain(&third, "e-third")).await;

            let page = |idx| {
                let mut params = ListAlertsParams::new(ORG);
                params.alert_type = AlertTypeFilter::Scheduled;
                params.page_size_and_idx = Some((2, idx));
                params
            };
            assert_eq!(ids_of(&db, page(0)).await, vec![first, second]);
            assert_eq!(ids_of(&db, page(1)).await, vec![third]);
        }

        /// Both new filters must read the indexed `slo_id` COLUMN, not the
        /// JSON condition and not `query_type`.
        ///
        /// On every row the save path can write, all three agree, so no other
        /// test in this module can tell them apart. The synthetic
        /// column-only row is the discriminator: a JSON-based or
        /// `query_type`-based predicate misses it.
        #[tokio::test]
        async fn the_slo_predicates_read_the_indexed_column_not_the_json() {
            let db = db_with_folder().await;
            let (a1, bare, p1) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_column_only_slo_row(&db, &bare, "bare", SLO_A).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            let mut by_type = ListAlertsParams::new(ORG);
            by_type.alert_type = AlertTypeFilter::Slo;
            assert_eq!(
                sorted_ids(ids_of(&db, by_type).await),
                sorted_ids(vec![a1.clone(), bare.clone()]),
                "alert_type=slo must select on the column"
            );

            let mut by_id = ListAlertsParams::new(ORG);
            by_id.slo_id = Some(SLO_A.to_string());
            assert_eq!(
                sorted_ids(ids_of(&db, by_id).await),
                sorted_ids(vec![a1, bare]),
                "slo_id must select on the column"
            );
        }

        /// That same synthetic row contributes no burn-window pair, because
        /// the pair lookup genuinely needs the stored condition.
        #[tokio::test]
        async fn a_row_with_no_stored_condition_contributes_no_pair() {
            let db = db_with_folder().await;
            let bare = alert_id();
            insert_column_only_slo_row(&db, &bare, "bare", SLO_A).await;

            assert_eq!(
                list_slo_burn_window_pairs(&db, ORG, SLO_A, None)
                    .await
                    .unwrap(),
                vec![]
            );
        }

        /// Guard against implementing the `alert_type` match too broadly.
        /// `Scheduled` and `Realtime` are filtered in memory by the HTTP
        /// handler, so adding a SQL arm for `Slo` must leave them passing
        /// every row through at this layer.
        #[tokio::test]
        async fn alert_type_filters_other_than_slo_do_not_filter_here() {
            let db = db_with_folder().await;
            let (a1, p1) = (alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            for filter in [AlertTypeFilter::All, AlertTypeFilter::AnomalyDetection] {
                let mut params = ListAlertsParams::new(ORG);
                params.alert_type = filter;
                assert_eq!(
                    ids_of(&db, params).await.len(),
                    2,
                    "{filter:?} must not filter at the SQL layer"
                );
            }
        }

        /// The two filters must AND. Asserting the combination alone is not
        /// enough — `slo_id = A` is a subset of `slo_id IS NOT NULL`, so the
        /// combined result is right even if the `Slo` arm does nothing. The
        /// standalone assertion is what proves the arm exists.
        #[tokio::test]
        async fn slo_id_and_alert_type_filters_combine() {
            let db = db_with_folder().await;
            let (a1, b1, p1) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&b1, "b1", SLO_B, 7200, 600)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            let mut only_type = ListAlertsParams::new(ORG);
            only_type.alert_type = AlertTypeFilter::Slo;
            assert_eq!(
                sorted_ids(ids_of(&db, only_type).await),
                sorted_ids(vec![a1.clone(), b1]),
                "the Slo arm must filter on its own"
            );

            let mut both = ListAlertsParams::new(ORG);
            both.slo_id = Some(SLO_A.to_string());
            both.alert_type = AlertTypeFilter::Slo;
            assert_eq!(ids_of(&db, both).await, vec![a1]);
        }

        /// The SLO filter must intersect the tag filter, not union with it.
        ///
        /// The tag predicate is built as a `Condition::any()`; adding the SLO
        /// predicate into that same object — the nearest `Condition` in the
        /// function — turns `tags AND slo` into `tags OR slo`, which would
        /// return every tagged alert plus every SLO alert.
        #[tokio::test]
        async fn slo_filter_intersects_the_tag_predicate() {
            let db = db_with_folder().await;
            let (a1, a2, p1) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            insert_alert(&db, AlertSpec::burn(&a2, "a2", SLO_A, 7200, 600)).await;
            insert_alert(&db, AlertSpec::plain(&p1, "p1")).await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(SLO_A.to_string());
            params.tag_alert_ids = Some(vec![a2.clone(), p1]);

            assert_eq!(
                ids_of(&db, params).await,
                vec![a2],
                "only the alert satisfying BOTH filters"
            );
        }

        /// An empty resolved tag set means "no alert carries these tags" and
        /// must still match nothing once a SLO filter is also present.
        #[tokio::test]
        async fn slo_filter_with_an_empty_tag_set_matches_nothing() {
            let db = db_with_folder().await;
            let a1 = alert_id();
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(SLO_A.to_string());
            params.tag_alert_ids = Some(vec![]);

            assert!(ids_of(&db, params).await.is_empty());
        }

        /// `folder_id` filters the folder's user-facing slug through the join;
        /// `slo_id` filters an alerts column. Neither may swallow the other.
        #[tokio::test]
        async fn slo_filter_and_folder_filter_intersect() {
            let db = db_with_folder().await;
            seed_folder(&db, FOLDER_B_PK, ORG, "team-a").await;
            let (in_default, in_team, plain_team) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&in_default, "a1", SLO_A, 3600, 300)).await;
            insert_alert(
                &db,
                AlertSpec::burn(&in_team, "a2", SLO_A, 7200, 600).in_folder(ORG, FOLDER_B_PK),
            )
            .await;
            insert_alert(
                &db,
                AlertSpec::plain(&plain_team, "p1").in_folder(ORG, FOLDER_B_PK),
            )
            .await;

            let mut slo_only = ListAlertsParams::new(ORG);
            slo_only.slo_id = Some(SLO_A.to_string());
            assert_eq!(
                sorted_ids(ids_of(&db, slo_only).await),
                sorted_ids(vec![in_default, in_team.clone()]),
                "the SLO filter must not implicitly scope to a folder"
            );

            let mut both = ListAlertsParams::new(ORG);
            both.slo_id = Some(SLO_A.to_string());
            both.folder_id = Some("team-a".to_string());
            assert_eq!(
                ids_of(&db, both).await,
                vec![in_team],
                "both predicates must apply"
            );

            let mut folder_only = ListAlertsParams::new(ORG);
            folder_only.folder_id = Some("team-a".to_string());
            assert_eq!(
                ids_of(&db, folder_only).await.len(),
                2,
                "the folder filter alone still returns non-SLO alerts"
            );
        }

        /// Ordering must survive the new predicate — including the deliberate
        /// cross-database "unset priority sorts last" CASE, which nothing else
        /// in the repo covers.
        #[tokio::test]
        async fn slo_filter_preserves_priority_ordering_with_nulls_last() {
            let db = db_with_folder().await;
            let (p1, p2, none, dup) = (alert_id(), alert_id(), alert_id(), alert_id());
            insert_alert(
                &db,
                AlertSpec::burn(&p2, "b", SLO_A, 7200, 600).with_priority(Some(2)),
            )
            .await;
            insert_alert(
                &db,
                AlertSpec::burn(&none, "c", SLO_A, 14400, 1200).with_priority(None),
            )
            .await;
            insert_alert(
                &db,
                AlertSpec::burn(&p1, "a", SLO_A, 3600, 300).with_priority(Some(1)),
            )
            .await;
            insert_alert(
                &db,
                AlertSpec::burn(&dup, "d", SLO_A, 28800, 2400).with_priority(Some(2)),
            )
            .await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(SLO_A.to_string());
            params.sort_by = Some(MetaAlertSortField::Priority);

            assert_eq!(
                ids_of(&db, params).await,
                vec![p1, p2, dup, none],
                "P1, then the two P2s by name, then the unset one LAST"
            );
        }

        /// Org scoping, with a same-org different-SLO row present so the
        /// assertion cannot be satisfied by the org filter alone.
        #[tokio::test]
        async fn slo_filter_is_org_scoped() {
            let db = db_with_folder().await;
            seed_folder(&db, FOLDER_OTHER_ORG_PK, OTHER_ORG, "default").await;
            let (a1, b1, c1) = (alert_id(), alert_id(), alert_id());
            insert_alert(&db, AlertSpec::burn(&a1, "a1", SLO_A, 3600, 300)).await;
            // Same org, different SLO: without this the org filter alone
            // satisfies the assertion and the SLO filter is never exercised.
            insert_alert(&db, AlertSpec::burn(&b1, "b1", SLO_B, 7200, 600)).await;
            insert_alert(
                &db,
                AlertSpec::burn(&c1, "c1", SLO_A, 14400, 1200)
                    .in_folder(OTHER_ORG, FOLDER_OTHER_ORG_PK),
            )
            .await;

            let mut params = ListAlertsParams::new(ORG);
            params.slo_id = Some(SLO_A.to_string());

            assert_eq!(ids_of(&db, params).await, vec![a1]);
        }
    }
}
