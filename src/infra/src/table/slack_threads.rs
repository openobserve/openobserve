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

use config::{
    meta::slack::{SlackThread, SlackThreadKey},
    utils::json,
};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder,
    QuerySelect, Select, Set,
    sea_query::{Expr, OnConflict},
};

use super::{
    entity::slack_threads::{ActiveModel, Column, Entity, Model},
    slack_shared::{db_err, decode_pages, enum_text, parse_enum, parse_json, with_region},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

/// (expires_at, installation_id, channel_id, thread_ts) of the last raw row read.
type ExpiredCursor = (i64, String, String, String);

pub async fn put(row: &SlackThread) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(
    installation_id: &str,
    channel_id: &str,
    thread_ts: &str,
) -> Result<Option<SlackThread>, Error> {
    get_with(
        get_orm_client_ro().await,
        installation_id,
        channel_id,
        thread_ts,
    )
    .await
}

pub async fn touch(
    key: &SlackThreadKey,
    last_activity_at: i64,
    expires_at: i64,
) -> Result<(), Error> {
    touch_with(get_orm_client_rw().await, key, last_activity_at, expires_at).await
}

pub async fn list_expired(before: i64, limit: u64) -> Result<Vec<SlackThread>, Error> {
    list_expired_with(get_orm_client_ro().await, before, limit).await
}

pub async fn delete(key: &SlackThreadKey) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, key).await
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_installation(installation_id: &str) -> Result<u64, Error> {
    delete_by_installation_with(get_orm_client_rw().await, installation_id).await
}

/// Marks the org's live rows in the installation as removed; they keep their expiry.
pub async fn mark_org_removed(
    installation_id: &str,
    org_id: &str,
    at: i64,
    origin_region: &str,
) -> Result<u64, Error> {
    mark_org_removed_with(
        get_orm_client_rw().await,
        installation_id,
        org_id,
        at,
        Some(origin_region),
    )
    .await
}

pub async fn put_with<C: ConnectionTrait>(conn: &C, row: &SlackThread) -> Result<(), Error> {
    let key = [Column::InstallationId, Column::ChannelId, Column::ThreadTs];
    Entity::insert(to_active(row)?)
        .on_conflict(
            OnConflict::columns(key)
                .update_columns(Column::iter().filter(|c| {
                    !matches!(
                        c,
                        Column::InstallationId | Column::ChannelId | Column::ThreadTs
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
    installation_id: &str,
    channel_id: &str,
    thread_ts: &str,
) -> Result<Option<SlackThread>, Error> {
    live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ChannelId.eq(channel_id))
        .filter(Column::ThreadTs.eq(thread_ts))
        .one(conn)
        .await?
        .map(from_model)
        .transpose()
}

pub async fn touch_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackThreadKey,
    last_activity_at: i64,
    expires_at: i64,
) -> Result<(), Error> {
    touch_columns(conn, key, last_activity_at, expires_at, None).await
}

pub async fn touch_in_region_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackThreadKey,
    last_activity_at: i64,
    expires_at: i64,
    origin_region: &str,
) -> Result<(), Error> {
    touch_columns(conn, key, last_activity_at, expires_at, Some(origin_region)).await
}

pub async fn list_expired_with<C: ConnectionTrait>(
    conn: &C,
    before: i64,
    limit: u64,
) -> Result<Vec<SlackThread>, Error> {
    decode_pages(
        "slack_threads",
        limit,
        None,
        |after, n| expired_page(conn, before, after, n),
        |m: &Model| {
            (
                m.expires_at,
                m.installation_id.clone(),
                m.channel_id.clone(),
                m.thread_ts.clone(),
            )
        },
        |m| format!("{}/{}/{}", m.installation_id, m.channel_id, m.thread_ts),
        from_model,
    )
    .await
}

pub async fn delete_with<C: ConnectionTrait>(conn: &C, key: &SlackThreadKey) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::InstallationId.eq(&key.installation_id))
        .filter(Column::ChannelId.eq(&key.channel_id))
        .filter(Column::ThreadTs.eq(&key.thread_ts))
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

pub async fn delete_by_installation_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::InstallationId.eq(installation_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

pub async fn mark_org_removed_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    org_id: &str,
    at: i64,
    origin_region: Option<&str>,
) -> Result<u64, Error> {
    let update = Entity::update_many()
        .col_expr(Column::OrgRemovedAt, Expr::value(at))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    let result = with_region(update, Column::OriginRegion, origin_region)
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::OrgRemovedAt.is_null())
        .filter(Column::DeletedAt.is_null())
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

async fn touch_columns<C: ConnectionTrait>(
    conn: &C,
    key: &SlackThreadKey,
    last_activity_at: i64,
    expires_at: i64,
    origin_region: Option<&str>,
) -> Result<(), Error> {
    let update = Entity::update_many()
        .col_expr(Column::LastActivityAt, Expr::value(last_activity_at))
        .col_expr(Column::ExpiresAt, Expr::value(expires_at))
        .col_expr(Column::UpdatedAt, Expr::value(last_activity_at));
    with_region(update, Column::OriginRegion, origin_region)
        .filter(Column::InstallationId.eq(&key.installation_id))
        .filter(Column::ChannelId.eq(&key.channel_id))
        .filter(Column::ThreadTs.eq(&key.thread_ts))
        .exec(conn)
        .await?;
    Ok(())
}

/// Raw rows in (expires_at, key) order, so the cursor moves past rows that fail to decode.
async fn expired_page<C: ConnectionTrait>(
    conn: &C,
    before: i64,
    after: Option<ExpiredCursor>,
    limit: u64,
) -> Result<Vec<Model>, Error> {
    let mut query = live().filter(Column::ExpiresAt.lt(before));
    if let Some((expires_at, installation_id, channel_id, thread_ts)) = after {
        let same_expiry = Condition::all().add(Column::ExpiresAt.eq(expires_at));
        let same_installation = same_expiry
            .clone()
            .add(Column::InstallationId.eq(installation_id.clone()));
        let same_channel = same_installation
            .clone()
            .add(Column::ChannelId.eq(channel_id.clone()));
        query = query.filter(
            Condition::any()
                .add(Column::ExpiresAt.gt(expires_at))
                .add(same_expiry.add(Column::InstallationId.gt(installation_id)))
                .add(same_installation.add(Column::ChannelId.gt(channel_id)))
                .add(same_channel.add(Column::ThreadTs.gt(thread_ts))),
        );
    }
    Ok(query
        .order_by_asc(Column::ExpiresAt)
        .order_by_asc(Column::InstallationId)
        .order_by_asc(Column::ChannelId)
        .order_by_asc(Column::ThreadTs)
        .limit(limit)
        .all(conn)
        .await?)
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

fn to_active(row: &SlackThread) -> Result<ActiveModel, Error> {
    Ok(ActiveModel {
        installation_id: Set(row.installation_id.clone()),
        channel_id: Set(row.channel_id.clone()),
        thread_ts: Set(row.thread_ts.clone()),
        org_id: Set(row.org_id.clone()),
        kind: Set(enum_text(&row.kind)?),
        assistant_session_id: Set(row.assistant_session_id.clone()),
        started_by_link_id: Set(row.started_by_link_id.clone()),
        shared_urls: Set(Some(json::to_string(&row.shared_urls)?)),
        bot_answers: Set(Some(json::to_string(&row.bot_answers)?)),
        created_at: Set(row.created_at),
        last_activity_at: Set(row.last_activity_at),
        expires_at: Set(row.expires_at),
        org_removed_at: Set(row.org_removed_at),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
    })
}

fn from_model(model: Model) -> Result<SlackThread, Error> {
    Ok(SlackThread {
        installation_id: model.installation_id,
        channel_id: model.channel_id,
        thread_ts: model.thread_ts,
        org_id: model.org_id,
        kind: parse_enum("kind", &model.kind)?,
        assistant_session_id: model.assistant_session_id,
        started_by_link_id: model.started_by_link_id,
        shared_urls: parse_json("shared_urls", model.shared_urls.as_deref())?,
        bot_answers: parse_json("bot_answers", model.bot_answers.as_deref())?,
        created_at: model.created_at,
        last_activity_at: model.last_activity_at,
        expires_at: model.expires_at,
        org_removed_at: model.org_removed_at,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::slack::{BotAnswer, SharedUrl, ThreadKind};
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::slack::create_tables_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn thread(thread_ts: &str, org_id: &str, expires_at: i64) -> SlackThread {
        SlackThread {
            installation_id: "i1".to_string(),
            channel_id: "C1".to_string(),
            thread_ts: thread_ts.to_string(),
            org_id: org_id.to_string(),
            kind: ThreadKind::Link,
            assistant_session_id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b".to_string(),
            started_by_link_id: Some("l1".to_string()),
            shared_urls: vec![SharedUrl {
                message_ts: "1700000000.000300".to_string(),
                url: "https://o2.acme.com/web/logs?org_identifier=acme".to_string(),
            }],
            bot_answers: vec![
                BotAnswer {
                    ts: "1700000000.000400".to_string(),
                    text: "p95 rose at 10:02".to_string(),
                },
                BotAnswer {
                    ts: "1700000000.000500".to_string(),
                    text: "cause: \"db pool\"".to_string(),
                },
            ],
            created_at: 100,
            last_activity_at: 150,
            expires_at,
            org_removed_at: None,
            updated_at: 150,
            origin_region: "default".to_string(),
            deleted_at: None,
        }
    }

    fn key(thread_ts: &str) -> SlackThreadKey {
        SlackThreadKey {
            installation_id: "i1".to_string(),
            channel_id: "C1".to_string(),
            thread_ts: thread_ts.to_string(),
        }
    }

    fn tss(rows: Vec<SlackThread>) -> Vec<String> {
        rows.into_iter().map(|r| r.thread_ts).collect()
    }

    #[tokio::test]
    async fn every_column_reads_back_including_json() {
        let db = db().await;
        let row = thread("1.1", "acme", 1_000);
        put_with(&db, &row).await.unwrap();
        assert_eq!(get_with(&db, "i1", "C1", "1.1").await.unwrap(), Some(row));
        let empty = SlackThread {
            kind: ThreadKind::Question,
            started_by_link_id: None,
            shared_urls: vec![],
            bot_answers: vec![],
            ..thread("1.2", "acme", 1_000)
        };
        put_with(&db, &empty).await.unwrap();
        assert_eq!(get_with(&db, "i1", "C1", "1.2").await.unwrap(), Some(empty));
        let marked = SlackThread {
            org_removed_at: Some(120),
            ..thread("1.3", "acme", 1_000)
        };
        put_with(&db, &marked).await.unwrap();
        assert_eq!(
            get_with(&db, "i1", "C1", "1.3").await.unwrap(),
            Some(marked)
        );
    }

    #[tokio::test]
    async fn touch_moves_activity_and_expiry() {
        let db = db().await;
        let row = thread("1.1", "acme", 1_000);
        put_with(&db, &row).await.unwrap();
        touch_with(&db, &key("1.1"), 500, 2_000).await.unwrap();
        assert_eq!(
            get_with(&db, "i1", "C1", "1.1").await.unwrap(),
            Some(SlackThread {
                last_activity_at: 500,
                expires_at: 2_000,
                updated_at: 500,
                ..row
            })
        );
    }

    #[tokio::test]
    async fn region_aware_touch_writes_both_replication_columns() {
        let db = db().await;
        let row = thread("1.1", "acme", 1_000);
        put_with(&db, &row).await.unwrap();
        touch_in_region_with(&db, &key("1.1"), 500, 2_000, "eu-west")
            .await
            .unwrap();
        assert_eq!(
            get_with(&db, "i1", "C1", "1.1").await.unwrap(),
            Some(SlackThread {
                last_activity_at: 500,
                expires_at: 2_000,
                updated_at: 500,
                origin_region: "eu-west".to_string(),
                ..row
            })
        );
    }

    #[tokio::test]
    async fn list_expired_is_oldest_first_and_limited() {
        let db = db().await;
        for (ts, expires_at) in [("1.3", 300), ("1.1", 100), ("1.2", 200), ("1.9", 900)] {
            put_with(&db, &thread(ts, "acme", expires_at))
                .await
                .unwrap();
        }
        put_with(
            &db,
            &SlackThread {
                deleted_at: Some(1),
                ..thread("1.0", "acme", 50)
            },
        )
        .await
        .unwrap();
        assert_eq!(
            tss(list_expired_with(&db, 500, 2).await.unwrap()),
            ["1.1", "1.2"]
        );
        assert_eq!(
            tss(list_expired_with(&db, 500, 10).await.unwrap()),
            ["1.1", "1.2", "1.3"]
        );
        assert!(list_expired_with(&db, 100, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_expired_fills_the_page_past_undecodable_rows() {
        let db = db().await;
        for (ts, expires_at) in [("1.1", 100), ("1.2", 100), ("1.3", 100), ("1.4", 200)] {
            put_with(&db, &thread(ts, "acme", expires_at))
                .await
                .unwrap();
        }
        let other_channel = SlackThread {
            channel_id: "C0".to_string(),
            ..thread("1.9", "acme", 100)
        };
        put_with(&db, &other_channel).await.unwrap();
        db.execute_unprepared(
            "UPDATE slack_threads SET kind = 'from_a_newer_release' \
             WHERE thread_ts IN ('1.1', '1.2')",
        )
        .await
        .unwrap();
        assert_eq!(
            tss(list_expired_with(&db, 500, 2).await.unwrap()),
            ["1.9", "1.3"]
        );
        assert_eq!(
            tss(list_expired_with(&db, 500, 3).await.unwrap()),
            ["1.9", "1.3", "1.4"]
        );
        assert_eq!(
            tss(list_expired_with(&db, 500, 10).await.unwrap()),
            ["1.9", "1.3", "1.4"]
        );
    }

    #[tokio::test]
    async fn deletes_by_key_and_org() {
        let db = db().await;
        put_with(&db, &thread("1.1", "acme", 100)).await.unwrap();
        put_with(&db, &thread("1.2", "acme", 100)).await.unwrap();
        put_with(&db, &thread("1.3", "globex", 100)).await.unwrap();
        delete_with(&db, &key("1.1")).await.unwrap();
        assert_eq!(get_with(&db, "i1", "C1", "1.1").await.unwrap(), None);
        assert_eq!(delete_by_org_with(&db, "acme").await.unwrap(), 1);
        assert_eq!(
            tss(list_expired_with(&db, 1_000, 10).await.unwrap()),
            ["1.3"]
        );
    }

    #[tokio::test]
    async fn delete_by_installation_keeps_other_installations() {
        let db = db().await;
        put_with(&db, &thread("1.1", "acme", 100)).await.unwrap();
        put_with(&db, &thread("1.2", "globex", 100)).await.unwrap();
        let other = SlackThread {
            installation_id: "i2".to_string(),
            ..thread("1.1", "acme", 100)
        };
        put_with(&db, &other).await.unwrap();
        assert_eq!(delete_by_installation_with(&db, "i1").await.unwrap(), 2);
        assert_eq!(get_with(&db, "i1", "C1", "1.1").await.unwrap(), None);
        assert_eq!(get_with(&db, "i1", "C1", "1.2").await.unwrap(), None);
        assert_eq!(get_with(&db, "i2", "C1", "1.1").await.unwrap(), Some(other));
        assert_eq!(delete_by_installation_with(&db, "i1").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn mark_org_removed_marks_only_that_orgs_live_rows_in_that_installation() {
        let db = db().await;
        put_with(&db, &thread("1.1", "acme", 100)).await.unwrap();
        put_with(&db, &thread("1.2", "globex", 100)).await.unwrap();
        let other = SlackThread {
            installation_id: "i2".to_string(),
            ..thread("1.1", "acme", 100)
        };
        put_with(&db, &other).await.unwrap();
        let gone = SlackThread {
            deleted_at: Some(1),
            ..thread("1.4", "acme", 100)
        };
        put_with(&db, &gone).await.unwrap();
        assert_eq!(
            mark_org_removed_with(&db, "i1", "acme", 500, Some("eu"))
                .await
                .unwrap(),
            1
        );
        let row = get_with(&db, "i1", "C1", "1.1").await.unwrap().unwrap();
        assert_eq!(
            (
                row.org_removed_at,
                row.updated_at,
                row.origin_region.as_str()
            ),
            (Some(500), 500, "eu")
        );
        assert_eq!(row.expires_at, 100, "a marked row keeps its expiry");
        assert_eq!(
            mark_org_removed_with(&db, "i1", "acme", 600, None)
                .await
                .unwrap(),
            0,
            "a marked row keeps its first mark"
        );
        let untouched = get_with(&db, "i1", "C1", "1.2").await.unwrap().unwrap();
        assert_eq!(untouched.org_removed_at, None);
        assert_eq!(get_with(&db, "i2", "C1", "1.1").await.unwrap(), Some(other));
        assert_eq!(
            tss(list_expired_with(&db, 1_000, 10).await.unwrap()),
            ["1.1", "1.2", "1.1"],
            "the sweep still expires a marked row"
        );
    }
}
