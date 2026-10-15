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

//! Applies replicated rows through the table layer only, so applying never emits.

use std::{
    collections::HashMap,
    future::Future,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use infra::table::rum_pa::{
    self, Applied, FunnelRow, Funnels, NamedEventRow, NamedEvents, PaRow, PaTable,
};
use sea_orm::{ConnectionTrait, DbErr, RuntimeErr, TransactionTrait, sqlx};

use super::{
    RumPaError, is_id,
    service::{EVENTS_TABLE, FUNNELS_TABLE, REPLICATION_MODULE},
    sql_state, validate_app, validate_name,
};

/// Tries per delivery for a deadlock, serialization failure, lock wait or unique-index race.
const ATTEMPTS: u32 = 4;
const FIRST_BACKOFF: Duration = Duration::from_millis(50);
/// Failed deliveries per key on this node before it is acked; a lost connection never counts.
const MAX_DELIVERIES: u32 = 5;
/// A failure count idle this long is dropped; far above the queues' 30 s redelivery wait.
const FAILURE_TTL: Duration = Duration::from_secs(600);
/// The `created_by` and `updated_by` columns are `varchar(256)`.
const MAX_USER_CHARS: usize = 256;
/// The `org_id` columns are `varchar(256)`, as is `organizations.identifier`.
const MAX_ORG_CHARS: usize = 256;

static FAILED_DELIVERIES: LazyLock<Mutex<DeliveryFailures>> =
    LazyLock::new(|| Mutex::new(DeliveryFailures::default()));

/// What a message key names.
#[derive(Debug, PartialEq, Eq)]
enum Target {
    Org(String),
    Row {
        org: String,
        table: Table,
        id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Table {
    NamedEvents,
    Funnels,
}

/// The checks that keep the store from refusing a replicated row.
trait Replicated {
    fn check(&self) -> Result<(), RumPaError>;
}

impl Replicated for NamedEventRow {
    fn check(&self) -> Result<(), RumPaError> {
        check_common(
            &self.org_id,
            &self.app,
            &self.name,
            &self.created_by,
            &self.updated_by,
        )
    }
}

impl Replicated for FunnelRow {
    fn check(&self) -> Result<(), RumPaError> {
        check_common(
            &self.org_id,
            &self.app,
            &self.name,
            &self.created_by,
            &self.updated_by,
        )
    }
}

/// Consecutive failed deliveries per message key, with the time of the last one.
#[derive(Debug, Default)]
struct DeliveryFailures(HashMap<String, (u32, Instant)>);

impl DeliveryFailures {
    /// Maps an outcome to ack (`Ok`) or redeliver (`Err`), acking a key that keeps failing.
    fn settle(
        &mut self,
        key: &str,
        outcome: Result<(), DbErr>,
        now: Instant,
    ) -> Result<(), String> {
        self.0
            .retain(|_, (_, last)| now.duration_since(*last) < FAILURE_TTL);
        let e = match outcome {
            Ok(()) => {
                self.0.remove(key);
                return Ok(());
            }
            Err(e) if is_lost_connection(&e) => return Err(format!("rum_analytics {key}: {e}")),
            Err(e) => e,
        };
        let (deliveries, last) = self.0.entry(key.to_string()).or_insert((0, now));
        *deliveries += 1;
        *last = now;
        if *deliveries < MAX_DELIVERIES {
            return Err(format!(
                "rum_analytics {key}: delivery {deliveries} of {MAX_DELIVERIES} failed: {e}"
            ));
        }
        self.0.remove(key);
        log::error!(
            "[SUPER_CLUSTER:rum_analytics] gave up on {key} after {MAX_DELIVERIES} failed deliveries: {e}"
        );
        Ok(())
    }
}

/// A replicated write, as the queue delivers it.
#[derive(Debug, Clone, Copy)]
pub enum Op<'a> {
    Put(Option<&'a [u8]>),
    /// `version` is the deleted row's edit counter, carried in the message's `start_dt`.
    Delete {
        prefix: bool,
        version: Option<i64>,
    },
    Other,
}

/// `Err` leaves the message for redelivery; an invalid or repeatedly failing one is acked.
pub async fn apply<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    key: &str,
    op: Op<'_>,
) -> Result<(), String> {
    let Some(target) = parse_key(key) else {
        log::warn!("[SUPER_CLUSTER:rum_analytics] dropped a message with key {key}");
        return Ok(());
    };
    let outcome = with_retries(|| apply_once(db, &target, op)).await;
    settle(key, outcome)
}

/// `/rum_analytics/{org}/` or `/rum_analytics/{org}/{named_events|funnels}/{id}`.
fn parse_key(key: &str) -> Option<Target> {
    let rest = key.strip_prefix(&format!("/{REPLICATION_MODULE}/"))?;
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.as_slice() {
        [org, ""] if !org.is_empty() => Some(Target::Org(org.to_string())),
        [org, table, id] if !org.is_empty() && is_id(id) => Some(Target::Row {
            org: org.to_string(),
            table: match *table {
                EVENTS_TABLE => Table::NamedEvents,
                FUNNELS_TABLE => Table::Funnels,
                _ => return None,
            },
            id: id.to_string(),
        }),
        _ => None,
    }
}

/// One try; an invalid message is logged and is `Ok`, so only a store failure is an `Err`.
async fn apply_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    target: &Target,
    op: Op<'_>,
) -> Result<(), DbErr> {
    match (target, op) {
        (Target::Org(org), Op::Delete { prefix: true, .. }) => {
            rum_pa::apply_delete_org(db, org).await
        }
        (Target::Row { org, table, id }, Op::Put(value)) => put(db, org, *table, id, value).await,
        (
            Target::Row { org, table, id },
            Op::Delete {
                prefix: false,
                version,
            },
        ) => delete(db, org, *table, id, version).await,
        (target, other) => {
            log::warn!("[SUPER_CLUSTER:rum_analytics] dropped {other:?} for {target:?}");
            Ok(())
        }
    }
}

/// Runs `attempt` again, with doubling backoff, while it fails on a lock conflict and tries remain.
async fn with_retries<F, Fut>(mut attempt: F) -> Result<(), DbErr>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), DbErr>>,
{
    let mut backoff = FIRST_BACKOFF;
    for tried in 1..ATTEMPTS {
        match attempt().await {
            Err(e) if is_lock_conflict(&e) => {
                log::warn!(
                    "[SUPER_CLUSTER:rum_analytics] try {tried} of {ATTEMPTS} hit a lock conflict, retrying: {e}"
                );
                tokio::time::sleep(backoff).await;
                backoff *= 2;
            }
            other => return other,
        }
    }
    attempt().await
}

fn settle(key: &str, outcome: Result<(), DbErr>) -> Result<(), String> {
    FAILED_DELIVERIES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .settle(key, outcome, Instant::now())
}

/// A deadlock, serialization failure, lock wait or unique-index race; a retry can succeed.
fn is_lock_conflict(e: &DbErr) -> bool {
    let Some(code) = sql_state(e) else {
        return false;
    };
    // A SQLSTATE is always five characters; SQLite extended codes never reach five digits.
    if code.len() == 5 {
        return matches!(code.as_str(), "40P01" | "40001" | "55P03" | "23505");
    }
    // The low byte of a SQLite extended code is SQLITE_BUSY (5) or SQLITE_LOCKED (6).
    code.parse::<i64>()
        .is_ok_and(|sqlite| matches!(sqlite & 0xff, 5 | 6))
}

fn is_lost_connection(e: &DbErr) -> bool {
    match e {
        DbErr::Conn(_) | DbErr::ConnectionAcquire(_) => true,
        DbErr::Exec(RuntimeErr::SqlxError(inner)) | DbErr::Query(RuntimeErr::SqlxError(inner)) => {
            matches!(
                inner,
                sqlx::Error::Io(_)
                    | sqlx::Error::PoolTimedOut
                    | sqlx::Error::PoolClosed
                    | sqlx::Error::WorkerCrashed
            ) || sql_state(e).is_some_and(|code| code.starts_with("08") || code.starts_with("57P"))
        }
        _ => false,
    }
}

async fn put<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    org: &str,
    table: Table,
    id: &str,
    value: Option<&[u8]>,
) -> std::result::Result<(), DbErr> {
    let Some(value) = value else {
        log::warn!("[SUPER_CLUSTER:rum_analytics] put {org}/{id} carries no row");
        return Ok(());
    };
    let applied = match table {
        Table::NamedEvents => match row::<NamedEventRow>(org, id, value) {
            Some(row) => upsert::<NamedEvents, _>(db, row).await?,
            None => return Ok(()),
        },
        Table::Funnels => match row::<FunnelRow>(org, id, value) {
            Some(row) => upsert::<Funnels, _>(db, row).await?,
            None => return Ok(()),
        },
    };
    match applied {
        Applied::Renamed { id, name } => log::warn!(
            "[SUPER_CLUSTER:rum_analytics] name clash in {org}: {id} is now named {name:?} here"
        ),
        Applied::OtherApp => log::warn!(
            "[SUPER_CLUSTER:rum_analytics] dropped put {org}/{id}: the id is stored under another app"
        ),
        Applied::Written | Applied::Stale => {}
    }
    Ok(())
}

async fn upsert<T, C>(db: &C, row: T::Row) -> std::result::Result<Applied, DbErr>
where
    T: PaTable,
    T::Row: Replicated,
    C: ConnectionTrait + TransactionTrait,
{
    let app = row.app().to_string();
    rum_pa::apply_upsert::<T, _>(db, &app, row).await
}

/// The payload's row, if it parses, matches its key and fits the store's columns.
fn row<R: serde::de::DeserializeOwned + PaRow + Replicated>(
    org: &str,
    id: &str,
    value: &[u8],
) -> Option<R> {
    match serde_json::from_slice::<R>(value) {
        Ok(row) if row.org_id() != org || row.id() != id => {
            log::warn!("[SUPER_CLUSTER:rum_analytics] row does not match its key {org}/{id}");
            None
        }
        Ok(row) => match row.check() {
            Ok(()) => Some(row),
            Err(e) => {
                log::warn!("[SUPER_CLUSTER:rum_analytics] dropped invalid row {org}/{id}: {e:?}");
                None
            }
        },
        Err(e) => {
            log::warn!("[SUPER_CLUSTER:rum_analytics] unreadable row for {org}/{id}: {e}");
            None
        }
    }
}

fn check_common(
    org: &str,
    app: &str,
    name: &str,
    created_by: &str,
    updated_by: &str,
) -> Result<(), RumPaError> {
    if org.chars().count() > MAX_ORG_CHARS {
        return Err(RumPaError::InvalidBody(format!(
            "an org id is at most {MAX_ORG_CHARS} characters"
        )));
    }
    validate_app(Some(app))?;
    if validate_name(name)? != name {
        return Err(RumPaError::InvalidName("name is not trimmed".into()));
    }
    if [created_by, updated_by]
        .iter()
        .any(|user| user.chars().count() > MAX_USER_CHARS)
    {
        return Err(RumPaError::InvalidBody(format!(
            "a user is at most {MAX_USER_CHARS} characters"
        )));
    }
    Ok(())
}

/// The deleted row's version rides in `start_dt`; a delete without one is dropped.
async fn delete<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    org: &str,
    table: Table,
    id: &str,
    version: Option<i64>,
) -> std::result::Result<(), DbErr> {
    let Some(version) = version.and_then(|v| i32::try_from(v).ok()) else {
        log::warn!("[SUPER_CLUSTER:rum_analytics] delete {org}/{id} carries no version");
        return Ok(());
    };
    match table {
        Table::NamedEvents => rum_pa::apply_delete::<NamedEvents, _>(db, org, id, version).await?,
        Table::Funnels => rum_pa::apply_delete::<Funnels, _>(db, org, id, version).await?,
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        sync::atomic::{AtomicU32, Ordering},
        time::Instant,
    };

    use sea_orm::{ConnectOptions, Database, DatabaseConnection, EntityTrait, PaginatorTrait};

    use super::*;

    const ID: &str = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";

    /// A database error carrying only a SQLSTATE or SQLite code.
    #[derive(Debug)]
    struct Coded(&'static str);

    impl std::fmt::Display for Coded {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "injected {}", self.0)
        }
    }

    impl std::error::Error for Coded {}

    impl sqlx::error::DatabaseError for Coded {
        fn message(&self) -> &str {
            "injected"
        }

        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            Some(self.0.into())
        }

        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }

        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }

        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }

        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    fn coded(code: &'static str) -> DbErr {
        DbErr::Exec(RuntimeErr::SqlxError(sqlx::Error::Database(Box::new(
            Coded(code),
        ))))
    }

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        rum_pa::create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn event(org: &str, id: &str) -> NamedEventRow {
        NamedEventRow {
            id: id.into(),
            org_id: org.into(),
            app: "web".into(),
            name: "Signup".into(),
            name_key: "signup".into(),
            rules: serde_json::json!([]),
            version: 2,
            created_by: "a@x.io".into(),
            updated_by: "a@x.io".into(),
            created_at: 1,
            updated_at: 2,
        }
    }

    async fn put(db: &DatabaseConnection, key: &str, row: &NamedEventRow) {
        let value = serde_json::to_vec(row).unwrap();
        apply(db, key, Op::Put(Some(&value))).await.unwrap();
    }

    async fn rows(db: &DatabaseConnection, org: &str) -> usize {
        rum_pa::list::<NamedEvents, _>(db, org, "web")
            .await
            .unwrap()
            .len()
    }

    #[test]
    fn keys_parse_to_an_org_or_a_row() {
        assert_eq!(
            parse_key("/rum_analytics/acme/"),
            Some(Target::Org("acme".into()))
        );
        assert_eq!(
            parse_key(&format!("/rum_analytics/acme/funnels/{ID}")),
            Some(Target::Row {
                org: "acme".into(),
                table: Table::Funnels,
                id: ID.into()
            })
        );
        for bad in [
            format!("/rum_analytics/acme/dashboards/{ID}"),
            "/rum_analytics/acme/named_events/short".to_string(),
            format!("/rum_analytics//named_events/{ID}"),
            format!("/rum_analytics/acme/named_events/{ID}/x"),
            format!("/kv/acme/named_events/{ID}"),
        ] {
            assert_eq!(parse_key(&bad), None, "{bad}");
        }
    }

    #[tokio::test]
    async fn an_unknown_table_an_org_mismatch_or_a_bad_id_is_acked_and_writes_nothing() {
        let db = db().await;
        let row = event("acme", ID);
        for key in [
            format!("/rum_analytics/acme/dashboards/{ID}"),
            format!("/rum_analytics/other/named_events/{ID}"),
            "/rum_analytics/acme/named_events/bad-id".to_string(),
        ] {
            put(&db, &key, &row).await;
        }
        let key = format!("/rum_analytics/acme/named_events/{ID}");
        apply(&db, &key, Op::Put(Some(b"{not json"))).await.unwrap();
        apply(&db, &key, Op::Put(None)).await.unwrap();
        apply(&db, &key, Op::Other).await.unwrap();
        assert_eq!(rows(&db, "acme").await, 0);
        assert_eq!(rows(&db, "other").await, 0);
    }

    #[tokio::test]
    async fn a_put_applies_and_a_versioned_delete_removes() {
        let db = db().await;
        let key = format!("/rum_analytics/acme/named_events/{ID}");
        put(&db, &key, &event("acme", ID)).await;
        assert_eq!(rows(&db, "acme").await, 1);
        let delete_at = |version: Option<i64>| Op::Delete {
            prefix: false,
            version,
        };
        apply(&db, &key, delete_at(None)).await.unwrap();
        apply(&db, &key, delete_at(Some(1))).await.unwrap();
        assert_eq!(rows(&db, "acme").await, 1);
        apply(&db, &key, delete_at(Some(2))).await.unwrap();
        assert_eq!(rows(&db, "acme").await, 0);
    }

    #[tokio::test]
    async fn the_prefix_delete_empties_one_org() {
        let db = db().await;
        let other_id = "2A7YeEEBY3ABp3e2zS8iq9y7Ajz";
        put(
            &db,
            &format!("/rum_analytics/acme/named_events/{ID}"),
            &event("acme", ID),
        )
        .await;
        put(
            &db,
            &format!("/rum_analytics/keep/named_events/{other_id}"),
            &event("keep", other_id),
        )
        .await;
        let prefix = Op::Delete {
            prefix: true,
            version: None,
        };
        apply(&db, "/rum_analytics/acme/", prefix).await.unwrap();
        assert_eq!(rows(&db, "acme").await, 0);
        assert_eq!(rows(&db, "keep").await, 1);
    }

    #[test]
    fn a_service_key_round_trips_through_the_parser() {
        assert_eq!(
            parse_key(&super::super::service::row_key("acme", EVENTS_TABLE, ID)),
            Some(Target::Row {
                org: "acme".into(),
                table: Table::NamedEvents,
                id: ID.into()
            })
        );
        assert_eq!(
            parse_key(&super::super::service::org_key("acme")),
            Some(Target::Org("acme".into()))
        );
    }

    #[tokio::test]
    async fn a_deadlock_on_the_first_try_is_retried_and_the_row_lands() {
        let db = db().await;
        let key = format!("/rum_analytics/acme/named_events/{ID}");
        let target = parse_key(&key).unwrap();
        let value = serde_json::to_vec(&event("acme", ID)).unwrap();
        let tries = AtomicU32::new(0);
        let outcome = with_retries(|| async {
            if tries.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err(coded("40P01"));
            }
            apply_once(&db, &target, Op::Put(Some(&value))).await
        })
        .await;
        assert!(outcome.is_ok(), "{outcome:?}");
        assert_eq!(tries.load(Ordering::SeqCst), 2);
        assert_eq!(rows(&db, "acme").await, 1);
        assert_eq!(settle(&key, outcome), Ok(()));
    }

    #[tokio::test]
    async fn a_lock_conflict_on_every_try_stops_at_the_bound_and_other_errors_are_not_retried() {
        for (code, expected) in [
            ("40P01", ATTEMPTS),
            ("40001", ATTEMPTS),
            ("23505", ATTEMPTS),
            ("517", ATTEMPTS),
            ("6", ATTEMPTS),
            ("22001", 1),
            ("40002", 1),
            ("2067", 1),
        ] {
            let tries = AtomicU32::new(0);
            let outcome = with_retries(|| async {
                tries.fetch_add(1, Ordering::SeqCst);
                Err(coded(code))
            })
            .await;
            assert!(outcome.is_err(), "{code}");
            assert_eq!(tries.load(Ordering::SeqCst), expected, "{code}");
        }
    }

    #[test]
    fn a_lost_connection_redelivers_and_never_counts_toward_the_bound() {
        let key = "/rum_analytics/conn/named_events/x";
        for _ in 0..MAX_DELIVERIES * 2 {
            for lost in [
                DbErr::Conn(RuntimeErr::Internal("gone".into())),
                DbErr::Exec(RuntimeErr::SqlxError(sqlx::Error::PoolTimedOut)),
                coded("08006"),
                coded("57P01"),
            ] {
                assert!(settle(key, Err(lost)).is_err());
            }
        }
        let first = settle(key, Err(DbErr::Custom("x".into()))).unwrap_err();
        assert!(first.contains("delivery 1 of"), "{first}");
    }

    #[test]
    fn a_key_that_keeps_failing_redelivers_until_the_bound_then_is_acked() {
        let key = "/rum_analytics/poison/named_events/x";
        let fail = || Err(DbErr::Custom("value too long".into()));
        for _ in 1..MAX_DELIVERIES {
            assert!(settle(key, fail()).is_err());
        }
        assert_eq!(settle(key, fail()), Ok(()));
        assert!(
            settle(key, fail()).is_err(),
            "the count restarts after giving up"
        );
    }

    #[test]
    fn a_success_resets_the_failure_count() {
        let key = "/rum_analytics/flaky/named_events/x";
        let fail = || Err(DbErr::Custom("flaky".into()));
        for _ in 1..MAX_DELIVERIES {
            assert!(settle(key, fail()).is_err());
        }
        assert_eq!(settle(key, Ok(())), Ok(()));
        for _ in 1..MAX_DELIVERIES {
            assert!(settle(key, fail()).is_err());
        }
    }

    #[tokio::test]
    async fn a_row_the_store_would_refuse_is_acked_and_writes_nothing() {
        let db = db().await;
        let key = format!("/rum_analytics/acme/named_events/{ID}");
        let base = event("acme", ID);
        for bad in [
            NamedEventRow {
                name: "\u{130}".repeat(65),
                ..base.clone()
            },
            NamedEventRow {
                name: " Signup".into(),
                ..base.clone()
            },
            NamedEventRow {
                app: String::new(),
                ..base.clone()
            },
            NamedEventRow {
                updated_by: "u".repeat(257),
                ..base.clone()
            },
        ] {
            put(&db, &key, &bad).await;
        }
        let long_org = "o".repeat(MAX_ORG_CHARS + 1);
        put(
            &db,
            &format!("/rum_analytics/{long_org}/named_events/{ID}"),
            &event(&long_org, ID),
        )
        .await;
        assert_eq!(NamedEvents::find().count(&db).await.unwrap(), 0);
        let widest_org = "o".repeat(MAX_ORG_CHARS);
        put(
            &db,
            &format!("/rum_analytics/{widest_org}/named_events/{ID}"),
            &event(&widest_org, ID),
        )
        .await;
        assert_eq!(rows(&db, &widest_org).await, 1);
    }

    #[test]
    fn a_key_abandoned_before_the_bound_is_forgotten_after_the_ttl() {
        let mut failures = DeliveryFailures::default();
        let start = Instant::now();
        let fail = || Err(DbErr::Custom("value too long".into()));
        for _ in 1..MAX_DELIVERIES {
            assert!(failures.settle("abandoned", fail(), start).is_err());
        }
        assert!(failures.settle("other", fail(), start).is_err());
        assert_eq!(failures.0.len(), 2);
        let later = start + FAILURE_TTL;
        assert_eq!(failures.settle("fresh", Ok(()), later), Ok(()));
        assert!(failures.0.is_empty(), "{:?}", failures.0);
        let restarted = failures.settle("abandoned", fail(), later).unwrap_err();
        assert!(restarted.contains("delivery 1 of"), "{restarted}");
    }

    #[test]
    fn redeliveries_an_ack_wait_apart_keep_their_count_until_the_bound() {
        let mut failures = DeliveryFailures::default();
        let ack_wait = Duration::from_secs(30);
        let mut now = Instant::now();
        let fail = || Err(DbErr::Custom("value too long".into()));
        for _ in 1..MAX_DELIVERIES {
            assert!(failures.settle("poison", fail(), now).is_err());
            now += ack_wait;
        }
        assert_eq!(failures.settle("poison", fail(), now), Ok(()));
        assert!(failures.0.is_empty());
    }

    #[tokio::test]
    async fn the_stored_name_key_is_derived_from_the_name() {
        let db = db().await;
        let key = format!("/rum_analytics/acme/named_events/{ID}");
        let row = NamedEventRow {
            name_key: "something else".into(),
            ..event("acme", ID)
        };
        put(&db, &key, &row).await;
        let stored = rum_pa::get::<NamedEvents, _>(&db, "acme", "web", ID)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.name_key, "signup");
    }
}
