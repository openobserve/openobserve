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

//! Table ops for the certificates of custom domains: certificate rows with their holder claim and
//! page, pending challenges, the manager row and the listener heartbeats.
//!
//! The certificate store reads these on the primary, so callers pass the write connection. Every
//! function takes a connection or a transaction; none opens one.

use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, DatabaseTransaction, EntityTrait,
    FromQueryResult, IntoActiveModel, JoinType, PaginatorTrait, QueryFilter, QueryOrder,
    QueryResult, QuerySelect, Select, TransactionTrait, TryInsertResult,
    prelude::Expr,
    sea_query::{Alias, OnConflict, Query},
};

use super::entity::{
    status_page_custom_domains as claims, status_page_domain_acme_accounts as accounts,
    status_page_domain_certs as certs, status_page_domain_challenges as challenges,
    status_page_domain_listeners as listeners, status_page_domain_manager as manager,
    status_page_domain_orders as orders, status_page_domain_revocations as revocations,
    status_page_snapshots, status_pages,
};
use crate::errors;

static CERTS_GATE: OnceLock<fn() -> bool> = OnceLock::new();

#[cfg(test)]
thread_local! {
    static FORCED: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// The one row of `status_page_domain_manager`.
pub const MANAGER_ID: i32 = 1;

/// How long a lease lasts; the manager renews it every 20 seconds.
pub const LEASE_MICROS: i64 = 60 * 1_000_000;
/// A listener is reporting while its row was written within this long.
pub const LISTENER_SEEN_MICROS: i64 = 60 * 1_000_000;
/// A listener is reporting while its store synced within this long.
pub const LISTENER_SYNCED_MICROS: i64 = 5 * 60 * 1_000_000;
const HOUR_MICROS: i64 = 3_600 * 1_000_000;
const DAY_MICROS: i64 = 24 * HOUR_MICROS;
const WEEK_MICROS: i64 = 7 * DAY_MICROS;
const KEPT_MICROS: i64 = 30 * DAY_MICROS;
const LISTENER_KEPT_MICROS: i64 = DAY_MICROS;
const PAGE_ID_CHUNK: usize = 500;

pub const ORDER_FIRST: &str = "first";
pub const ORDER_RENEWAL: &str = "renewal";
pub const ORDER_TARGET: &str = "target";
pub const ORDER_STARTED: &str = "started";
pub const ORDER_FINALIZE_SENT: &str = "finalize_sent";
pub const ORDER_DONE: &str = "done";
pub const ORDER_FAILED: &str = "failed";
pub const ORDER_ABANDONED: &str = "abandoned";
/// Outcome prefixes of orders that failed or were abandoned after the finalize call was sent.
pub const OUTCOME_FINALIZE_FAILED: &str = "finalize_failed";
pub const OUTCOME_ABANDONED_AFTER_FINALIZE: &str = "abandoned_after_finalize";
/// Outcome of an issued order whose challenge the CA validated during the order.
pub const OUTCOME_ISSUED: &str = "issued";
/// Outcome of an issued order for which the CA reused an earlier authorization.
pub const OUTCOME_ISSUED_REUSED: &str = "issued_authorization_reused";

pub const REVOCATION_WAITING: &str = "waiting";
pub const REVOCATION_DONE: &str = "done";
pub const REVOCATION_GAVE_UP: &str = "gave_up";

/// The holder claim of a hostname and its page, as the store needs them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HolderPage {
    pub claim_id: String,
    pub org_id: String,
    pub page_id: String,
    pub slug: String,
}

/// A certificate row; `holder` is set only when the claim it names still holds the hostname and
/// its page exists.
#[derive(Clone, Debug, PartialEq)]
pub struct CertRow {
    pub cert: certs::Model,
    pub holder: Option<HolderPage>,
}

impl FromQueryResult for CertRow {
    fn from_query_result(res: &QueryResult, pre: &str) -> Result<Self, sea_orm::DbErr> {
        let cert = certs::Model::from_query_result(res, pre)?;
        let text = |column: &str| res.try_get::<Option<String>>(pre, column);
        let holder = match (
            text("holder_claim_id")?,
            text("holder_org_id")?,
            text("holder_page_id")?,
            text("holder_slug")?,
        ) {
            (Some(claim_id), Some(org_id), Some(page_id), Some(slug)) => Some(HolderPage {
                claim_id,
                org_id,
                page_id,
                slug,
            }),
            _ => None,
        };
        Ok(Self { cert, holder })
    }
}

/// A pending challenge; `claim_is_holder` says its claim holds its hostname right now.
#[derive(Clone, Debug, PartialEq)]
pub struct ChallengeRow {
    pub challenge: challenges::Model,
    pub claim_is_holder: bool,
}

impl FromQueryResult for ChallengeRow {
    fn from_query_result(res: &QueryResult, pre: &str) -> Result<Self, sea_orm::DbErr> {
        Ok(Self {
            challenge: challenges::Model::from_query_result(res, pre)?,
            claim_is_holder: res
                .try_get::<Option<String>>(pre, "holder_claim_id")?
                .is_some(),
        })
    }
}

/// The hostname, registered domain and org an order is counted against.
#[derive(Clone, Copy, Debug)]
pub struct OrderSubject<'a> {
    pub hostname: &'a str,
    pub registered_domain: &'a str,
    pub org_id: &'a str,
}

/// The order counts of D §9 for one subject.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OrderCounts {
    pub installation_hour: u64,
    pub org_day: u64,
    pub registered_domain_week: u64,
    pub hostname_week: u64,
    pub validation_attempts_hour: u64,
}

/// One count of D §9, by what it counts and over which window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderLimit {
    InstallationHour,
    OrgDay,
    /// Across the installation: the CA counts a registered domain whichever org orders.
    RegisteredDomainWeek,
    HostnameWeek,
    AttemptsHour,
}

impl OrderLimit {
    fn window(self) -> i64 {
        match self {
            OrderLimit::InstallationHour | OrderLimit::AttemptsHour => HOUR_MICROS,
            OrderLimit::OrgDay => DAY_MICROS,
            OrderLimit::RegisteredDomainWeek | OrderLimit::HostnameWeek => WEEK_MICROS,
        }
    }
}

/// What the manager reads of a holder's page for row 7.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageState {
    /// 0 draft, 1 public, 2 password.
    pub visibility: i32,
    /// The page has a snapshot, so the public route can answer for it.
    pub built: bool,
}

/// Every certificate row with its holder and page.
pub async fn list_certs<C: ConnectionTrait>(conn: &C) -> Result<Vec<CertRow>, errors::Error> {
    Ok(certs_with_holder()
        .order_by_asc(certs::Column::Hostname)
        .into_model::<CertRow>()
        .all(conn)
        .await?)
}

pub async fn get_cert<C: ConnectionTrait>(
    conn: &C,
    hostname: &str,
) -> Result<Option<CertRow>, errors::Error> {
    Ok(certs_with_holder()
        .filter(certs::Column::Hostname.eq(hostname))
        .into_model::<CertRow>()
        .one(conn)
        .await?)
}

/// Inserts the row, or replaces every column but `created_at` of the hostname's row.
pub async fn upsert_cert<C: ConnectionTrait>(
    conn: &C,
    model: &certs::Model,
) -> Result<(), errors::Error> {
    use certs::Column;
    let replace = OnConflict::column(Column::Hostname)
        .update_columns([
            Column::ClaimId,
            Column::OrgId,
            Column::CaDirectory,
            Column::CertChain,
            Column::PrivateKey,
            Column::Fingerprint,
            Column::PreviousFingerprint,
            Column::NotBefore,
            Column::NotAfter,
            Column::RenewAt,
            Column::Source,
            Column::UpdatedAt,
        ])
        .to_owned();
    certs::Entity::insert(model.clone().into_active_model())
        .on_conflict(replace)
        .exec(conn)
        .await?;
    Ok(())
}

/// Deletes a hostname's row; false when there was none.
pub async fn delete_cert<C: ConnectionTrait>(
    conn: &C,
    hostname: &str,
) -> Result<bool, errors::Error> {
    let deleted = certs::Entity::delete_many()
        .filter(certs::Column::Hostname.eq(hostname))
        .exec(conn)
        .await?;
    Ok(deleted.rows_affected > 0)
}

/// Deletes a hostname's row only while it still holds `private_key`, the ciphertext the caller
/// inspected: a certificate issued meanwhile stays. False when nothing went.
pub async fn delete_cert_sealed_as<C: ConnectionTrait>(
    conn: &C,
    hostname: &str,
    private_key: &str,
) -> Result<bool, errors::Error> {
    let deleted = certs::Entity::delete_many()
        .filter(certs::Column::Hostname.eq(hostname))
        .filter(certs::Column::PrivateKey.eq(private_key))
        .exec(conn)
        .await?;
    Ok(deleted.rows_affected > 0)
}

/// Challenges that have not expired at `now`. The store reads only; the manager writes them.
pub async fn list_live_challenges<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<Vec<ChallengeRow>, errors::Error> {
    let mut select = challenges::Entity::find()
        .filter(challenges::Column::ExpiresAt.gt(now))
        .order_by_asc(challenges::Column::Hostname)
        .column_as(Expr::col((holder(), claims::Column::Id)), "holder_claim_id");
    QuerySelect::query(&mut select).join_as(
        JoinType::LeftJoin,
        claims::Entity,
        holder(),
        unreleased_holder_of(
            Expr::col((challenges::Entity, challenges::Column::Hostname)),
            Expr::col((challenges::Entity, challenges::Column::ClaimId)),
        ),
    );
    Ok(select.into_model::<ChallengeRow>().all(conn).await?)
}

pub async fn get_manager<C: ConnectionTrait>(
    conn: &C,
) -> Result<Option<manager::Model>, errors::Error> {
    Ok(manager::Entity::find_by_id(MANAGER_ID).one(conn).await?)
}

/// Stores the key check value only while none is stored and the manager is at `epoch`.
pub async fn set_key_check_if_unset<C: ConnectionTrait>(
    conn: &C,
    key_check: &str,
    epoch: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    let set = manager::Entity::update_many()
        .col_expr(manager::Column::KeyCheck, Expr::value(key_check))
        .col_expr(manager::Column::UpdatedAt, Expr::value(now))
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .filter(manager::Column::Epoch.eq(epoch))
        .filter(manager::Column::KeyCheck.is_null())
        .exec(conn)
        .await?;
    Ok(set.rows_affected > 0)
}

/// Locks the claim's row while it still holds `hostname`; false when it no longer does.
pub async fn lock_holder<C: ConnectionTrait>(
    conn: &C,
    claim_id: &str,
    hostname: &str,
) -> Result<bool, errors::Error> {
    let touched = claims::Entity::update_many()
        .col_expr(
            claims::Column::UpdatedAt,
            Expr::col(claims::Column::UpdatedAt).into(),
        )
        .filter(claims::Column::Id.eq(claim_id))
        .filter(claims::Column::HeldDomain.eq(hostname))
        .filter(claims::Column::ReleasedAt.is_null())
        .filter(claims::Column::ReleaseSeal.is_null())
        .exec(conn)
        .await?;
    Ok(touched.rows_affected > 0)
}

/// Whether the Enterprise store is on here, by the one decision it registered; off until then.
pub fn certs_enabled() -> bool {
    #[cfg(test)]
    if let Some(forced) = FORCED.with(std::cell::Cell::get) {
        return forced;
    }
    CERTS_GATE.get().is_some_and(|gate| gate())
}

/// The Enterprise store registers its enablement here; the OSS build never does.
pub fn set_certs_gate(gate: fn() -> bool) {
    let _ = CERTS_GATE.set(gate);
}

/// Makes `certs_enabled` answer `on` on this test's thread.
#[cfg(test)]
pub(crate) fn force_certs_for_tests(on: bool) {
    FORCED.with(|forced| forced.set(Some(on)));
}

/// Inserts the node's heartbeat row, or replaces what the node reported before.
pub async fn upsert_listener<C: ConnectionTrait>(
    conn: &C,
    model: &listeners::Model,
) -> Result<(), errors::Error> {
    use listeners::Column;
    let replace = OnConflict::column(Column::NodeUuid)
        .update_columns([
            Column::NodeName,
            Column::Address,
            Column::LastSeenAt,
            Column::CertsLoaded,
            Column::LastSyncAt,
            Column::PrivatePeersOnly,
        ])
        .to_owned();
    listeners::Entity::insert(model.clone().into_active_model())
        .on_conflict(replace)
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn list_listeners<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<listeners::Model>, errors::Error> {
    Ok(listeners::Entity::find()
        .order_by_asc(listeners::Column::NodeUuid)
        .all(conn)
        .await?)
}

/// Takes or keeps the lease while no other owner holds it; expiry is judged on database time.
pub async fn acquire_lease<C: ConnectionTrait>(
    conn: &C,
    owner: &str,
    lease_micros: i64,
) -> Result<bool, errors::Error> {
    let now = db_now(conn);
    let free = Condition::any()
        .add(manager::Column::LeaseOwner.is_null())
        .add(manager::Column::LeaseOwner.eq(owner))
        .add(Expr::col(manager::Column::LeaseExpiresAt).lte(Expr::cust(now)));
    let taken = manager::Entity::update_many()
        .col_expr(manager::Column::LeaseOwner, Expr::value(owner))
        .col_expr(
            manager::Column::LeaseExpiresAt,
            Expr::cust(format!("{now} + {lease_micros}")),
        )
        .col_expr(manager::Column::UpdatedAt, Expr::cust(now))
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .filter(free)
        .exec(conn)
        .await?;
    Ok(taken.rows_affected > 0)
}

/// Renews the lease only while `owner` holds it and it has not expired; false means stop.
pub async fn renew_lease<C: ConnectionTrait>(
    conn: &C,
    owner: &str,
    lease_micros: i64,
) -> Result<bool, errors::Error> {
    let now = db_now(conn);
    let renewed = manager::Entity::update_many()
        .col_expr(
            manager::Column::LeaseExpiresAt,
            Expr::cust(format!("{now} + {lease_micros}")),
        )
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .filter(manager::Column::LeaseOwner.eq(owner))
        .filter(Expr::col(manager::Column::LeaseExpiresAt).gt(Expr::cust(now)))
        .exec(conn)
        .await?;
    Ok(renewed.rows_affected > 0)
}

/// A transaction whose first statement renewed the lease; `None` when the lease is lost.
pub async fn begin_fenced<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    owner: &str,
) -> Result<Option<DatabaseTransaction>, errors::Error> {
    let txn = conn.begin().await?;
    if !renew_lease(&txn, owner, LEASE_MICROS).await? {
        txn.rollback().await?;
        return Ok(None);
    }
    Ok(Some(txn))
}

/// Writes the installation status text of the manager row.
pub async fn write_installation_status<C: ConnectionTrait>(
    conn: &C,
    status: &str,
    now: i64,
) -> Result<(), errors::Error> {
    manager::Entity::update_many()
        .col_expr(manager::Column::InstallationStatus, Expr::value(status))
        .col_expr(manager::Column::UpdatedAt, Expr::value(now))
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .exec(conn)
        .await?;
    Ok(())
}

/// Every unreleased claim that holds its hostname.
pub async fn list_holders<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<claims::Model>, errors::Error> {
    Ok(claims::Entity::find()
        .filter(claims::Column::HeldDomain.is_not_null())
        .filter(claims::Column::ReleasedAt.is_null())
        .filter(claims::Column::ReleaseSeal.is_null())
        .order_by_asc(claims::Column::Id)
        .all(conn)
        .await?)
}

/// The visibility and the snapshot of each page among `ids` that still exists.
pub async fn page_states<C: ConnectionTrait>(
    conn: &C,
    ids: &[String],
) -> Result<HashMap<String, PageState>, errors::Error> {
    let mut found = HashMap::new();
    for chunk in ids.chunks(PAGE_ID_CHUNK) {
        let pages: Vec<(String, i32)> = status_pages::Entity::find()
            .select_only()
            .column(status_pages::Column::Id)
            .column(status_pages::Column::Visibility)
            .filter(status_pages::Column::Id.is_in(chunk.to_vec()))
            .into_tuple()
            .all(conn)
            .await?;
        let built: HashSet<String> = status_page_snapshots::Entity::find()
            .select_only()
            .column(status_page_snapshots::Column::StatusPageId)
            .filter(status_page_snapshots::Column::StatusPageId.is_in(chunk.to_vec()))
            .into_tuple()
            .all(conn)
            .await?
            .into_iter()
            .collect();
        for (id, visibility) in pages {
            let built = built.contains(&id);
            found.insert(id, PageState { visibility, built });
        }
    }
    Ok(found)
}

/// When each org last started an order, for taking turns.
pub async fn last_order_times<C: ConnectionTrait>(
    conn: &C,
) -> Result<HashMap<String, i64>, errors::Error> {
    let rows: Vec<(String, i64)> = orders::Entity::find()
        .select_only()
        .column(orders::Column::OrgId)
        .column_as(orders::Column::CreatedAt.max(), "last_at")
        .filter(orders::Column::OrgId.is_not_null())
        .group_by(orders::Column::OrgId)
        .into_tuple()
        .all(conn)
        .await?;
    Ok(rows.into_iter().collect())
}

/// Listeners that count for the installation check and the probe at `now`.
pub async fn list_reporting_listeners<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<Vec<listeners::Model>, errors::Error> {
    Ok(listeners::Entity::find()
        .filter(listeners::Column::LastSeenAt.gte(now - LISTENER_SEEN_MICROS))
        .filter(listeners::Column::LastSyncAt.gte(now - LISTENER_SYNCED_MICROS))
        .order_by_asc(listeners::Column::NodeUuid)
        .all(conn)
        .await?)
}

/// Deletes what C5 says the manager purges once a cycle; returns how many rows went.
pub async fn purge_old_rows<C: ConnectionTrait>(conn: &C, now: i64) -> Result<u64, errors::Error> {
    let mut gone = listeners::Entity::delete_many()
        .filter(listeners::Column::LastSeenAt.lt(now - LISTENER_KEPT_MICROS))
        .exec(conn)
        .await?
        .rows_affected;
    gone += orders::Entity::delete_many()
        .filter(orders::Column::CreatedAt.lt(now - KEPT_MICROS))
        .exec(conn)
        .await?
        .rows_affected;
    gone += revocations::Entity::delete_many()
        .filter(revocations::Column::State.is_in([REVOCATION_DONE, REVOCATION_GAVE_UP]))
        .filter(revocations::Column::UpdatedAt.lt(now - KEPT_MICROS))
        .exec(conn)
        .await?
        .rows_affected;
    gone += challenges::Entity::delete_many()
        .filter(challenges::Column::ExpiresAt.lt(now))
        .exec(conn)
        .await?
        .rows_affected;
    Ok(gone)
}

/// Moves the renewal time of the certificate with this fingerprint; false when it was replaced.
/// `updated_at` stays, so the probe evidence of the certificate keeps counting.
pub async fn set_renew_at<C: ConnectionTrait>(
    conn: &C,
    (hostname, fingerprint): (&str, &str),
    renew_at: i64,
) -> Result<bool, errors::Error> {
    let moved = certs::Entity::update_many()
        .col_expr(certs::Column::RenewAt, Expr::value(renew_at))
        .filter(certs::Column::Hostname.eq(hostname))
        .filter(certs::Column::Fingerprint.eq(fingerprint))
        .exec(conn)
        .await?;
    Ok(moved.rows_affected > 0)
}

pub async fn insert_order<C: ConnectionTrait>(
    conn: &C,
    model: &orders::Model,
) -> Result<(), errors::Error> {
    orders::Entity::insert(model.clone().into_active_model())
        .exec(conn)
        .await?;
    Ok(())
}

/// Moves an order to `state`; the URL and outcome are written only when given.
pub async fn update_order<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    state: &str,
    (order_url, outcome): (Option<&str>, Option<&str>),
    now: i64,
) -> Result<(), errors::Error> {
    let mut update = orders::Entity::update_many()
        .col_expr(orders::Column::State, Expr::value(state))
        .col_expr(orders::Column::UpdatedAt, Expr::value(now))
        .filter(orders::Column::Id.eq(id));
    if let Some(url) = order_url {
        update = update.col_expr(orders::Column::OrderUrl, Expr::value(url));
    }
    if let Some(outcome) = outcome {
        update = update.col_expr(orders::Column::Outcome, Expr::value(outcome));
    }
    update.exec(conn).await?;
    Ok(())
}

/// Orders that have not ended, oldest first.
pub async fn list_open_orders<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<orders::Model>, errors::Error> {
    Ok(orders::Entity::find()
        .filter(orders::Column::State.is_in([ORDER_STARTED, ORDER_FINALIZE_SENT]))
        .order_by_asc(orders::Column::CreatedAt)
        .all(conn)
        .await?)
}

/// Marks open orders created before `cutoff` abandoned; one that reached the finalize call keeps
/// counting toward the weekly limits.
pub async fn abandon_stale_orders<C: ConnectionTrait>(
    conn: &C,
    cutoff: i64,
    now: i64,
) -> Result<u64, errors::Error> {
    let mut gone = 0;
    for (from, outcome) in [
        (ORDER_FINALIZE_SENT, OUTCOME_ABANDONED_AFTER_FINALIZE),
        (ORDER_STARTED, ORDER_ABANDONED),
    ] {
        gone += orders::Entity::update_many()
            .col_expr(orders::Column::State, Expr::value(ORDER_ABANDONED))
            .col_expr(orders::Column::Outcome, Expr::value(outcome))
            .col_expr(orders::Column::UpdatedAt, Expr::value(now))
            .filter(orders::Column::State.eq(from))
            .filter(orders::Column::CreatedAt.lt(cutoff))
            .exec(conn)
            .await?
            .rows_affected;
    }
    Ok(gone)
}

/// The newest orders of a hostname, newest first.
pub async fn list_hostname_orders<C: ConnectionTrait>(
    conn: &C,
    hostname: &str,
    limit: u64,
) -> Result<Vec<orders::Model>, errors::Error> {
    Ok(orders::Entity::find()
        .filter(orders::Column::Hostname.eq(hostname))
        .order_by_desc(orders::Column::CreatedAt)
        .limit(limit)
        .all(conn)
        .await?)
}

/// The newest orders that ended, of any hostname, newest first.
pub async fn list_ended_orders<C: ConnectionTrait>(
    conn: &C,
    limit: u64,
) -> Result<Vec<orders::Model>, errors::Error> {
    Ok(orders::Entity::find()
        .filter(orders::Column::State.is_in([ORDER_DONE, ORDER_FAILED]))
        .order_by_desc(orders::Column::UpdatedAt)
        .limit(limit)
        .all(conn)
        .await?)
}

/// The counts of D §9 for a subject at `now`; every order counts toward the hourly and daily
/// ones, only those that reached the finalize call toward the weekly ones.
pub async fn order_counts<C: ConnectionTrait>(
    conn: &C,
    subject: &OrderSubject<'_>,
    now: i64,
) -> Result<OrderCounts, errors::Error> {
    let count = |limit| counted(limit, subject, now).count(conn);
    Ok(OrderCounts {
        installation_hour: count(OrderLimit::InstallationHour).await?,
        org_day: count(OrderLimit::OrgDay).await?,
        registered_domain_week: count(OrderLimit::RegisteredDomainWeek).await?,
        hostname_week: count(OrderLimit::HostnameWeek).await?,
        validation_attempts_hour: count(OrderLimit::AttemptsHour).await?,
    })
}

/// When a count that stands at `allowed` or more lets one more order through: the moment the
/// `allowed`-th newest counted order leaves the window. `None` when fewer are counted.
pub async fn slot_free_at<C: ConnectionTrait>(
    conn: &C,
    subject: &OrderSubject<'_>,
    (limit, allowed): (OrderLimit, u64),
    now: i64,
) -> Result<Option<i64>, errors::Error> {
    let Some(offset) = allowed.checked_sub(1) else {
        return Ok(None);
    };
    let leaving: Option<i64> = counted(limit, subject, now)
        .select_only()
        .column(orders::Column::CreatedAt)
        .order_by_desc(orders::Column::CreatedAt)
        .offset(offset)
        .limit(1)
        .into_tuple()
        .one(conn)
        .await?;
    Ok(leaving.map(|created_at| created_at + limit.window()))
}

/// Hostnames' validation attempts in the last hour, for the hostnames among `hostnames`.
pub async fn count_attempts_by_hostname<C: ConnectionTrait>(
    conn: &C,
    hostnames: &[String],
    now: i64,
) -> Result<std::collections::HashMap<String, u64>, errors::Error> {
    let rows: Vec<String> = orders::Entity::find()
        .select_only()
        .column(orders::Column::Hostname)
        .filter(orders::Column::Hostname.is_in(hostnames.to_vec()))
        .filter(orders::Column::CreatedAt.gt(now - HOUR_MICROS))
        .into_tuple()
        .all(conn)
        .await?;
    let mut counts = std::collections::HashMap::new();
    for hostname in rows {
        *counts.entry(hostname).or_insert(0) += 1;
    }
    Ok(counts)
}

pub async fn upsert_challenge<C: ConnectionTrait>(
    conn: &C,
    model: &challenges::Model,
) -> Result<(), errors::Error> {
    use challenges::Column;
    let replace = OnConflict::column(Column::Hostname)
        .update_columns([
            Column::ClaimId,
            Column::Token,
            Column::KeyAuthDigest,
            Column::ExpiresAt,
            Column::CreatedAt,
        ])
        .to_owned();
    challenges::Entity::insert(model.clone().into_active_model())
        .on_conflict(replace)
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn get_challenge<C: ConnectionTrait>(
    conn: &C,
    hostname: &str,
) -> Result<Option<challenges::Model>, errors::Error> {
    Ok(challenges::Entity::find_by_id(hostname).one(conn).await?)
}

pub async fn delete_challenge<C: ConnectionTrait>(
    conn: &C,
    hostname: &str,
) -> Result<(), errors::Error> {
    challenges::Entity::delete_by_id(hostname)
        .exec(conn)
        .await?;
    Ok(())
}

/// Queues the certificate for revocation unless it was imported, which another CA account issued.
pub async fn queue_revocation_of<C: ConnectionTrait>(
    conn: &C,
    cert: &certs::Model,
    now: i64,
) -> Result<bool, errors::Error> {
    if cert.source == "imported" {
        return Ok(false);
    }
    let row = revocations::Model {
        id: config::ider::generate(),
        hostname: cert.hostname.clone(),
        cert_chain: cert.cert_chain.clone(),
        ca_directory: cert.ca_directory.clone(),
        state: REVOCATION_WAITING.to_string(),
        attempts: 0,
        created_at: now,
        updated_at: now,
    };
    revocations::Entity::insert(row.into_active_model())
        .exec(conn)
        .await?;
    Ok(true)
}

pub async fn list_waiting_revocations<C: ConnectionTrait>(
    conn: &C,
    limit: u64,
) -> Result<Vec<revocations::Model>, errors::Error> {
    Ok(revocations::Entity::find()
        .filter(revocations::Column::State.eq(REVOCATION_WAITING))
        .order_by_asc(revocations::Column::CreatedAt)
        .limit(limit)
        .all(conn)
        .await?)
}

pub async fn update_revocation<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    (state, attempts): (&str, i32),
    now: i64,
) -> Result<(), errors::Error> {
    revocations::Entity::update_many()
        .col_expr(revocations::Column::State, Expr::value(state))
        .col_expr(revocations::Column::Attempts, Expr::value(attempts))
        .col_expr(revocations::Column::UpdatedAt, Expr::value(now))
        .filter(revocations::Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn get_account<C: ConnectionTrait>(
    conn: &C,
    ca_directory: &str,
) -> Result<Option<accounts::Model>, errors::Error> {
    Ok(accounts::Entity::find_by_id(ca_directory).one(conn).await?)
}

/// Stores the account unless the directory has one already; false when another node was first.
pub async fn insert_account<C: ConnectionTrait>(
    conn: &C,
    model: &accounts::Model,
) -> Result<bool, errors::Error> {
    let keep = OnConflict::column(accounts::Column::CaDirectory)
        .do_nothing()
        .to_owned();
    let inserted = accounts::Entity::insert(model.clone().into_active_model())
        .on_conflict(keep)
        .do_nothing()
        .exec_without_returning(conn)
        .await?;
    Ok(matches!(inserted, TryInsertResult::Inserted(rows) if rows > 0))
}

pub async fn list_accounts<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<accounts::Model>, errors::Error> {
    Ok(accounts::Entity::find().all(conn).await?)
}

/// Removes a directory's account only while it still holds `credentials`, the ciphertext the
/// caller inspected: an account another node registered meanwhile stays. False when nothing went.
pub async fn delete_account_sealed_as<C: ConnectionTrait>(
    conn: &C,
    ca_directory: &str,
    credentials: &str,
) -> Result<bool, errors::Error> {
    let gone = accounts::Entity::delete_many()
        .filter(accounts::Column::CaDirectory.eq(ca_directory))
        .filter(accounts::Column::Credentials.eq(credentials))
        .exec(conn)
        .await?;
    Ok(gone.rows_affected > 0)
}

/// The final certificate write. The claim is touched first, so a release that committed before
/// it, or one that waits on it, decides: `false` means the claim no longer holds the hostname and
/// nothing was written.
pub async fn write_certificate<C: ConnectionTrait>(
    conn: &C,
    model: &certs::Model,
) -> Result<bool, errors::Error> {
    if let Some(claim_id) = &model.claim_id
        && !lock_holder(conn, claim_id, &model.hostname).await?
    {
        return Ok(false);
    }
    let mut row = model.clone();
    row.previous_fingerprint = certs::Entity::find_by_id(&model.hostname)
        .one(conn)
        .await?
        .map(|old| old.fingerprint)
        .filter(|old| *old != row.fingerprint);
    upsert_cert(conn, &row).await?;
    Ok(true)
}

/// Holders by the serving state the manager stored; `None` is a holder it has not judged yet.
pub async fn count_holders_by_state<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<(Option<String>, i64)>, errors::Error> {
    Ok(claims::Entity::find()
        .select_only()
        .column(claims::Column::ServingState)
        .column_as(claims::Column::Id.count(), "holders")
        .filter(claims::Column::HeldDomain.is_not_null())
        .filter(claims::Column::ReleasedAt.is_null())
        .filter(claims::Column::ReleaseSeal.is_null())
        .group_by(claims::Column::ServingState)
        .into_tuple()
        .all(conn)
        .await?)
}

/// When the proof of the holder that has waited longest for a certificate was first found: the
/// oldest `dns_ok_since` of a holder with no certificate row, its proof found and no
/// proof-failure clock running (a clock means a later check found the proof missing).
pub async fn oldest_stuck_since<C: ConnectionTrait>(
    conn: &C,
) -> Result<Option<i64>, errors::Error> {
    let certified = Query::select()
        .column(certs::Column::Hostname)
        .from(certs::Entity)
        .to_owned();
    let since: Option<Option<i64>> = claims::Entity::find()
        .select_only()
        .column_as(claims::Column::DnsOkSince.min(), "since")
        .filter(claims::Column::HeldDomain.is_not_null())
        .filter(claims::Column::ReleasedAt.is_null())
        .filter(claims::Column::ReleaseSeal.is_null())
        .filter(claims::Column::DnsOkSince.is_not_null())
        .filter(claims::Column::ProofFailedSince.is_null())
        .filter(claims::Column::HeldDomain.not_in_subquery(certified))
        .into_tuple()
        .one(conn)
        .await?;
    Ok(since.flatten())
}

/// Clears the stored key check value, so the next node with a key writes its own; false when no
/// value was stored.
pub async fn clear_key_check<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<bool, errors::Error> {
    let cleared = manager::Entity::update_many()
        .col_expr(manager::Column::KeyCheck, Expr::cust("NULL"))
        .col_expr(manager::Column::UpdatedAt, Expr::value(now))
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .filter(manager::Column::KeyCheck.is_not_null())
        .exec(conn)
        .await?;
    Ok(cleared.rows_affected > 0)
}

/// Writes the epoch only while the row still holds `from`, so a concurrent change is not undone.
/// In the same statement it drops the installation status: what a restore brought back says
/// nothing about the new epoch, so readiness starts again from the next manager publication.
pub async fn set_epoch<C: ConnectionTrait>(
    conn: &C,
    from: i64,
    to: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    let set = manager::Entity::update_many()
        .col_expr(manager::Column::Epoch, Expr::value(to))
        .col_expr(manager::Column::UpdatedAt, Expr::value(now))
        .col_expr(manager::Column::InstallationStatus, Expr::cust("NULL"))
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .filter(manager::Column::Epoch.eq(from))
        .exec(conn)
        .await?;
    Ok(set.rows_affected > 0)
}

/// Replaces the installation status text only while it is still `from`, so a status the manager
/// wrote meanwhile is not lost.
pub async fn swap_installation_status<C: ConnectionTrait>(
    conn: &C,
    from: &str,
    to: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    let swapped = manager::Entity::update_many()
        .col_expr(manager::Column::InstallationStatus, Expr::value(to))
        .col_expr(manager::Column::UpdatedAt, Expr::value(now))
        .filter(manager::Column::Id.eq(MANAGER_ID))
        .filter(manager::Column::InstallationStatus.eq(from))
        .exec(conn)
        .await?;
    Ok(swapped.rows_affected > 0)
}

/// Database time as a SQL expression, so a lease is judged by one clock whatever the node says.
fn db_now<C: ConnectionTrait>(conn: &C) -> &'static str {
    match conn.get_database_backend() {
        DatabaseBackend::Postgres => "(EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::bigint",
        _ => "(CAST(strftime('%s', 'now') AS INTEGER) * 1000000)",
    }
}

/// An order that reached the finalize call, or failed or was abandoned after it.
fn reached_finalize() -> Condition {
    Condition::any()
        .add(orders::Column::State.is_in([ORDER_FINALIZE_SENT, ORDER_DONE]))
        .add(orders::Column::Outcome.starts_with(OUTCOME_FINALIZE_FAILED))
        .add(orders::Column::Outcome.starts_with(OUTCOME_ABANDONED_AFTER_FINALIZE))
}

/// The orders a limit counts for a subject in the window that ends at `now`.
fn counted(limit: OrderLimit, subject: &OrderSubject<'_>, now: i64) -> Select<orders::Entity> {
    use orders::Column;
    let in_window = orders::Entity::find().filter(Column::CreatedAt.gt(now - limit.window()));
    let weekly = |select: Select<orders::Entity>| {
        select
            .filter(Column::Kind.ne(ORDER_TARGET))
            .filter(reached_finalize())
    };
    match limit {
        OrderLimit::InstallationHour => in_window,
        OrderLimit::OrgDay => in_window.filter(Column::OrgId.eq(subject.org_id)),
        OrderLimit::RegisteredDomainWeek => {
            weekly(in_window.filter(Column::RegisteredDomain.eq(subject.registered_domain)))
        }
        OrderLimit::HostnameWeek => weekly(in_window.filter(Column::Hostname.eq(subject.hostname))),
        OrderLimit::AttemptsHour => in_window.filter(Column::Hostname.eq(subject.hostname)),
    }
}

fn holder() -> Alias {
    Alias::new("holder")
}

fn page() -> Alias {
    Alias::new("page")
}

/// A claim that is unreleased, holds `hostname` and has the id `claim_id`.
fn unreleased_holder_of(hostname: Expr, claim_id: Expr) -> Condition {
    Condition::all()
        .add(Expr::col((holder(), claims::Column::HeldDomain)).eq(hostname))
        .add(Expr::col((holder(), claims::Column::Id)).eq(claim_id))
        .add(Expr::col((holder(), claims::Column::ReleasedAt)).is_null())
        .add(Expr::col((holder(), claims::Column::ReleaseSeal)).is_null())
}

fn certs_with_holder() -> Select<certs::Entity> {
    let mut select = certs::Entity::find()
        .column_as(Expr::col((holder(), claims::Column::Id)), "holder_claim_id")
        .column_as(
            Expr::col((holder(), claims::Column::OrgId)),
            "holder_org_id",
        )
        .column_as(
            Expr::col((holder(), claims::Column::StatusPageId)),
            "holder_page_id",
        )
        .column_as(
            Expr::col((page(), status_pages::Column::Slug)),
            "holder_slug",
        );
    let query = QuerySelect::query(&mut select);
    query.join_as(
        JoinType::LeftJoin,
        claims::Entity,
        holder(),
        unreleased_holder_of(
            Expr::col((certs::Entity, certs::Column::Hostname)),
            Expr::col((certs::Entity, certs::Column::ClaimId)),
        ),
    );
    query.join_as(
        JoinType::LeftJoin,
        status_pages::Entity,
        page(),
        Condition::all()
            .add(
                Expr::col((page(), status_pages::Column::Id))
                    .equals((holder(), claims::Column::StatusPageId)),
            )
            .add(
                Expr::col((page(), status_pages::Column::OrgId))
                    .equals((holder(), claims::Column::OrgId)),
            ),
    );
    select
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    const HOST: &str = "status.example.com";
    const T0: i64 = 1_000_000_000_000;

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let pages = Schema::new(backend).create_table_from_entity(status_pages::Entity);
        db.execute(backend.build(&pages)).await.unwrap();
        let snapshots =
            Schema::new(backend).create_table_from_entity(status_page_snapshots::Entity);
        db.execute(backend.build(&snapshots)).await.unwrap();
        crate::table::migration::create_status_page_custom_domains_table(&db)
            .await
            .unwrap();
        db
    }

    async fn page_row(db: &DatabaseConnection, id: &str, org_id: &str, slug: &str) {
        status_pages::Model {
            id: id.to_string(),
            org_id: org_id.to_string(),
            name: id.to_string(),
            slug: slug.to_string(),
            description: None,
            visibility: 1,
            password_hash: None,
            noindex: true,
            show_uptime_percent: false,
            show_timeline_bars: false,
            show_response_time: false,
            confirm_failures: 1,
            confirm_recovery: 1,
            confirm_after_secs: None,
            brand_name: None,
            accent_color: None,
            logo_img: None,
            favicon_img: None,
            tracking_since: None,
            owner: None,
            created_at: 1,
            updated_at: 1,
        }
        .into_active_model()
        .insert(db)
        .await
        .unwrap();
    }

    /// A claim row; `holds` makes it the holder of `domain`, `released` seals it.
    async fn claim_row(db: &DatabaseConnection, id: &str, holds: bool, released: bool) {
        claims::Model {
            id: id.to_string(),
            org_id: "org-a".to_string(),
            status_page_id: "pa".to_string(),
            domain: HOST.to_string(),
            verification_token: format!("o2v_{id}"),
            verification_state: i32::from(holds),
            held_domain: holds.then(|| HOST.to_string()),
            released_at: released.then_some(T0),
            release_seal: released.then_some(T0),
            cname_label: Some(format!("label{id}")),
            created_at: T0,
            updated_at: T0,
            ..Default::default()
        }
        .into_active_model()
        .insert(db)
        .await
        .unwrap();
    }

    fn cert(hostname: &str, claim_id: Option<&str>) -> certs::Model {
        certs::Model {
            hostname: hostname.to_string(),
            claim_id: claim_id.map(str::to_string),
            org_id: claim_id.map(|_| "org-a".to_string()),
            ca_directory: "https://ca.test/dir".to_string(),
            cert_chain: "chain".to_string(),
            private_key: "sealed".to_string(),
            fingerprint: "fp1".to_string(),
            previous_fingerprint: None,
            not_before: T0,
            not_after: T0 + 100,
            renew_at: Some(T0 + 50),
            source: "acme".to_string(),
            created_at: T0,
            updated_at: T0,
        }
    }

    fn challenge(hostname: &str, claim_id: Option<&str>, expires_at: i64) -> challenges::Model {
        challenges::Model {
            hostname: hostname.to_string(),
            claim_id: claim_id.map(str::to_string),
            token: "token".to_string(),
            key_auth_digest: "ab".repeat(32),
            expires_at,
            created_at: T0,
        }
    }

    #[tokio::test]
    async fn a_certificate_row_carries_its_holder_and_page() {
        let db = db().await;
        page_row(&db, "pa", "org-a", "the-slug").await;
        claim_row(&db, "a", true, false).await;
        upsert_cert(&db, &cert(HOST, Some("a"))).await.unwrap();

        let row = get_cert(&db, HOST).await.unwrap().unwrap();

        assert_eq!(
            row.holder,
            Some(HolderPage {
                claim_id: "a".to_string(),
                org_id: "org-a".to_string(),
                page_id: "pa".to_string(),
                slug: "the-slug".to_string(),
            })
        );
        assert_eq!(row.cert, cert(HOST, Some("a")));
        assert_eq!(list_certs(&db).await.unwrap(), vec![row]);
    }

    #[tokio::test]
    async fn a_certificate_has_no_holder_unless_its_own_claim_holds_the_hostname() {
        let db = db().await;
        page_row(&db, "pa", "org-a", "the-slug").await;
        claim_row(&db, "holds", true, false).await;
        claim_row(&db, "pending", false, false).await;
        claim_row(&db, "gone", false, true).await;
        for (hostname, claim_id) in [
            ("pending.example.com", "pending"),
            ("gone.example.com", "gone"),
            ("nobody.example.com", "missing"),
        ] {
            upsert_cert(&db, &cert(hostname, Some(claim_id)))
                .await
                .unwrap();
        }
        upsert_cert(&db, &cert(HOST, Some("pending")))
            .await
            .unwrap();
        upsert_cert(&db, &cert("domains.example.com", None))
            .await
            .unwrap();

        let rows = list_certs(&db).await.unwrap();

        assert_eq!(rows.len(), 5);
        assert!(
            rows.iter().all(|row| row.holder.is_none()),
            "{:?}",
            rows.iter().map(|r| &r.cert.hostname).collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn a_holder_whose_page_is_gone_gives_no_holder() {
        let db = db().await;
        claim_row(&db, "a", true, false).await;
        upsert_cert(&db, &cert(HOST, Some("a"))).await.unwrap();

        let row = get_cert(&db, HOST).await.unwrap().unwrap();

        assert_eq!(row.holder, None);
    }

    #[tokio::test]
    async fn an_upsert_replaces_the_row_and_keeps_its_creation_time() {
        let db = db().await;
        upsert_cert(&db, &cert(HOST, None)).await.unwrap();
        let newer = certs::Model {
            fingerprint: "fp2".to_string(),
            previous_fingerprint: Some("fp1".to_string()),
            not_after: T0 + 200,
            created_at: T0 + 9,
            updated_at: T0 + 9,
            ..cert(HOST, None)
        };

        upsert_cert(&db, &newer).await.unwrap();

        let stored = get_cert(&db, HOST).await.unwrap().unwrap().cert;
        assert_eq!(stored.fingerprint, "fp2");
        assert_eq!(stored.previous_fingerprint.as_deref(), Some("fp1"));
        assert_eq!((stored.created_at, stored.updated_at), (T0, T0 + 9));
        assert_eq!(list_certs(&db).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_delete_removes_the_row_once() {
        let db = db().await;
        upsert_cert(&db, &cert(HOST, None)).await.unwrap();

        assert!(delete_cert(&db, HOST).await.unwrap());
        assert!(!delete_cert(&db, HOST).await.unwrap());
        assert!(get_cert(&db, HOST).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_failed_transaction_leaves_the_certificate_row_as_it_was() {
        let db = db().await;
        upsert_cert(&db, &cert(HOST, None)).await.unwrap();
        let txn = sea_orm::TransactionTrait::begin(&db).await.unwrap();

        delete_cert(&txn, HOST).await.unwrap();
        txn.rollback().await.unwrap();

        assert!(get_cert(&db, HOST).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn challenges_are_live_until_they_expire_and_say_whether_their_claim_holds() {
        let db = db().await;
        page_row(&db, "pa", "org-a", "s").await;
        claim_row(&db, "holds", true, false).await;
        for model in [
            challenge(HOST, Some("holds"), T0 + 10),
            challenge("pending.example.com", Some("pending"), T0 + 10),
            challenge("domains.example.com", None, T0 + 10),
            challenge("old.example.com", Some("holds"), T0),
        ] {
            challenges::Entity::insert(model.into_active_model())
                .exec(&db)
                .await
                .unwrap();
        }

        let rows = list_live_challenges(&db, T0).await.unwrap();

        let summary: Vec<_> = rows
            .iter()
            .map(|r| (r.challenge.hostname.as_str(), r.claim_is_holder))
            .collect();
        assert_eq!(
            summary,
            [
                ("domains.example.com", false),
                ("pending.example.com", false),
                (HOST, true)
            ]
        );
    }

    #[tokio::test]
    async fn the_manager_row_starts_with_epoch_one_and_no_key_check() {
        let db = db().await;

        let row = get_manager(&db).await.unwrap().unwrap();

        assert_eq!((row.id, row.epoch, row.key_check), (MANAGER_ID, 1, None));
    }

    async fn only_the_first_key_check_is_stored<C: ConnectionTrait>(conn: &C) {
        assert!(set_key_check_if_unset(conn, "first", 1, T0).await.unwrap());
        assert!(
            !set_key_check_if_unset(conn, "second", 1, T0 + 1)
                .await
                .unwrap()
        );

        let row = get_manager(conn).await.unwrap().unwrap();
        assert_eq!(row.key_check.as_deref(), Some("first"));
        assert_eq!(row.updated_at, T0);
    }

    #[tokio::test]
    async fn the_key_check_is_set_only_while_none_is_stored() {
        only_the_first_key_check_is_stored(&db().await).await;
    }

    #[tokio::test]
    async fn the_key_check_is_not_set_when_the_epoch_moved_since_it_was_read() {
        let db = db().await;
        manager::Entity::update_many()
            .col_expr(manager::Column::Epoch, Expr::value(2_i64))
            .exec(&db)
            .await
            .unwrap();

        assert!(
            !set_key_check_if_unset(&db, "old-epoch", 1, T0)
                .await
                .unwrap()
        );
        assert_eq!(get_manager(&db).await.unwrap().unwrap().key_check, None);
        assert!(
            set_key_check_if_unset(&db, "new-epoch", 2, T0)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn lock_holder_succeeds_only_for_the_unreleased_holder_of_the_hostname() {
        let db = db().await;
        page_row(&db, "pa", "org-a", "s").await;
        claim_row(&db, "holds", true, false).await;
        claim_row(&db, "pending", false, false).await;
        claim_row(&db, "gone", false, true).await;

        assert!(lock_holder(&db, "holds", HOST).await.unwrap());
        assert!(
            !lock_holder(&db, "holds", "other.example.com")
                .await
                .unwrap()
        );
        assert!(!lock_holder(&db, "pending", HOST).await.unwrap());
        assert!(!lock_holder(&db, "gone", HOST).await.unwrap());
    }

    #[tokio::test]
    async fn postgres_the_key_check_is_set_only_while_none_is_stored() {
        let Ok(dsn) = std::env::var("ZO_TEST_POSTGRES_DSN") else {
            return;
        };
        let admin = Database::connect(ConnectOptions::new(dsn.clone()))
            .await
            .unwrap();
        let schema = format!("pgtest_{}", config::ider::generate().to_lowercase());
        admin
            .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
            .await
            .unwrap();
        let mut opts = ConnectOptions::new(dsn);
        opts.max_connections(2)
            .set_schema_search_path(schema.clone());
        let pg = Database::connect(opts).await.unwrap();
        let backend = pg.get_database_backend();
        let pages = Schema::new(backend).create_table_from_entity(status_pages::Entity);
        pg.execute(backend.build(&pages)).await.unwrap();
        crate::table::migration::create_status_page_custom_domains_table(&pg)
            .await
            .unwrap();

        only_the_first_key_check_is_stored(&pg).await;
        manager::Entity::update_many()
            .col_expr(
                manager::Column::KeyCheck,
                Expr::value(Option::<String>::None),
            )
            .col_expr(manager::Column::Epoch, Expr::value(2_i64))
            .exec(&pg)
            .await
            .unwrap();
        assert!(
            !set_key_check_if_unset(&pg, "old-epoch", 1, T0)
                .await
                .unwrap()
        );
        assert_eq!(get_manager(&pg).await.unwrap().unwrap().key_check, None);
        assert!(
            set_key_check_if_unset(&pg, "new-epoch", 2, T0)
                .await
                .unwrap()
        );

        admin
            .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_listener_heartbeat_replaces_the_nodes_row() {
        let db = db().await;
        let beat = |seen: i64, loaded: i32| listeners::Model {
            node_uuid: "node-1".to_string(),
            node_name: "o2-0".to_string(),
            address: "10.0.0.4:5443".to_string(),
            last_seen_at: seen,
            certs_loaded: loaded,
            last_sync_at: seen,
            private_peers_only: false,
        };
        upsert_listener(&db, &beat(T0, 1)).await.unwrap();
        upsert_listener(&db, &beat(T0 + 15, 4)).await.unwrap();
        let other = listeners::Model {
            node_uuid: "node-2".to_string(),
            private_peers_only: true,
            ..beat(T0, 0)
        };
        upsert_listener(&db, &other).await.unwrap();

        let rows = list_listeners(&db).await.unwrap();

        assert_eq!(rows, vec![beat(T0 + 15, 4), other]);
    }

    fn order_row(
        id: &str,
        hostname: &str,
        kind: &str,
        state: &str,
        outcome: Option<&str>,
        at: i64,
    ) -> orders::Model {
        orders::Model {
            id: id.to_string(),
            hostname: hostname.to_string(),
            registered_domain: "example.com".to_string(),
            org_id: Some("org-a".to_string()),
            claim_id: Some("c1".to_string()),
            kind: kind.to_string(),
            state: state.to_string(),
            order_url: None,
            outcome: outcome.map(str::to_string),
            created_at: at,
            updated_at: at,
        }
    }

    #[tokio::test]
    async fn the_lease_is_taken_renewed_and_lost_on_its_expiry_by_database_time() {
        let db = db().await;

        assert!(acquire_lease(&db, "one", LEASE_MICROS).await.unwrap());
        assert!(!acquire_lease(&db, "two", LEASE_MICROS).await.unwrap());
        assert!(renew_lease(&db, "one", LEASE_MICROS).await.unwrap());
        assert!(!renew_lease(&db, "two", LEASE_MICROS).await.unwrap());

        let expired = manager::Entity::update_many()
            .col_expr(manager::Column::LeaseExpiresAt, Expr::value(0_i64))
            .filter(manager::Column::Id.eq(MANAGER_ID))
            .exec(&db)
            .await
            .unwrap();
        assert_eq!(expired.rows_affected, 1);

        assert!(acquire_lease(&db, "two", LEASE_MICROS).await.unwrap());
        assert!(!renew_lease(&db, "one", LEASE_MICROS).await.unwrap());
    }

    #[tokio::test]
    async fn a_fenced_transaction_returns_nothing_when_the_lease_is_not_held() {
        let db = db().await;
        acquire_lease(&db, "one", LEASE_MICROS).await.unwrap();

        assert!(begin_fenced(&db, "one").await.unwrap().is_some());
        assert!(begin_fenced(&db, "two").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_cycle_purge_removes_old_rows_and_nothing_young_nor_waiting() {
        let db = db().await;
        upsert_listener(
            &db,
            &listeners::Model {
                node_uuid: "gone".to_string(),
                node_name: "n".to_string(),
                address: "10.0.0.1:5443".to_string(),
                last_seen_at: T0 - 24 * 3_600 * 1_000_000 - 1,
                certs_loaded: 0,
                last_sync_at: T0,
                private_peers_only: false,
            },
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row(
                "old",
                HOST,
                ORDER_FIRST,
                ORDER_DONE,
                Some("issued"),
                T0 - 31 * 24 * 3_600 * 1_000_000,
            ),
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row(
                "young",
                HOST,
                ORDER_FIRST,
                ORDER_DONE,
                Some("issued"),
                T0 - 29 * 24 * 3_600 * 1_000_000,
            ),
        )
        .await
        .unwrap();
        upsert_challenge(
            &db,
            &challenges::Model {
                hostname: HOST.to_string(),
                claim_id: None,
                token: "t".to_string(),
                key_auth_digest: "d".to_string(),
                expires_at: T0 - 1,
                created_at: T0,
            },
        )
        .await
        .unwrap();

        let gone = purge_old_rows(&db, T0).await.unwrap();

        assert!(gone >= 3);
        assert_eq!(list_listeners(&db).await.unwrap().len(), 0);
        assert_eq!(list_hostname_orders(&db, HOST, 10).await.unwrap().len(), 1);
        assert!(get_challenge(&db, HOST).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_order_counts_cover_every_window_and_only_finalize_stage_orders_count_weekly() {
        let db = db().await;
        let hour = 3_600 * 1_000_000;
        insert_order(
            &db,
            &order_row(
                "done",
                HOST,
                ORDER_FIRST,
                ORDER_DONE,
                Some("issued"),
                T0 - hour / 2,
            ),
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row(
                "finalized",
                HOST,
                ORDER_FIRST,
                ORDER_FAILED,
                Some("finalize_failed:ca_other: x"),
                T0 - hour / 2,
            ),
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row(
                "validation",
                HOST,
                ORDER_FIRST,
                ORDER_FAILED,
                Some("ca_dns: x"),
                T0 - hour / 2,
            ),
        )
        .await
        .unwrap();

        let counts = order_counts(
            &db,
            &OrderSubject {
                hostname: HOST,
                registered_domain: "example.com",
                org_id: "org-a",
            },
            T0,
        )
        .await
        .unwrap();

        assert_eq!(counts.installation_hour, 3);
        assert_eq!(counts.org_day, 3);
        assert_eq!(counts.validation_attempts_hour, 3);
        assert_eq!(
            counts.hostname_week, 2,
            "a validation failure reaches no finalize call"
        );
        assert_eq!(counts.registered_domain_week, 2);
    }

    #[tokio::test]
    async fn two_orgs_under_one_registered_domain_share_its_weekly_count() {
        let db = db().await;
        let issued = |id: &str, hostname: &str| {
            order_row(id, hostname, ORDER_FIRST, ORDER_DONE, None, T0 - 1)
        };
        let mut theirs = issued("theirs", "b.example.com");
        theirs.org_id = Some("org-b".to_string());
        let mut elsewhere = issued("elsewhere", "a.example.org");
        elsewhere.registered_domain = "example.org".to_string();
        for row in [issued("ours", HOST), theirs, elsewhere] {
            insert_order(&db, &row).await.unwrap();
        }

        let subject = OrderSubject {
            hostname: HOST,
            registered_domain: "example.com",
            org_id: "org-a",
        };
        let counts = order_counts(&db, &subject, T0).await.unwrap();

        assert_eq!(
            counts.registered_domain_week, 2,
            "the other org's order counts, another registered domain's does not"
        );
        assert_eq!(counts.org_day, 2, "the daily count stays per org");
        assert_eq!(counts.hostname_week, 1);
    }

    #[tokio::test]
    async fn the_attempts_by_hostname_counts_only_the_last_hour() {
        let db = db().await;
        let hour = 3_600 * 1_000_000;
        insert_order(
            &db,
            &order_row(
                "a",
                HOST,
                ORDER_FIRST,
                ORDER_DONE,
                Some("issued"),
                T0 - 10 * 1_000_000,
            ),
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row(
                "b",
                HOST,
                ORDER_FIRST,
                ORDER_FAILED,
                Some("ca_dns: x"),
                T0 - 20 * 1_000_000,
            ),
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row(
                "c",
                HOST,
                ORDER_FIRST,
                ORDER_DONE,
                Some("issued"),
                T0 - 2 * hour,
            ),
        )
        .await
        .unwrap();

        let counts = count_attempts_by_hostname(&db, &[HOST.to_string(), "other".to_string()], T0)
            .await
            .unwrap();

        assert_eq!(counts.get(HOST), Some(&2));
        assert_eq!(counts.get("other"), None);
    }

    #[tokio::test]
    async fn the_page_states_and_the_last_order_times_read_what_they_name() {
        let db = db().await;
        page_row(&db, "pa", "org-a", "pa").await;
        insert_order(
            &db,
            &order_row(
                "older",
                HOST,
                ORDER_FIRST,
                ORDER_DONE,
                Some("issued"),
                T0 - 5,
            ),
        )
        .await
        .unwrap();
        insert_order(
            &db,
            &order_row("newer", HOST, ORDER_FIRST, ORDER_DONE, Some("issued"), T0),
        )
        .await
        .unwrap();
        let ids = ["pa".to_string(), "gone".to_string()];

        let before = page_states(&db, &ids).await.unwrap();
        status_page_snapshots::Model {
            status_page_id: "pa".to_string(),
            org_id: "org-a".to_string(),
            history: "{}".to_string(),
            current: "{}".to_string(),
            history_generated_at: 1,
            current_generated_at: 1,
        }
        .into_active_model()
        .insert(&db)
        .await
        .unwrap();
        let after = page_states(&db, &ids).await.unwrap();
        let last = last_order_times(&db).await.unwrap();

        let page = |built| PageState {
            visibility: 1,
            built,
        };
        assert_eq!(before.get("pa"), Some(&page(false)), "no snapshot yet");
        assert_eq!(after.get("pa"), Some(&page(true)));
        assert_eq!(after.get("gone"), None);
        assert_eq!(last.get("org-a"), Some(&T0));
    }

    #[tokio::test]
    async fn a_full_count_frees_a_slot_when_its_allowed_th_newest_order_leaves_the_window() {
        let db = db().await;
        let minute = 60 * 1_000_000;
        for (id, ago) in [("a", 50), ("b", 40), ("c", 10)] {
            let row = order_row(
                id,
                HOST,
                ORDER_FIRST,
                ORDER_FAILED,
                Some("ca_dns: x"),
                T0 - ago * minute,
            );
            insert_order(&db, &row).await.unwrap();
        }
        let subject = OrderSubject {
            hostname: HOST,
            registered_domain: "example.com",
            org_id: "org-a",
        };

        let free = slot_free_at(&db, &subject, (OrderLimit::AttemptsHour, 3), T0).await;
        let none = slot_free_at(&db, &subject, (OrderLimit::AttemptsHour, 4), T0).await;
        let two = slot_free_at(&db, &subject, (OrderLimit::AttemptsHour, 2), T0).await;

        assert_eq!(
            free.unwrap(),
            Some(T0 + 10 * minute),
            "the oldest leaves in 10 minutes"
        );
        assert_eq!(none.unwrap(), None, "fewer orders than the limit");
        assert_eq!(two.unwrap(), Some(T0 + 20 * minute));
    }

    #[tokio::test]
    async fn a_revocation_is_queued_for_an_acme_row_only() {
        let db = db().await;
        let acme = cert(HOST, Some("c1"));
        let mut imported = cert("imported.example.com", Some("c1"));
        imported.source = "imported".to_string();

        assert!(queue_revocation_of(&db, &acme, T0).await.unwrap());
        assert!(!queue_revocation_of(&db, &imported, T0).await.unwrap());

        let waiting = list_waiting_revocations(&db, 10).await.unwrap();
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0].hostname, HOST);
        assert_eq!(waiting[0].attempts, 0);

        update_revocation(&db, &waiting[0].id, (REVOCATION_DONE, 1), T0)
            .await
            .unwrap();
        assert!(list_waiting_revocations(&db, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_final_certificate_write_needs_the_claim_to_still_hold_the_hostname() {
        let db = db().await;
        claim_row(&db, "c1", false, false).await;
        let mut row = cert(HOST, Some("c1"));
        row.cert_chain = "c".to_string();
        row.private_key = "k".to_string();

        assert!(
            !write_certificate(&db, &row).await.unwrap(),
            "not the holder"
        );
        assert!(get_cert(&db, HOST).await.unwrap().is_none());

        crate::table::status_pages::grant_domain(&db, "c1", T0)
            .await
            .unwrap();
        assert!(write_certificate(&db, &row).await.unwrap());
        assert!(get_cert(&db, HOST).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn the_account_is_stored_once_per_directory() {
        let db = db().await;
        let row = accounts::Model {
            ca_directory: "https://ca.test/dir".to_string(),
            credentials: "sealed".to_string(),
            created_at: T0,
        };

        assert!(insert_account(&db, &row).await.unwrap());
        assert!(
            !insert_account(&db, &row).await.unwrap(),
            "the first one stays"
        );
        assert_eq!(
            get_account(&db, "https://ca.test/dir")
                .await
                .unwrap()
                .unwrap()
                .credentials,
            "sealed"
        );
    }

    /// A holder claim of `domain`; a test changes the columns it needs before the insert.
    fn holder_of(id: &str, domain: &str) -> claims::Model {
        claims::Model {
            id: id.to_string(),
            org_id: "org-a".to_string(),
            status_page_id: "pa".to_string(),
            domain: domain.to_string(),
            verification_token: format!("o2v_{id}"),
            verification_state: 1,
            held_domain: Some(domain.to_string()),
            cname_label: Some(format!("label{id}")),
            created_at: T0,
            updated_at: T0,
            ..Default::default()
        }
    }

    async fn put_claim(db: &DatabaseConnection, model: claims::Model) {
        model.into_active_model().insert(db).await.unwrap();
    }

    #[tokio::test]
    async fn holders_are_counted_by_stored_state_and_never_a_released_or_non_holder_claim() {
        let db = db().await;
        for (id, state) in [("a", Some("serving")), ("b", Some("serving")), ("c", None)] {
            let mut claim = holder_of(id, &format!("{id}.example.com"));
            claim.serving_state = state.map(str::to_string);
            put_claim(&db, claim).await;
        }
        let mut released = holder_of("d", "d.example.com");
        released.release_seal = Some(T0);
        released.serving_state = Some("serving".to_string());
        put_claim(&db, released).await;
        let mut pending = holder_of("e", "e.example.com");
        pending.held_domain = None;
        pending.serving_state = Some("serving".to_string());
        put_claim(&db, pending).await;

        let mut counts = count_holders_by_state(&db).await.unwrap();

        counts.sort();
        assert_eq!(counts, [(None, 1), (Some("serving".to_string()), 2)]);
    }

    #[tokio::test]
    async fn the_oldest_stuck_holder_has_its_proof_found_and_no_certificate() {
        let db = db().await;
        assert_eq!(oldest_stuck_since(&db).await.unwrap(), None);
        let rows = [
            ("a", Some(T0 + 10), false, false),
            ("with-cert", Some(T0 + 1), true, false),
            ("no-proof", None, false, false),
            ("late", Some(T0 + 20), false, false),
            ("released", Some(T0 + 2), false, true),
        ];
        for (id, found_since, certified, released) in rows {
            let domain = format!("{id}.example.com");
            let mut claim = holder_of(id, &domain);
            claim.dns_ok_since = found_since;
            claim.release_seal = released.then_some(T0);
            put_claim(&db, claim).await;
            if certified {
                upsert_cert(&db, &cert(&domain, Some(id))).await.unwrap();
            }
        }
        let mut failing = holder_of("failing", "failing.example.com");
        failing.dns_ok_since = Some(T0 + 3);
        failing.proof_failed_since = Some(T0 + 4);
        put_claim(&db, failing).await;

        assert_eq!(oldest_stuck_since(&db).await.unwrap(), Some(T0 + 10));
    }

    #[tokio::test]
    async fn the_key_check_is_cleared_once_and_the_next_node_with_a_key_writes_its_own() {
        let db = db().await;
        assert!(!clear_key_check(&db, T0).await.unwrap(), "nothing stored");
        assert!(set_key_check_if_unset(&db, "old", 1, T0).await.unwrap());

        assert!(clear_key_check(&db, T0 + 1).await.unwrap());
        assert!(!clear_key_check(&db, T0 + 2).await.unwrap());

        assert_eq!(get_manager(&db).await.unwrap().unwrap().key_check, None);
        assert!(set_key_check_if_unset(&db, "new", 1, T0 + 3).await.unwrap());
        let stored = get_manager(&db).await.unwrap().unwrap().key_check;
        assert_eq!(stored.as_deref(), Some("new"));
    }

    #[tokio::test]
    async fn the_epoch_is_written_only_while_the_row_still_holds_the_epoch_that_was_read() {
        let db = db().await;
        write_installation_status(&db, "ready for two days", T0)
            .await
            .unwrap();
        assert!(!set_epoch(&db, 5, 7, T0).await.unwrap(), "another epoch");
        assert_eq!(get_manager(&db).await.unwrap().unwrap().epoch, 1);
        assert!(set_epoch(&db, 1, 7, T0 + 1).await.unwrap());
        assert!(
            !set_epoch(&db, 1, 9, T0 + 2).await.unwrap(),
            "already moved"
        );

        let row = get_manager(&db).await.unwrap().unwrap();
        assert_eq!((row.epoch, row.updated_at), (7, T0 + 1));
        assert_eq!(
            row.installation_status, None,
            "the readiness of the old epoch is gone"
        );
    }

    #[tokio::test]
    async fn the_installation_status_is_swapped_only_while_it_is_the_text_that_was_read() {
        let db = db().await;
        write_installation_status(&db, "one", T0).await.unwrap();

        assert!(
            !swap_installation_status(&db, "other", "two", T0 + 1)
                .await
                .unwrap()
        );
        assert!(
            swap_installation_status(&db, "one", "two", T0 + 2)
                .await
                .unwrap()
        );
        assert!(
            !swap_installation_status(&db, "one", "three", T0 + 3)
                .await
                .unwrap()
        );

        let status = get_manager(&db).await.unwrap().unwrap().installation_status;
        assert_eq!(status.as_deref(), Some("two"));
    }

    #[tokio::test]
    async fn a_certificate_is_deleted_only_while_it_holds_the_ciphertext_that_was_inspected() {
        let db = db().await;
        let mut old = cert(HOST, Some("a"));
        old.private_key = "sealed-old".to_string();
        upsert_cert(&db, &old).await.unwrap();
        let mut replacement = old.clone();
        replacement.private_key = "sealed-new".to_string();
        upsert_cert(&db, &replacement).await.unwrap();

        let stale = delete_cert_sealed_as(&db, HOST, "sealed-old")
            .await
            .unwrap();

        assert!(!stale, "the row was replaced after it was read");
        assert!(get_cert(&db, HOST).await.unwrap().is_some());
        assert!(
            delete_cert_sealed_as(&db, HOST, "sealed-new")
                .await
                .unwrap()
        );
        assert!(get_cert(&db, HOST).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn an_account_is_deleted_only_while_it_holds_the_ciphertext_that_was_inspected() {
        let db = db().await;
        let account = |credentials: &str| accounts::Model {
            ca_directory: "https://ca.test/dir".to_string(),
            credentials: credentials.to_string(),
            created_at: T0,
        };
        assert!(insert_account(&db, &account("old")).await.unwrap());
        assert!(
            delete_account_sealed_as(&db, "https://ca.test/dir", "old")
                .await
                .unwrap()
        );
        assert!(insert_account(&db, &account("new")).await.unwrap());

        let stale = delete_account_sealed_as(&db, "https://ca.test/dir", "old").await;

        assert!(
            !stale.unwrap(),
            "the account was registered again after it was read"
        );
        assert_eq!(list_accounts(&db).await.unwrap().len(), 1);
    }
}
