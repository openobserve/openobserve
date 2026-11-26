// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! The one guarded path every automatic close of an incident takes: the row lock, the caller's
//! guards and the resolve write, in the caller's transaction.

use config::meta::alerts::recovery::transitions::CheckState;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, QuerySelect, Set,
    TransactionTrait, sea_query::LockType,
};

use crate::{
    db::get_orm_client_rw,
    errors,
    table::{
        entity::{alert_incident_alerts, alert_incidents, external_alerts},
        incident_events, incident_recovery_checks,
    },
};

/// `resolved_by` of every automatic close (design 6.1).
pub const SYSTEM_RESOLVER: &str = "system";

/// Who asks for an automatic close; each caller keeps its own guards.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseCaller {
    /// The stale sweep; the incident must have had no activity since `cutoff`.
    StaleSweep { cutoff: i64 },
    /// The org's explicit security_cases.auto_close_days policy owns case expiry.
    SecurityCaseSweep { cutoff: i64 },
    /// Every firing recovered.
    AlertRecovery,
    /// An external source cleared.
    ExternalAlert,
    /// The on-call page the incident was promoted from was closed.
    OncallClose,
}

/// What [resolve_guarded_in] did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GuardedClose {
    /// The resolve is written in the caller's transaction, which must commit it.
    Closed {
        before: Box<alert_incidents::Model>,
        after: Box<alert_incidents::Model>,
        stopped_checks: Vec<String>,
    },
    AlreadyResolved(Box<alert_incidents::Model>),
    Kept(KeptReason),
}

/// Why a guarded close left the incident open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeptReason {
    Missing,
    /// A security case is an analyst's to close.
    SecurityCase,
    /// Something happened on the incident at `last_activity`, at or after the sweep's cutoff.
    Active {
        last_activity: i64,
    },
    FiringOpen,
    NoFirings,
    /// Every firing recovered, but a person who acknowledged or was assigned it owns the close.
    Owned,
    /// Another external source linked into the incident has not cleared.
    ExternalFiring,
    RecoveryInProgress,
    NotAtHeld,
}

impl std::fmt::Display for KeptReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(f, "the incident does not exist"),
            Self::SecurityCase => write!(f, "it is a security case"),
            Self::Active { last_activity } => write!(f, "it was active at {last_activity}"),
            Self::FiringOpen => write!(f, "a firing is still open"),
            Self::NoFirings => write!(f, "it has no firings"),
            Self::Owned => write!(f, "a person owns the close"),
            Self::ExternalFiring => write!(f, "another external source still fires"),
            Self::RecoveryInProgress => write!(f, "incident recovery is still active"),
            Self::NotAtHeld => write!(f, "the current attempt has not reached held"),
        }
    }
}

/// [resolve_guarded_in] in its own transaction on the primary, committed only when it closed.
pub async fn resolve_guarded(
    org_id: &str,
    incident_id: &str,
    caller: CloseCaller,
) -> Result<GuardedClose, errors::Error> {
    let db = get_orm_client_rw().await;
    let txn = db.begin().await?;
    let now = chrono::Utc::now().timestamp_micros();
    let mut closed = resolve_guarded_in(&txn, org_id, incident_id, caller, now, None).await?;
    if let GuardedClose::Closed { stopped_checks, .. } = &mut closed {
        txn.commit().await?;
        incident_recovery_checks::retire_stopped_triggers(
            db,
            org_id,
            std::mem::take(stopped_checks),
        )
        .await;
    } else {
        txn.rollback().await?;
    }
    Ok(closed)
}

/// Locks the incident row, applies `caller`'s guards under the lock and writes the resolve.
pub async fn resolve_guarded_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    incident_id: &str,
    caller: CloseCaller,
    now: i64,
    at_held: Option<&str>,
) -> Result<GuardedClose, errors::Error> {
    // On SQLite the one write connection this transaction holds keeps other writers out instead.
    let Some(before) = alert_incidents::Entity::find_by_id(incident_id)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .lock(LockType::Update)
        .one(txn)
        .await?
    else {
        return Ok(GuardedClose::Kept(KeptReason::Missing));
    };
    if before.status == "resolved" {
        return Ok(GuardedClose::AlreadyResolved(Box::new(before)));
    }
    if let Some(reason) = security_case_guard(&before, caller, at_held) {
        return Ok(GuardedClose::Kept(reason));
    }
    if let Some(reason) = check_guard(txn, &before, at_held).await? {
        return Ok(GuardedClose::Kept(reason));
    }
    let kept = if at_held.is_some() {
        has_open_firing(txn, &before)
            .await?
            .then_some(KeptReason::FiringOpen)
    } else {
        match caller {
            CloseCaller::StaleSweep { cutoff } | CloseCaller::SecurityCaseSweep { cutoff } => {
                stale_guard(txn, &before, cutoff).await?
            }
            CloseCaller::AlertRecovery => recovery_guard(txn, &before).await?,
            CloseCaller::ExternalAlert => external_guard(txn, &before).await?,
            CloseCaller::OncallClose => None,
        }
    };
    if let Some(reason) = kept {
        return Ok(GuardedClose::Kept(reason));
    }
    let stopped_checks = super::resolve_recovery_in(txn, &before, now).await?;
    let mut active: alert_incidents::ActiveModel = before.clone().into();
    active.recovery_due_at = Set(None);
    active.status = Set("resolved".to_string());
    active.resolved_at = Set(Some(now));
    active.updated_at = Set(now);
    // A resolved incident is muted by nothing, even if recording its events fails later.
    active.muted_by_downtime_id = Set(None);
    active.resolved_by = Set(Some(SYSTEM_RESOLVER.to_string()));
    let after = active.update(txn).await?;
    Ok(GuardedClose::Closed {
        before: Box::new(before),
        after: Box::new(after),
        stopped_checks,
    })
}

pub async fn has_open_firing(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
) -> Result<bool, errors::Error> {
    let open_internal = alert_incident_alerts::Entity::find()
        .filter(alert_incident_alerts::Column::IncidentId.eq(&row.id))
        .filter(alert_incident_alerts::Column::AlertKind.ne("external"))
        .filter(alert_incident_alerts::Column::ResolvedAt.is_null())
        .one(txn)
        .await?;
    if open_internal.is_some() {
        return Ok(true);
    }
    Ok(external_guard(txn, row).await? == Some(KeptReason::ExternalFiring))
}

fn security_case_guard(
    row: &alert_incidents::Model,
    caller: CloseCaller,
    at_held: Option<&str>,
) -> Option<KeptReason> {
    if let CloseCaller::SecurityCaseSweep { cutoff } = caller
        && at_held.is_none()
    {
        if !row.security_case {
            return Some(KeptReason::Missing);
        }
        // A new detection can carry an old event timestamp.
        let last_activity = row.updated_at.max(row.created_at);
        return (last_activity >= cutoff).then_some(KeptReason::Active { last_activity });
    }
    row.security_case.then_some(KeptReason::SecurityCase)
}

async fn check_guard(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
    at_held: Option<&str>,
) -> Result<Option<KeptReason>, errors::Error> {
    if at_held.is_some() && (at_held != row.fix_attempt_id.as_deref() || row.recovered_at.is_none())
    {
        return Ok(Some(KeptReason::NotAtHeld));
    }
    if row.fix_applied_at.is_some() || (row.mitigated_at.is_some() && row.recovered_at.is_none()) {
        return Ok(Some(KeptReason::RecoveryInProgress));
    }
    let Some(attempt) = &row.fix_attempt_id else {
        return Ok(None);
    };
    let mut held = false;
    for check in incident_recovery_checks::list(txn, &row.org_id, &row.id).await? {
        if check.attempt_id != *attempt {
            continue;
        }
        match CheckState::parse(&check.state) {
            Some(CheckState::Checking | CheckState::Soaking) => {
                return Ok(Some(KeptReason::RecoveryInProgress));
            }
            Some(CheckState::Held) if at_held.is_none() => {
                return Ok(Some(KeptReason::RecoveryInProgress));
            }
            Some(CheckState::Held) => held = true,
            _ => {}
        }
    }
    Ok((at_held.is_some() && !held).then_some(KeptReason::NotAtHeld))
}

/// Idle means no alert and no event since `cutoff`; a comment or an ack is activity too.
async fn stale_guard(
    txn: &DatabaseTransaction,
    incident: &alert_incidents::Model,
    cutoff: i64,
) -> Result<Option<KeptReason>, errors::Error> {
    let events = incident_events::get_with(txn, &incident.org_id, &incident.id).await?;
    let last_activity = events
        .iter()
        .map(|e| e.timestamp)
        .chain(incident.acknowledged_at)
        .fold(incident.last_alert_at, i64::max);
    Ok((last_activity >= cutoff).then_some(KeptReason::Active { last_activity }))
}

async fn recovery_guard(
    txn: &DatabaseTransaction,
    incident: &alert_incidents::Model,
) -> Result<Option<KeptReason>, errors::Error> {
    // Two single-row reads under the row lock, however many links a long-lived incident holds.
    let links = alert_incident_alerts::Entity::find()
        .filter(alert_incident_alerts::Column::IncidentId.eq(&incident.id));
    let open_link = links
        .clone()
        .filter(alert_incident_alerts::Column::ResolvedAt.is_null())
        .one(txn)
        .await?;
    if open_link.is_some() {
        return Ok(Some(KeptReason::FiringOpen));
    }
    if links.one(txn).await?.is_none() {
        return Ok(Some(KeptReason::NoFirings));
    }
    let held = incident.status != "open"
        || incident.acknowledged_by.is_some()
        || incident.assigned_to.is_some();
    Ok(held.then_some(KeptReason::Owned))
}

/// A single source clearing must not close an incident other still-firing sources feed.
async fn external_guard(
    txn: &DatabaseTransaction,
    incident: &alert_incidents::Model,
) -> Result<Option<KeptReason>, errors::Error> {
    let sources: Vec<String> = alert_incident_alerts::Entity::find()
        .select_only()
        .column(alert_incident_alerts::Column::AlertId)
        .filter(alert_incident_alerts::Column::IncidentId.eq(&incident.id))
        .filter(alert_incident_alerts::Column::AlertKind.eq("external"))
        .into_tuple()
        .all(txn)
        .await?;
    if sources.is_empty() {
        return Ok(Some(KeptReason::NoFirings));
    }
    let firing = external_alerts::Entity::find()
        .filter(external_alerts::Column::OrgId.eq(&incident.org_id))
        .filter(external_alerts::Column::Id.is_in(sources))
        .filter(external_alerts::Column::State.ne("resolved"))
        .one(txn)
        .await?;
    Ok(firing.map(|_| KeptReason::ExternalFiring))
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::incidents::IncidentEvent;
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Schema, sea_query::Expr};

    use super::*;
    use crate::{
        race::{Barriers, Order, in_both_orders},
        table::alert_incidents::{
            FirstAlert, StaleScope, add_firing_once_with, auto_resolve_stale_with, new_incident,
        },
    };

    const HOUR: i64 = 3_600_000_000;
    const MINUTE: i64 = 60_000_000;
    const RACE_POINT: &str = "alert_incidents.stale_before_lock";
    const FIRING: FirstAlert<'static> = FirstAlert {
        alert_id: "a1",
        alert_name: "cpu",
        alert_kind: "alert",
        correlation_reason: "service",
        labels: None,
        severity: None,
    };

    /// SQLite, then (first) a Postgres schema of its own when `ZO_META_POSTGRES_DSN` is set.
    async fn backends() -> Vec<(&'static str, DatabaseConnection, Option<String>)> {
        let mut out = vec![("sqlite", sqlite().await, None)];
        if let Some(schema) = pg_schema().await {
            let pg = schema_connection(&schema).await;
            create_tables(&pg).await;
            out.insert(0, ("postgres", pg, Some(schema)));
        }
        out
    }

    /// One connection, as the SQLite write pool has, so two transactions never overlap.
    async fn sqlite() -> DatabaseConnection {
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_tables(&db).await;
        db
    }

    async fn create_tables(db: &DatabaseConnection) {
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(alert_incidents::Entity),
            schema.create_table_from_entity(alert_incident_alerts::Entity),
            schema.create_table_from_entity(crate::table::entity::incident_events::Entity),
            schema.create_table_from_entity(external_alerts::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
    }

    /// A fresh schema on `ZO_META_POSTGRES_DSN`; the SQLite lane sets the variable empty.
    async fn pg_schema() -> Option<String> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!("igc_test_{}", config::ider::generate().to_ascii_lowercase());
        let admin = Database::connect(&dsn).await.unwrap();
        let create = format!(r#"CREATE SCHEMA "{schema}""#);
        admin.execute_unprepared(&create).await.unwrap();
        Some(schema)
    }

    async fn schema_connection(schema: &str) -> DatabaseConnection {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap();
        let mut options = sea_orm::ConnectOptions::new(dsn);
        options
            .max_connections(1)
            .set_schema_search_path(schema.to_string());
        Database::connect(options).await.unwrap()
    }

    async fn drop_schema(schema: Option<String>) {
        let Some(schema) = schema else {
            return;
        };
        let admin = Database::connect(std::env::var("ZO_META_POSTGRES_DSN").unwrap())
            .await
            .unwrap();
        let drop = format!(r#"DROP SCHEMA "{schema}" CASCADE"#);
        admin.execute_unprepared(&drop).await.unwrap();
        println!("postgres arm ran");
    }

    /// An open `acme` incident whose last alert was at `last_alert_at`.
    async fn incident(
        db: &DatabaseConnection,
        last_alert_at: i64,
        edit: impl FnOnce(&mut alert_incidents::ActiveModel),
    ) -> String {
        let mut row = new_incident(
            "acme",
            "P2",
            serde_json::json!({"service": "payments"}),
            "service",
            (last_alert_at, last_alert_at),
            None,
            None,
            None,
        );
        row.created_at = Set(last_alert_at);
        row.updated_at = Set(last_alert_at);
        edit(&mut row);
        row.insert(db).await.unwrap().id
    }

    async fn link(db: &DatabaseConnection, id: &str, alert_id: &str, kind: &str, done: bool) {
        alert_incident_alerts::ActiveModel {
            incident_id: Set(id.to_string()),
            alert_id: Set(alert_id.to_string()),
            alert_fired_at: Set(1),
            alert_name: Set(alert_id.to_string()),
            alert_kind: Set(kind.to_string()),
            correlation_reason: Set(None),
            created_at: Set(1),
            resolved_at: Set(done.then_some(2)),
            labels: Set(None),
            severity: Set(None),
        }
        .insert(db)
        .await
        .unwrap();
    }

    async fn external(db: &DatabaseConnection, id: &str, state: &str) {
        external_alerts::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("acme".to_string()),
            integration_id: Set("int".to_string()),
            detected_source: Set("generic".to_string()),
            dedup_key: Set(id.to_string()),
            title: Set(id.to_string()),
            severity: Set("P2".to_string()),
            state: Set(state.to_string()),
            labels: Set("{}".to_string()),
            source_url: Set(None),
            last_payload: Set("{}".to_string()),
            first_seen_at: Set(1),
            last_seen_at: Set(1),
            resolved_at: Set(None),
        }
        .insert(db)
        .await
        .unwrap();
    }

    async fn comment_at(db: &DatabaseConnection, id: &str, at: i64) {
        let mut event = IncidentEvent::comment("someone@example.com", "looking");
        event.timestamp = at;
        incident_events::append_with(db, "acme", id, event)
            .await
            .unwrap();
    }

    async fn status(db: &DatabaseConnection, id: &str) -> String {
        alert_incidents::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .status
    }

    async fn close(db: &DatabaseConnection, id: &str, caller: CloseCaller) -> GuardedClose {
        let txn = db.begin().await.unwrap();
        let closed = resolve_guarded_in(&txn, "acme", id, caller, 500, None)
            .await
            .unwrap();
        txn.commit().await.unwrap();
        closed
    }

    fn kept(closed: &GuardedClose) -> Option<KeptReason> {
        match closed {
            GuardedClose::Kept(reason) => Some(*reason),
            _ => None,
        }
    }

    async fn sweep(db: &DatabaseConnection, cutoff: i64) -> Vec<String> {
        let (_, closed) = auto_resolve_stale_with(db, cutoff, cutoff, StaleScope::Ops)
            .await
            .unwrap();
        closed.into_iter().map(|c| c.incident_id).collect()
    }

    fn sweep_at(now: i64) -> CloseCaller {
        CloseCaller::StaleSweep { cutoff: now - HOUR }
    }

    #[tokio::test]
    async fn the_sweep_measures_idleness_by_the_last_alert_or_event() {
        for (name, db, schema) in backends().await {
            let now = chrono::Utc::now().timestamp_micros();
            let worked = incident(&db, now - 2 * HOUR, |_| {}).await;
            comment_at(&db, &worked, now - 5 * MINUTE).await;
            let idle = incident(&db, now - 2 * HOUR, |_| {}).await;
            comment_at(&db, &idle, now - 90 * MINUTE).await;

            assert_eq!(
                sweep(&db, now - HOUR).await,
                std::slice::from_ref(&idle),
                "{name}"
            );
            assert_eq!(status(&db, &worked).await, "open", "{name}");
            let txn = db.begin().await.unwrap();
            let again = resolve_guarded_in(&txn, "acme", &worked, sweep_at(now), now, None)
                .await
                .unwrap();
            assert_eq!(
                kept(&again),
                Some(KeptReason::Active {
                    last_activity: now - 5 * MINUTE
                }),
                "{name}"
            );
            txn.rollback().await.unwrap();

            let before = alert_incidents::Entity::find_by_id(&idle)
                .one(&db)
                .await
                .unwrap()
                .unwrap();
            assert!(sweep(&db, now).await.contains(&worked), "{name}");
            let resolved = close(&db, &idle, sweep_at(now)).await;
            assert_eq!(
                resolved,
                GuardedClose::AlreadyResolved(Box::new(before)),
                "{name}: a resolved incident is a no-op and is not written again"
            );
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn the_sweep_keeps_an_ack_that_has_not_reached_the_timeline() {
        for (name, db, schema) in backends().await {
            let now = chrono::Utc::now().timestamp_micros();
            let id = incident(&db, now - 2 * HOUR, |_| {}).await;
            super::super::acknowledge_with(&db, "acme", &id, "ana@acme.io")
                .await
                .unwrap()
                .unwrap();

            let closed = sweep(&db, now - HOUR).await;
            let state = status(&db, &id).await;
            drop_schema(schema).await;
            assert!(closed.is_empty(), "{name}: closed {closed:?}");
            assert_eq!(state, "acknowledged", "{name}");
        }
    }

    #[tokio::test]
    async fn a_firing_that_joins_before_the_sweep_locks_keeps_the_incident_open_on_postgres() {
        let Some(schema) = pg_schema().await else {
            println!("postgres arm skipped: ZO_META_POSTGRES_DSN is unset");
            return;
        };
        let (db, other) = (
            schema_connection(&schema).await,
            schema_connection(&schema).await,
        );
        create_tables(&db).await;
        let now = chrono::Utc::now().timestamp_micros();
        let id = incident(&db, now - 2 * HOUR, |_| {}).await;
        let race = Barriers::new();
        race.arm(RACE_POINT, 2);
        let sweeper = {
            let race = race.clone();
            tokio::spawn(async move { race.run(sweep(&db, now - HOUR)).await })
        };
        while race.arrived(RACE_POINT) == 0 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let joined = add_firing_once_with(&other, "acme", &id, &FIRING, now).await;
        assert!(joined.is_ok(), "{joined:?}");
        race.wait(RACE_POINT).await;

        assert!(sweeper.await.unwrap().is_empty());
        race.assert_all_met();
        assert_eq!(status(&other, &id).await, "open");
        drop_schema(Some(schema)).await;
    }

    #[tokio::test]
    async fn a_firing_and_the_sweep_in_either_order_on_sqlite() {
        let now = chrono::Utc::now().timestamp_micros();
        let runs = in_both_orders(|_| async move {
            let db = std::sync::Arc::new(sqlite().await);
            let id = incident(&db, now - 2 * HOUR, |_| {}).await;
            let (sweeper, joiner) = (db.clone(), db);
            let id2 = id.clone();
            (
                async move {
                    (
                        sweep(&sweeper, now - HOUR).await,
                        status(&sweeper, &id).await,
                    )
                },
                async move { add_firing_once_with(&joiner, "acme", &id2, &FIRING, now).await },
            )
        })
        .await;
        for run in runs {
            let (closed, _) = &run.a;
            match run.order {
                // The sweep closed it first, so the join is refused and correlation retries.
                Order::AThenB => assert!(closed.len() == 1 && run.b.is_err(), "{:?}", run.b),
                Order::BThenA => {
                    assert!(run.b.is_ok() && closed.is_empty());
                    assert_eq!(run.a.1, "open");
                }
            }
        }
    }

    #[tokio::test]
    async fn two_sweeps_over_one_candidate_close_it_once() {
        let now = chrono::Utc::now().timestamp_micros();
        if let Some(schema) = pg_schema().await {
            let (a, b) = (
                schema_connection(&schema).await,
                schema_connection(&schema).await,
            );
            create_tables(&a).await;
            incident(&a, now - 2 * HOUR, |_| {}).await;
            let race = Barriers::new();
            race.arm(RACE_POINT, 2);
            let node = |db: DatabaseConnection| {
                let race = race.clone();
                tokio::spawn(async move { race.run(sweep(&db, now - HOUR)).await })
            };
            let (first, second) = (node(a), node(b));
            let (first, second) = (first.await.unwrap(), second.await.unwrap());
            race.assert_all_met();
            assert_eq!(first.len() + second.len(), 1, "{first:?} {second:?}");
            drop_schema(Some(schema)).await;
        } else {
            println!("postgres arm skipped: ZO_META_POSTGRES_DSN is unset");
        }
        let runs = in_both_orders(|_| async move {
            let db = std::sync::Arc::new(sqlite().await);
            incident(&db, now - 2 * HOUR, |_| {}).await;
            let (a, b) = (db.clone(), db);
            (async move { sweep(&a, now - HOUR).await }, async move {
                sweep(&b, now - HOUR).await
            })
        })
        .await;
        for run in runs {
            assert_eq!(run.a.len() + run.b.len(), 1, "{:?}", run.order);
        }
    }

    #[tokio::test]
    async fn a_failing_candidate_does_not_drop_the_closes_already_committed() {
        for (name, db, schema) in backends().await {
            let now = chrono::Utc::now().timestamp_micros();
            for id in ["inc-a", "inc-b", "inc-c"] {
                incident(&db, now - 2 * HOUR, |row| row.id = Set(id.to_string())).await;
            }
            let refuse = match &schema {
                Some(s) => vec![
                    format!(
                        r#"CREATE FUNCTION "{s}".refuse_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'inc-b' THEN RAISE EXCEPTION 'the test refused this close'; END IF; RETURN NEW; END $$"#
                    ),
                    format!(
                        r#"CREATE TRIGGER refuse_close BEFORE UPDATE ON "{s}".alert_incidents FOR EACH ROW EXECUTE FUNCTION "{s}".refuse_close()"#
                    ),
                ],
                None => vec![
                    "CREATE TRIGGER refuse_close BEFORE UPDATE ON alert_incidents \
                     WHEN NEW.id = 'inc-b' BEGIN SELECT RAISE(ABORT, 'the test refused this close'); END"
                        .to_string(),
                ],
            };
            for sql in refuse {
                db.execute_unprepared(&sql).await.unwrap();
            }

            assert_eq!(sweep(&db, now - HOUR).await, ["inc-a", "inc-c"], "{name}");
            assert_eq!(status(&db, "inc-b").await, "open", "{name}");
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn each_caller_keeps_its_own_guards_under_the_lock() {
        for (name, db, schema) in backends().await {
            let open = incident(&db, 100, |row| {
                row.muted_by_downtime_id = Set(Some("dt-1".to_string()));
            })
            .await;
            let GuardedClose::Closed { after, .. } =
                close(&db, &open, CloseCaller::OncallClose).await
            else {
                panic!("{name}: the on-call close resolves an open incident");
            };
            assert_eq!(
                (after.status.as_str(), after.resolved_at, after.updated_at),
                ("resolved", Some(500), 500),
                "{name}"
            );
            assert_eq!(after.muted_by_downtime_id, None, "{name}");
            assert_eq!(
                after.resolved_by.as_deref(),
                Some(SYSTEM_RESOLVER),
                "{name}"
            );
            let case = incident(&db, 100, |row| row.security_case = Set(true)).await;
            for caller in [
                CloseCaller::OncallClose,
                CloseCaller::ExternalAlert,
                CloseCaller::AlertRecovery,
            ] {
                let closed = close(&db, &case, caller).await;
                assert_eq!(kept(&closed), Some(KeptReason::SecurityCase), "{name}");
            }
            let missing = close(&db, "missing", CloseCaller::OncallClose).await;
            assert_eq!(kept(&missing), Some(KeptReason::Missing), "{name}");

            let fed = incident(&db, 100, |_| {}).await;
            link(&db, &fed, "e1", "external", false).await;
            link(&db, &fed, "e2", "external", false).await;
            external(&db, "e1", "resolved").await;
            external(&db, "e2", "firing").await;
            let closed = close(&db, &fed, CloseCaller::ExternalAlert).await;
            assert_eq!(kept(&closed), Some(KeptReason::ExternalFiring), "{name}");
            external_alerts::Entity::update_many()
                .col_expr(external_alerts::Column::State, Expr::value("resolved"))
                .filter(external_alerts::Column::Id.eq("e2"))
                .exec(&db)
                .await
                .unwrap();
            let closed = close(&db, &fed, CloseCaller::ExternalAlert).await;
            assert!(matches!(closed, GuardedClose::Closed { .. }), "{name}");

            let acked = incident(&db, 100, |row| {
                row.acknowledged_by = Set(Some("someone@example.com".to_string()));
            })
            .await;
            link(&db, &acked, "a1", "alert", true).await;
            let closed = close(&db, &acked, CloseCaller::AlertRecovery).await;
            assert_eq!(kept(&closed), Some(KeptReason::Owned), "{name}");
            link(&db, &acked, "a2", "alert", false).await;
            let closed = close(&db, &acked, CloseCaller::AlertRecovery).await;
            assert_eq!(kept(&closed), Some(KeptReason::FiringOpen), "{name}");
            let bare = incident(&db, 100, |_| {}).await;
            let closed = close(&db, &bare, CloseCaller::AlertRecovery).await;
            assert_eq!(kept(&closed), Some(KeptReason::NoFirings), "{name}");
            let closed = close(&db, &bare, CloseCaller::ExternalAlert).await;
            assert_eq!(kept(&closed), Some(KeptReason::NoFirings), "{name}");
            drop_schema(schema).await;
        }
    }
}
