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

//! Steering rows of RCA runs (`rca_steering`, 04 §8).

use std::str::FromStr;

use config::meta::alerts::rca_steering::{
    SteerAction, SteerKind, SteerRecord, SteerStatus, SteerStatusReason,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseTransaction, DbErr, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, sea_query::Expr,
};

pub use super::entity::rca_steering::Model;
use super::entity::rca_steering::{ActiveModel, Column, Entity};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

/// The fields a [set_status] write may fill besides the status.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SteerPatch {
    pub status_reason: Option<SteerStatusReason>,
    pub delivered_at: Option<i64>,
    pub read_at: Option<i64>,
    pub acted_at: Option<i64>,
    pub agent_note: Option<String>,
    pub opencode_message_id: Option<String>,
    pub question_id: Option<String>,
    pub kind: Option<SteerKind>,
}

/// The counts the SG10 rate limits decide with. `guidance` rows do not count.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RateCounts {
    /// The author's rows on the run.
    pub author_total: u64,
    /// The author's rows on the run created at or after `since_us`.
    pub author_since: u64,
    /// Every author's rows on the run.
    pub run_total: u64,
    /// `created_at` of the author's newest row on the run.
    pub last_author_at: Option<i64>,
}

/// Inserts a new row.
pub async fn insert(record: &SteerRecord) -> Result<(), DbErr> {
    insert_with(get_orm_client_rw().await, record).await
}

/// [insert] inside the caller's transaction (the guidance row of a new run, SG33).
pub async fn insert_in(txn: &DatabaseTransaction, record: &SteerRecord) -> Result<(), DbErr> {
    insert_with(txn, record).await
}

/// [insert] on a given connection.
pub async fn insert_with<C: ConnectionTrait>(conn: &C, record: &SteerRecord) -> Result<(), DbErr> {
    ActiveModel {
        org_id: Set(record.org_id.clone()),
        steer_id: Set(record.steer_id.clone()),
        run_id: Set(record.run_id.clone()),
        incident_id: Set(record.incident_id.clone()),
        author_email: Set(record.author_email.clone()),
        kind: Set(record.kind.as_str().to_string()),
        action: Set(record.action.map(|a| a.as_str().to_string())),
        hypothesis_id: Set(record.hypothesis_id.clone()),
        question_id: Set(record.question_id.clone()),
        text: Set(record.text.clone()),
        status: Set(record.status.as_str().to_string()),
        status_reason: Set(record.status_reason.map(|r| r.as_str().to_string())),
        created_at: Set(record.created_at),
        delivered_at: Set(record.delivered_at),
        read_at: Set(record.read_at),
        acted_at: Set(record.acted_at),
        agent_note: Set(record.agent_note.clone()),
        opencode_message_id: Set(record.opencode_message_id.clone()),
    }
    .insert(conn)
    .await?;
    Ok(())
}

/// One row.
pub async fn get(org_id: &str, steer_id: &str) -> Result<Option<SteerRecord>, DbErr> {
    get_with(get_orm_client_ro().await, org_id, steer_id).await
}

/// [get] on the primary, for a write path that must see a row written just before.
pub async fn get_rw(org_id: &str, steer_id: &str) -> Result<Option<SteerRecord>, DbErr> {
    get_with(get_orm_client_rw().await, org_id, steer_id).await
}

/// [get] on a given connection.
pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    steer_id: &str,
) -> Result<Option<SteerRecord>, DbErr> {
    Ok(
        Entity::find_by_id((org_id.to_string(), steer_id.to_string()))
            .one(conn)
            .await?
            .map(to_record),
    )
}

/// The run's rows in send order (`created_at`, then `steer_id`).
pub async fn list_for_run(org_id: &str, run_id: &str) -> Result<Vec<SteerRecord>, DbErr> {
    list_for_run_with(get_orm_client_ro().await, org_id, run_id).await
}

/// [list_for_run] on the primary, for a write path that must see rows written just before.
pub async fn list_for_run_rw(org_id: &str, run_id: &str) -> Result<Vec<SteerRecord>, DbErr> {
    list_for_run_with(get_orm_client_rw().await, org_id, run_id).await
}

/// [list_for_run] on a given connection.
pub async fn list_for_run_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
) -> Result<Vec<SteerRecord>, DbErr> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::SteerId)
        .all(conn)
        .await?
        .into_iter()
        .map(to_record)
        .collect())
}

pub async fn fill_transcript_fields(
    org_id: &str,
    steer_id: &str,
    opencode_message_id: Option<&str>,
    delivered_at: Option<i64>,
) -> Result<(), DbErr> {
    fill_transcript_fields_with(
        get_orm_client_rw().await,
        org_id,
        steer_id,
        opencode_message_id,
        delivered_at,
    )
    .await
}

/// [fill_transcript_fields] on a given connection.
pub async fn fill_transcript_fields_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    steer_id: &str,
    opencode_message_id: Option<&str>,
    delivered_at: Option<i64>,
) -> Result<(), DbErr> {
    if let Some(message_id) = opencode_message_id {
        Entity::update_many()
            .col_expr(Column::OpencodeMessageId, Expr::value(message_id))
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::SteerId.eq(steer_id))
            .filter(Column::OpencodeMessageId.is_null())
            .exec(conn)
            .await?;
    }
    if let Some(at) = delivered_at {
        Entity::update_many()
            .col_expr(Column::DeliveredAt, Expr::value(at))
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::SteerId.eq(steer_id))
            .filter(Column::DeliveredAt.is_null())
            .exec(conn)
            .await?;
    }
    Ok(())
}

pub async fn set_status(
    org_id: &str,
    steer_id: &str,
    to: SteerStatus,
    patch: SteerPatch,
) -> Result<bool, DbErr> {
    set_status_with(get_orm_client_rw().await, org_id, steer_id, to, patch).await
}

/// [set_status] on a given connection.
pub async fn set_status_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    steer_id: &str,
    to: SteerStatus,
    patch: SteerPatch,
) -> Result<bool, DbErr> {
    let from = SteerStatus::allowed_from(to);
    let mut update = Entity::update_many()
        .col_expr(Column::Status, Expr::value(to.as_str()))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SteerId.eq(steer_id))
        .filter(Column::Status.is_in(from.iter().map(|s| s.as_str())));
    if let Some(reason) = patch.status_reason {
        update = update.col_expr(Column::StatusReason, Expr::value(reason.as_str()));
    }
    if let Some(at) = patch.delivered_at {
        update = update.col_expr(Column::DeliveredAt, Expr::value(at));
    }
    if let Some(at) = patch.read_at {
        update = update.col_expr(Column::ReadAt, Expr::value(at));
    }
    if let Some(at) = patch.acted_at {
        update = update.col_expr(Column::ActedAt, Expr::value(at));
    }
    if let Some(note) = patch.agent_note {
        update = update.col_expr(Column::AgentNote, Expr::value(note));
    }
    if let Some(message_id) = patch.opencode_message_id {
        update = update.col_expr(Column::OpencodeMessageId, Expr::value(message_id));
    }
    if patch.kind.is_some() || patch.question_id.is_some() {
        update = update.filter(Column::Status.eq(SteerStatus::Queued.as_str()));
        if let Some(kind) = patch.kind {
            update = update.col_expr(Column::Kind, Expr::value(kind.as_str()));
        }
        if let Some(question_id) = patch.question_id {
            update = update.col_expr(Column::QuestionId, Expr::value(question_id));
        }
    }
    Ok(update.exec(conn).await?.rows_affected > 0)
}

/// The SG10 counts of `author` on the run.
pub async fn rate_window(
    org_id: &str,
    run_id: &str,
    author: &str,
    since_us: i64,
) -> Result<RateCounts, DbErr> {
    rate_window_with(get_orm_client_rw().await, org_id, run_id, author, since_us).await
}

/// [rate_window] on a given connection.
pub async fn rate_window_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
    author: &str,
    since_us: i64,
) -> Result<RateCounts, DbErr> {
    let counted = || {
        Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::RunId.eq(run_id))
            .filter(Column::Kind.ne(SteerKind::Guidance.as_str()))
    };
    let run_total = counted().count(conn).await?;
    let author_times: Vec<i64> = counted()
        .filter(Column::AuthorEmail.eq(author))
        .select_only()
        .column(Column::CreatedAt)
        .into_tuple()
        .all(conn)
        .await?;
    Ok(RateCounts {
        author_total: author_times.len() as u64,
        author_since: author_times.iter().filter(|at| **at >= since_us).count() as u64,
        run_total,
        last_author_at: author_times.iter().copied().max(),
    })
}

pub async fn pending_action_exists(
    org_id: &str,
    run_id: &str,
    hypothesis_id: &str,
    action: SteerAction,
) -> Result<bool, DbErr> {
    pending_action_exists_with(
        get_orm_client_rw().await,
        org_id,
        run_id,
        hypothesis_id,
        action,
    )
    .await
}

/// [pending_action_exists] on a given connection.
pub async fn pending_action_exists_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
    hypothesis_id: &str,
    action: SteerAction,
) -> Result<bool, DbErr> {
    let pending = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .filter(Column::Kind.eq(SteerKind::HypothesisAction.as_str()))
        .filter(Column::HypothesisId.eq(hypothesis_id))
        .filter(Column::Action.eq(action.as_str()))
        .filter(Column::Status.is_in([
            SteerStatus::Queued.as_str(),
            SteerStatus::Delivered.as_str(),
            SteerStatus::Read.as_str(),
        ]))
        .count(conn)
        .await?;
    Ok(pending > 0)
}

/// Deletes the rows of the given runs inside the caller's transaction (the RR-25 prune, 04 §8.5).
pub async fn delete_for_runs_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    run_ids: &[String],
) -> Result<(), DbErr> {
    if run_ids.is_empty() {
        return Ok(());
    }
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.is_in(run_ids.iter().map(String::as_str)))
        .exec(txn)
        .await?;
    Ok(())
}

/// Deletes every row of the org.
pub async fn delete_by_org(org_id: &str) -> Result<(), DbErr> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

/// [delete_by_org] on a given connection.
pub async fn delete_by_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Parses a stored enum column; an unknown value (a newer node's) reads as `fallback`.
fn parse_or<T: FromStr>(raw: &str, fallback: T, steer_id: &str, column: &str) -> T {
    T::from_str(raw).unwrap_or_else(|_| {
        log::warn!("[RCA_STEERING] row {steer_id} has unknown {column} {raw:?}");
        fallback
    })
}

fn to_record(m: Model) -> SteerRecord {
    let kind = parse_or(&m.kind, SteerKind::Message, &m.steer_id, "kind");
    let status = parse_or(&m.status, SteerStatus::NotRead, &m.steer_id, "status");
    let action = m
        .action
        .as_deref()
        .and_then(|a| SteerAction::from_str(a).ok());
    let status_reason = m
        .status_reason
        .as_deref()
        .and_then(|r| SteerStatusReason::from_str(r).ok());
    SteerRecord {
        org_id: m.org_id,
        steer_id: m.steer_id,
        run_id: m.run_id,
        incident_id: m.incident_id,
        author_email: m.author_email,
        kind,
        action,
        hypothesis_id: m.hypothesis_id,
        question_id: m.question_id,
        text: m.text,
        status,
        status_reason,
        created_at: m.created_at,
        delivered_at: m.delivered_at,
        read_at: m.read_at,
        acted_at: m.acted_at,
        agent_note: m.agent_note,
        opencode_message_id: m.opencode_message_id,
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema, TransactionTrait};

    use super::*;

    const ORG: &str = "acme";
    const RUN: &str = "run_1";
    const SEC: i64 = 1_000_000;
    const T0: i64 = 1_700_000_000 * SEC;

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    fn row(steer_id: &str, author: &str, kind: SteerKind, created_at: i64) -> SteerRecord {
        SteerRecord {
            org_id: ORG.to_string(),
            steer_id: steer_id.to_string(),
            run_id: RUN.to_string(),
            incident_id: "inc_1".to_string(),
            author_email: author.to_string(),
            kind,
            action: None,
            hypothesis_id: None,
            question_id: None,
            text: "check the pool".to_string(),
            status: SteerStatus::Queued,
            status_reason: None,
            created_at,
            delivered_at: None,
            read_at: None,
            acted_at: None,
            agent_note: None,
            opencode_message_id: None,
        }
    }

    fn action_row(
        steer_id: &str,
        h: &str,
        action: SteerAction,
        status: SteerStatus,
    ) -> SteerRecord {
        SteerRecord {
            action: Some(action),
            hypothesis_id: Some(h.to_string()),
            status,
            ..row(steer_id, "a.rao@acme.io", SteerKind::HypothesisAction, T0)
        }
    }

    async fn stored(db: &DatabaseConnection, steer_id: &str) -> SteerRecord {
        get_with(db, ORG, steer_id).await.unwrap().unwrap()
    }

    /// A patch that fills every non-conversion field.
    fn full_patch() -> SteerPatch {
        SteerPatch {
            status_reason: Some(SteerStatusReason::NoActiveTurn),
            delivered_at: Some(T0 + SEC),
            read_at: Some(T0 + 2 * SEC),
            acted_at: Some(T0 + 3 * SEC),
            agent_note: Some("checked".to_string()),
            opencode_message_id: Some("msg_1".to_string()),
            question_id: None,
            kind: None,
        }
    }

    /// SG1: insert, get, list in send order, and the record round-trips every column.
    #[tokio::test]
    async fn sg1_insert_get_and_list_in_send_order() {
        let db = db().await;
        let mut full = action_row("stg_b", "h1", SteerAction::TestFirst, SteerStatus::Applied);
        full.created_at = T0 + 2 * SEC;
        full.question_id = Some("call_1".into());
        full.status_reason = Some(SteerStatusReason::RunCompleted);
        full.delivered_at = Some(T0 + 3 * SEC);
        full.read_at = Some(T0 + 4 * SEC);
        full.acted_at = Some(T0 + 5 * SEC);
        full.agent_note = Some("done".into());
        full.opencode_message_id = Some("msg_9".into());
        insert_with(&db, &full).await.unwrap();
        insert_with(
            &db,
            &row("stg_c", "b@acme.io", SteerKind::Message, T0 + SEC),
        )
        .await
        .unwrap();
        insert_with(
            &db,
            &row("stg_a", "b@acme.io", SteerKind::Message, T0 + SEC),
        )
        .await
        .unwrap();
        let mut other_run = row("stg_z", "b@acme.io", SteerKind::Message, T0);
        other_run.run_id = "run_2".into();
        insert_with(&db, &other_run).await.unwrap();
        assert!(
            insert_with(&db, &row("stg_a", "x", SteerKind::Message, T0))
                .await
                .is_err(),
            "duplicate (org_id, steer_id)"
        );

        assert_eq!(stored(&db, "stg_b").await, full);
        assert_eq!(get_with(&db, "other", "stg_b").await.unwrap(), None);
        let ids: Vec<String> = list_for_run_with(&db, ORG, RUN)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.steer_id)
            .collect();
        assert_eq!(ids, ["stg_a", "stg_c", "stg_b"]);
    }

    /// SG2 / SG3 / §8.2: every (from, to) pair through `set_status`.
    #[tokio::test]
    async fn sg2_sg3_set_status_follows_the_status_chart() {
        use SteerStatus::*;
        let all = [
            Queued, Delivered, Read, Applied, Declined, NotRead, Rejected,
        ];
        let allowed = |from: SteerStatus, to: SteerStatus| {
            matches!(
                (from, to),
                (Queued, Queued)
                    | (Queued, Delivered)
                    | (Delivered, Read)
                    | (Read, Applied)
                    | (Read, Declined)
                    | (Queued, NotRead)
                    | (Delivered, NotRead)
                    | (Queued, Rejected)
            )
        };
        let db = db().await;
        for from in all {
            for to in all {
                let id = format!("stg_{from}_{to}");
                let mut before = action_row(&id, "h1", SteerAction::Disprove, from);
                before.question_id = Some("call_0".into());
                insert_with(&db, &before).await.unwrap();
                let wrote = set_status_with(&db, ORG, &id, to, full_patch())
                    .await
                    .unwrap();
                let after = stored(&db, &id).await;
                assert_eq!(wrote, allowed(from, to), "{from} -> {to}");
                if wrote {
                    let p = full_patch();
                    assert_eq!(after.status, to);
                    assert_eq!(after.status_reason, p.status_reason);
                    assert_eq!(after.delivered_at, p.delivered_at);
                    assert_eq!(after.read_at, p.read_at);
                    assert_eq!(after.acted_at, p.acted_at);
                    assert_eq!(after.agent_note, p.agent_note);
                    assert_eq!(after.opencode_message_id, p.opencode_message_id);
                } else {
                    assert_eq!(after, before, "{from} -> {to} wrote");
                }
                // SG2: the immutable columns.
                assert_eq!(
                    (
                        &after.org_id,
                        &after.steer_id,
                        &after.run_id,
                        &after.incident_id,
                        &after.author_email,
                        &after.text,
                        after.created_at,
                        after.action,
                        &after.hypothesis_id,
                        after.kind,
                        &after.question_id,
                    ),
                    (
                        &before.org_id,
                        &before.steer_id,
                        &before.run_id,
                        &before.incident_id,
                        &before.author_email,
                        &before.text,
                        before.created_at,
                        before.action,
                        &before.hypothesis_id,
                        before.kind,
                        &before.question_id,
                    ),
                    "{from} -> {to}"
                );
            }
        }
        // A missing row or another org's row is not written.
        assert!(
            !set_status_with(&db, ORG, "stg_none", Delivered, SteerPatch::default())
                .await
                .unwrap()
        );
        assert!(
            !set_status_with(
                &db,
                "other",
                "stg_queued_delivered",
                Read,
                SteerPatch::default()
            )
            .await
            .unwrap()
        );
    }

    /// SG3: a late `delivered` after the reconcile wrote `read` keeps `read` and its times.
    #[tokio::test]
    async fn sg3_a_late_delivered_after_read_keeps_read() {
        let db = db().await;
        insert_with(&db, &row("stg_1", "a", SteerKind::Message, T0))
            .await
            .unwrap();
        assert!(
            set_status_with(
                &db,
                ORG,
                "stg_1",
                SteerStatus::Delivered,
                SteerPatch {
                    delivered_at: Some(T0 + SEC),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
        );
        assert!(
            set_status_with(
                &db,
                ORG,
                "stg_1",
                SteerStatus::Read,
                SteerPatch {
                    read_at: Some(T0 + 2 * SEC),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
        );
        assert!(
            !set_status_with(
                &db,
                ORG,
                "stg_1",
                SteerStatus::Delivered,
                SteerPatch {
                    delivered_at: Some(T0 + 9 * SEC),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
        );
        let r = stored(&db, "stg_1").await;
        assert_eq!(r.status, SteerStatus::Read);
        assert_eq!(r.delivered_at, Some(T0 + SEC));
        assert_eq!(r.read_at, Some(T0 + 2 * SEC));
    }

    /// SG18: `kind` and `question_id` change only on a `queued` row.
    #[tokio::test]
    async fn sg18_kind_and_question_id_change_only_from_queued() {
        let db = db().await;
        let conversion = || SteerPatch {
            kind: Some(SteerKind::Answer),
            question_id: Some("call_7f".into()),
            ..Default::default()
        };
        insert_with(&db, &row("stg_q", "a", SteerKind::Message, T0))
            .await
            .unwrap();
        assert!(
            set_status_with(&db, ORG, "stg_q", SteerStatus::Queued, conversion())
                .await
                .unwrap()
        );
        let r = stored(&db, "stg_q").await;
        assert_eq!(
            (r.status, r.kind, r.question_id.as_deref()),
            (SteerStatus::Queued, SteerKind::Answer, Some("call_7f"))
        );

        // A delivered row may move to not_read, but not with a conversion.
        let mut delivered = row("stg_d", "a", SteerKind::Message, T0);
        delivered.status = SteerStatus::Delivered;
        insert_with(&db, &delivered).await.unwrap();
        let mut patch = conversion();
        patch.status_reason = Some(SteerStatusReason::RunCompleted);
        assert!(
            !set_status_with(&db, ORG, "stg_d", SteerStatus::NotRead, patch)
                .await
                .unwrap()
        );
        assert_eq!(stored(&db, "stg_d").await, delivered);
        // The conversion from queued into another status writes kind with it.
        insert_with(&db, &row("stg_r", "a", SteerKind::Message, T0))
            .await
            .unwrap();
        assert!(
            set_status_with(&db, ORG, "stg_r", SteerStatus::Delivered, conversion())
                .await
                .unwrap()
        );
        assert_eq!(stored(&db, "stg_r").await.kind, SteerKind::Answer);
    }

    #[tokio::test]
    async fn sg10_rate_window_counts() {
        let db = db().await;
        let a = "a.rao@acme.io";
        let empty = rate_window_with(&db, ORG, RUN, a, T0).await.unwrap();
        assert_eq!(empty, RateCounts::default());

        insert_with(&db, &row("stg_1", a, SteerKind::Message, T0))
            .await
            .unwrap();
        insert_with(&db, &row("stg_2", a, SteerKind::Answer, T0 + 3 * SEC))
            .await
            .unwrap();
        insert_with(
            &db,
            &row("stg_3", "b@acme.io", SteerKind::Message, T0 + 4 * SEC),
        )
        .await
        .unwrap();
        insert_with(
            &db,
            &action_row("stg_4", "h1", SteerAction::Disprove, SteerStatus::Queued),
        )
        .await
        .unwrap();
        // Guidance rows do not count, even the newest.
        insert_with(&db, &row("stg_5", a, SteerKind::Guidance, T0 + 9 * SEC))
            .await
            .unwrap();
        let mut other = row("stg_6", a, SteerKind::Message, T0 + 8 * SEC);
        other.run_id = "run_2".into();
        insert_with(&db, &other).await.unwrap();

        let c = rate_window_with(&db, ORG, RUN, a, T0 + 2 * SEC)
            .await
            .unwrap();
        assert_eq!(
            c,
            RateCounts {
                author_total: 3,
                author_since: 1,
                run_total: 4,
                last_author_at: Some(T0 + 3 * SEC),
            }
        );
        let c = rate_window_with(&db, ORG, RUN, a, T0).await.unwrap();
        assert_eq!(c.author_since, 3, "since is inclusive");
        let c = rate_window_with(&db, ORG, RUN, "b@acme.io", T0)
            .await
            .unwrap();
        assert_eq!((c.author_total, c.run_total), (1, 4));
        let c = rate_window_with(&db, "other", RUN, a, T0).await.unwrap();
        assert_eq!(c, RateCounts::default());
    }

    #[tokio::test]
    async fn sg10_pending_action_exists() {
        use SteerStatus::*;
        for (status, pending) in [
            (Queued, true),
            (Delivered, true),
            (Read, true),
            (Applied, false),
            (Declined, false),
            (NotRead, false),
            (Rejected, false),
        ] {
            let db = db().await;
            insert_with(
                &db,
                &action_row("stg_1", "h1", SteerAction::Disprove, status),
            )
            .await
            .unwrap();
            assert_eq!(
                pending_action_exists_with(&db, ORG, RUN, "h1", SteerAction::Disprove)
                    .await
                    .unwrap(),
                pending,
                "{status}"
            );
            for (h, action) in [
                ("h2", SteerAction::Disprove),
                ("h1", SteerAction::Reopen),
                ("h1", SteerAction::TestFirst),
            ] {
                assert!(
                    !pending_action_exists_with(&db, ORG, RUN, h, action)
                        .await
                        .unwrap()
                );
            }
            assert!(
                !pending_action_exists_with(&db, ORG, "run_2", "h1", SteerAction::Disprove)
                    .await
                    .unwrap()
            );
        }
        // A message row naming the hypothesis is not an action.
        let db = db().await;
        let mut msg = row("stg_m", "a", SteerKind::Message, T0);
        msg.hypothesis_id = Some("h1".into());
        msg.action = Some(SteerAction::Disprove);
        insert_with(&db, &msg).await.unwrap();
        assert!(
            !pending_action_exists_with(&db, ORG, RUN, "h1", SteerAction::Disprove)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn deletes_by_runs_in_a_transaction_and_by_org() {
        let db = db().await;
        for (id, run, org) in [
            ("stg_1", "run_1", ORG),
            ("stg_2", "run_2", ORG),
            ("stg_3", "run_3", ORG),
            ("stg_4", "run_1", "other"),
        ] {
            let mut r = row(id, "a", SteerKind::Message, T0);
            r.run_id = run.into();
            r.org_id = org.into();
            insert_with(&db, &r).await.unwrap();
        }
        let doomed = vec!["run_1".to_string(), "run_2".to_string()];
        let txn = db.begin().await.unwrap();
        delete_for_runs_in(&txn, ORG, &doomed).await.unwrap();
        txn.rollback().await.unwrap();
        assert!(get_with(&db, ORG, "stg_1").await.unwrap().is_some());

        let txn = db.begin().await.unwrap();
        delete_for_runs_in(&txn, ORG, &[]).await.unwrap();
        delete_for_runs_in(&txn, ORG, &doomed).await.unwrap();
        txn.commit().await.unwrap();
        assert!(get_with(&db, ORG, "stg_1").await.unwrap().is_none());
        assert!(get_with(&db, ORG, "stg_2").await.unwrap().is_none());
        assert!(get_with(&db, ORG, "stg_3").await.unwrap().is_some());
        assert!(get_with(&db, "other", "stg_4").await.unwrap().is_some());

        delete_by_org_with(&db, ORG).await.unwrap();
        assert!(get_with(&db, ORG, "stg_3").await.unwrap().is_none());
        assert!(get_with(&db, "other", "stg_4").await.unwrap().is_some());
    }

    /// `insert_in` commits with the caller's transaction only.
    #[tokio::test]
    async fn insert_in_follows_the_transaction() {
        let db = db().await;
        let txn = db.begin().await.unwrap();
        insert_in(&txn, &row("stg_g", "a", SteerKind::Guidance, T0))
            .await
            .unwrap();
        txn.rollback().await.unwrap();
        assert!(get_with(&db, ORG, "stg_g").await.unwrap().is_none());
        let txn = db.begin().await.unwrap();
        insert_in(&txn, &row("stg_g", "a", SteerKind::Guidance, T0))
            .await
            .unwrap();
        txn.commit().await.unwrap();
        assert_eq!(stored(&db, "stg_g").await.kind, SteerKind::Guidance);
    }

    #[tokio::test]
    async fn sg23_fill_transcript_fields_writes_only_null_columns() {
        use SteerStatus::*;
        let db = db().await;
        for status in [
            Queued, Delivered, Read, Applied, Declined, NotRead, Rejected,
        ] {
            // Both NULL: both filled, nothing else changes.
            let id = format!("stg_empty_{status}");
            let mut before = action_row(&id, "h1", SteerAction::Reopen, status);
            before.status_reason = Some(SteerStatusReason::RunCompleted);
            before.read_at = Some(T0 + 7 * SEC);
            insert_with(&db, &before).await.unwrap();
            fill_transcript_fields_with(&db, ORG, &id, Some("msg_1"), Some(T0 + SEC))
                .await
                .unwrap();
            let mut want = before.clone();
            want.opencode_message_id = Some("msg_1".into());
            want.delivered_at = Some(T0 + SEC);
            assert_eq!(stored(&db, &id).await, want, "{status}");

            // A second fill never overwrites.
            fill_transcript_fields_with(&db, ORG, &id, Some("msg_2"), Some(T0 + 9 * SEC))
                .await
                .unwrap();
            assert_eq!(stored(&db, &id).await, want, "{status} overwritten");

            // One set, one NULL: only the NULL one is filled.
            let id = format!("stg_half_{status}");
            let mut half = action_row(&id, "h1", SteerAction::Reopen, status);
            half.opencode_message_id = Some("msg_old".into());
            insert_with(&db, &half).await.unwrap();
            fill_transcript_fields_with(&db, ORG, &id, Some("msg_new"), Some(T0 + 2 * SEC))
                .await
                .unwrap();
            let mut want = half.clone();
            want.delivered_at = Some(T0 + 2 * SEC);
            assert_eq!(stored(&db, &id).await, want, "{status}");

            let id = format!("stg_half2_{status}");
            let mut half = action_row(&id, "h1", SteerAction::Reopen, status);
            half.delivered_at = Some(T0 + SEC);
            insert_with(&db, &half).await.unwrap();
            fill_transcript_fields_with(&db, ORG, &id, Some("msg_new"), Some(T0 + 5 * SEC))
                .await
                .unwrap();
            let mut want = half.clone();
            want.opencode_message_id = Some("msg_new".into());
            assert_eq!(stored(&db, &id).await, want, "{status}");

            // `None` arguments write nothing.
            let id = format!("stg_none_{status}");
            let none = action_row(&id, "h1", SteerAction::Reopen, status);
            insert_with(&db, &none).await.unwrap();
            fill_transcript_fields_with(&db, ORG, &id, None, None)
                .await
                .unwrap();
            assert_eq!(stored(&db, &id).await, none, "{status}");
        }
        // Another org's row with the same id is not touched; a missing row is not an error.
        let mut foreign = row("stg_shared", "a", SteerKind::Message, T0);
        foreign.org_id = "other".into();
        insert_with(&db, &foreign).await.unwrap();
        fill_transcript_fields_with(&db, ORG, "stg_shared", Some("m"), Some(T0))
            .await
            .unwrap();
        assert_eq!(
            get_with(&db, "other", "stg_shared").await.unwrap(),
            Some(foreign)
        );
    }

    #[tokio::test]
    async fn sg18_a_conversion_patch_requires_queued_for_every_target() {
        use SteerStatus::*;
        let all = [
            Queued, Delivered, Read, Applied, Declined, NotRead, Rejected,
        ];
        let db = db().await;
        for from in all {
            for to in all {
                for patch in [
                    SteerPatch {
                        kind: Some(SteerKind::Answer),
                        ..Default::default()
                    },
                    SteerPatch {
                        question_id: Some("call_9".into()),
                        ..Default::default()
                    },
                ] {
                    let id = format!("stg_{from}_{to}_{}", patch.kind.is_some());
                    let before = row(&id, "a", SteerKind::Message, T0);
                    let before = SteerRecord {
                        status: from,
                        ..before
                    };
                    insert_with(&db, &before).await.unwrap();
                    let wrote = set_status_with(&db, ORG, &id, to, patch.clone())
                        .await
                        .unwrap();
                    let want = from == Queued && SteerStatus::allowed_from(to).contains(&from);
                    assert_eq!(wrote, want, "{from} -> {to} {patch:?}");
                    let after = stored(&db, &id).await;
                    if wrote {
                        assert_eq!(after.status, to);
                        if patch.kind.is_some() {
                            assert_eq!(after.kind, SteerKind::Answer);
                        } else {
                            assert_eq!(after.question_id.as_deref(), Some("call_9"));
                        }
                    } else {
                        assert_eq!(after, before, "{from} -> {to} wrote");
                    }
                }
            }
        }
    }
}
