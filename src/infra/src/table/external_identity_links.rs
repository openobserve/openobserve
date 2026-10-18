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

use config::meta::slack::{ExternalIdentityLink, RevokedReason};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, QuerySelect,
    Select, Set,
    sea_query::{Expr, OnConflict},
};

use super::{
    entity::external_identity_links::{ActiveModel, Column, Entity, Model},
    slack_shared::{db_err, decode_all, enum_text, parse_enum},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

const PROVIDER: &str = "slack";

/// Upserts on (provider, installation_id, external_user_id).
pub async fn put(row: &ExternalIdentityLink) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(id: &str) -> Result<Option<ExternalIdentityLink>, Error> {
    get_with(get_orm_client_ro().await, id).await
}

pub async fn get_by_slack_user(
    installation_id: &str,
    external_user_id: &str,
) -> Result<Option<ExternalIdentityLink>, Error> {
    get_by_slack_user_with(get_orm_client_ro().await, installation_id, external_user_id).await
}

pub async fn list_by_installation(
    installation_id: &str,
    cursor: Option<&str>,
    limit: u64,
) -> Result<Vec<ExternalIdentityLink>, Error> {
    list_by_installation_with(get_orm_client_ro().await, installation_id, cursor, limit).await
}

pub async fn list_by_email(email: &str) -> Result<Vec<ExternalIdentityLink>, Error> {
    list_by_email_with(get_orm_client_ro().await, email).await
}

pub async fn revoke(id: &str, reason: RevokedReason, at: i64) -> Result<(), Error> {
    revoke_with(get_orm_client_rw().await, id, reason, at).await
}

/// Column-only update that leaves `updated_at`, so it never overwrites a concurrent revoke.
pub async fn touch_last_used(id: &str, at: i64) -> Result<(), Error> {
    touch_last_used_with(get_orm_client_rw().await, id, at).await
}

pub async fn delete(id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, id).await
}

/// Keeps `unlinked` rows: they are the record that suppresses automatic linking.
pub async fn delete_revoked_before(at: i64) -> Result<u64, Error> {
    delete_revoked_before_with(get_orm_client_rw().await, at).await
}

pub async fn put_with<C: ConnectionTrait>(
    conn: &C,
    row: &ExternalIdentityLink,
) -> Result<(), Error> {
    let key = [
        Column::Provider,
        Column::InstallationId,
        Column::ExternalUserId,
    ];
    Entity::insert(to_active(row)?)
        .on_conflict(
            OnConflict::columns(key)
                .update_columns(Column::iter().filter(|c| {
                    !matches!(
                        c,
                        Column::Provider | Column::InstallationId | Column::ExternalUserId
                    )
                }))
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<ExternalIdentityLink>, Error> {
    live()
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
        .map(from_model)
        .transpose()
}

pub async fn get_by_slack_user_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    external_user_id: &str,
) -> Result<Option<ExternalIdentityLink>, Error> {
    live()
        .filter(Column::Provider.eq(PROVIDER))
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ExternalUserId.eq(external_user_id))
        .one(conn)
        .await?
        .map(from_model)
        .transpose()
}

pub async fn list_by_installation_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    cursor: Option<&str>,
    limit: u64,
) -> Result<Vec<ExternalIdentityLink>, Error> {
    let mut query = live().filter(Column::InstallationId.eq(installation_id));
    if let Some(cursor) = cursor {
        query = query.filter(Column::Id.gt(cursor));
    }
    let models = query
        .order_by_asc(Column::Id)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn list_by_email_with<C: ConnectionTrait>(
    conn: &C,
    email: &str,
) -> Result<Vec<ExternalIdentityLink>, Error> {
    let models = live()
        .filter(Column::UserEmail.eq(email))
        .order_by_asc(Column::Id)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn revoke_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    reason: RevokedReason,
    at: i64,
) -> Result<(), Error> {
    Entity::update_many()
        .col_expr(Column::RevokedAt, Expr::value(at))
        .col_expr(Column::RevokedReason, Expr::value(enum_text(&reason)?))
        .col_expr(Column::UpdatedAt, Expr::value(at))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn touch_last_used_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
) -> Result<(), Error> {
    Entity::update_many()
        .col_expr(Column::LastUsedAt, Expr::value(at))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_with<C: ConnectionTrait>(conn: &C, id: &str) -> Result<(), Error> {
    Entity::delete_by_id(id).exec(conn).await?;
    Ok(())
}

pub async fn delete_revoked_before_with<C: ConnectionTrait>(
    conn: &C,
    at: i64,
) -> Result<u64, Error> {
    let unlinked = enum_text(&RevokedReason::Unlinked)?;
    let result = Entity::delete_many()
        .filter(Column::RevokedAt.lt(at))
        .filter(
            Column::RevokedReason
                .is_null()
                .or(Column::RevokedReason.ne(unlinked)),
        )
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

fn decode_rows(models: Vec<Model>) -> Vec<ExternalIdentityLink> {
    decode_all(
        "external_identity_links",
        models,
        |m| m.id.clone(),
        from_model,
    )
}

fn to_active(row: &ExternalIdentityLink) -> Result<ActiveModel, Error> {
    Ok(ActiveModel {
        id: Set(row.id.clone()),
        provider: Set(row.provider.clone()),
        installation_id: Set(row.installation_id.clone()),
        external_enterprise_id: Set(row.external_enterprise_id.clone()),
        external_team_id: Set(row.external_team_id.clone()),
        external_user_id: Set(row.external_user_id.clone()),
        user_email: Set(row.user_email.clone()),
        default_org_id: Set(row.default_org_id.clone()),
        link_method: Set(enum_text(&row.link_method)?),
        created_at: Set(row.created_at),
        last_used_at: Set(row.last_used_at),
        revoked_at: Set(row.revoked_at),
        revoked_reason: Set(row.revoked_reason.as_ref().map(enum_text).transpose()?),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
    })
}

fn from_model(model: Model) -> Result<ExternalIdentityLink, Error> {
    Ok(ExternalIdentityLink {
        id: model.id,
        provider: model.provider,
        installation_id: model.installation_id,
        external_enterprise_id: model.external_enterprise_id,
        external_team_id: model.external_team_id,
        external_user_id: model.external_user_id,
        user_email: model.user_email,
        default_org_id: model.default_org_id,
        link_method: parse_enum("link_method", &model.link_method)?,
        created_at: model.created_at,
        last_used_at: model.last_used_at,
        revoked_at: model.revoked_at,
        revoked_reason: model
            .revoked_reason
            .as_deref()
            .map(|text| parse_enum("revoked_reason", text))
            .transpose()?,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::slack::LinkMethod;
    use sea_orm::{Database, DatabaseConnection, EntityTrait, PaginatorTrait};

    use super::*;
    use crate::table::{entity::external_identity_links::Entity, slack::create_tables_for_test};

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn link(id: &str, installation_id: &str, user: &str) -> ExternalIdentityLink {
        ExternalIdentityLink {
            id: id.to_string(),
            provider: "slack".to_string(),
            installation_id: installation_id.to_string(),
            external_enterprise_id: "E1".to_string(),
            external_team_id: "T1".to_string(),
            external_user_id: user.to_string(),
            user_email: format!("{user}@acme.com").to_lowercase(),
            default_org_id: "acme".to_string(),
            link_method: LinkMethod::Email,
            created_at: 100,
            last_used_at: 150,
            revoked_at: None,
            revoked_reason: None,
            updated_at: 200,
            origin_region: "default".to_string(),
            deleted_at: None,
        }
    }

    fn revoked(
        mut row: ExternalIdentityLink,
        reason: RevokedReason,
        at: i64,
    ) -> ExternalIdentityLink {
        row.revoked_at = Some(at);
        row.revoked_reason = Some(reason);
        row
    }

    fn ids(rows: Vec<ExternalIdentityLink>) -> Vec<String> {
        rows.into_iter().map(|r| r.id).collect()
    }

    #[tokio::test]
    async fn every_column_reads_back_as_written() {
        let db = db().await;
        let row = ExternalIdentityLink {
            link_method: LinkMethod::AdminBulk,
            ..revoked(link("l1", "i1", "U1"), RevokedReason::SlackUserDeleted, 300)
        };
        put_with(&db, &row).await.unwrap();
        assert_eq!(get_with(&db, "l1").await.unwrap(), Some(row.clone()));
        assert_eq!(
            get_by_slack_user_with(&db, "i1", "U1").await.unwrap(),
            Some(row)
        );
    }

    #[tokio::test]
    async fn relink_replaces_the_row() {
        let db = db().await;
        put_with(
            &db,
            &revoked(link("l1", "i1", "U1"), RevokedReason::Unlinked, 300),
        )
        .await
        .unwrap();
        let relinked = ExternalIdentityLink {
            user_email: "new@acme.com".to_string(),
            link_method: LinkMethod::Oidc,
            created_at: 400,
            ..link("l2", "i1", "U1")
        };
        put_with(&db, &relinked).await.unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 1);
        assert_eq!(get_with(&db, "l1").await.unwrap(), None);
        assert_eq!(
            get_by_slack_user_with(&db, "i1", "U1").await.unwrap(),
            Some(relinked)
        );
        put_with(&db, &link("l3", "i2", "U1")).await.unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn touch_is_column_only() {
        let db = db().await;
        put_with(&db, &link("l1", "i1", "U1")).await.unwrap();
        let read = get_with(&db, "l1").await.unwrap().unwrap();

        touch_last_used_with(&db, "l1", 250).await.unwrap();
        let touched = get_with(&db, "l1").await.unwrap().unwrap();
        assert_eq!(
            touched,
            ExternalIdentityLink {
                last_used_at: 250,
                ..read.clone()
            }
        );

        revoke_with(&db, "l1", RevokedReason::UserRemoved, 500)
            .await
            .unwrap();
        touch_last_used_with(&db, "l1", 600).await.unwrap();
        let after = get_with(&db, "l1").await.unwrap().unwrap();
        assert_eq!(
            after,
            ExternalIdentityLink {
                last_used_at: 600,
                revoked_at: Some(500),
                revoked_reason: Some(RevokedReason::UserRemoved),
                updated_at: 500,
                ..read
            }
        );
    }

    #[tokio::test]
    async fn list_by_installation_pages_by_cursor() {
        let db = db().await;
        for (id, user) in [
            ("l5", "U5"),
            ("l1", "U1"),
            ("l3", "U3"),
            ("l2", "U2"),
            ("l4", "U4"),
        ] {
            put_with(&db, &link(id, "i1", user)).await.unwrap();
        }
        put_with(&db, &link("l0", "i2", "U9")).await.unwrap();
        let mut gone = link("l6", "i1", "U6");
        gone.deleted_at = Some(1);
        put_with(&db, &gone).await.unwrap();

        let page = |cursor: Option<&'static str>| {
            let db = &db;
            async move {
                ids(list_by_installation_with(db, "i1", cursor, 2)
                    .await
                    .unwrap())
            }
        };
        assert_eq!(page(None).await, ["l1", "l2"]);
        assert_eq!(page(Some("l2")).await, ["l3", "l4"]);
        assert_eq!(page(Some("l4")).await, ["l5"]);
        assert!(page(Some("l5")).await.is_empty());
    }

    #[tokio::test]
    async fn list_by_email_and_deleted_rows_are_ignored() {
        let db = db().await;
        put_with(&db, &link("l1", "i1", "U1")).await.unwrap();
        put_with(
            &db,
            &ExternalIdentityLink {
                user_email: "u1@acme.com".to_string(),
                ..link("l2", "i2", "U7")
            },
        )
        .await
        .unwrap();
        put_with(
            &db,
            &ExternalIdentityLink {
                user_email: "u1@acme.com".to_string(),
                deleted_at: Some(9),
                ..link("l3", "i3", "U8")
            },
        )
        .await
        .unwrap();
        let mut found = ids(list_by_email_with(&db, "u1@acme.com").await.unwrap());
        found.sort();
        assert_eq!(found, ["l1", "l2"]);
        assert_eq!(get_with(&db, "l3").await.unwrap(), None);
        assert_eq!(get_by_slack_user_with(&db, "i3", "U8").await.unwrap(), None);
    }

    #[tokio::test]
    async fn delete_revoked_before_keeps_unlinked_rows() {
        let db = db().await;
        let rows = [
            revoked(link("l1", "i1", "U1"), RevokedReason::UserRemoved, 100),
            revoked(link("l2", "i1", "U2"), RevokedReason::Unlinked, 100),
            revoked(link("l3", "i1", "U3"), RevokedReason::OrgDeleted, 300),
            link("l4", "i1", "U4"),
        ];
        for row in &rows {
            put_with(&db, row).await.unwrap();
        }
        assert_eq!(delete_revoked_before_with(&db, 200).await.unwrap(), 1);
        let mut left = ids(list_by_installation_with(&db, "i1", None, 10)
            .await
            .unwrap());
        left.sort();
        assert_eq!(left, ["l2", "l3", "l4"]);
        delete_with(&db, "l4").await.unwrap();
        assert_eq!(get_with(&db, "l4").await.unwrap(), None);
    }
}
