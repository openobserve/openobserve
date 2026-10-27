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

//! Points pre-run incidents' run summary at their newest v1 report; the list never reads topology.

use std::collections::HashMap;

use config::meta::alerts::rca_runs::{has_v1_reports, v1_reports};
use sea_orm::{ConnectionTrait, QueryResult};
use sea_orm_migration::prelude::*;

const PAGE_SIZE: u64 = 500;
/// `run_id` of the newest pre-run report (`v1_reports`).
const V1_POINTER: &str = "v1-0";
const V1_POINTER_PATTERN: &str = "v1-%";
const COMPLETED: &str = "completed";
const AI_ANALYSIS_COMPLETE: &str = "ai_analysis_complete";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        let mut after = String::new();
        loop {
            let rows = db.query_all(backend.build(&candidates(&after))).await?;
            let Some(last) = rows.last() else {
                break;
            };
            after = last.try_get("", "id")?;
            let incidents: Vec<V1Incident> = rows.iter().filter_map(V1Incident::from_row).collect();
            if incidents.is_empty() {
                continue;
            }
            let completed_at = completed_at_of(db, &incidents).await?;
            let pointers: Vec<(&str, i64)> = incidents
                .iter()
                .filter_map(|incident| {
                    let key = (incident.org_id.clone(), incident.id.clone());
                    let times = completed_at.get(&key).map_or(&[][..], Vec::as_slice);
                    incident
                        .newest_report_at(times)
                        .map(|at| (incident.id.as_str(), at))
                })
                .collect();
            if let Some(stmt) = set_pointers(&pointers) {
                db.execute(backend.build(&stmt)).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let no_text = || SimpleExpr::from(Option::<String>::None);
        let no_time = || SimpleExpr::from(Option::<i64>::None);
        let stmt = Query::update()
            .table(AlertIncidents::Table)
            .values([
                (AlertIncidents::RcaRunId, no_text()),
                (AlertIncidents::RcaState, no_text()),
                (AlertIncidents::RcaStartedAt, no_time()),
                (AlertIncidents::RcaUpdatedAt, no_time()),
                (AlertIncidents::RcaOutcome, no_text()),
                (AlertIncidents::RcaConfidence, no_text()),
                (AlertIncidents::RcaSummary, no_text()),
            ])
            .and_where(Expr::col(AlertIncidents::RcaRunId).like(V1_POINTER_PATTERN))
            .to_owned();
        db.execute(db.get_database_backend().build(&stmt)).await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    Id,
    OrgId,
    CreatedAt,
    TopologyContext,
    RcaRunId,
    RcaState,
    RcaStartedAt,
    RcaUpdatedAt,
    RcaOutcome,
    RcaConfidence,
    RcaSummary,
}

#[derive(DeriveIden)]
enum IncidentEvents {
    Table,
    OrgId,
    IncidentId,
    Events,
}

/// An incident with no run pointer whose topology holds pre-run reports.
struct V1Incident {
    id: String,
    org_id: String,
    created_at: i64,
    topology: serde_json::Value,
}

impl V1Incident {
    fn from_row(row: &QueryResult) -> Option<Self> {
        let id: String = row.try_get("", "id").ok()?;
        let topology: serde_json::Value = match row.try_get("", "topology_context") {
            Ok(topology) => topology,
            Err(e) => {
                log::warn!("[MIGRATION] incident {id}: unreadable topology_context, skipped: {e}");
                return None;
            }
        };
        if !has_v1_reports(&topology) {
            return None;
        }
        Some(Self {
            id,
            org_id: row.try_get("", "org_id").ok()?,
            created_at: row.try_get("", "created_at").ok()?,
            topology,
        })
    }

    /// The newest report's time, by the same rule the incident detail's run history uses.
    fn newest_report_at(&self, completed_at: &[i64]) -> Option<i64> {
        let mut completed_at = completed_at.to_vec();
        completed_at.sort_unstable_by(|a, b| b.cmp(a));
        v1_reports(&self.topology, &completed_at, self.created_at)
            .first()
            .map(|report| report.at)
    }
}

fn candidates(after: &str) -> SelectStatement {
    Query::select()
        .columns([
            AlertIncidents::Id,
            AlertIncidents::OrgId,
            AlertIncidents::CreatedAt,
            AlertIncidents::TopologyContext,
        ])
        .from(AlertIncidents::Table)
        .and_where(Expr::col(AlertIncidents::RcaRunId).is_null())
        .and_where(Expr::col(AlertIncidents::TopologyContext).is_not_null())
        .and_where(Expr::col(AlertIncidents::Id).gt(after))
        .order_by(AlertIncidents::Id, Order::Asc)
        .limit(PAGE_SIZE)
        .to_owned()
}

/// `AIAnalysisComplete` times per `(org_id, incident_id)`; with no run yet, every one is pre-run.
async fn completed_at_of<C: ConnectionTrait>(
    db: &C,
    incidents: &[V1Incident],
) -> Result<HashMap<(String, String), Vec<i64>>, DbErr> {
    let stmt = Query::select()
        .columns([
            IncidentEvents::OrgId,
            IncidentEvents::IncidentId,
            IncidentEvents::Events,
        ])
        .from(IncidentEvents::Table)
        .and_where(
            Expr::tuple([
                Expr::col(IncidentEvents::OrgId).into(),
                Expr::col(IncidentEvents::IncidentId).into(),
            ])
            .in_tuples(
                incidents
                    .iter()
                    .map(|incident| (incident.org_id.as_str(), incident.id.as_str())),
            ),
        )
        .to_owned();
    let mut times = HashMap::new();
    for row in db.query_all(db.get_database_backend().build(&stmt)).await? {
        let org_id: String = row.try_get("", "org_id")?;
        let incident_id: String = row.try_get("", "incident_id")?;
        match row.try_get::<serde_json::Value>("", "events") {
            Ok(events) => {
                times.insert((org_id, incident_id), completed_times(&events));
            }
            Err(e) => log::warn!(
                "[MIGRATION] incident {org_id}/{incident_id}: unreadable events, dated without \
                 them: {e}"
            ),
        }
    }
    Ok(times)
}

fn completed_times(events: &serde_json::Value) -> Vec<i64> {
    events
        .as_array()
        .into_iter()
        .flatten()
        .filter(|event| {
            event.get("type").and_then(serde_json::Value::as_str) == Some(AI_ANALYSIS_COMPLETE)
        })
        .filter_map(|event| event.get("timestamp").and_then(serde_json::Value::as_i64))
        .collect()
}

/// One UPDATE per page that never overwrites a run pointer written since the page was read.
fn set_pointers(pointers: &[(&str, i64)]) -> Option<UpdateStatement> {
    let ((first_id, first_at), rest) = pointers.split_first()?;
    let case = rest.iter().fold(
        Expr::case(Expr::col(AlertIncidents::Id).eq(*first_id), *first_at),
        |case, (id, at)| case.case(Expr::col(AlertIncidents::Id).eq(*id), *at),
    );
    let at: SimpleExpr = case.into();
    Some(
        Query::update()
            .table(AlertIncidents::Table)
            .values([
                (AlertIncidents::RcaRunId, V1_POINTER.into()),
                (AlertIncidents::RcaState, COMPLETED.into()),
                (AlertIncidents::RcaStartedAt, at.clone()),
                (AlertIncidents::RcaUpdatedAt, at),
                (AlertIncidents::RcaOutcome, Option::<String>::None.into()),
                (AlertIncidents::RcaConfidence, Option::<String>::None.into()),
                (AlertIncidents::RcaSummary, Option::<String>::None.into()),
            ])
            .and_where(Expr::col(AlertIncidents::Id).is_in(pointers.iter().map(|(id, _)| *id)))
            .and_where(Expr::col(AlertIncidents::RcaRunId).is_null())
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, Schema, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;
    use crate::table::entity::{alert_incidents, incident_events};

    const CREATED_AT: i64 = 50;

    async fn incidents_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(alert_incidents::Entity),
            schema.create_table_from_entity(incident_events::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    async fn exec(db: &DatabaseConnection, sql: &str, values: Vec<sea_orm::Value>) {
        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            sql,
            values,
        ))
        .await
        .unwrap();
    }

    async fn incident(db: &DatabaseConnection, id: &str, run_id: Option<&str>, topology: &str) {
        exec(
            db,
            "INSERT INTO alert_incidents (id, org_id, status, severity, group_values, key_type, \
             topology_context, first_alert_at, last_alert_at, alert_count, created_at, \
             updated_at, rca_run_id, rca_state, rca_started_at, rca_updated_at) VALUES \
             (?, 'acme', 'open', 'P2', '{}', 'service', ?, 1, 1, 1, ?, 1, ?, ?, ?, ?)",
            vec![
                id.into(),
                topology.into(),
                CREATED_AT.into(),
                run_id.into(),
                run_id.map(|_| "running").into(),
                run_id.map(|_| 7_i64).into(),
                run_id.map(|_| 8_i64).into(),
            ],
        )
        .await;
    }

    async fn events(db: &DatabaseConnection, org_id: &str, id: &str, events: serde_json::Value) {
        exec(
            db,
            "INSERT INTO incident_events (org_id, incident_id, events) VALUES (?, ?, ?)",
            vec![org_id.into(), id.into(), events.to_string().into()],
        )
        .await;
    }

    fn complete(timestamp: i64) -> serde_json::Value {
        serde_json::json!({"type": AI_ANALYSIS_COMPLETE, "timestamp": timestamp})
    }

    type Pointer = (
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    );

    async fn pointer(db: &DatabaseConnection, id: &str) -> Pointer {
        let row = db
            .query_one(Statement::from_sql_and_values(
                db.get_database_backend(),
                "SELECT rca_run_id, rca_state, rca_started_at, rca_updated_at, rca_summary \
                 FROM alert_incidents WHERE id = ?",
                vec![id.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        (
            row.try_get("", "rca_run_id").unwrap(),
            row.try_get("", "rca_state").unwrap(),
            row.try_get("", "rca_started_at").unwrap(),
            row.try_get("", "rca_updated_at").unwrap(),
            row.try_get("", "rca_summary").unwrap(),
        )
    }

    fn v1(at: i64) -> Pointer {
        (
            Some(V1_POINTER.to_string()),
            Some(COMPLETED.to_string()),
            Some(at),
            Some(at),
            None,
        )
    }

    fn untouched() -> Pointer {
        (None, None, None, None, None)
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261026_000001_backfill_v1_rca_pointer");
    }

    /// Each time source of the detail history, in order, and every row the backfill must skip.
    #[tokio::test]
    async fn up_points_v1_incidents_at_their_newest_report_and_down_clears_it() {
        let db = incidents_db().await;
        let archived = r#"{"suggested_root_cause":"current","previous_analyses":[{"content":"older","archived_at":200}]}"#;
        let current_only = r#"{"nodes":[],"suggested_root_cause":"current"}"#;
        incident(&db, "by-archive", None, archived).await;
        events(
            &db,
            "acme",
            "by-archive",
            serde_json::json!([complete(150)]),
        )
        .await;
        incident(&db, "by-event", None, current_only).await;
        let mixed = serde_json::json!([
            complete(100),
            complete(150),
            {"type": "ai_analysis_begin", "timestamp": 300},
        ]);
        events(&db, "acme", "by-event", mixed).await;
        incident(&db, "by-created", None, current_only).await;
        events(
            &db,
            "other-org",
            "by-created",
            serde_json::json!([complete(400)]),
        )
        .await;
        incident(&db, "ran", Some("2abcDEFghiJKLmnoPQRstuVWXyz"), archived).await;
        incident(
            &db,
            "no-v1",
            None,
            r#"{"nodes":[],"suggested_root_cause":"  "}"#,
        )
        .await;
        incident(&db, "bad-json", None, "{not json").await;

        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.expect("re-running is a no-op");

        assert_eq!(pointer(&db, "by-archive").await, v1(200));
        assert_eq!(pointer(&db, "by-event").await, v1(150));
        assert_eq!(
            pointer(&db, "by-created").await,
            v1(CREATED_AT),
            "another org's events are not this incident's"
        );
        let ran = (
            Some("2abcDEFghiJKLmnoPQRstuVWXyz".to_string()),
            Some("running".to_string()),
            Some(7),
            Some(8),
            None,
        );
        assert_eq!(pointer(&db, "ran").await, ran);
        assert_eq!(pointer(&db, "no-v1").await, untouched());
        assert_eq!(pointer(&db, "bad-json").await, untouched());

        Migration.down(&manager).await.unwrap();
        for id in ["by-archive", "by-event", "by-created"] {
            assert_eq!(pointer(&db, id).await, untouched(), "{id}");
        }
        assert_eq!(pointer(&db, "ran").await, ran);
    }

    /// Paging resumes past skipped rows, and each page's pointers land in one batched update.
    #[tokio::test]
    async fn up_reaches_v1_incidents_past_the_first_page() {
        let db = incidents_db().await;
        // Even rows are v1 reports: page 1 both skips rows and batches PAGE_SIZE / 2 pointers.
        for n in 0..PAGE_SIZE {
            let topology = if n % 2 == 0 {
                r#"{"suggested_root_cause":"current"}"#
            } else {
                r#"{"nodes":[]}"#
            };
            incident(&db, &format!("a{n:04}"), None, topology).await;
        }
        incident(&db, "z-last", None, r#"{"suggested_root_cause":"current"}"#).await;

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        for n in 0..PAGE_SIZE {
            let expected = if n % 2 == 0 {
                v1(CREATED_AT)
            } else {
                untouched()
            };
            assert_eq!(pointer(&db, &format!("a{n:04}")).await, expected, "a{n:04}");
        }
        assert_eq!(pointer(&db, "z-last").await, v1(CREATED_AT));
    }
}
