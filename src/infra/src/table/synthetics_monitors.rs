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

use config::meta::synthetics::{
    BrowserConfig, ListSyntheticsParams, Synthetic, SyntheticAuth, SyntheticCookie,
    SyntheticFrequency, SyntheticSettings, SyntheticStatus, SyntheticType, SyntheticVariable,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait, TryIntoModel, prelude::Expr,
};
use serde::{Deserialize, Serialize};

use super::entity::synthetics_monitors::{self, ActiveModel, Column, Entity};
use crate::errors;

// ── TryFrom: ORM model → meta type ───────────────────────────────────────────

impl TryFrom<synthetics_monitors::Model> for Synthetic {
    type Error = errors::Error;

    fn try_from(m: synthetics_monitors::Model) -> Result<Self, Self::Error> {
        let monitor_type: SyntheticType = serde_json::from_value(serde_json::Value::String(
            m.synthetics_type.clone(),
        ))
        .map_err(|e| {
            errors::Error::Message(format!(
                "invalid synthetics_type '{}': {e}",
                m.synthetics_type
            ))
        })?;

        let locations: Vec<String> = serde_json::from_value(m.locations)
            .map_err(|e| errors::Error::Message(format!("invalid locations JSON: {e}")))?;

        let destinations: Vec<String> = serde_json::from_value(m.destinations)
            .map_err(|e| errors::Error::Message(format!("invalid destinations JSON: {e}")))?;

        let tags: Vec<String> = serde_json::from_value(m.tags).unwrap_or_default();

        let frequency: SyntheticFrequency = serde_json::from_value(m.frequency).unwrap_or_default();

        let settings: SyntheticSettings = serde_json::from_value(m.settings).unwrap_or_default();

        let stored: StoredSecrets = serde_json::from_str(&m.secrets).unwrap_or_default();
        let auth = stored.auth;
        let cookies = stored.cookies;
        let variables = stored.variables;
        let config_secrets = stored.config;

        let last_check_status = SyntheticStatus::from_db(m.last_check_status);

        Ok(Synthetic {
            id: m.id,
            org_id: m.org_id,
            folder_id: m.folder_id,
            tz_offset: m.tz_offset,
            name: m.name,
            description: m.description,
            tags,
            monitor_type,
            target: m.target,
            config: m.config,
            frequency,
            locations,
            enabled: m.enabled,
            destinations,
            retries: settings.retries,
            cooldown_mins: settings.cooldown_mins,
            wait_before_retry_secs: settings.wait_before_retry_secs,
            alert_if_fails: settings.alert_if_fails,
            collect_rum_data: settings.collect_rum_data,
            session_replay: settings.session_replay,
            auth,
            cookies,
            variables,
            config_secrets,
            start: settings.start,
            next_run_at: m.next_run_at,
            last_triggered_at: m.last_triggered_at,
            last_check_status,
            owner: m.owner,
            created_at: m.created_at,
            updated_at: m.updated_at,
        })
    }
}

// ── Public CRUD API ───────────────────────────────────────────────────────────

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    let maybe = get_model(conn, org_id, id).await?;
    maybe.map(Synthetic::try_from).transpose()
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<Vec<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    list_models(conn, org_id, params)
        .await?
        .into_iter()
        .map(Synthetic::try_from)
        .collect()
}

pub async fn count<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<u64, errors::Error> {
    let _lock = super::get_lock().await;
    let q = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .apply_filters(params);
    Ok(q.count(conn).await?)
}

/// Counts synthetics (any org) whose `locations` JSON array contains the given
/// location id — used to reject deleting a location that is still referenced.
/// Scans the locations column in Rust: the table is small (hundreds of rows)
/// and JSON LIKE semantics differ across Postgres/MySQL/SQLite.
pub async fn count_referencing_location<C: ConnectionTrait>(
    conn: &C,
    location_id: &str,
) -> Result<u64, errors::Error> {
    let rows: Vec<serde_json::Value> = Entity::find()
        .select_only()
        .column(Column::Locations)
        .into_tuple()
        .all(conn)
        .await?;
    Ok(rows
        .iter()
        .filter(|locs| {
            locs.as_array()
                .map(|a| a.iter().any(|v| v.as_str() == Some(location_id)))
                .unwrap_or(false)
        })
        .count() as u64)
}

/// Synthetics in one org whose `locations` array contains the given location
/// id. Filtered in Rust for the same cross-DB reason as
/// `count_referencing_location`; the per-org set is small.
pub async fn list_referencing_location<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    location_id: &str,
) -> Result<Vec<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    let models = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(conn)
        .await?;
    let mut out = Vec::new();
    for m in models {
        let s = Synthetic::try_from(m)?;
        if s.locations.iter().any(|l| l == location_id) {
            out.push(s);
        }
    }
    Ok(out)
}

pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    monitor: Synthetic,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();
    let id = config::ider::uuid();

    let mut am = build_active_model(&monitor)?;
    am.id = Set(id);
    am.org_id = Set(org_id.to_owned());
    am.folder_id = Set(monitor.folder_id.clone());
    am.synthetics_type = Set(monitor_type_to_str(&monitor.monitor_type).to_owned());
    am.created_at = Set(now);
    am.updated_at = Set(now);
    am.next_run_at = Set(monitor.start.unwrap_or(0));
    am.owner = Set(monitor.owner.clone());

    let model = am.insert(&txn).await?.try_into_model()?;
    let result = Synthetic::try_from(model)?;
    txn.commit().await?;
    Ok(result)
}

pub async fn update<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    monitor: Synthetic,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;

    let Some(m) = get_model(&txn, org_id, id).await? else {
        return Err(errors::Error::Message(format!("monitor not found: {id}")));
    };

    let mut am: ActiveModel = m.into();
    update_mutable_fields(&mut am, &monitor)?;
    am.updated_at = Set(config::utils::time::now_micros());

    let model = am.update(&txn).await?.try_into_model()?;
    let result = Synthetic::try_from(model)?;
    txn.commit().await?;
    Ok(result)
}

pub async fn put<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    monitor: Synthetic,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();

    let result = match get_model(&txn, org_id, &monitor.id).await? {
        Some(m) => {
            let mut am: ActiveModel = m.into();
            update_mutable_fields(&mut am, &monitor)?;
            am.updated_at = Set(now);
            let model = am.update(&txn).await?.try_into_model()?;
            Synthetic::try_from(model)?
        }
        None => {
            let mut am = build_active_model(&monitor)?;
            am.id = Set(monitor.id.clone());
            am.org_id = Set(org_id.to_owned());
            am.folder_id = Set(monitor.folder_id.clone());
            am.synthetics_type = Set(monitor_type_to_str(&monitor.monitor_type).to_owned());
            am.created_at = Set(now);
            am.updated_at = Set(now);
            let model = am.insert(&txn).await?.try_into_model()?;
            Synthetic::try_from(model)?
        }
    };

    txn.commit().await?;
    Ok(result)
}

pub async fn delete<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let _lock = super::get_lock().await;
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Moves a batch of monitors to a different folder.
pub async fn move_to_folder<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
    dst_folder_id: &str,
) -> Result<u64, errors::Error> {
    let _lock = super::get_lock().await;
    if ids.is_empty() {
        return Ok(0);
    }
    let res = Entity::update_many()
        .col_expr(Column::FolderId, Expr::value(dst_folder_id.to_owned()))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.is_in(ids.to_vec()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Sets the `enabled` flag — used by the enable/pause API.
pub async fn set_enabled<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    enabled: bool,
) -> Result<bool, errors::Error> {
    let _lock = super::get_lock().await;
    let res = Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

// ── Scheduler helpers ─────────────────────────────────────────────────────────

/// Scheduler's fan-out data — the subset of Synthetic fields the scheduler needs.
pub struct DueMonitor {
    pub id: String,
    pub name: String,
    pub org_id: String,
    pub monitor_type: SyntheticType,
    pub locations: Vec<String>,
    pub frequency: SyntheticFrequency,
    /// Minutes from UTC — used for cron scheduling. 0 = UTC.
    pub tz_offset: i32,
    /// Populated only for browser monitors (parsed from config.browser_devices).
    pub browser_devices: Vec<config::meta::synthetics::BrowserDevice>,
    pub tags: Vec<String>,
}

/// Returns up to `limit` enabled monitors whose `next_run_at` is at or before `now_us`.
/// Ordered by next_run_at ASC so the most overdue fire first.
///
/// NOTE: Does not use FOR UPDATE SKIP LOCKED — the scheduler is single-node on alert_manager.
/// If multi-node scheduling is needed, convert to a raw SQL query with SKIP LOCKED.
pub async fn fetch_due<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<DueMonitor>, errors::Error> {
    let _lock = super::get_lock().await;
    let models = Entity::find()
        .filter(Column::Enabled.eq(true))
        .filter(Column::NextRunAt.lte(now_us))
        .order_by_asc(Column::NextRunAt)
        .limit(limit)
        .all(conn)
        .await?;

    models
        .into_iter()
        .map(|m| {
            let monitor_type: SyntheticType =
                serde_json::from_value(serde_json::Value::String(m.synthetics_type.clone()))
                    .map_err(|e| {
                        errors::Error::Message(format!(
                            "invalid synthetics_type '{}' for {}: {e}",
                            m.synthetics_type, m.id
                        ))
                    })?;

            let locations: Vec<String> = serde_json::from_value(m.locations).map_err(|e| {
                errors::Error::Message(format!("invalid locations for {}: {e}", m.id))
            })?;

            let frequency: SyntheticFrequency =
                serde_json::from_value(m.frequency).unwrap_or_default();

            let browser_devices = if monitor_type == SyntheticType::Browser {
                let cfg: BrowserConfig = serde_json::from_value(m.config).unwrap_or_default();
                cfg.browser_devices
            } else {
                vec![]
            };

            let tags: Vec<String> = serde_json::from_value(m.tags).unwrap_or_default();

            Ok(DueMonitor {
                id: m.id,
                name: m.name,
                org_id: m.org_id,
                monitor_type,
                locations,
                frequency,
                tz_offset: m.tz_offset,
                browser_devices,
                tags,
            })
        })
        .collect()
}

/// Updates `last_triggered_at` and `next_run_at` after the scheduler fans out a monitor.
pub async fn advance_schedule<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    last_triggered_at: i64,
    next_run_at: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::LastTriggeredAt, Expr::value(last_triggered_at))
        .col_expr(Column::NextRunAt, Expr::value(next_run_at))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Updates `last_check_status` after a probe acks a job.
pub async fn update_last_check_status<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    status: i32,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::LastCheckStatus, Expr::value(status))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

// ── Private helpers ───────────────────────────────────────────────────────────

async fn get_model<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<synthetics_monitors::Model>, sea_orm::DbErr> {
    Entity::find_by_id(id)
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await
}

async fn list_models<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<Vec<synthetics_monitors::Model>, sea_orm::DbErr> {
    let q = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .apply_filters(params)
        .order_by_asc(Column::Name);

    if let (Some(page_size), Some(page)) = (params.page_size, params.page)
        && page_size > 0
    {
        return q.paginate(conn, page_size).fetch_page(page).await;
    }
    q.all(conn).await
}

fn pack_settings(monitor: &Synthetic) -> Result<serde_json::Value, errors::Error> {
    Ok(serde_json::to_value(SyntheticSettings {
        retries: monitor.retries,
        cooldown_mins: monitor.cooldown_mins,
        wait_before_retry_secs: monitor.wait_before_retry_secs,
        alert_if_fails: monitor.alert_if_fails,
        collect_rum_data: monitor.collect_rum_data,
        session_replay: monitor.session_replay,
        start: monitor.start,
    })?)
}

/// Internal serde shape for the `secrets` column.
/// All fields default to empty so missing keys deserialize cleanly.
#[derive(Serialize, Deserialize, Default)]
struct StoredSecrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth: Option<SyntheticAuth>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    cookies: Vec<SyntheticCookie>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    variables: Vec<SyntheticVariable>,
    /// Encrypted config-embedded secrets keyed by JSON pointer into `config`
    /// (e.g. "/headers/0/value") — extracted so the config column stores no
    /// secret material at all.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    config: std::collections::BTreeMap<String, String>,
}

fn pack_secrets(monitor: &Synthetic) -> Result<String, errors::Error> {
    serde_json::to_string(&StoredSecrets {
        auth: monitor.auth.clone(),
        cookies: monitor.cookies.clone(),
        variables: monitor.variables.clone(),
        config: monitor.config_secrets.clone(),
    })
    .map_err(|e| errors::Error::Message(format!("secrets serialize failed: {e}")))
}

fn update_mutable_fields(am: &mut ActiveModel, monitor: &Synthetic) -> Result<(), errors::Error> {
    let locations = serde_json::to_value(&monitor.locations)?;
    let destinations = serde_json::to_value(&monitor.destinations)?;
    let tags = serde_json::to_value(&monitor.tags)?;
    let frequency = serde_json::to_value(&monitor.frequency)?;
    let settings = pack_settings(monitor)?;
    am.folder_id = Set(monitor.folder_id.clone());
    am.tz_offset = Set(monitor.tz_offset);
    am.name = Set(monitor.name.clone());
    am.description = Set(monitor.description.clone());
    am.tags = Set(tags);
    am.target = Set(monitor.target.clone());
    am.config = Set(monitor.config.clone());
    am.frequency = Set(frequency);
    am.locations = Set(locations);
    am.enabled = Set(monitor.enabled);
    am.destinations = Set(destinations);
    am.settings = Set(settings);
    am.secrets = Set(pack_secrets(monitor)?);
    Ok(())
}

fn build_active_model(monitor: &Synthetic) -> Result<ActiveModel, errors::Error> {
    let locations = serde_json::to_value(&monitor.locations)?;
    let destinations = serde_json::to_value(&monitor.destinations)?;
    let tags = serde_json::to_value(&monitor.tags)?;
    let frequency = serde_json::to_value(&monitor.frequency)?;
    let settings = pack_settings(monitor)?;
    Ok(ActiveModel {
        name: Set(monitor.name.clone()),
        description: Set(monitor.description.clone()),
        tags: Set(tags),
        target: Set(monitor.target.clone()),
        config: Set(monitor.config.clone()),
        frequency: Set(frequency),
        locations: Set(locations),
        enabled: Set(monitor.enabled),
        destinations: Set(destinations),
        settings: Set(settings),
        secrets: Set(pack_secrets(monitor)?),
        ..Default::default()
    })
}

fn monitor_type_to_str(t: &SyntheticType) -> &'static str {
    match t {
        SyntheticType::Http => "http",
        SyntheticType::Api => "api",
        SyntheticType::Tcp => "tcp",
        SyntheticType::Tls => "tls",
        SyntheticType::Ssh => "ssh",
        SyntheticType::Browser => "browser",
        SyntheticType::Ping => "ping",
        SyntheticType::Dns => "dns",
    }
}

// ── Filter extension ──────────────────────────────────────────────────────────

trait ApplyMonitorFilters {
    fn apply_filters(self, params: &ListSyntheticsParams) -> Self;
}

impl ApplyMonitorFilters for sea_orm::Select<Entity> {
    fn apply_filters(self, params: &ListSyntheticsParams) -> Self {
        let mut q = self;
        if let Some(folder_id) = &params.folder_id {
            q = q.filter(Column::FolderId.eq(folder_id.clone()));
        }
        if let Some(monitor_type) = &params.monitor_type {
            q = q.filter(Column::SyntheticsType.eq(monitor_type_to_str(monitor_type)));
        }
        if let Some(enabled) = params.enabled {
            q = q.filter(Column::Enabled.eq(enabled));
        }
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::entity::synthetics_monitors::Model;

    fn make_model() -> Model {
        Model {
            id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            folder_id: "folder-1".to_string(),
            tz_offset: 0,
            name: "Login Flow".to_string(),
            synthetics_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            description: "Monitors the login flow".to_string(),
            tags: serde_json::json!(["prod"]),
            config: serde_json::json!({
                "browser_devices": [{"browser": "chromium", "device": "desktop"}],
                "steps": []
            }),
            frequency: serde_json::json!({"type": "minutes", "interval": 5, "cron": ""}),
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            destinations: serde_json::json!([]),
            settings: serde_json::json!({"retries": 1, "cooldown_mins": 0, "wait_before_retry_secs": 5, "alert_if_fails": 1, "collect_rum_data": false, "session_replay": false}),
            secrets: "{}".to_string(),
            next_run_at: 0,
            last_triggered_at: 0,
            last_check_status: 0,
            owner: None,
            created_at: 1750000000000000,
            updated_at: 1750000000000000,
        }
    }

    #[test]
    fn test_try_from_model() {
        let monitor = Synthetic::try_from(make_model()).unwrap();
        assert_eq!(monitor.id, "mon-1");
        assert_eq!(monitor.monitor_type, SyntheticType::Browser);
        assert_eq!(monitor.locations, vec!["aws-us-east-1"]);
        assert!(monitor.enabled);
        assert_eq!(monitor.frequency.interval, 5);
        assert_eq!(
            monitor.frequency.frequency_type,
            config::meta::synthetics::SyntheticFrequencyType::Minutes
        );
    }

    #[test]
    fn test_try_from_invalid_synthetics_type() {
        let mut m = make_model();
        m.synthetics_type = "invalid".to_string();
        assert!(Synthetic::try_from(m).is_err());
    }

    #[test]
    fn test_monitor_type_to_str() {
        assert_eq!(monitor_type_to_str(&SyntheticType::Http), "http");
        assert_eq!(monitor_type_to_str(&SyntheticType::Browser), "browser");
        assert_eq!(monitor_type_to_str(&SyntheticType::Api), "api");
        assert_eq!(monitor_type_to_str(&SyntheticType::Tcp), "tcp");
        assert_eq!(monitor_type_to_str(&SyntheticType::Tls), "tls");
        assert_eq!(monitor_type_to_str(&SyntheticType::Ssh), "ssh");
        assert_eq!(monitor_type_to_str(&SyntheticType::Ping), "ping");
        assert_eq!(monitor_type_to_str(&SyntheticType::Dns), "dns");
    }

    #[test]
    fn test_try_from_preserves_scheduler_fields() {
        let mut m = make_model();
        m.next_run_at = 1750000001000000;
        m.last_triggered_at = 1750000000500000;
        m.last_check_status = 1;
        let monitor = Synthetic::try_from(m).unwrap();
        assert_eq!(monitor.next_run_at, 1750000001000000);
        assert_eq!(monitor.last_triggered_at, 1750000000500000);
        assert_eq!(monitor.last_check_status, SyntheticStatus::Passed);
    }
}
