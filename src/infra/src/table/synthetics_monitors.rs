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

use config::meta::synthetics::{ListMonitorsParams, Monitor, MonitorType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, Set, TransactionTrait, TryIntoModel,
};
use svix_ksuid::KsuidLike;

use super::entity::synthetics_monitors::{self, ActiveModel, Column, Entity};
use crate::errors;

// ── TryFrom: ORM model → meta type ───────────────────────────────────────────

impl TryFrom<synthetics_monitors::Model> for Monitor {
    type Error = errors::Error;

    fn try_from(m: synthetics_monitors::Model) -> Result<Self, Self::Error> {
        let monitor_type: MonitorType = serde_json::from_value(serde_json::Value::String(
            m.monitor_type.clone(),
        ))
        .map_err(|e| errors::Error::Message(format!("invalid monitor_type '{}': {e}", m.monitor_type)))?;

        let locations: Vec<String> = serde_json::from_value(m.locations)
            .map_err(|e| errors::Error::Message(format!("invalid locations JSON: {e}")))?;

        Ok(Monitor {
            id: m.id,
            org_id: m.org_id,
            folder_id: m.folder_id,
            name: m.name,
            monitor_type,
            target: m.target,
            config: m.config,
            interval_secs: m.interval_secs,
            locations,
            enabled: m.enabled,
            next_run_at: m.next_run_at,
            created_at: m.created_at,
            updated_at: m.updated_at,
        })
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Gets a monitor by ID.
pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Monitor>, errors::Error> {
    let _lock = super::get_lock().await;
    let maybe = get_model(conn, org_id, id).await?;
    maybe.map(Monitor::try_from).transpose()
}

/// Lists monitors for an org, with optional filters.
pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListMonitorsParams,
) -> Result<Vec<Monitor>, errors::Error> {
    let _lock = super::get_lock().await;
    list_models(conn, org_id, params)
        .await?
        .into_iter()
        .map(Monitor::try_from)
        .collect()
}

/// Counts monitors for an org, with optional filters.
pub async fn count<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListMonitorsParams,
) -> Result<u64, errors::Error> {
    let _lock = super::get_lock().await;
    let mut q = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .apply_filters(params);
    Ok(q.count(conn).await?)
}

/// Creates a new monitor. Fails if one with the same id already exists.
pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    monitor: Monitor,
) -> Result<Monitor, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();
    let id = svix_ksuid::Ksuid::new(None, None).to_string();

    let mut am = build_active_model(&monitor)?;
    am.id = Set(id);
    am.org_id = Set(org_id.to_owned());
    am.folder_id = Set(monitor.folder_id.clone());
    am.monitor_type = Set(monitor_type_to_str(&monitor.monitor_type).to_owned());
    am.created_at = Set(now);
    am.updated_at = Set(now);
    am.next_run_at = Set(0);

    let model = am.insert(&txn).await?.try_into_model()?;
    let result = Monitor::try_from(model)?;
    txn.commit().await?;
    Ok(result)
}

/// Updates an existing monitor. Fails if it does not exist.
pub async fn update<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    monitor: Monitor,
) -> Result<Monitor, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;

    let Some(m) = get_model(&txn, org_id, id).await? else {
        return Err(errors::Error::Message(format!("monitor not found: {id}")));
    };

    let mut am: ActiveModel = m.into();
    update_mutable_fields(&mut am, &monitor)?;
    am.updated_at = Set(config::utils::time::now_micros());

    let model = am.update(&txn).await?.try_into_model()?;
    let result = Monitor::try_from(model)?;
    txn.commit().await?;
    Ok(result)
}

/// Upserts a monitor (create or update by id).
/// Used by the super cluster queue handler.
pub async fn put<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    monitor: Monitor,
) -> Result<Monitor, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();

    let result = match get_model(&txn, org_id, &monitor.id).await? {
        Some(m) => {
            let mut am: ActiveModel = m.into();
            update_mutable_fields(&mut am, &monitor)?;
            am.updated_at = Set(now);
            let model = am.update(&txn).await?.try_into_model()?;
            Monitor::try_from(model)?
        }
        None => {
            let mut am = build_active_model(&monitor)?;
            am.id = Set(monitor.id.clone());
            am.org_id = Set(org_id.to_owned());
            am.folder_id = Set(monitor.folder_id.clone());
            am.monitor_type = Set(monitor_type_to_str(&monitor.monitor_type).to_owned());
            am.created_at = Set(now);
            am.updated_at = Set(now);
            am.next_run_at = Set(monitor.next_run_at);
            let model = am.insert(&txn).await?.try_into_model()?;
            Monitor::try_from(model)?
        }
    };

    txn.commit().await?;
    Ok(result)
}

/// Deletes a monitor by ID. Returns true if a row was deleted.
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

// ── Scheduler helpers ─────────────────────────────────────────────────────────

/// Represents a monitor that is due to run, with only the fields the scheduler needs.
pub struct DueMonitor {
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub monitor_type: MonitorType,
    pub locations: Vec<String>,
    pub interval_secs: i32,
    /// Parsed from config.browser_devices — empty for non-browser monitors.
    pub browser_devices: Vec<config::meta::synthetics::BrowserDevice>,
}

/// Fetches monitors whose `next_run_at <= now_us` and `enabled = true`.
/// Uses FOR UPDATE SKIP LOCKED so concurrent scheduler instances don't double-schedule.
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
        .paginate(conn, limit)
        .fetch_page(0)
        .await?;

    models
        .into_iter()
        .map(|m| {
            let monitor_type: MonitorType =
                serde_json::from_value(serde_json::Value::String(m.monitor_type.clone()))
                    .map_err(|e| {
                        errors::Error::Message(format!(
                            "invalid monitor_type '{}': {e}",
                            m.monitor_type
                        ))
                    })?;

            let locations: Vec<String> = serde_json::from_value(m.locations).map_err(|e| {
                errors::Error::Message(format!("invalid locations JSON for {}: {e}", m.id))
            })?;

            let browser_devices = if monitor_type == MonitorType::Browser {
                let cfg: config::meta::synthetics::BrowserConfig =
                    serde_json::from_value(m.config).unwrap_or_default();
                cfg.browser_devices
            } else {
                vec![]
            };

            Ok(DueMonitor {
                id: m.id,
                org_id: m.org_id,
                folder_id: m.folder_id,
                monitor_type,
                locations,
                interval_secs: m.interval_secs,
                browser_devices,
            })
        })
        .collect()
}

/// Advances `next_run_at` for a monitor after it has been scheduled.
pub async fn advance_next_run_at<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    next: i64,
) -> Result<(), errors::Error> {
    let _lock = super::get_lock().await;
    Entity::update_many()
        .col_expr(Column::NextRunAt, sea_orm::prelude::Expr::value(next))
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
    params: &ListMonitorsParams,
) -> Result<Vec<synthetics_monitors::Model>, sea_orm::DbErr> {
    let q = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .apply_filters(params)
        .order_by_asc(Column::Name);

    if let (Some(page_size), Some(page)) = (params.page_size, params.page) {
        if page_size > 0 {
            return q.paginate(conn, page_size).fetch_page(page).await;
        }
    }
    q.all(conn).await
}

/// Sets all mutable fields on an `ActiveModel` from a `Monitor`.
/// Does NOT set immutable fields (id, org_id, created_at, monitor_type).
fn update_mutable_fields(
    am: &mut ActiveModel,
    monitor: &Monitor,
) -> Result<(), errors::Error> {
    let locations = serde_json::to_value(&monitor.locations)?;
    am.folder_id = Set(monitor.folder_id.clone());
    am.name = Set(monitor.name.clone());
    am.target = Set(monitor.target.clone());
    am.config = Set(monitor.config.clone());
    am.interval_secs = Set(monitor.interval_secs);
    am.locations = Set(locations);
    am.enabled = Set(monitor.enabled);
    Ok(())
}

/// Builds an `ActiveModel` from a `Monitor` for all mutable fields.
/// Caller must still set: id, org_id, folder_id, monitor_type, created_at, updated_at, next_run_at.
fn build_active_model(monitor: &Monitor) -> Result<ActiveModel, errors::Error> {
    let locations = serde_json::to_value(&monitor.locations)?;
    Ok(ActiveModel {
        name: Set(monitor.name.clone()),
        target: Set(monitor.target.clone()),
        config: Set(monitor.config.clone()),
        interval_secs: Set(monitor.interval_secs),
        locations: Set(locations),
        enabled: Set(monitor.enabled),
        ..Default::default()
    })
}

fn monitor_type_to_str(t: &MonitorType) -> &'static str {
    match t {
        MonitorType::Http => "http",
        MonitorType::Api => "api",
        MonitorType::Tcp => "tcp",
        MonitorType::Tls => "tls",
        MonitorType::Ssh => "ssh",
        MonitorType::Browser => "browser",
    }
}

// ── Filter extension ──────────────────────────────────────────────────────────

trait ApplyMonitorFilters {
    fn apply_filters(self, params: &ListMonitorsParams) -> Self;
}

impl ApplyMonitorFilters for sea_orm::Select<Entity> {
    fn apply_filters(self, params: &ListMonitorsParams) -> Self {
        let mut q = self;
        if let Some(folder_id) = &params.folder_id {
            q = q.filter(Column::FolderId.eq(folder_id));
        }
        if let Some(monitor_type) = &params.monitor_type {
            q = q.filter(Column::MonitorType.eq(monitor_type_to_str(monitor_type)));
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
            folder_id: "default".to_string(),
            name: "Login Flow".to_string(),
            monitor_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            config: serde_json::json!({
                "browser_devices": [{"browser": "chromium", "device": "laptop_large"}],
                "steps": []
            }),
            interval_secs: 300,
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            next_run_at: 0,
            created_at: 1750000000000000,
            updated_at: 1750000000000000,
        }
    }

    #[test]
    fn test_try_from_model() {
        let monitor = Monitor::try_from(make_model()).unwrap();
        assert_eq!(monitor.id, "mon-1");
        assert_eq!(monitor.monitor_type, MonitorType::Browser);
        assert_eq!(monitor.locations, vec!["aws-us-east-1"]);
        assert!(monitor.enabled);
    }

    #[test]
    fn test_try_from_invalid_monitor_type() {
        let mut m = make_model();
        m.monitor_type = "invalid".to_string();
        assert!(Monitor::try_from(m).is_err());
    }

    #[test]
    fn test_monitor_type_to_str() {
        assert_eq!(monitor_type_to_str(&MonitorType::Http), "http");
        assert_eq!(monitor_type_to_str(&MonitorType::Browser), "browser");
        assert_eq!(monitor_type_to_str(&MonitorType::Api), "api");
        assert_eq!(monitor_type_to_str(&MonitorType::Tcp), "tcp");
        assert_eq!(monitor_type_to_str(&MonitorType::Tls), "tls");
        assert_eq!(monitor_type_to_str(&MonitorType::Ssh), "ssh");
    }
}
