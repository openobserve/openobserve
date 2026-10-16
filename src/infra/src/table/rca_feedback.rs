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

//! Responder feedback on RCA runs (`rca_feedback`, README §9).
//!
//! One row per run and author; a second write by the same author replaces the first (the
//! latest write wins, `created_at` is kept). Rows are not pruned with their run: they are
//! keyed by subject so a correction keeps feeding later runs' past causes.

use std::str::FromStr;

use config::meta::{
    alerts::rca_feedback::{FeedbackReason, FeedbackVerdict, RcaFeedback},
    oncall::ResolutionCause,
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    sea_query::OnConflict,
};

pub use super::entity::rca_feedback::Model;
use super::entity::rca_feedback::{ActiveModel, Column, Entity};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

/// Writes the author's row for the run; an existing row keeps its `created_at` and takes
/// every other column from `row`. Returns the stored row.
pub async fn upsert(row: &Model) -> Result<Model, DbErr> {
    upsert_with(get_orm_client_rw().await, row).await
}

/// [upsert] on a given connection.
pub async fn upsert_with<C: ConnectionTrait>(conn: &C, row: &Model) -> Result<Model, DbErr> {
    let active: ActiveModel = row.clone().into();
    Entity::insert(active)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::RunId, Column::AuthorEmail])
                .update_columns([
                    Column::IncidentId,
                    Column::SubjectType,
                    Column::SubjectId,
                    Column::Verdict,
                    Column::Cause,
                    Column::Note,
                    Column::Reasons,
                    Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Entity::find_by_id((
        row.org_id.clone(),
        row.run_id.clone(),
        row.author_email.clone(),
    ))
    .one(conn)
    .await?
    .ok_or_else(|| DbErr::RecordNotFound("rca_feedback row after upsert".to_string()))
}

/// Deletes the author's row for the run. `true` when a row was deleted.
pub async fn delete_own(org_id: &str, run_id: &str, author_email: &str) -> Result<bool, DbErr> {
    delete_own_with(get_orm_client_rw().await, org_id, run_id, author_email).await
}

/// [delete_own] on a given connection.
pub async fn delete_own_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
    author_email: &str,
) -> Result<bool, DbErr> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .filter(Column::AuthorEmail.eq(author_email))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Every author's row for the run, oldest `created_at` first.
pub async fn list_for_run(org_id: &str, run_id: &str) -> Result<Vec<Model>, DbErr> {
    list_for_run_with(get_orm_client_ro().await, org_id, run_id).await
}

/// [list_for_run] on a given connection.
pub async fn list_for_run_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::AuthorEmail)
        .all(conn)
        .await
}

/// The run's newest row over all authors (largest `updated_at`), the backtest label.
pub async fn latest_for_run(org_id: &str, run_id: &str) -> Result<Option<Model>, DbErr> {
    latest_for_run_with(get_orm_client_ro().await, org_id, run_id).await
}

/// [latest_for_run] on a given connection.
pub async fn latest_for_run_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .order_by_desc(Column::UpdatedAt)
        .order_by_asc(Column::AuthorEmail)
        .one(conn)
        .await
}

/// The subject's `change` rows (corrected causes), newest `updated_at` first, at most
/// `limit`. `subject_id` must be bare (an alert id without `:group:<team>`).
pub async fn list_corrections_for_subject(
    org_id: &str,
    subject_type: &str,
    subject_id: &str,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    list_corrections_for_subject_with(
        get_orm_client_ro().await,
        org_id,
        subject_type,
        subject_id,
        limit,
    )
    .await
}

/// [list_corrections_for_subject] on a given connection.
pub async fn list_corrections_for_subject_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    subject_type: &str,
    subject_id: &str,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SubjectType.eq(subject_type))
        .filter(Column::SubjectId.eq(subject_id))
        .filter(Column::Verdict.eq(FeedbackVerdict::Change.as_str()))
        .order_by_desc(Column::UpdatedAt)
        .limit(limit)
        .all(conn)
        .await
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

/// The API shape of a row. `None` for a row whose verdict this node cannot read (a newer
/// node's); an unknown cause or reason is dropped.
pub fn to_feedback(m: Model) -> Option<RcaFeedback> {
    let verdict = match FeedbackVerdict::from_str(&m.verdict) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "[rca_feedback] org {} run {}: skipping row: {e}",
                m.org_id,
                m.run_id
            );
            return None;
        }
    };
    let cause = m.cause.as_deref().and_then(ResolutionCause::from_str_opt);
    let reasons = m
        .reasons
        .as_ref()
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|r| r.as_str().and_then(|s| FeedbackReason::from_str(s).ok()))
                .collect()
        })
        .unwrap_or_default();
    Some(RcaFeedback {
        org_id: m.org_id,
        run_id: m.run_id,
        author_email: m.author_email,
        incident_id: m.incident_id,
        subject_type: m.subject_type,
        subject_id: m.subject_id,
        verdict,
        cause,
        note: m.note,
        reasons,
        created_at: m.created_at,
        updated_at: m.updated_at,
    })
}

/// The reasons column for a row: `None` when there are none.
pub fn reasons_column(reasons: &[FeedbackReason]) -> Option<serde_json::Value> {
    (!reasons.is_empty()).then(|| {
        serde_json::Value::Array(
            reasons
                .iter()
                .map(|r| serde_json::Value::String(r.as_str().to_string()))
                .collect(),
        )
    })
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";
    const RUN: &str = "run_1";
    const ALERT: &str = "alert_1";
    const SEC: i64 = 1_000_000;
    const T0: i64 = 1_700_000_000 * SEC;
    const RAO: &str = "a.rao@acme.io";
    const KIM: &str = "b.kim@acme.io";

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    fn row(org: &str, run: &str, author: &str, verdict: FeedbackVerdict, at: i64) -> Model {
        Model {
            org_id: org.to_string(),
            run_id: run.to_string(),
            author_email: author.to_string(),
            incident_id: Some("inc_1".to_string()),
            subject_type: "alert".to_string(),
            subject_id: ALERT.to_string(),
            verdict: verdict.as_str().to_string(),
            cause: None,
            note: None,
            reasons: None,
            created_at: at,
            updated_at: at,
        }
    }

    fn change(org: &str, run: &str, author: &str, cause: ResolutionCause, at: i64) -> Model {
        Model {
            cause: Some(cause.as_str().to_string()),
            ..row(org, run, author, FeedbackVerdict::Change, at)
        }
    }

    fn keys(rows: &[Model]) -> Vec<(&str, &str)> {
        rows.iter()
            .map(|r| (r.run_id.as_str(), r.author_email.as_str()))
            .collect()
    }

    /// J1: one row per (org, run, author); the second write replaces every column but keeps
    /// `created_at`.
    #[tokio::test]
    async fn upsert_keeps_one_row_per_author_latest_write_wins() {
        let db = db().await;
        let first = Model {
            reasons: reasons_column(&[FeedbackReason::WrongService]),
            note: Some("wrong pod".to_string()),
            ..row(ORG, RUN, RAO, FeedbackVerdict::No, T0)
        };
        assert_eq!(upsert_with(&db, &first).await.unwrap(), first);

        let second = Model {
            created_at: T0 + 60 * SEC,
            updated_at: T0 + 60 * SEC,
            note: None,
            ..change(ORG, RUN, RAO, ResolutionCause::CapacityOrLoad, T0)
        };
        let stored = upsert_with(&db, &second).await.unwrap();
        assert_eq!(
            stored,
            Model {
                created_at: T0,
                ..second.clone()
            },
            "every column but created_at follows the latest write; note and reasons cleared"
        );
        let all = list_for_run_with(&db, ORG, RUN).await.unwrap();
        assert_eq!(all, vec![stored]);

        // Another author is a separate row.
        upsert_with(&db, &row(ORG, RUN, KIM, FeedbackVerdict::Yes, T0 + SEC))
            .await
            .unwrap();
        assert_eq!(list_for_run_with(&db, ORG, RUN).await.unwrap().len(), 2);
    }

    /// J2 Undo: only the caller's row goes; a second delete reports nothing deleted.
    #[tokio::test]
    async fn delete_own_removes_only_the_callers_row() {
        let db = db().await;
        for r in [
            row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0),
            row(ORG, RUN, KIM, FeedbackVerdict::No, T0 + SEC),
            row(ORG, "run_2", RAO, FeedbackVerdict::Yes, T0),
            row(OTHER_ORG, RUN, RAO, FeedbackVerdict::Yes, T0),
        ] {
            upsert_with(&db, &r).await.unwrap();
        }
        assert!(delete_own_with(&db, ORG, RUN, RAO).await.unwrap());
        assert!(!delete_own_with(&db, ORG, RUN, RAO).await.unwrap());
        assert!(
            !delete_own_with(&db, ORG, RUN, "nobody@acme.io")
                .await
                .unwrap()
        );
        assert_eq!(
            keys(&list_for_run_with(&db, ORG, RUN).await.unwrap()),
            [(RUN, KIM)]
        );
        assert_eq!(list_for_run_with(&db, ORG, "run_2").await.unwrap().len(), 1);
        assert_eq!(
            list_for_run_with(&db, OTHER_ORG, RUN).await.unwrap().len(),
            1
        );
    }

    /// `list_for_run` returns only that run's rows, oldest `created_at` first, even when an
    /// older row was rewritten later.
    #[tokio::test]
    async fn list_for_run_is_scoped_and_oldest_first() {
        let db = db().await;
        upsert_with(
            &db,
            &row(ORG, RUN, KIM, FeedbackVerdict::Yes, T0 + 10 * SEC),
        )
        .await
        .unwrap();
        upsert_with(&db, &row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0))
            .await
            .unwrap();
        upsert_with(
            &db,
            &row(ORG, "run_2", "c@acme.io", FeedbackVerdict::Yes, T0),
        )
        .await
        .unwrap();
        // RAO rewrites after KIM: created_at stays T0, so RAO stays first.
        upsert_with(&db, &row(ORG, RUN, RAO, FeedbackVerdict::No, T0 + 20 * SEC))
            .await
            .unwrap();
        assert_eq!(
            keys(&list_for_run_with(&db, ORG, RUN).await.unwrap()),
            [(RUN, RAO), (RUN, KIM)]
        );
        assert!(
            list_for_run_with(&db, ORG, "run_9")
                .await
                .unwrap()
                .is_empty()
        );
    }

    /// The backtest label: the newest `updated_at` over all authors, so a rewrite of an older
    /// row makes it the latest.
    #[tokio::test]
    async fn latest_for_run_is_the_newest_update_across_authors() {
        let db = db().await;
        assert!(latest_for_run_with(&db, ORG, RUN).await.unwrap().is_none());
        upsert_with(&db, &row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0))
            .await
            .unwrap();
        upsert_with(&db, &row(ORG, RUN, KIM, FeedbackVerdict::No, T0 + 10 * SEC))
            .await
            .unwrap();
        // A newer row in another org or run does not count.
        upsert_with(
            &db,
            &row(OTHER_ORG, RUN, RAO, FeedbackVerdict::Change, T0 + 99 * SEC),
        )
        .await
        .unwrap();
        upsert_with(
            &db,
            &row(ORG, "run_2", RAO, FeedbackVerdict::Change, T0 + 99 * SEC),
        )
        .await
        .unwrap();
        let latest = latest_for_run_with(&db, ORG, RUN).await.unwrap().unwrap();
        assert_eq!(
            (latest.author_email.as_str(), latest.verdict.as_str()),
            (KIM, "no")
        );

        upsert_with(
            &db,
            &Model {
                updated_at: T0 + 20 * SEC,
                ..row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0)
            },
        )
        .await
        .unwrap();
        let latest = latest_for_run_with(&db, ORG, RUN).await.unwrap().unwrap();
        assert_eq!(latest.author_email, RAO);
        assert_eq!(latest.created_at, T0);
    }

    /// J3a: only `change` rows of exactly that subject (type and id) in that org, newest
    /// `updated_at` first, at most `limit`; an alert's `:group:<team>` id is a different key.
    #[tokio::test]
    async fn list_corrections_for_subject_filters_orders_and_limits() {
        let db = db().await;
        for r in [
            change(ORG, "run_1", RAO, ResolutionCause::CapacityOrLoad, T0),
            change(
                ORG,
                "run_2",
                RAO,
                ResolutionCause::DependencyFailure,
                T0 + 30 * SEC,
            ),
            change(
                ORG,
                "run_3",
                KIM,
                ResolutionCause::GenuineDefect,
                T0 + 10 * SEC,
            ),
            // Not corrections.
            row(ORG, "run_4", RAO, FeedbackVerdict::Yes, T0 + 40 * SEC),
            row(ORG, "run_5", RAO, FeedbackVerdict::No, T0 + 50 * SEC),
            // Other subjects and orgs.
            Model {
                subject_id: "alert_2".to_string(),
                ..change(
                    ORG,
                    "run_6",
                    RAO,
                    ResolutionCause::NoisyThreshold,
                    T0 + 60 * SEC,
                )
            },
            Model {
                subject_type: "incident".to_string(),
                ..change(
                    ORG,
                    "run_7",
                    RAO,
                    ResolutionCause::NoisyThreshold,
                    T0 + 60 * SEC,
                )
            },
            Model {
                subject_id: format!("{ALERT}:group:payments"),
                ..change(
                    ORG,
                    "run_8",
                    RAO,
                    ResolutionCause::NoisyThreshold,
                    T0 + 60 * SEC,
                )
            },
            change(
                OTHER_ORG,
                "run_9",
                RAO,
                ResolutionCause::NoisyThreshold,
                T0 + 60 * SEC,
            ),
        ] {
            upsert_with(&db, &r).await.unwrap();
        }
        let got = list_corrections_for_subject_with(&db, ORG, "alert", ALERT, 10)
            .await
            .unwrap();
        assert_eq!(keys(&got), [("run_2", RAO), ("run_3", KIM), ("run_1", RAO)]);
        let got = list_corrections_for_subject_with(&db, ORG, "alert", ALERT, 2)
            .await
            .unwrap();
        assert_eq!(keys(&got), [("run_2", RAO), ("run_3", KIM)]);

        // A correction rewritten as `yes` stops being a lead.
        upsert_with(
            &db,
            &row(ORG, "run_2", RAO, FeedbackVerdict::Yes, T0 + 70 * SEC),
        )
        .await
        .unwrap();
        let got = list_corrections_for_subject_with(&db, ORG, "alert", ALERT, 10)
            .await
            .unwrap();
        assert_eq!(keys(&got), [("run_3", KIM), ("run_1", RAO)]);
    }

    #[tokio::test]
    async fn delete_by_org_leaves_other_orgs() {
        let db = db().await;
        for r in [
            row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0),
            change(ORG, "run_2", KIM, ResolutionCause::CapacityOrLoad, T0),
            row(OTHER_ORG, RUN, RAO, FeedbackVerdict::Yes, T0),
        ] {
            upsert_with(&db, &r).await.unwrap();
        }
        delete_by_org_with(&db, ORG).await.unwrap();
        assert!(list_for_run_with(&db, ORG, RUN).await.unwrap().is_empty());
        assert!(
            list_corrections_for_subject_with(&db, ORG, "alert", ALERT, 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_for_run_with(&db, OTHER_ORG, RUN).await.unwrap().len(),
            1
        );
        delete_by_org_with(&db, "empty_org").await.unwrap();
    }

    /// Stored values round-trip to the API shape; a newer node's verdict hides the row, a
    /// newer node's cause or reason is dropped instead of failing the read.
    #[tokio::test]
    async fn to_feedback_round_trips_and_tolerates_unknown_values() {
        let db = db().await;
        let stored = upsert_with(
            &db,
            &Model {
                reasons: reasons_column(&[
                    FeedbackReason::MissedChange,
                    FeedbackReason::SymptomNotCause,
                ]),
                note: Some("deploy at 14:02".to_string()),
                ..row(ORG, RUN, RAO, FeedbackVerdict::No, T0)
            },
        )
        .await
        .unwrap();
        let api = to_feedback(stored).unwrap();
        assert_eq!(api.verdict, FeedbackVerdict::No);
        assert_eq!(
            api.reasons,
            [
                FeedbackReason::MissedChange,
                FeedbackReason::SymptomNotCause
            ]
        );
        assert_eq!(api.note.as_deref(), Some("deploy at 14:02"));
        assert_eq!((api.created_at, api.updated_at), (T0, T0));

        let corrected = upsert_with(
            &db,
            &change(ORG, "run_2", RAO, ResolutionCause::DataOrIngestionIssue, T0),
        )
        .await
        .unwrap();
        assert_eq!(
            to_feedback(corrected).unwrap().cause,
            Some(ResolutionCause::DataOrIngestionIssue)
        );

        assert!(
            to_feedback(Model {
                verdict: "partly".to_string(),
                ..row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0)
            })
            .is_none()
        );

        let lenient = to_feedback(Model {
            cause: Some("solar_flare".to_string()),
            reasons: Some(serde_json::json!(["wrong_service", "new_reason", 3])),
            ..row(ORG, RUN, RAO, FeedbackVerdict::Change, T0)
        })
        .unwrap();
        assert_eq!(lenient.cause, None);
        assert_eq!(lenient.reasons, [FeedbackReason::WrongService]);

        assert_eq!(reasons_column(&[]), None);
        assert!(
            to_feedback(row(ORG, RUN, RAO, FeedbackVerdict::Yes, T0))
                .unwrap()
                .reasons
                .is_empty()
        );
    }
}
