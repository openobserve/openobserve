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

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, sea_query::OnConflict};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::entity::paid_overage_attribution::{ActiveModel, Column, Entity, Model},
};

/// Who last turned paid usage on or off for one `(org, pool)`.
pub async fn get(org_id: &str, pool: &str) -> Result<Option<Model>, sea_orm::DbErr> {
    get_in(get_orm_client_ro().await, org_id, pool).await
}

/// Removes every attribution row of an org, as part of org deletion.
pub async fn delete_by_org(org_id: &str) -> Result<(), sea_orm::DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

/// [`get`] against a caller-supplied connection.
pub(crate) async fn get_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    pool: &str,
) -> Result<Option<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Pool.eq(pool))
        .one(conn)
        .await
}

/// Records `actor` as enabler or revoker and clears the other side, so only the last change shows.
pub(crate) async fn record_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    pool: &str,
    enabled: bool,
    actor: &str,
    now: i64,
) -> Result<(), sea_orm::DbErr> {
    let (by, at) = (Some(actor.to_string()), Some(now));
    let (enabled_by, enabled_at, disabled_by, disabled_at) = if enabled {
        (by, at, None, None)
    } else {
        (None, None, by, at)
    };
    let row = ActiveModel {
        org_id: sea_orm::ActiveValue::Set(org_id.to_string()),
        pool: sea_orm::ActiveValue::Set(pool.to_string()),
        enabled_by_email: sea_orm::ActiveValue::Set(enabled_by),
        enabled_at: sea_orm::ActiveValue::Set(enabled_at),
        disabled_by_email: sea_orm::ActiveValue::Set(disabled_by),
        disabled_at: sea_orm::ActiveValue::Set(disabled_at),
    };
    Entity::insert(row)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::Pool])
                .update_columns([
                    Column::EnabledByEmail,
                    Column::EnabledAt,
                    Column::DisabledByEmail,
                    Column::DisabledAt,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn enabling_records_the_enabler_and_revoking_clears_it() {
        let db = db().await;
        record_in(&db, "acme", "ai_credits", true, "admin@acme.io", 10)
            .await
            .unwrap();
        let row = get_in(&db, "acme", "ai_credits").await.unwrap().unwrap();
        assert_eq!(row.enabled_by_email.as_deref(), Some("admin@acme.io"));
        assert_eq!(row.enabled_at, Some(10));
        assert_eq!(row.disabled_by_email, None);

        record_in(&db, "acme", "ai_credits", false, "owner@acme.io", 20)
            .await
            .unwrap();
        let row = get_in(&db, "acme", "ai_credits").await.unwrap().unwrap();
        assert_eq!(row.enabled_by_email, None);
        assert_eq!(row.enabled_at, None);
        assert_eq!(row.disabled_by_email.as_deref(), Some("owner@acme.io"));
        assert_eq!(row.disabled_at, Some(20));
    }

    #[tokio::test]
    async fn re_enabling_replaces_the_enabler_and_clears_the_revoker() {
        let db = db().await;
        record_in(&db, "acme", "ai_credits", false, "owner@acme.io", 5)
            .await
            .unwrap();
        record_in(&db, "acme", "ai_credits", true, "a@acme.io", 10)
            .await
            .unwrap();
        record_in(&db, "acme", "ai_credits", true, "b@acme.io", 30)
            .await
            .unwrap();
        let row = get_in(&db, "acme", "ai_credits").await.unwrap().unwrap();
        assert_eq!(row.enabled_by_email.as_deref(), Some("b@acme.io"));
        assert_eq!(row.enabled_at, Some(30));
        assert_eq!(row.disabled_by_email, None);
        assert_eq!(row.disabled_at, None);
    }

    #[tokio::test]
    async fn rows_are_scoped_per_org_and_pool() {
        let db = db().await;
        record_in(&db, "acme", "ai_credits", true, "a@acme.io", 10)
            .await
            .unwrap();
        assert!(get_in(&db, "other", "ai_credits").await.unwrap().is_none());
        assert!(
            get_in(&db, "acme", "synthetics_browser_steps")
                .await
                .unwrap()
                .is_none()
        );
    }
}
