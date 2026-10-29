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

//! `alert_acks`: one ack per alert group, in force only for the firing it names.

use config::meta::alerts::ack::AlertAck;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, Set,
    TransactionTrait,
    sea_query::{Alias, Expr, OnConflict, Query},
};

use super::{
    entity::{
        alert_acks::{ActiveModel, Column, Entity, Model},
        alert_states,
    },
    slack_alert_messages,
    slack_shared::{decode_all, enum_text, parse_enum},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn get(org_id: &str, alert_id: &str, group_key: &str) -> Result<Option<AlertAck>, Error> {
    get_with(get_orm_client_ro().await, org_id, alert_id, group_key).await
}

pub async fn list_for_alert(org_id: &str, alert_id: &str) -> Result<Vec<AlertAck>, Error> {
    list_for_alert_with(get_orm_client_ro().await, org_id, alert_id).await
}

/// Writes the ack and bumps its Slack messages in one transaction; returns the messages bumped.
pub async fn put_with_outbox(ack: &AlertAck) -> Result<u64, Error> {
    put_with_outbox_with(get_orm_client_rw().await, ack).await
}

/// Writes the ack only when no ack is in force on that firing; `None` when another one holds it.
pub async fn claim_with_outbox(ack: &AlertAck) -> Result<Option<u64>, Error> {
    claim_with_outbox_with(get_orm_client_rw().await, ack).await
}

/// Every ack row of these alerts, for list pages.
pub async fn list_for_alerts(org_id: &str, alert_ids: &[String]) -> Result<Vec<AlertAck>, Error> {
    list_for_alerts_with(get_orm_client_ro().await, org_id, alert_ids).await
}

/// Marks the firing's ack unacknowledged; false when it was not acked.
pub async fn unack_with_outbox(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    unacked_by: &str,
    unacked_at: i64,
) -> Result<bool, Error> {
    unack_with_outbox_with(
        get_orm_client_rw().await,
        org_id,
        alert_id,
        group_key,
        firing_started_at,
        unacked_by,
        unacked_at,
    )
    .await
}

/// Applies a row from another region; false when the stored row is as new or newer.
pub async fn apply_replicated(ack: &AlertAck) -> Result<bool, Error> {
    apply_replicated_with(get_orm_client_rw().await, ack).await
}

pub async fn delete_by_alert(org_id: &str, alert_id: &str) -> Result<u64, Error> {
    delete_by_alert_with(get_orm_client_rw().await, org_id, alert_id).await
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

/// Deletes acks last written before `at` whose firing is no longer the group's current one.
pub async fn delete_ended_before(at: i64) -> Result<u64, Error> {
    delete_ended_before_with(get_orm_client_rw().await, at).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
    group_key: &str,
) -> Result<Option<AlertAck>, Error> {
    Entity::find_by_id((
        org_id.to_string(),
        alert_id.to_string(),
        group_key.to_string(),
    ))
    .one(conn)
    .await?
    .map(from_model)
    .transpose()
}

pub async fn list_for_alert_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
) -> Result<Vec<AlertAck>, Error> {
    let models = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.eq(alert_id))
        .order_by_asc(Column::GroupKey)
        .all(conn)
        .await?;
    Ok(decode_all(
        "alert_acks",
        models,
        |m| format!("{}/{}/{}", m.org_id, m.alert_id, m.group_key),
        from_model,
    ))
}

pub async fn put_with_outbox_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    ack: &AlertAck,
) -> Result<u64, Error> {
    let txn = conn.begin().await?;
    Entity::insert(to_active(ack)?)
        .on_conflict(upsert())
        .exec_without_returning(&txn)
        .await?;
    let bumped = slack_alert_messages::bump_wanted_with(
        &txn,
        &ack.alert_id,
        &ack.group_key,
        ack.firing_started_at,
    )
    .await?;
    txn.commit().await?;
    Ok(bumped)
}

pub async fn claim_with_outbox_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    ack: &AlertAck,
) -> Result<Option<u64>, Error> {
    let txn = conn.begin().await?;
    // The upsert's own WHERE keeps the first of two racing acks of one firing.
    let mut on_conflict = upsert();
    on_conflict.action_and_where(
        Expr::col((Entity, Column::FiringStartedAt))
            .ne(Expr::col((Alias::new("excluded"), Column::FiringStartedAt)))
            .or(Expr::col((Entity, Column::UnackedAt)).is_not_null()),
    );
    let written = Entity::insert(to_active(ack)?)
        .on_conflict(on_conflict)
        .exec_without_returning(&txn)
        .await?;
    if written == 0 {
        txn.rollback().await?;
        return Ok(None);
    }
    let bumped = slack_alert_messages::bump_wanted_with(
        &txn,
        &ack.alert_id,
        &ack.group_key,
        ack.firing_started_at,
    )
    .await?;
    txn.commit().await?;
    Ok(Some(bumped))
}

pub async fn list_for_alerts_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_ids: &[String],
) -> Result<Vec<AlertAck>, Error> {
    if alert_ids.is_empty() {
        return Ok(vec![]);
    }
    let models = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.is_in(alert_ids.to_vec()))
        .order_by_asc(Column::AlertId)
        .order_by_asc(Column::GroupKey)
        .all(conn)
        .await?;
    Ok(decode_all(
        "alert_acks",
        models,
        |m| format!("{}/{}/{}", m.org_id, m.alert_id, m.group_key),
        from_model,
    ))
}

pub async fn unack_with_outbox_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    unacked_by: &str,
    unacked_at: i64,
) -> Result<bool, Error> {
    let txn = conn.begin().await?;
    let result = Entity::update_many()
        .col_expr(Column::UnackedAt, Expr::value(unacked_at))
        .col_expr(Column::UnackedBy, Expr::value(unacked_by))
        .col_expr(Column::UpdatedAt, Expr::value(unacked_at))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.eq(alert_id))
        .filter(Column::GroupKey.eq(group_key))
        .filter(Column::FiringStartedAt.eq(firing_started_at))
        .filter(Column::UnackedAt.is_null())
        .exec(&txn)
        .await?;
    let changed = result.rows_affected > 0;
    if changed {
        slack_alert_messages::bump_wanted_with(&txn, alert_id, group_key, firing_started_at)
            .await?;
    }
    txn.commit().await?;
    Ok(changed)
}

pub async fn apply_replicated_with<C: ConnectionTrait>(
    conn: &C,
    ack: &AlertAck,
) -> Result<bool, Error> {
    let mut on_conflict = upsert();
    on_conflict.action_and_where(
        Expr::col((Entity, Column::UpdatedAt))
            .lt(Expr::col((Alias::new("excluded"), Column::UpdatedAt))),
    );
    let written = Entity::insert(to_active(ack)?)
        .on_conflict(on_conflict)
        .exec_without_returning(conn)
        .await?;
    Ok(written > 0)
}

pub async fn delete_by_alert_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.eq(alert_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

pub async fn delete_by_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

pub async fn delete_ended_before_with<C: ConnectionTrait>(conn: &C, at: i64) -> Result<u64, Error> {
    let still_firing = Query::select()
        .expr(Expr::val(1))
        .from(alert_states::Entity)
        .and_where(
            Expr::col((alert_states::Entity, alert_states::Column::AlertId))
                .equals((Entity, Column::AlertId)),
        )
        .and_where(
            Expr::col((alert_states::Entity, alert_states::Column::GroupKey))
                .equals((Entity, Column::GroupKey)),
        )
        .and_where(
            Expr::col((alert_states::Entity, alert_states::Column::FiringStartedAt))
                .equals((Entity, Column::FiringStartedAt)),
        )
        .to_owned();
    let result = Entity::delete_many()
        .filter(Column::UpdatedAt.lt(at))
        .filter(Condition::all().add(Expr::exists(still_firing).not()))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

/// Creates `alert_acks`; for tests, since the migrator replays the whole history.
#[cfg(any(test, feature = "test-utils"))]
pub async fn create_table_for_test<C: ConnectionTrait>(conn: &C) -> Result<(), sea_orm::DbErr> {
    super::migration::create_alert_acks_table(conn).await
}

fn upsert() -> OnConflict {
    OnConflict::columns([Column::OrgId, Column::AlertId, Column::GroupKey])
        .update_columns(
            Column::iter()
                .filter(|c| !matches!(c, Column::OrgId | Column::AlertId | Column::GroupKey)),
        )
        .to_owned()
}

fn to_active(ack: &AlertAck) -> Result<ActiveModel, Error> {
    Ok(ActiveModel {
        org_id: Set(ack.org_id.clone()),
        alert_id: Set(ack.alert_id.clone()),
        group_key: Set(ack.group_key.clone()),
        firing_started_at: Set(ack.firing_started_at),
        acked_by: Set(ack.acked_by.clone()),
        acked_at: Set(ack.acked_at),
        ack_source: Set(enum_text(&ack.ack_source)?),
        taken_over_from: Set(ack.taken_over_from.clone()),
        unacked_at: Set(ack.unacked_at),
        unacked_by: Set(ack.unacked_by.clone()),
        updated_at: Set(ack.updated_at),
    })
}

fn from_model(model: Model) -> Result<AlertAck, Error> {
    Ok(AlertAck {
        ack_source: parse_enum("ack_source", &model.ack_source)?,
        org_id: model.org_id,
        alert_id: model.alert_id,
        group_key: model.group_key,
        firing_started_at: model.firing_started_at,
        acked_by: model.acked_by,
        acked_at: model.acked_at,
        taken_over_from: model.taken_over_from,
        unacked_at: model.unacked_at,
        unacked_by: model.unacked_by,
        updated_at: model.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::ack::AckSource,
        slack::{MessageState, SlackAlertMessage},
    };
    use sea_orm::{Database, DatabaseConnection};

    use super::*;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_table_for_test(&db).await.unwrap();
        crate::table::slack::create_tables_for_test(&db)
            .await
            .unwrap();
        crate::table::migration::create_alert_states_for_test(&db)
            .await
            .unwrap();
        db
    }

    fn ack(group_key: &str, firing: i64, updated_at: i64) -> AlertAck {
        AlertAck {
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: group_key.into(),
            firing_started_at: firing,
            acked_by: "dana@acme.com".into(),
            acked_at: updated_at,
            ack_source: AckSource::Ui,
            taken_over_from: None,
            unacked_at: None,
            unacked_by: None,
            updated_at,
        }
    }

    #[tokio::test]
    async fn a_second_ack_of_the_same_firing_leaves_the_first_one_standing() {
        let db = db().await;
        assert_eq!(
            claim_with_outbox_with(&db, &ack("g", 100, 10))
                .await
                .unwrap(),
            Some(0)
        );
        let other = AlertAck {
            acked_by: "bob@acme.com".into(),
            ..ack("g", 100, 11)
        };
        assert_eq!(claim_with_outbox_with(&db, &other).await.unwrap(), None);
        let stored = get_with(&db, "acme", "a1", "g").await.unwrap().unwrap();
        assert_eq!(stored.acked_by, "dana@acme.com");

        // A new firing, or an unacked one, is free to claim.
        let next_firing = AlertAck {
            acked_by: "bob@acme.com".into(),
            ..ack("g", 200, 12)
        };
        assert_eq!(
            claim_with_outbox_with(&db, &next_firing).await.unwrap(),
            Some(0)
        );
        assert!(
            unack_with_outbox_with(&db, "acme", "a1", "g", 200, "bob@acme.com", 13)
                .await
                .unwrap()
        );
        assert_eq!(
            claim_with_outbox_with(&db, &ack("g", 200, 14))
                .await
                .unwrap(),
            Some(0)
        );
        let stored = get_with(&db, "acme", "a1", "g").await.unwrap().unwrap();
        assert_eq!(
            (stored.acked_by.as_str(), stored.unacked_at),
            ("dana@acme.com", None)
        );
        assert_eq!(
            list_for_alerts_with(&db, "acme", &["a1".to_string(), "a2".to_string()])
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            list_for_alerts_with(&db, "acme", &[])
                .await
                .unwrap()
                .is_empty()
        );
    }

    fn message(destination_id: &str, group_key: &str, firing: i64) -> SlackAlertMessage {
        SlackAlertMessage {
            destination_id: destination_id.into(),
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: group_key.into(),
            firing_started_at: firing,
            installation_id: "i1".into(),
            channel_id: "C1".into(),
            first_fired_at: firing,
            state: MessageState::Firing,
            created_at: firing,
            updated_at: firing,
            origin_region: "default".into(),
            ..Default::default()
        }
    }

    async fn wanted(
        db: &DatabaseConnection,
        destination_id: &str,
        group: &str,
        firing: i64,
    ) -> i64 {
        let key = message(destination_id, group, firing).key();
        slack_alert_messages::get_by_key_with(db, &key)
            .await
            .unwrap()
            .unwrap()
            .wanted_seq
    }

    #[tokio::test]
    async fn put_reads_back_every_column_and_bumps_the_firings_messages_only() {
        let db = db().await;
        for (destination, group, firing) in [("d1", "k", 10), ("d2", "k", 10), ("d1", "k", 5)] {
            slack_alert_messages::insert_firing_with(&db, &message(destination, group, firing))
                .await
                .unwrap();
        }
        let row = AlertAck {
            ack_source: AckSource::Slack,
            taken_over_from: Some("eve@acme.com".into()),
            ..ack("k", 10, 20)
        };
        assert_eq!(put_with_outbox_with(&db, &row).await.unwrap(), 2);
        assert_eq!(get_with(&db, "acme", "a1", "k").await.unwrap(), Some(row));
        assert_eq!(wanted(&db, "d1", "k", 10).await, 1);
        assert_eq!(wanted(&db, "d2", "k", 10).await, 1);
        assert_eq!(wanted(&db, "d1", "k", 5).await, 0);
        let next_firing = ack("k", 30, 40);
        put_with_outbox_with(&db, &next_firing).await.unwrap();
        assert_eq!(
            list_for_alert_with(&db, "acme", "a1").await.unwrap(),
            vec![next_firing]
        );
    }

    #[tokio::test]
    async fn unack_changes_only_an_acked_matching_firing() {
        let db = db().await;
        slack_alert_messages::insert_firing_with(&db, &message("d1", "", 10))
            .await
            .unwrap();
        put_with_outbox_with(&db, &ack("", 10, 20)).await.unwrap();
        assert!(
            !unack_with_outbox_with(&db, "acme", "a1", "", 9, "eve@acme.com", 30)
                .await
                .unwrap()
        );
        assert!(
            unack_with_outbox_with(&db, "acme", "a1", "", 10, "eve@acme.com", 30)
                .await
                .unwrap()
        );
        assert!(
            !unack_with_outbox_with(&db, "acme", "a1", "", 10, "eve@acme.com", 31)
                .await
                .unwrap()
        );
        let stored = get_with(&db, "acme", "a1", "").await.unwrap().unwrap();
        assert_eq!(stored.unacked_at, Some(30));
        assert_eq!(stored.unacked_by.as_deref(), Some("eve@acme.com"));
        assert_eq!(stored.updated_at, 30);
        assert_eq!(wanted(&db, "d1", "", 10).await, 2);
    }

    #[tokio::test]
    async fn apply_replicated_ignores_an_older_or_equal_updated_at() {
        let db = db().await;
        assert!(apply_replicated_with(&db, &ack("k", 10, 20)).await.unwrap());
        let older = AlertAck {
            acked_by: "old@acme.com".into(),
            ..ack("k", 10, 19)
        };
        assert!(!apply_replicated_with(&db, &older).await.unwrap());
        let same = AlertAck {
            acked_by: "same@acme.com".into(),
            ..ack("k", 10, 20)
        };
        assert!(!apply_replicated_with(&db, &same).await.unwrap());
        assert_eq!(
            get_with(&db, "acme", "a1", "k")
                .await
                .unwrap()
                .unwrap()
                .acked_by,
            "dana@acme.com"
        );
        let newer = AlertAck {
            acked_by: "new@acme.com".into(),
            ..ack("k", 10, 21)
        };
        assert!(apply_replicated_with(&db, &newer).await.unwrap());
        assert_eq!(get_with(&db, "acme", "a1", "k").await.unwrap(), Some(newer));
    }

    #[tokio::test]
    async fn the_sweep_keeps_current_firings_and_recent_rows() {
        let db = db().await;
        db.execute_unprepared(
            "INSERT INTO alert_states (alert_id, group_key, firing_started_at) VALUES \
             ('a1', 'current', 10), ('a1', 'ended', 99)",
        )
        .await
        .unwrap();
        for group in ["current", "ended", "untracked"] {
            put_with_outbox_with(&db, &ack(group, 10, 20))
                .await
                .unwrap();
        }
        put_with_outbox_with(&db, &ack("recent", 10, 500))
            .await
            .unwrap();
        assert_eq!(delete_ended_before_with(&db, 100).await.unwrap(), 2);
        let left: Vec<String> = list_for_alert_with(&db, "acme", "a1")
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.group_key)
            .collect();
        assert_eq!(left, ["current", "recent"]);
    }

    #[tokio::test]
    async fn deletes_by_alert_and_org() {
        let db = db().await;
        put_with_outbox_with(&db, &ack("k", 10, 20)).await.unwrap();
        put_with_outbox_with(
            &db,
            &AlertAck {
                alert_id: "a2".into(),
                ..ack("k", 10, 20)
            },
        )
        .await
        .unwrap();
        put_with_outbox_with(
            &db,
            &AlertAck {
                org_id: "globex".into(),
                ..ack("k", 10, 20)
            },
        )
        .await
        .unwrap();
        assert_eq!(delete_by_alert_with(&db, "acme", "a1").await.unwrap(), 1);
        assert_eq!(delete_by_org_with(&db, "acme").await.unwrap(), 1);
        assert!(get_with(&db, "globex", "a1", "k").await.unwrap().is_some());
    }
}
