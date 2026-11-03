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

use config::meta::slack::SlackChannelDefault;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, Select, Set,
    TransactionTrait, sea_query::OnConflict,
};

use super::{
    entity::slack_channel_defaults::{ActiveModel, Column, Entity, Model},
    slack_shared::{db_err, decode_all, enum_text, parse_enum},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn put(row: &SlackChannelDefault) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

/// False when the channel already has a live default; a tombstoned row counts as none.
pub async fn insert_if_absent(row: &SlackChannelDefault) -> Result<bool, Error> {
    insert_if_absent_with(get_orm_client_rw().await, row).await
}

pub async fn get(
    installation_id: &str,
    channel_id: &str,
) -> Result<Option<SlackChannelDefault>, Error> {
    get_with(get_orm_client_ro().await, installation_id, channel_id).await
}

pub async fn list_by_installation(
    installation_id: &str,
) -> Result<Vec<SlackChannelDefault>, Error> {
    list_by_installation_with(get_orm_client_ro().await, installation_id).await
}

pub async fn delete(installation_id: &str, channel_id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, installation_id, channel_id).await
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn put_with<C: ConnectionTrait>(
    conn: &C,
    row: &SlackChannelDefault,
) -> Result<(), Error> {
    let key = [Column::InstallationId, Column::ChannelId];
    Entity::insert(to_active(row)?)
        .on_conflict(
            OnConflict::columns(key)
                .update_columns(
                    Column::iter()
                        .filter(|c| !matches!(c, Column::InstallationId | Column::ChannelId)),
                )
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn insert_if_absent_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    row: &SlackChannelDefault,
) -> Result<bool, Error> {
    let txn = conn.begin().await?;
    Entity::delete_many()
        .filter(Column::InstallationId.eq(&row.installation_id))
        .filter(Column::ChannelId.eq(&row.channel_id))
        .filter(Column::DeletedAt.is_not_null())
        .exec(&txn)
        .await?;
    let inserted = Entity::insert(to_active(row)?)
        .on_conflict(
            OnConflict::columns([Column::InstallationId, Column::ChannelId])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&txn)
        .await
        .map_err(db_err)?;
    txn.commit().await?;
    Ok(inserted > 0)
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    channel_id: &str,
) -> Result<Option<SlackChannelDefault>, Error> {
    live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ChannelId.eq(channel_id))
        .one(conn)
        .await?
        .map(from_model)
        .transpose()
}

pub async fn list_by_installation_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
) -> Result<Vec<SlackChannelDefault>, Error> {
    let models = live()
        .filter(Column::InstallationId.eq(installation_id))
        .order_by_asc(Column::ChannelId)
        .all(conn)
        .await?;
    Ok(decode_all(
        "slack_channel_defaults",
        models,
        |m| format!("{}/{}", m.installation_id, m.channel_id),
        from_model,
    ))
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    channel_id: &str,
) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ChannelId.eq(channel_id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

fn to_active(row: &SlackChannelDefault) -> Result<ActiveModel, Error> {
    Ok(ActiveModel {
        installation_id: Set(row.installation_id.clone()),
        channel_id: Set(row.channel_id.clone()),
        channel_name: Set(row.channel_name.clone()),
        org_id: Set(row.org_id.clone()),
        answer_mode: Set(enum_text(&row.answer_mode)?),
        set_from: Set(enum_text(&row.set_from)?),
        updated_by: Set(row.updated_by.clone()),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
    })
}

fn from_model(model: Model) -> Result<SlackChannelDefault, Error> {
    Ok(SlackChannelDefault {
        installation_id: model.installation_id,
        channel_id: model.channel_id,
        channel_name: model.channel_name,
        org_id: model.org_id,
        answer_mode: parse_enum("answer_mode", &model.answer_mode)?,
        set_from: parse_enum("set_from", &model.set_from)?,
        updated_by: model.updated_by,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::slack::{AnswerMode, SetFrom};
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::slack::create_tables_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn channel(installation_id: &str, channel_id: &str, org_id: &str) -> SlackChannelDefault {
        SlackChannelDefault {
            installation_id: installation_id.to_string(),
            channel_id: channel_id.to_string(),
            channel_name: format!("ops-{channel_id}"),
            org_id: org_id.to_string(),
            answer_mode: AnswerMode::Private,
            set_from: SetFrom::Install,
            updated_by: "admin@acme.com".to_string(),
            updated_at: 200,
            origin_region: "default".to_string(),
            deleted_at: None,
        }
    }

    fn channel_ids(rows: Vec<SlackChannelDefault>) -> Vec<String> {
        rows.into_iter().map(|r| r.channel_id).collect()
    }

    #[tokio::test]
    async fn every_column_reads_back_and_put_replaces() {
        let db = db().await;
        let row = channel("i1", "C1", "acme");
        put_with(&db, &row).await.unwrap();
        assert_eq!(get_with(&db, "i1", "C1").await.unwrap(), Some(row.clone()));
        let replaced = SlackChannelDefault {
            org_id: "globex".to_string(),
            answer_mode: AnswerMode::Thread,
            set_from: SetFrom::Destination,
            updated_at: 300,
            ..row
        };
        put_with(&db, &replaced).await.unwrap();
        assert_eq!(get_with(&db, "i1", "C1").await.unwrap(), Some(replaced));
    }

    #[tokio::test]
    async fn lists_and_deletes() {
        let db = db().await;
        put_with(&db, &channel("i1", "C2", "acme")).await.unwrap();
        put_with(&db, &channel("i1", "C1", "globex")).await.unwrap();
        put_with(&db, &channel("i2", "C1", "acme")).await.unwrap();
        put_with(
            &db,
            &SlackChannelDefault {
                deleted_at: Some(1),
                ..channel("i1", "C3", "acme")
            },
        )
        .await
        .unwrap();
        assert_eq!(
            channel_ids(list_by_installation_with(&db, "i1").await.unwrap()),
            ["C1", "C2"]
        );
        assert_eq!(get_with(&db, "i1", "C3").await.unwrap(), None);
        delete_with(&db, "i1", "C1").await.unwrap();
        assert_eq!(get_with(&db, "i1", "C1").await.unwrap(), None);
        assert_eq!(delete_by_org_with(&db, "acme").await.unwrap(), 3);
        assert!(
            list_by_installation_with(&db, "i1")
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            list_by_installation_with(&db, "i2")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn insert_if_absent_keeps_a_live_default_and_replaces_a_tombstone() {
        let db = db().await;
        let first = channel("i1", "C1", "acme");
        let second = SlackChannelDefault {
            org_id: "globex".to_string(),
            set_from: SetFrom::Destination,
            ..channel("i1", "C1", "globex")
        };
        let (a, b) = tokio::join!(
            insert_if_absent_with(&db, &first),
            insert_if_absent_with(&db, &second)
        );
        assert_eq!([a.unwrap(), b.unwrap()], [true, false]);
        assert_eq!(
            list_by_installation_with(&db, "i1").await.unwrap(),
            vec![first]
        );
        put_with(
            &db,
            &SlackChannelDefault {
                deleted_at: Some(1),
                ..channel("i1", "C2", "acme")
            },
        )
        .await
        .unwrap();
        let fresh = SlackChannelDefault {
            set_from: SetFrom::Destination,
            ..channel("i1", "C2", "globex")
        };
        assert!(insert_if_absent_with(&db, &fresh).await.unwrap());
        assert_eq!(get_with(&db, "i1", "C2").await.unwrap(), Some(fresh));
    }
}
