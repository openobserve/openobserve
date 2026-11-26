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

//! One holder per custom domain: `held_domain` with a unique index, the release seal, and the
//! backfill that turns "first org to type it" into "the org with the proof".

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

const TABLE: &str = "status_page_custom_domains";
const HELD_DOMAIN_INDEX: &str = "status_page_custom_domains_held_domain_uidx";
const CLAIM_TTL_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;
const VERIFIED: i32 = 1;
/// `release_reason` of a claim released without ever holding its hostname.
const RELEASED_EXPIRED: i32 = 2;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip the columns already added.
        for (name, column) in new_columns() {
            if !manager.has_column(TABLE, name).await? {
                manager.alter_table(add_column_stmt(column)).await?;
            }
        }
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        db.execute(backend.build(&seal_released_stmt())).await?;
        let now = config::utils::time::now_micros();
        settle_duplicates(db, now, true).await?;
        let expires_at = now + CLAIM_TTL_MICROS;
        db.execute(backend.build(&start_expiry_stmt(expires_at)))
            .await?;
        manager.create_index(held_domain_index_stmt()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_index(TABLE, HELD_DOMAIN_INDEX).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(HELD_DOMAIN_INDEX)
                        .table(StatusPageCustomDomains::Table)
                        .to_owned(),
                )
                .await?;
        }
        for (name, _) in new_columns() {
            if manager.has_column(TABLE, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(StatusPageCustomDomains::Table)
                            .drop_column(Alias::new(name))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum StatusPageCustomDomains {
    Table,
    Id,
    Domain,
    VerificationState,
    ReleasedAt,
    CreatedAt,
    HeldDomain,
    ReleaseSeal,
    ReleaseReason,
    ProofFailedSince,
    ExpiresAt,
}

fn new_columns() -> [(&'static str, ColumnDef); 5] {
    use StatusPageCustomDomains::*;
    [
        (
            "held_domain",
            ColumnDef::new(HeldDomain).string_len(253).null().to_owned(),
        ),
        (
            "release_seal",
            ColumnDef::new(ReleaseSeal).big_integer().null().to_owned(),
        ),
        (
            "release_reason",
            ColumnDef::new(ReleaseReason).integer().null().to_owned(),
        ),
        (
            "proof_failed_since",
            ColumnDef::new(ProofFailedSince)
                .big_integer()
                .null()
                .to_owned(),
        ),
        (
            "expires_at",
            ColumnDef::new(ExpiresAt).big_integer().null().to_owned(),
        ),
    ]
}

fn add_column_stmt(mut column: ColumnDef) -> TableAlterStatement {
    Table::alter()
        .table(StatusPageCustomDomains::Table)
        .add_column(&mut column)
        .to_owned()
}

/// Both databases allow many NULLs in a unique index, so only holders compete for a hostname.
fn held_domain_index_stmt() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(HELD_DOMAIN_INDEX)
        .table(StatusPageCustomDomains::Table)
        .col(StatusPageCustomDomains::HeldDomain)
        .unique()
        .to_owned()
}

fn unreleased() -> Condition {
    Cond::all()
        .add(Expr::col(StatusPageCustomDomains::ReleasedAt).is_null())
        .add(Expr::col(StatusPageCustomDomains::ReleaseSeal).is_null())
}

fn seal_released_stmt() -> UpdateStatement {
    Query::update()
        .table(StatusPageCustomDomains::Table)
        .value(
            StatusPageCustomDomains::ReleaseSeal,
            Expr::col(StatusPageCustomDomains::ReleasedAt),
        )
        .and_where(Expr::col(StatusPageCustomDomains::ReleasedAt).is_not_null())
        .and_where(Expr::col(StatusPageCustomDomains::ReleaseSeal).is_null())
        .to_owned()
}

/// A rerun only fills rows that have no expiry yet, so it never moves a running clock.
fn start_expiry_stmt(expires_at: i64) -> UpdateStatement {
    Query::update()
        .table(StatusPageCustomDomains::Table)
        .value(StatusPageCustomDomains::ExpiresAt, expires_at)
        .cond_where(unreleased())
        .and_where(Expr::col(StatusPageCustomDomains::HeldDomain).is_null())
        .and_where(Expr::col(StatusPageCustomDomains::ExpiresAt).is_null())
        .to_owned()
}

fn hold_stmt(id: &str) -> UpdateStatement {
    Query::update()
        .table(StatusPageCustomDomains::Table)
        .value(
            StatusPageCustomDomains::HeldDomain,
            Expr::col(StatusPageCustomDomains::Domain),
        )
        .and_where(Expr::col(StatusPageCustomDomains::Id).eq(id))
        .cond_where(unreleased())
        .and_where(Expr::col(StatusPageCustomDomains::HeldDomain).is_null())
        .to_owned()
}

fn release_stmt(id: &str, at: i64) -> UpdateStatement {
    Query::update()
        .table(StatusPageCustomDomains::Table)
        .value(StatusPageCustomDomains::ReleasedAt, at)
        .value(StatusPageCustomDomains::ReleaseSeal, at)
        .value(StatusPageCustomDomains::ReleaseReason, RELEASED_EXPIRED)
        .and_where(Expr::col(StatusPageCustomDomains::Id).eq(id))
        .cond_where(unreleased())
        .and_where(Expr::col(StatusPageCustomDomains::HeldDomain).is_null())
        .to_owned()
}

/// Keeps one unreleased claim per hostname: a holder, else verified before pending, then the older,
/// then the lower id. The others are released; a kept verified claim becomes the holder.
pub(crate) async fn settle_duplicates<C: ConnectionTrait>(
    db: &C,
    at: i64,
    promote: bool,
) -> Result<(), DbErr> {
    let backend = db.get_database_backend();
    let unreleased_claims = Query::select()
        .columns([
            StatusPageCustomDomains::Id,
            StatusPageCustomDomains::Domain,
            StatusPageCustomDomains::VerificationState,
            StatusPageCustomDomains::CreatedAt,
            StatusPageCustomDomains::HeldDomain,
        ])
        .from(StatusPageCustomDomains::Table)
        .cond_where(unreleased())
        .to_owned();
    let mut claims = Vec::new();
    for row in db.query_all(backend.build(&unreleased_claims)).await? {
        let held: Option<String> = row.try_get("", "held_domain")?;
        let state: i32 = row.try_get("", "verification_state")?;
        claims.push(Claim {
            id: row.try_get("", "id")?,
            domain: row.try_get("", "domain")?,
            rank: (held.is_none(), state != VERIFIED),
            created_at: row.try_get("", "created_at")?,
            held: held.is_some(),
            verified: state == VERIFIED,
        });
    }
    claims.sort_by(|a, b| {
        (&a.domain, a.rank, a.created_at, &a.id).cmp(&(&b.domain, b.rank, b.created_at, &b.id))
    });
    let mut previous: Option<&str> = None;
    for claim in &claims {
        let kept = previous != Some(claim.domain.as_str());
        previous = Some(claim.domain.as_str());
        let stmt = match (kept, claim.held, claim.verified && promote) {
            (false, ..) => release_stmt(&claim.id, at),
            (true, false, true) => hold_stmt(&claim.id),
            (true, ..) => continue,
        };
        db.execute(backend.build(&stmt)).await?;
    }
    Ok(())
}

/// An unreleased claim as the backfill reads it.
struct Claim {
    id: String,
    domain: String,
    /// Sorts a holder first, then a verified claim, before any other.
    rank: (bool, bool),
    created_at: i64,
    held: bool,
    verified: bool,
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, EntityTrait};

    use super::*;
    use crate::table::{
        entity::status_page_custom_domains as domains,
        migration::{
            m20260825_000001_create_status_page_custom_domains as create_domains,
            m20261226_000001_status_page_domain_store as store,
            m20261227_000001_status_page_domain_manager as manager_migration,
        },
    };

    /// The table as the release before this one left it.
    async fn old_db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let schema = SchemaManager::new(&db);
        create_domains::Migration.up(&schema).await.unwrap();
        // The current entity reads the columns the manager migration adds, so the schema must too.
        manager_migration::Migration.up(&schema).await.unwrap();
        db
    }

    async fn old_row(
        db: &DatabaseConnection,
        id: &str,
        domain: &str,
        state: i32,
        released_at: Option<i64>,
        created_at: i64,
    ) {
        let released_at = released_at.map_or("NULL".to_string(), |at| at.to_string());
        db.execute_unprepared(&format!(
            "INSERT INTO status_page_custom_domains (id, org_id, status_page_id, domain, \
             verification_token, verification_state, released_at, created_at, updated_at) VALUES \
             ('{id}', 'org-{id}', 'page-{id}', '{domain}', 'o2v_{id}', {state}, {released_at}, \
             {created_at}, {created_at})"
        ))
        .await
        .unwrap();
    }

    /// The entity reads `cname_label`, so the next migration's column comes with this one's.
    async fn migrate(db: &DatabaseConnection) {
        Migration.up(&SchemaManager::new(db)).await.unwrap();
        store::Migration.up(&SchemaManager::new(db)).await.unwrap();
    }

    async fn row(db: &DatabaseConnection, id: &str) -> domains::Model {
        domains::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn a_verified_claim_becomes_the_holder_and_has_no_expiry() {
        let db = old_db().await;
        old_row(&db, "v1", "status.example.com", 1, None, 10).await;

        migrate(&db).await;

        let claim = row(&db, "v1").await;
        assert_eq!(claim.held_domain.as_deref(), Some("status.example.com"));
        assert_eq!(claim.verification_state, 1);
        assert_eq!(claim.expires_at, None);
        assert_eq!(claim.release_seal, None);
    }

    #[tokio::test]
    async fn of_two_verified_claims_for_one_hostname_the_older_holds_it_and_the_other_is_released()
    {
        let db = old_db().await;
        old_row(&db, "young", "status.example.com", 1, None, 20).await;
        old_row(&db, "old", "status.example.com", 1, None, 10).await;
        old_row(&db, "tie-b", "tie.example.com", 1, None, 30).await;
        old_row(&db, "tie-a", "tie.example.com", 1, None, 30).await;
        let before = config::utils::time::now_micros();

        migrate(&db).await;

        let old = row(&db, "old").await;
        assert_eq!(old.held_domain.as_deref(), Some("status.example.com"));
        assert_eq!(old.released_at, None);
        let young = row(&db, "young").await;
        assert_eq!(young.held_domain, None);
        assert!(young.released_at.unwrap() >= before);
        assert_eq!(young.release_seal, young.released_at);
        assert_eq!(young.release_reason, Some(2));
        assert_eq!(
            row(&db, "tie-a").await.held_domain.as_deref(),
            Some("tie.example.com"),
            "equal creation times fall back to the id"
        );
        assert_eq!(row(&db, "tie-b").await.release_reason, Some(2));
    }

    #[tokio::test]
    async fn a_verified_claim_is_kept_before_an_older_pending_one() {
        let db = old_db().await;
        old_row(&db, "pending", "status.example.com", 0, None, 10).await;
        old_row(&db, "failed", "status.example.com", 2, None, 5).await;
        old_row(&db, "verified", "status.example.com", 1, None, 20).await;
        old_row(&db, "p-old", "other.example.com", 0, None, 10).await;
        old_row(&db, "p-young", "other.example.com", 0, None, 20).await;

        migrate(&db).await;

        let kept = row(&db, "verified").await;
        assert_eq!(kept.held_domain.as_deref(), Some("status.example.com"));
        for id in ["pending", "failed", "p-young"] {
            assert_eq!(row(&db, id).await.release_reason, Some(2), "{id}");
            assert!(row(&db, id).await.release_seal.is_some(), "{id}");
        }
        let older = row(&db, "p-old").await;
        assert_eq!((older.held_domain, older.released_at), (None, None));
        assert!(
            older.expires_at.is_some(),
            "a kept pending claim starts its 7 days"
        );
    }

    #[tokio::test]
    async fn a_claim_released_before_the_migration_does_not_compete() {
        let db = old_db().await;
        old_row(&db, "gone", "status.example.com", 1, Some(5), 1).await;
        old_row(&db, "live", "status.example.com", 0, None, 20).await;

        migrate(&db).await;

        assert_eq!(row(&db, "live").await.released_at, None);
        assert_eq!(row(&db, "gone").await.release_reason, None);
    }

    #[tokio::test]
    async fn a_released_claim_is_sealed_and_holds_nothing() {
        let db = old_db().await;
        old_row(&db, "gone", "status.example.com", 1, Some(77), 10).await;
        old_row(&db, "live", "status.example.com", 1, None, 20).await;

        migrate(&db).await;

        let gone = row(&db, "gone").await;
        assert_eq!(gone.release_seal, Some(77));
        assert_eq!(gone.held_domain, None);
        assert_eq!(gone.expires_at, None);
        assert_eq!(
            row(&db, "live").await.held_domain.as_deref(),
            Some("status.example.com"),
            "a released claim does not compete for the hostname"
        );
    }

    #[tokio::test]
    async fn pending_and_failed_claims_get_seven_days() {
        let db = old_db().await;
        old_row(&db, "pending", "a.example.com", 0, None, 10).await;
        old_row(&db, "failed", "b.example.com", 2, None, 10).await;
        let before = config::utils::time::now_micros();

        migrate(&db).await;

        let after = config::utils::time::now_micros();
        for id in ["pending", "failed"] {
            let claim = row(&db, id).await;
            let expires_at = claim.expires_at.unwrap();
            assert!(
                (before + CLAIM_TTL_MICROS..=after + CLAIM_TTL_MICROS).contains(&expires_at),
                "{id}: {expires_at}"
            );
            assert_eq!(claim.held_domain, None);
        }
    }

    #[tokio::test]
    async fn a_second_run_changes_nothing() {
        let db = old_db().await;
        old_row(&db, "old", "status.example.com", 1, None, 10).await;
        old_row(&db, "young", "status.example.com", 1, None, 20).await;
        old_row(&db, "pending", "a.example.com", 0, None, 10).await;
        old_row(&db, "gone", "b.example.com", 1, Some(77), 10).await;
        migrate(&db).await;
        let first = domains::Entity::find().all(&db).await.unwrap();

        migrate(&db).await;

        assert_eq!(domains::Entity::find().all(&db).await.unwrap(), first);
    }

    #[tokio::test]
    async fn two_holders_of_one_hostname_are_refused_by_the_index() {
        let db = old_db().await;
        old_row(&db, "a", "status.example.com", 0, None, 10).await;
        old_row(&db, "b", "status.example.com", 0, None, 20).await;
        migrate(&db).await;
        let hold = |id: &str| format!("UPDATE {TABLE} SET held_domain = domain WHERE id = '{id}'");

        db.execute_unprepared(&hold("a")).await.unwrap();

        assert!(db.execute_unprepared(&hold("b")).await.is_err());
    }

    #[tokio::test]
    async fn down_removes_the_columns_and_the_index() {
        let db = old_db().await;
        migrate(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.down(&manager).await.unwrap();

        assert!(!manager.has_index(TABLE, HELD_DOMAIN_INDEX).await.unwrap());
        for (name, _) in new_columns() {
            assert!(!manager.has_column(TABLE, name).await.unwrap(), "{name}");
        }
    }

    #[test]
    fn postgres() {
        let [(_, held_domain), ..] = new_columns();
        collapsed_eq!(
            &add_column_stmt(held_domain).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "status_page_custom_domains" ADD COLUMN "held_domain" varchar(253) NULL"#
        );
        collapsed_eq!(
            &held_domain_index_stmt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "status_page_custom_domains_held_domain_uidx" ON "status_page_custom_domains" ("held_domain")"#
        );
        collapsed_eq!(
            &seal_released_stmt().to_string(PostgresQueryBuilder),
            r#"UPDATE "status_page_custom_domains" SET "release_seal" = "released_at" WHERE "released_at" IS NOT NULL AND "release_seal" IS NULL"#
        );
    }

    #[test]
    fn sqlite() {
        let [.., (_, expires_at)] = new_columns();
        collapsed_eq!(
            &add_column_stmt(expires_at).to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "status_page_custom_domains" ADD COLUMN "expires_at" bigint NULL"#
        );
        collapsed_eq!(
            &held_domain_index_stmt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "status_page_custom_domains_held_domain_uidx" ON "status_page_custom_domains" ("held_domain")"#
        );
        collapsed_eq!(
            &start_expiry_stmt(9).to_string(SqliteQueryBuilder),
            r#"UPDATE "status_page_custom_domains" SET "expires_at" = 9 WHERE "released_at" IS NULL AND "release_seal" IS NULL AND "held_domain" IS NULL AND "expires_at" IS NULL"#
        );
    }
}
