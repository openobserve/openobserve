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

use std::sync::OnceLock;

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, FromQueryResult, IntoActiveModel,
    JoinType, QueryFilter, QueryOrder, QueryResult, QuerySelect, Select,
    prelude::Expr,
    sea_query::{Alias, OnConflict},
};

use super::entity::{
    status_page_custom_domains as claims, status_page_domain_certs as certs,
    status_page_domain_challenges as challenges, status_page_domain_listeners as listeners,
    status_page_domain_manager as manager, status_pages,
};
use crate::errors;

static CERTS_GATE: OnceLock<fn() -> bool> = OnceLock::new();

#[cfg(test)]
thread_local! {
    static FORCED: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// The one row of `status_page_domain_manager`.
pub const MANAGER_ID: i32 = 1;

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
}
