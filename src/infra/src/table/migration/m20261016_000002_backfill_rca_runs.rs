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

//! Backfills `rca_runs` from the RCA reports stored in `alert_incidents.topology_context`
//! and points each incident's run summary at the run that the incident's newest AI event
//! describes. Afterwards the report keys are removed from `topology_context`.

use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, TransactionTrait, sea_query::LockType,
};
use sea_orm_migration::prelude::*;
use serde_json::{Value, json};
use svix_ksuid::{Ksuid, KsuidLike};

/// Incidents read per page.
const PAGE_SIZE: u64 = 500;
/// Topology keys that held the reports before `rca_runs` existed.
const CURRENT_REPORT_KEY: &str = "suggested_root_cause";
const PREVIOUS_REPORTS_KEY: &str = "previous_analyses";
/// `RCA_STAGE_COUNT` of the run summary.
const STAGE_COUNT: u8 = 7;
const LEGACY_TRIGGER: &str = "legacy";
const LEGACY_STARTED_BY: &str = "system";
const LEGACY_MODE: &str = "fresh";
const SUBJECT_INCIDENT: &str = "incident";
const STATE_COMPLETED: &str = "completed";
const STATE_FAILED: &str = "failed";
const STATE_CANCELLED: &str = "cancelled";
const UNFINISHED_REASON: &str = "The analysis did not finish before the upgrade";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let mut after: Option<String> = None;
        let mut backfilled = 0usize;
        // Keyset paging: the per-incident commits change `rca_run_id`, so offset paging over
        // a `rca_run_id IS NULL` filter would skip rows.
        loop {
            let mut page = alert_incidents::Entity::find()
                .select_only()
                .column(alert_incidents::Column::Id)
                .filter(alert_incidents::Column::RcaRunId.is_null())
                .order_by_asc(alert_incidents::Column::Id)
                .limit(PAGE_SIZE);
            if let Some(last) = &after {
                page = page.filter(alert_incidents::Column::Id.gt(last.as_str()));
            }
            let ids = page.into_tuple::<String>().all(db).await?;
            for id in &ids {
                if backfill_incident(db, id).await? {
                    backfilled += 1;
                }
            }
            if (ids.len() as u64) < PAGE_SIZE {
                break;
            }
            after = ids.into_iter().last();
        }
        log::info!("[RCA_RUNS] backfilled legacy RCA runs for {backfilled} incident(s)");
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Data migration: the removed topology keys cannot be rebuilt, and dropping the
        // table in the schema migration's `down` removes the backfilled runs.
        log::info!("[RCA_RUNS] backfill_rca_runs down is a no-op");
        Ok(())
    }
}

/// Backfills one incident in its own transaction. Returns whether anything was written.
async fn backfill_incident<C: TransactionTrait>(db: &C, id: &str) -> Result<bool, DbErr> {
    let txn = db.begin().await?;
    let mut find = alert_incidents::Entity::find_by_id(id.to_string());
    // The row lock holds an old node's topology write until this commits; SQLite
    // serializes writers instead.
    if txn.get_database_backend() != DatabaseBackend::Sqlite {
        find = find.lock(LockType::Update);
    }
    let Some(incident) = find.one(&txn).await? else {
        txn.rollback().await?;
        return Ok(false);
    };
    if incident.rca_run_id.is_some() {
        txn.rollback().await?;
        return Ok(false);
    }

    let events = incident_events::Entity::find()
        .filter(incident_events::Column::OrgId.eq(incident.org_id.as_str()))
        .filter(incident_events::Column::IncidentId.eq(incident.id.as_str()))
        .one(&txn)
        .await?
        .map(|row| decode_events(&incident.org_id, &incident.id, &row.events))
        .unwrap_or_default();

    let plan = plan_backfill(&incident, &events);
    if plan.runs.is_empty() && plan.topology.is_none() {
        txn.rollback().await?;
        return Ok(false);
    }

    for run in &plan.runs {
        rca_runs::Entity::insert(run.active_model(&incident))
            .exec_without_returning(&txn)
            .await?;
    }

    let mut update = alert_incidents::Entity::update_many()
        .filter(alert_incidents::Column::Id.eq(incident.id.as_str()))
        .filter(alert_incidents::Column::RcaRunId.is_null());
    if let Some(topology) = plan.topology {
        update = update.col_expr(
            alert_incidents::Column::TopologyContext,
            Expr::value(topology),
        );
    }
    if let Some(pointed) = plan.pointed.map(|i| &plan.runs[i]) {
        let summary = summary_json(pointed, plan.newest_completed.map(|i| &plan.runs[i]));
        update = update
            .col_expr(
                alert_incidents::Column::RcaRunId,
                Expr::value(pointed.run_id.clone()),
            )
            .col_expr(
                alert_incidents::Column::RcaState,
                Expr::value(pointed.state),
            )
            .col_expr(
                alert_incidents::Column::RcaStartedAt,
                Expr::value(pointed.time),
            )
            .col_expr(
                alert_incidents::Column::RcaUpdatedAt,
                Expr::value(pointed.time),
            )
            .col_expr(
                alert_incidents::Column::RcaOutcome,
                Expr::value(Option::<String>::None),
            )
            .col_expr(
                alert_incidents::Column::RcaConfidence,
                Expr::value(Option::<String>::None),
            )
            .col_expr(alert_incidents::Column::RcaSummary, Expr::value(summary));
    }
    update.exec(&txn).await?;
    txn.commit().await?;
    Ok(true)
}

/// One legacy run to insert.
#[derive(Debug)]
struct LegacyRun {
    run_id: String,
    state: &'static str,
    /// `started_at = updated_at = ended_at`, µs.
    time: i64,
    report: Option<String>,
    error: Option<Value>,
    cancelled_by: Option<String>,
}

impl LegacyRun {
    fn new(state: &'static str, time: i64) -> Self {
        // A KSUID stamped with the run's own second keeps legacy ids in run order.
        let run_id = Ksuid::from_seconds(Some(time.div_euclid(1_000_000)), None).to_string();
        Self {
            run_id,
            state,
            time,
            report: None,
            error: None,
            cancelled_by: None,
        }
    }

    fn active_model(&self, incident: &alert_incidents::Model) -> rca_runs::ActiveModel {
        rca_runs::ActiveModel {
            run_id: Set(self.run_id.clone()),
            org_id: Set(incident.org_id.clone()),
            subject_type: Set(SUBJECT_INCIDENT.to_string()),
            subject_id: Set(incident.id.clone()),
            incident_id: Set(Some(incident.id.clone())),
            trigger: Set(LEGACY_TRIGGER.to_string()),
            mode: Set(LEGACY_MODE.to_string()),
            started_by: Set(LEGACY_STARTED_BY.to_string()),
            guidance: Set(None),
            state: Set(self.state.to_string()),
            started_at: Set(self.time),
            updated_at: Set(self.time),
            ended_at: Set(Some(self.time)),
            cancelled_by: Set(self.cancelled_by.clone()),
            outcome: Set(None),
            confidence: Set(None),
            report: Set(self.report.clone()),
            result: Set(None),
            error: Set(self.error.clone()),
            session_id: Set(None),
            stats: Set(None),
        }
    }
}

/// What the backfill writes for one incident.
#[derive(Debug)]
struct BackfillPlan {
    runs: Vec<LegacyRun>,
    /// Index into `runs` of the run the summary points to.
    pointed: Option<usize>,
    /// Index into `runs` of the newest completed run.
    newest_completed: Option<usize>,
    /// The new `topology_context`, when report keys were removed.
    topology: Option<Value>,
}

/// Builds the legacy runs and the summary pointer of one incident.
///
/// Reports, newest first, are the current report then the archived reports by
/// `archived_at` descending. The k-th newest report pairs with the k-th newest
/// `AIAnalysisComplete` timestamp; an unpaired current report takes the incident's
/// `updated_at`, an unpaired archived report its `archived_at`.
fn plan_backfill(incident: &alert_incidents::Model, events: &[IncidentEvent]) -> BackfillPlan {
    let topology = incident
        .topology_context
        .as_ref()
        .and_then(Value::as_object);

    let current = topology
        .and_then(|t| t.get(CURRENT_REPORT_KEY))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(|s| (s.to_string(), incident.updated_at));
    let mut archived: Vec<(String, i64)> = topology
        .and_then(|t| t.get(PREVIOUS_REPORTS_KEY))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let content = item.get("content")?.as_str()?;
                    if content.trim().is_empty() {
                        return None;
                    }
                    let archived_at = item
                        .get("archived_at")
                        .and_then(Value::as_i64)
                        .unwrap_or(incident.created_at);
                    Some((content.to_string(), archived_at))
                })
                .collect()
        })
        .unwrap_or_default();
    // Stable: equal timestamps keep the stored newest-first order.
    archived.sort_by_key(|item| std::cmp::Reverse(item.1));

    let mut complete_times: Vec<i64> = events
        .iter()
        .filter(|e| matches!(e.event_type, IncidentEventType::AIAnalysisComplete))
        .map(|e| e.timestamp)
        .collect();
    complete_times.sort_unstable_by(|a, b| b.cmp(a));

    let mut runs: Vec<LegacyRun> = current
        .into_iter()
        .chain(archived)
        .enumerate()
        .map(|(k, (content, fallback))| {
            let time = complete_times.get(k).copied().unwrap_or(fallback);
            let mut run = LegacyRun::new(STATE_COMPLETED, time);
            run.report = Some(content);
            run
        })
        .collect();
    let newest_completed = (!runs.is_empty()).then_some(0);

    let newest_ai = events
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            matches!(
                e.event_type,
                IncidentEventType::AIAnalysisBegin
                    | IncidentEventType::AIAnalysisComplete
                    | IncidentEventType::AIAnalysisFailed { .. }
                    | IncidentEventType::AIAnalysisCancelled { .. }
            )
        })
        .max_by_key(|(i, e)| (e.timestamp, *i))
        .map(|(_, e)| e);

    let terminal = match newest_ai.map(|e| (&e.event_type, e.timestamp)) {
        None | Some((IncidentEventType::AIAnalysisComplete, _)) => None,
        Some((
            IncidentEventType::AIAnalysisFailed {
                reason,
                trigger_type,
                ..
            },
            ts,
        )) => {
            // The legacy `error_details` were stored unredacted; the run keeps only the
            // user-facing reason (RR-47).
            let mut run = LegacyRun::new(STATE_FAILED, ts);
            run.error = Some(json!({
                "code": "legacy_failed",
                "reason": reason,
                "details": null,
                "trigger_type": trigger_type.to_string(),
            }));
            Some(run)
        }
        Some((IncidentEventType::AIAnalysisCancelled { user_id }, ts)) => {
            let mut run = LegacyRun::new(STATE_CANCELLED, ts);
            run.cancelled_by = user_id.clone();
            Some(run)
        }
        Some((IncidentEventType::AIAnalysisBegin, ts)) => {
            let mut run = LegacyRun::new(STATE_FAILED, ts);
            run.error = Some(json!({
                "code": "legacy_unfinished",
                "reason": UNFINISHED_REASON,
                "details": null,
                "trigger_type": null,
            }));
            Some(run)
        }
        Some(_) => None,
    };
    let pointed = match terminal {
        Some(run) => {
            runs.push(run);
            Some(runs.len() - 1)
        }
        None => newest_completed,
    };

    let topology = incident
        .topology_context
        .as_ref()
        .and_then(Value::as_object)
        .filter(|t| t.contains_key(CURRENT_REPORT_KEY) || t.contains_key(PREVIOUS_REPORTS_KEY))
        .map(|t| {
            let mut t = t.clone();
            t.remove(CURRENT_REPORT_KEY);
            t.remove(PREVIOUS_REPORTS_KEY);
            Value::Object(t)
        });

    BackfillPlan {
        runs,
        pointed,
        newest_completed,
        topology,
    }
}

/// The `rca_summary` JSON of a legacy run (`RunSummaryFields`).
fn summary_json(pointed: &LegacyRun, newest_completed: Option<&LegacyRun>) -> Value {
    let detail = pointed
        .error
        .as_ref()
        .and_then(|e| e.get("reason"))
        .cloned()
        .unwrap_or(Value::Null);
    let previous = newest_completed
        .filter(|_| pointed.state != STATE_COMPLETED)
        .map(|run| {
            json!({
                "run_id": run.run_id,
                "outcome": null,
                "confidence": null,
                "ended_at": run.time,
            })
        })
        .unwrap_or(Value::Null);
    json!({
        "stage_count": STAGE_COUNT,
        "steps": 0,
        "tool_calls": 0,
        "steered_by": [],
        "detail": detail,
        "cancelled_by": pointed.cancelled_by,
        "previous": previous,
    })
}

/// Decodes the stored events element-wise, as `infra::table::incident_events` does: one
/// malformed entry must not discard the rest of the timeline.
fn decode_events(org_id: &str, incident_id: &str, raw: &Value) -> Vec<IncidentEvent> {
    let Some(items) = raw.as_array() else {
        return vec![];
    };
    items
        .iter()
        .filter_map(
            |item| match serde_json::from_value::<IncidentEvent>(item.clone()) {
                Ok(event) => Some(event),
                Err(e) => {
                    log::warn!(
                        "[RCA_RUNS] backfill skips an undecodable event of {org_id}/{incident_id}: {e}"
                    );
                    None
                }
            },
        )
        .collect()
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// The `alert_incidents` columns this migration reads or writes.
mod alert_incidents {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "alert_incidents")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org_id: String,
        pub topology_context: Option<Json>,
        pub created_at: i64,
        pub updated_at: i64,
        pub rca_run_id: Option<String>,
        pub rca_state: Option<String>,
        pub rca_started_at: Option<i64>,
        pub rca_updated_at: Option<i64>,
        pub rca_outcome: Option<String>,
        pub rca_confidence: Option<String>,
        pub rca_summary: Option<Json>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the incident_events table at the time this migration executes.
mod incident_events {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "incident_events")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub org_id: String,
        #[sea_orm(primary_key, auto_increment = false)]
        pub incident_id: String,
        pub events: Json,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the rca_runs table at the time this migration executes.
mod rca_runs {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "rca_runs")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub run_id: String,
        pub org_id: String,
        pub subject_type: String,
        pub subject_id: String,
        pub incident_id: Option<String>,
        pub trigger: String,
        pub mode: String,
        pub started_by: String,
        #[sea_orm(column_type = "Text", nullable)]
        pub guidance: Option<String>,
        pub state: String,
        pub started_at: i64,
        pub updated_at: i64,
        pub ended_at: Option<i64>,
        pub cancelled_by: Option<String>,
        pub outcome: Option<String>,
        pub confidence: Option<String>,
        #[sea_orm(column_type = "Text", nullable)]
        pub report: Option<String>,
        pub result: Option<Json>,
        pub error: Option<Json>,
        pub session_id: Option<String>,
        pub stats: Option<Json>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::incidents::AnalysisTriggerType;
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::table::{
        entity,
        migration::{
            m20261016_000001_create_rca_runs as create_rca_runs,
            m20261017_000001_add_rca_run_progress_columns as progress_columns,
            m20261018_000001_create_rca_steering as create_rca_steering,
        },
    };

    const SEC: i64 = 1_000_000;
    const T0: i64 = 1_700_000_000 * SEC;

    /// The tables as they are after migration A: `rca_runs` comes from A itself, since the
    /// current entity carries NOT NULL columns that later migrations add.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(entity::alert_incidents::Entity),
            schema.create_table_from_entity(entity::incident_events::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        create_rca_runs::Migration
            .up(&SchemaManager::new(&db))
            .await
            .unwrap();
        db
    }

    async fn incident(
        db: &DatabaseConnection,
        id: &str,
        topology: Option<Value>,
        events: Vec<IncidentEvent>,
    ) {
        use sea_orm::ActiveModelTrait;
        entity::alert_incidents::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("acme".to_string()),
            status: Set("open".to_string()),
            severity: Set("P2".to_string()),
            group_values: Set(json!({"service": "payments"})),
            key_type: Set("service".to_string()),
            topology_context: Set(topology),
            first_alert_at: Set(T0),
            last_alert_at: Set(T0),
            resolved_at: Set(None),
            alert_count: Set(1),
            title: Set(None),
            assigned_to: Set(None),
            acknowledged_by: Set(None),
            acknowledged_at: Set(None),
            created_at: Set(T0),
            updated_at: Set(T0 + 900 * SEC),
            muted_by_downtime_id: Set(None),
            rca_run_id: Set(None),
            rca_state: Set(None),
            rca_started_at: Set(None),
            rca_updated_at: Set(None),
            rca_outcome: Set(None),
            rca_confidence: Set(None),
            rca_summary: Set(None),
            rca_off_reason: Set(None),
        }
        .insert(db)
        .await
        .unwrap();
        entity::incident_events::ActiveModel {
            org_id: Set("acme".to_string()),
            incident_id: Set(id.to_string()),
            events: Set(serde_json::to_value(events).unwrap()),
        }
        .insert(db)
        .await
        .unwrap();
    }

    fn at(mut event: IncidentEvent, timestamp: i64) -> IncidentEvent {
        event.timestamp = timestamp;
        event
    }

    fn topology_with_reports() -> Value {
        json!({
            "nodes": [],
            "edges": [],
            "related_incident_ids": ["other"],
            "suggested_root_cause": "current report",
            "previous_analyses": [
                {"content": "middle report", "archived_at": T0 + 300 * SEC},
                {"content": "oldest report", "archived_at": T0 + 100 * SEC},
            ],
        })
    }

    /// Runs the backfill, then the later migrations (as production does) so `rca_runs`
    /// matches the current entity before the tests read it.
    async fn migrate(db: &DatabaseConnection) {
        let manager = SchemaManager::new(db);
        Migration.up(&manager).await.unwrap();
        progress_columns::Migration.up(&manager).await.unwrap();
        create_rca_steering::Migration.up(&manager).await.unwrap();
    }

    async fn runs(db: &DatabaseConnection, id: &str) -> Vec<entity::rca_runs::Model> {
        entity::rca_runs::Entity::find()
            .filter(entity::rca_runs::Column::SubjectId.eq(id))
            .order_by_desc(entity::rca_runs::Column::StartedAt)
            .all(db)
            .await
            .unwrap()
    }

    async fn inc(db: &DatabaseConnection, id: &str) -> entity::alert_incidents::Model {
        entity::alert_incidents::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    /// Asserts the summary columns equal `run` (RR-2) and returns the summary JSON.
    fn assert_points_to(
        inc: &entity::alert_incidents::Model,
        run: &entity::rca_runs::Model,
    ) -> Value {
        assert_eq!(inc.rca_run_id.as_deref(), Some(run.run_id.as_str()));
        assert_eq!(inc.rca_state.as_deref(), Some(run.state.as_str()));
        assert_eq!(inc.rca_started_at, Some(run.started_at));
        assert_eq!(inc.rca_updated_at, Some(run.updated_at));
        assert_eq!((&inc.rca_outcome, &inc.rca_confidence), (&None, &None));
        inc.rca_summary.clone().expect("rca_summary set")
    }

    /// RR-24 migration B: a current report, two archived reports and two Complete events
    /// become three legacy completed runs, newest paired with the newest event; the summary
    /// points to the newest; the report keys leave `topology_context`; a second run changes
    /// nothing.
    #[tokio::test]
    async fn reports_become_completed_legacy_runs_with_paired_times() {
        let db = db().await;
        let complete_new = T0 + 800 * SEC;
        let complete_old = T0 + 400 * SEC;
        incident(
            &db,
            "inc-1",
            Some(topology_with_reports()),
            vec![
                at(IncidentEvent::created(), T0),
                at(IncidentEvent::ai_analysis_begin(), T0 + 390 * SEC),
                at(IncidentEvent::ai_analysis_complete(), complete_old),
                at(IncidentEvent::ai_analysis_begin(), T0 + 790 * SEC),
                at(IncidentEvent::ai_analysis_complete(), complete_new),
            ],
        )
        .await;
        migrate(&db).await;

        let rows = runs(&db, "inc-1").await;
        let got: Vec<(&str, Option<&str>, i64)> = rows
            .iter()
            .map(|r| (r.state.as_str(), r.report.as_deref(), r.started_at))
            .collect();
        assert_eq!(
            got,
            vec![
                ("completed", Some("current report"), complete_new),
                ("completed", Some("middle report"), complete_old),
                ("completed", Some("oldest report"), T0 + 100 * SEC),
            ]
        );
        for r in &rows {
            assert_eq!(r.ended_at, Some(r.started_at));
            assert_eq!(r.updated_at, r.started_at);
            assert_eq!(
                (r.trigger.as_str(), r.mode.as_str(), r.started_by.as_str()),
                ("legacy", "fresh", "system")
            );
            assert_eq!(
                (r.subject_type.as_str(), r.incident_id.as_deref()),
                ("incident", Some("inc-1"))
            );
            assert_eq!(
                (&r.outcome, &r.confidence, &r.result),
                (&None, &None, &None)
            );
        }

        let incident = inc(&db, "inc-1").await;
        let summary = assert_points_to(&incident, &rows[0]);
        assert_eq!(summary["previous"], Value::Null);
        assert_eq!(summary["stage_count"], json!(STAGE_COUNT));
        let topology = incident.topology_context.clone().unwrap();
        assert!(topology.get(CURRENT_REPORT_KEY).is_none());
        assert!(topology.get(PREVIOUS_REPORTS_KEY).is_none());
        assert_eq!(topology["related_incident_ids"], json!(["other"]));

        migrate(&db).await;
        assert_eq!(runs(&db, "inc-1").await, rows);
        assert_eq!(inc(&db, "inc-1").await, incident);
    }

    /// Newest AI event `AIAnalysisFailed`: a legacy failed run that the summary points to,
    /// with the completed report as `previous`.
    #[tokio::test]
    async fn a_failed_last_event_becomes_a_failed_legacy_run() {
        let db = db().await;
        incident(
            &db,
            "inc-1",
            Some(json!({"nodes": [], "suggested_root_cause": "only report"})),
            vec![
                at(IncidentEvent::ai_analysis_begin(), T0 + 10 * SEC),
                at(IncidentEvent::ai_analysis_complete(), T0 + 20 * SEC),
                at(IncidentEvent::ai_analysis_begin(), T0 + 30 * SEC),
                at(
                    IncidentEvent::ai_analysis_failed(
                        "Agent unavailable",
                        AnalysisTriggerType::AutomaticNewIncident,
                        Some("503".to_string()),
                    ),
                    T0 + 40 * SEC,
                ),
            ],
        )
        .await;
        migrate(&db).await;

        let rows = runs(&db, "inc-1").await;
        assert_eq!(rows.len(), 2);
        let (failed, completed) = (&rows[0], &rows[1]);
        assert_eq!(
            (failed.state.as_str(), failed.started_at),
            ("failed", T0 + 40 * SEC)
        );
        let error = failed.error.clone().unwrap();
        assert_eq!(error["code"], "legacy_failed");
        assert_eq!(error["reason"], "Agent unavailable");
        assert_eq!(
            error["details"],
            Value::Null,
            "legacy event details are not kept"
        );
        assert_eq!(
            error["trigger_type"],
            json!(AnalysisTriggerType::AutomaticNewIncident.to_string())
        );
        assert_eq!(
            (completed.state.as_str(), completed.started_at),
            ("completed", T0 + 20 * SEC)
        );

        let summary = assert_points_to(&inc(&db, "inc-1").await, failed);
        assert_eq!(summary["detail"], "Agent unavailable");
        assert_eq!(summary["previous"]["run_id"], json!(completed.run_id));
        assert_eq!(summary["previous"]["ended_at"], json!(T0 + 20 * SEC));
    }

    /// Newest AI event `AIAnalysisCancelled`: a legacy cancelled run with its user.
    #[tokio::test]
    async fn a_cancelled_last_event_becomes_a_cancelled_legacy_run() {
        let db = db().await;
        incident(
            &db,
            "inc-1",
            None,
            vec![
                at(IncidentEvent::ai_analysis_begin(), T0 + 10 * SEC),
                at(
                    IncidentEvent::ai_analysis_cancelled(Some("a.rao@acme.io".to_string())),
                    T0 + 20 * SEC,
                ),
            ],
        )
        .await;
        migrate(&db).await;

        let rows = runs(&db, "inc-1").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state, "cancelled");
        assert_eq!(rows[0].cancelled_by.as_deref(), Some("a.rao@acme.io"));
        let summary = assert_points_to(&inc(&db, "inc-1").await, &rows[0]);
        assert_eq!(summary["cancelled_by"], "a.rao@acme.io");
        assert_eq!(summary["previous"], Value::Null);
    }

    /// Newest AI event `AIAnalysisBegin` with no end: `failed`/`legacy_unfinished`.
    #[tokio::test]
    async fn a_begin_without_an_end_becomes_an_unfinished_legacy_run() {
        let db = db().await;
        incident(
            &db,
            "inc-1",
            None,
            vec![at(IncidentEvent::ai_analysis_begin(), T0 + 10 * SEC)],
        )
        .await;
        migrate(&db).await;

        let rows = runs(&db, "inc-1").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state, "failed");
        assert_eq!(rows[0].error.as_ref().unwrap()["code"], "legacy_unfinished");
        let summary = assert_points_to(&inc(&db, "inc-1").await, &rows[0]);
        assert_eq!(summary["detail"], UNFINISHED_REASON);
    }

    /// No AI event and no report: no run and no summary. A report with no AI event: one
    /// completed run at the incident's `updated_at`.
    #[tokio::test]
    async fn incidents_without_ai_events() {
        let db = db().await;
        let plain_topology = json!({"nodes": [], "edges": [], "related_incident_ids": []});
        incident(
            &db,
            "inc-none",
            Some(plain_topology.clone()),
            vec![at(IncidentEvent::created(), T0)],
        )
        .await;
        incident(
            &db,
            "inc-report",
            Some(json!({"suggested_root_cause": "report"})),
            vec![],
        )
        .await;
        migrate(&db).await;

        assert!(runs(&db, "inc-none").await.is_empty());
        let none = inc(&db, "inc-none").await;
        assert_eq!((none.rca_run_id, none.rca_summary), (None, None));
        assert_eq!(none.topology_context, Some(plain_topology));

        let rows = runs(&db, "inc-report").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].state.as_str(), rows[0].started_at),
            ("completed", T0 + 900 * SEC)
        );
        let incident = inc(&db, "inc-report").await;
        assert_points_to(&incident, &rows[0]);
        assert_eq!(incident.topology_context, Some(json!({})));
    }

    /// Step 5: an incident whose `rca_run_id` is already set is skipped.
    #[tokio::test]
    async fn an_incident_with_a_run_is_skipped() {
        let db = db().await;
        incident(&db, "inc-1", Some(topology_with_reports()), vec![]).await;
        entity::alert_incidents::Entity::update_many()
            .col_expr(
                entity::alert_incidents::Column::RcaRunId,
                Expr::value("live-run"),
            )
            .filter(entity::alert_incidents::Column::Id.eq("inc-1"))
            .exec(&db)
            .await
            .unwrap();
        let before = inc(&db, "inc-1").await;
        migrate(&db).await;
        assert!(runs(&db, "inc-1").await.is_empty());
        assert_eq!(inc(&db, "inc-1").await, before);
    }
}
