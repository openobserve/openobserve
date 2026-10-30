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

use config::{meta::slack::SlackLinkRequest, utils::time::now_micros};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, Iterable, PaginatorTrait, QueryFilter,
    Select, Set,
    sea_query::{Expr, OnConflict},
};

use super::{
    entity::slack_link_requests::{ActiveModel, Column, Entity, Model},
    slack_shared::{db_err, open, seal, secrets_key, with_region},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn put(row: &SlackLinkRequest) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(id: &str) -> Result<Option<SlackLinkRequest>, Error> {
    get_with(get_orm_client_ro().await, id).await
}

/// Counts discarded requests too, so Not now cannot reset the rate limit.
pub async fn count_created_since(
    installation_id: &str,
    external_user_id: &str,
    since: i64,
) -> Result<u64, Error> {
    count_created_since_with(
        get_orm_client_ro().await,
        installation_id,
        external_user_id,
        since,
    )
    .await
}

pub async fn mark_redeemed(id: &str, at: i64) -> Result<(), Error> {
    mark_redeemed_with(get_orm_client_rw().await, id, at).await
}

/// Also drops the held question: Not now must not keep it.
pub async fn mark_discarded(id: &str, at: i64) -> Result<(), Error> {
    mark_discarded_with(get_orm_client_rw().await, id, at).await
}

pub async fn clear_nonce(id: &str) -> Result<(), Error> {
    clear_nonce_with(get_orm_client_rw().await, id).await
}

pub async fn delete_finished_before(at: i64) -> Result<u64, Error> {
    delete_finished_before_with(get_orm_client_rw().await, at).await
}

pub async fn mark_discarded_in_region(id: &str, at: i64, origin_region: &str) -> Result<(), Error> {
    mark_discarded_in_region_with(get_orm_client_rw().await, id, at, origin_region).await
}

pub async fn clear_nonce_in_region(id: &str, at: i64, origin_region: &str) -> Result<(), Error> {
    clear_nonce_in_region_with(get_orm_client_rw().await, id, at, origin_region).await
}

pub async fn put_with<C: ConnectionTrait>(conn: &C, row: &SlackLinkRequest) -> Result<(), Error> {
    let key = secrets_key(row.question.is_some()).await?;
    put_keyed(conn, row, key.as_deref()).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<SlackLinkRequest>, Error> {
    let Some(model) = live().filter(Column::Id.eq(id)).one(conn).await? else {
        return Ok(None);
    };
    let key = secrets_key(model.question_enc.is_some()).await?;
    from_model(model, key.as_deref()).map(Some)
}

pub async fn count_created_since_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    external_user_id: &str,
    since: i64,
) -> Result<u64, Error> {
    Ok(live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ExternalUserId.eq(external_user_id))
        .filter(Column::CreatedAt.gte(since))
        .count(conn)
        .await?)
}

pub async fn mark_redeemed_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
) -> Result<(), Error> {
    mark_redeemed_columns(conn, id, at, None).await
}

pub async fn mark_discarded_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
) -> Result<(), Error> {
    mark_discarded_columns(conn, id, at, None).await
}

pub async fn clear_nonce_with<C: ConnectionTrait>(conn: &C, id: &str) -> Result<(), Error> {
    clear_nonce_columns(conn, id, now_micros(), None).await
}

pub async fn mark_redeemed_in_region_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
    origin_region: &str,
) -> Result<(), Error> {
    mark_redeemed_columns(conn, id, at, Some(origin_region)).await
}

pub async fn mark_discarded_in_region_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
    origin_region: &str,
) -> Result<(), Error> {
    mark_discarded_columns(conn, id, at, Some(origin_region)).await
}

pub async fn clear_nonce_in_region_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
    origin_region: &str,
) -> Result<(), Error> {
    clear_nonce_columns(conn, id, at, Some(origin_region)).await
}

pub async fn delete_finished_before_with<C: ConnectionTrait>(
    conn: &C,
    at: i64,
) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(
            Condition::any()
                .add(Column::ExpiresAt.lt(at))
                .add(Column::RedeemedAt.lt(at))
                .add(Column::DiscardedAt.lt(at)),
        )
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

async fn mark_redeemed_columns<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
    origin_region: Option<&str>,
) -> Result<(), Error> {
    let update = Entity::update_many()
        .col_expr(Column::RedeemedAt, Expr::value(at))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    with_region(update, Column::OriginRegion, origin_region)
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

async fn mark_discarded_columns<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
    origin_region: Option<&str>,
) -> Result<(), Error> {
    let update = Entity::update_many()
        .col_expr(Column::DiscardedAt, Expr::value(at))
        .col_expr(Column::QuestionEnc, Expr::value(Option::<String>::None))
        .col_expr(Column::HeldAction, Expr::value(Option::<String>::None))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    with_region(update, Column::OriginRegion, origin_region)
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

async fn clear_nonce_columns<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    at: i64,
    origin_region: Option<&str>,
) -> Result<(), Error> {
    let update = Entity::update_many()
        .col_expr(Column::OidcNonce, Expr::value(Option::<String>::None))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    with_region(update, Column::OriginRegion, origin_region)
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

async fn put_keyed<C: ConnectionTrait>(
    conn: &C,
    row: &SlackLinkRequest,
    key: Option<&[u8]>,
) -> Result<(), Error> {
    Entity::insert(to_active(row, key)?)
        .on_conflict(
            OnConflict::column(Column::Id)
                .update_columns(Column::iter().filter(|c| !matches!(c, Column::Id)))
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

fn to_active(row: &SlackLinkRequest, key: Option<&[u8]>) -> Result<ActiveModel, Error> {
    Ok(ActiveModel {
        id: Set(row.id.clone()),
        installation_id: Set(row.installation_id.clone()),
        external_user_id: Set(row.external_user_id.clone()),
        workspace_user_id: Set(row.workspace_user_id.clone()),
        channel_id: Set(row.channel_id.clone()),
        thread_ts: Set(row.thread_ts.clone()),
        message_ts: Set(row.message_ts.clone()),
        question_enc: Set(seal(key, row.question.as_deref())?),
        oidc_nonce: Set(row.oidc_nonce.clone()),
        created_at: Set(row.created_at),
        expires_at: Set(row.expires_at),
        redeemed_at: Set(row.redeemed_at),
        discarded_at: Set(row.discarded_at),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
        held_action: Set(row
            .held_action
            .as_ref()
            .and_then(|h| serde_json::to_string(h).ok())),
    })
}

/// An undecryptable question reads as none: the request still redeems, only the replay is lost.
fn from_model(model: Model, key: Option<&[u8]>) -> Result<SlackLinkRequest, Error> {
    let (question, _) = open(key, model.question_enc.as_deref());
    let held_action = model
        .held_action
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok());
    Ok(SlackLinkRequest {
        id: model.id,
        installation_id: model.installation_id,
        external_user_id: model.external_user_id,
        workspace_user_id: model.workspace_user_id,
        channel_id: model.channel_id,
        thread_ts: model.thread_ts,
        message_ts: model.message_ts,
        question,
        oidc_nonce: model.oidc_nonce,
        held_action,
        created_at: model.created_at,
        expires_at: model.expires_at,
        redeemed_at: model.redeemed_at,
        discarded_at: model.discarded_at,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
    })
}

#[cfg(test)]
mod tests {
    use config::{meta::slack::HeldAction, utils::encryption::decrypt_secret_value};
    use sea_orm::{Database, DatabaseConnection, DbBackend, Statement};

    use super::*;
    use crate::table::slack::create_tables_for_test;

    const KEY: [u8; 64] = [6u8; 64];

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn request(id: &str, user: &str, created_at: i64) -> SlackLinkRequest {
        SlackLinkRequest {
            id: id.to_string(),
            installation_id: "i1".to_string(),
            external_user_id: user.to_string(),
            workspace_user_id: format!("W{user}"),
            channel_id: Some("C1".to_string()),
            thread_ts: Some("1700000000.000100".to_string()),
            message_ts: Some("1700000000.000200".to_string()),
            question: Some("why is checkout slow?".to_string()),
            oidc_nonce: Some("nonce-1".to_string()),
            held_action: Some(HeldAction {
                action: "o2_alert_ack".to_string(),
                ref_key: "0193a8f0000070008000000000000000".to_string(),
                value: "0193a8f0000070008000000000000000".to_string(),
                firing_started_at: 1_700_000_000_000_000,
            }),
            created_at,
            expires_at: created_at + 1_800,
            redeemed_at: None,
            discarded_at: None,
            updated_at: created_at,
            origin_region: "default".to_string(),
            deleted_at: None,
        }
    }

    async fn stored_question(db: &DatabaseConnection, id: &str) -> Option<String> {
        db.query_one(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT question_enc FROM slack_link_requests WHERE id = '{id}'"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<Option<String>>("", "question_enc")
        .unwrap()
    }

    async fn stored_model(db: &DatabaseConnection, id: &str) -> Model {
        Entity::find_by_id(id).one(db).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn question_is_stored_aesenc_and_every_column_reads_back() {
        let db = db().await;
        let row = SlackLinkRequest {
            redeemed_at: Some(10),
            discarded_at: Some(11),
            ..request("r1", "U1", 100)
        };
        put_keyed(&db, &row, Some(&KEY)).await.unwrap();
        let stored = stored_question(&db, "r1").await.unwrap();
        assert!(stored.starts_with("AESenc:"), "{stored}");
        assert_eq!(
            decrypt_secret_value(&KEY, &stored).unwrap(),
            "why is checkout slow?"
        );
        assert!(from_model(stored_model(&db, "r1").await, Some(&KEY)).unwrap() == row);
    }

    #[tokio::test]
    async fn no_master_key_stores_null() {
        assert!(!crate::table::cipher::is_encrypting());
        let db = db().await;
        let row = request("r1", "U1", 100);
        put_with(&db, &row).await.unwrap();
        assert_eq!(stored_question(&db, "r1").await, None);
        let read = get_with(&db, "r1").await.unwrap().unwrap();
        assert!(
            read == SlackLinkRequest {
                question: None,
                ..row
            }
        );
    }

    #[tokio::test]
    async fn held_action_is_plain_json_and_not_now_drops_it_with_the_question() {
        let db = db().await;
        put_keyed(&db, &request("r1", "U1", 100), Some(&KEY))
            .await
            .unwrap();
        let raw = stored_model(&db, "r1").await.held_action.unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["action"], "o2_alert_ack");
        assert_eq!(json["firing_started_at"], 1_700_000_000_000_000_i64);
        mark_discarded_with(&db, "r1", 110).await.unwrap();
        let read = get_with(&db, "r1").await.unwrap().unwrap();
        assert!(read.held_action.is_none() && read.question.is_none());
        assert_eq!(read.discarded_at, Some(110));
    }

    #[tokio::test]
    async fn count_created_since_includes_discarded_and_skips_deleted() {
        let db = db().await;
        put_with(&db, &request("r1", "U1", 100)).await.unwrap();
        put_with(&db, &request("r2", "U1", 200)).await.unwrap();
        put_with(&db, &request("r3", "U1", 300)).await.unwrap();
        mark_discarded_with(&db, "r3", 310).await.unwrap();
        put_with(&db, &request("r4", "U2", 300)).await.unwrap();
        put_with(
            &db,
            &SlackLinkRequest {
                deleted_at: Some(1),
                ..request("r5", "U1", 300)
            },
        )
        .await
        .unwrap();
        assert_eq!(
            count_created_since_with(&db, "i1", "U1", 200)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            count_created_since_with(&db, "i1", "U1", 0).await.unwrap(),
            3
        );
        assert_eq!(
            count_created_since_with(&db, "i2", "U1", 0).await.unwrap(),
            0
        );
        assert!(get_with(&db, "r5").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn marks_and_nonce_clearing_touch_only_their_columns() {
        let db = db().await;
        put_keyed(&db, &request("r1", "U1", 100), Some(&KEY))
            .await
            .unwrap();
        put_keyed(&db, &request("r2", "U1", 100), Some(&KEY))
            .await
            .unwrap();

        mark_redeemed_with(&db, "r1", 400).await.unwrap();
        let before = config::utils::time::now_micros();
        clear_nonce_with(&db, "r1").await.unwrap();
        let r1 = from_model(stored_model(&db, "r1").await, Some(&KEY)).unwrap();
        assert!(
            (before..=config::utils::time::now_micros()).contains(&r1.updated_at),
            "clear_nonce stamps updated_at with now: {}",
            r1.updated_at
        );
        assert!(
            r1 == SlackLinkRequest {
                redeemed_at: Some(400),
                oidc_nonce: None,
                updated_at: r1.updated_at,
                ..request("r1", "U1", 100)
            }
        );

        mark_discarded_with(&db, "r2", 500).await.unwrap();
        assert_eq!(stored_question(&db, "r2").await, None);
        let r2 = from_model(stored_model(&db, "r2").await, Some(&KEY)).unwrap();
        assert!(
            r2 == SlackLinkRequest {
                discarded_at: Some(500),
                question: None,
                held_action: None,
                updated_at: 500,
                ..request("r2", "U1", 100)
            }
        );
    }

    #[tokio::test]
    async fn region_aware_marks_and_nonce_clearing_write_both_replication_columns() {
        let db = db().await;
        for id in ["r1", "r2", "r3"] {
            put_keyed(&db, &request(id, "U1", 100), Some(&KEY))
                .await
                .unwrap();
        }
        mark_redeemed_in_region_with(&db, "r1", 400, "eu-west")
            .await
            .unwrap();
        mark_discarded_in_region_with(&db, "r2", 500, "eu-west")
            .await
            .unwrap();
        clear_nonce_in_region_with(&db, "r3", 600, "eu-west")
            .await
            .unwrap();
        let read = |id: &'static str| {
            let db = &db;
            async move { from_model(stored_model(db, id).await, Some(&KEY)).unwrap() }
        };
        assert!(
            read("r1").await
                == SlackLinkRequest {
                    redeemed_at: Some(400),
                    updated_at: 400,
                    origin_region: "eu-west".to_string(),
                    ..request("r1", "U1", 100)
                }
        );
        assert_eq!(stored_question(&db, "r2").await, None);
        assert!(
            read("r2").await
                == SlackLinkRequest {
                    discarded_at: Some(500),
                    question: None,
                    held_action: None,
                    updated_at: 500,
                    origin_region: "eu-west".to_string(),
                    ..request("r2", "U1", 100)
                }
        );
        assert!(
            read("r3").await
                == SlackLinkRequest {
                    oidc_nonce: None,
                    updated_at: 600,
                    origin_region: "eu-west".to_string(),
                    ..request("r3", "U1", 100)
                }
        );
    }

    #[tokio::test]
    async fn delete_finished_before_removes_expired_redeemed_and_discarded() {
        let db = db().await;
        put_with(&db, &request("expired", "U1", 0)).await.unwrap();
        put_with(&db, &request("redeemed", "U2", 5_000))
            .await
            .unwrap();
        mark_redeemed_with(&db, "redeemed", 5_100).await.unwrap();
        put_with(&db, &request("discarded", "U3", 5_000))
            .await
            .unwrap();
        mark_discarded_with(&db, "discarded", 5_100).await.unwrap();
        put_with(&db, &request("recent", "U4", 5_000))
            .await
            .unwrap();
        put_with(&db, &request("open", "U5", 5_000)).await.unwrap();
        mark_redeemed_with(&db, "recent", 6_500).await.unwrap();

        assert_eq!(delete_finished_before_with(&db, 6_000).await.unwrap(), 3);
        let mut left: Vec<String> = Entity::find()
            .all(&db)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.id)
            .collect();
        left.sort();
        assert_eq!(left, ["open", "recent"]);
    }
}
