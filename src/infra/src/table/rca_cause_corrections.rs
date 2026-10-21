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

//! The responder's cause correction on an incident (`rca_cause_corrections`).

use config::meta::{alerts::rca_feedback::RcaCauseCorrection, oncall::ResolutionCause};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    sea_query::OnConflict,
};

pub use super::entity::rca_cause_corrections::Model;
use super::entity::rca_cause_corrections::{ActiveModel, Column, Entity};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

pub async fn upsert(row: &Model) -> Result<Model, DbErr> {
    upsert_with(get_orm_client_rw().await, row).await
}

/// [upsert] on a given connection; `created_at` keeps the first write.
pub async fn upsert_with<C: ConnectionTrait>(conn: &C, row: &Model) -> Result<Model, DbErr> {
    let active: ActiveModel = row.clone().into();
    Entity::insert(active)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::IncidentId, Column::AuthorEmail])
                .update_columns([
                    Column::SubjectType,
                    Column::SubjectId,
                    Column::Cause,
                    Column::Note,
                    Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Entity::find_by_id((
        row.org_id.clone(),
        row.incident_id.clone(),
        row.author_email.clone(),
    ))
    .one(conn)
    .await?
    .ok_or_else(|| DbErr::RecordNotFound("rca_cause_corrections row after upsert".to_string()))
}

/// Deletes the author's correction of the incident. `true` when a row was deleted.
pub async fn delete_own(
    org_id: &str,
    incident_id: &str,
    author_email: &str,
) -> Result<bool, DbErr> {
    delete_own_with(get_orm_client_rw().await, org_id, incident_id, author_email).await
}

/// [delete_own] on a given connection.
pub async fn delete_own_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
    author_email: &str,
) -> Result<bool, DbErr> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IncidentId.eq(incident_id))
        .filter(Column::AuthorEmail.eq(author_email))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Every author's correction of the incident, oldest `created_at` first.
pub async fn list_for_incident(org_id: &str, incident_id: &str) -> Result<Vec<Model>, DbErr> {
    list_for_incident_with(get_orm_client_ro().await, org_id, incident_id).await
}

/// [list_for_incident] on a given connection.
pub async fn list_for_incident_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IncidentId.eq(incident_id))
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::AuthorEmail)
        .all(conn)
        .await
}

/// The incident's newest correction over all authors (largest `updated_at`): what it was.
pub async fn latest_for_incident(org_id: &str, incident_id: &str) -> Result<Option<Model>, DbErr> {
    latest_for_incident_with(get_orm_client_ro().await, org_id, incident_id).await
}

/// [latest_for_incident] on a given connection.
pub async fn latest_for_incident_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IncidentId.eq(incident_id))
        .order_by_desc(Column::UpdatedAt)
        .order_by_asc(Column::AuthorEmail)
        .one(conn)
        .await
}

/// The subject's corrections over all its incidents, newest `updated_at` first, at most `limit`.
pub async fn list_for_subject(
    org_id: &str,
    subject_type: &str,
    subject_id: &str,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    list_for_subject_with(
        get_orm_client_ro().await,
        org_id,
        subject_type,
        subject_id,
        limit,
    )
    .await
}

/// [list_for_subject] on a given connection.
pub async fn list_for_subject_with<C: ConnectionTrait>(
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
        .order_by_desc(Column::UpdatedAt)
        .order_by_asc(Column::IncidentId)
        .order_by_asc(Column::AuthorEmail)
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

/// The API shape of a row; `None` for a cause this build cannot read.
pub fn to_correction(m: Model) -> Option<RcaCauseCorrection> {
    let Some(cause) = ResolutionCause::from_str_opt(&m.cause) else {
        log::warn!(
            "[rca_cause_corrections] org {} incident {}: skipping row with cause {:?}",
            m.org_id,
            m.incident_id,
            m.cause
        );
        return None;
    };
    Some(RcaCauseCorrection {
        org_id: m.org_id,
        incident_id: m.incident_id,
        author_email: m.author_email,
        cause,
        note: m.note,
        created_at: m.created_at,
        updated_at: m.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";
    const INC: &str = "inc_1";
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

    fn row(org: &str, incident: &str, author: &str, cause: ResolutionCause, at: i64) -> Model {
        Model {
            org_id: org.to_string(),
            incident_id: incident.to_string(),
            author_email: author.to_string(),
            subject_type: "alert".to_string(),
            subject_id: ALERT.to_string(),
            cause: cause.as_str().to_string(),
            note: None,
            created_at: at,
            updated_at: at,
        }
    }

    fn keys(rows: &[Model]) -> Vec<(&str, &str)> {
        rows.iter()
            .map(|r| (r.incident_id.as_str(), r.author_email.as_str()))
            .collect()
    }

    #[tokio::test]
    async fn upsert_keeps_one_row_per_incident_and_author() {
        let db = db().await;
        let first = Model {
            note: Some("pool exhausted".to_string()),
            ..row(ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0)
        };
        assert_eq!(upsert_with(&db, &first).await.unwrap(), first);

        let second = row(
            ORG,
            INC,
            RAO,
            ResolutionCause::DependencyFailure,
            T0 + 60 * SEC,
        );
        let stored = upsert_with(&db, &second).await.unwrap();
        assert_eq!(
            stored,
            Model {
                created_at: T0,
                ..second
            },
            "every column but created_at follows the latest write; the note is cleared"
        );
        upsert_with(
            &db,
            &row(ORG, INC, KIM, ResolutionCause::GenuineDefect, T0 + SEC),
        )
        .await
        .unwrap();
        assert_eq!(
            keys(&list_for_incident_with(&db, ORG, INC).await.unwrap()),
            [(INC, RAO), (INC, KIM)],
            "oldest first"
        );
    }

    #[tokio::test]
    async fn delete_own_removes_only_the_callers_row() {
        let db = db().await;
        for r in [
            row(ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0),
            row(ORG, INC, KIM, ResolutionCause::CapacityOrLoad, T0 + SEC),
            row(ORG, "inc_2", RAO, ResolutionCause::CapacityOrLoad, T0),
            row(OTHER_ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0),
        ] {
            upsert_with(&db, &r).await.unwrap();
        }
        assert!(delete_own_with(&db, ORG, INC, RAO).await.unwrap());
        assert!(!delete_own_with(&db, ORG, INC, RAO).await.unwrap());
        assert_eq!(
            keys(&list_for_incident_with(&db, ORG, INC).await.unwrap()),
            [(INC, KIM)]
        );
        assert_eq!(
            list_for_incident_with(&db, ORG, "inc_2")
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            list_for_incident_with(&db, OTHER_ORG, INC)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn latest_for_incident_is_the_newest_update_across_authors() {
        let db = db().await;
        assert!(
            latest_for_incident_with(&db, ORG, INC)
                .await
                .unwrap()
                .is_none()
        );
        upsert_with(
            &db,
            &row(ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0),
        )
        .await
        .unwrap();
        upsert_with(
            &db,
            &row(ORG, INC, KIM, ResolutionCause::GenuineDefect, T0 + 10 * SEC),
        )
        .await
        .unwrap();
        // Newer rows on another incident or org do not count.
        upsert_with(
            &db,
            &row(
                ORG,
                "inc_2",
                RAO,
                ResolutionCause::NoisyThreshold,
                T0 + 99 * SEC,
            ),
        )
        .await
        .unwrap();
        upsert_with(
            &db,
            &row(
                OTHER_ORG,
                INC,
                RAO,
                ResolutionCause::NoisyThreshold,
                T0 + 99 * SEC,
            ),
        )
        .await
        .unwrap();
        let latest = latest_for_incident_with(&db, ORG, INC)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (latest.author_email.as_str(), latest.cause.as_str()),
            (KIM, "genuine_defect")
        );
    }

    #[tokio::test]
    async fn list_for_subject_filters_orders_and_limits() {
        let db = db().await;
        for r in [
            row(ORG, "inc_1", RAO, ResolutionCause::CapacityOrLoad, T0),
            row(
                ORG,
                "inc_2",
                RAO,
                ResolutionCause::DependencyFailure,
                T0 + 30 * SEC,
            ),
            row(
                ORG,
                "inc_3",
                KIM,
                ResolutionCause::GenuineDefect,
                T0 + 10 * SEC,
            ),
            // Other subjects and orgs.
            Model {
                subject_id: "alert_2".to_string(),
                ..row(
                    ORG,
                    "inc_4",
                    RAO,
                    ResolutionCause::NoisyThreshold,
                    T0 + 60 * SEC,
                )
            },
            Model {
                subject_type: "incident".to_string(),
                ..row(
                    ORG,
                    "inc_5",
                    RAO,
                    ResolutionCause::NoisyThreshold,
                    T0 + 60 * SEC,
                )
            },
            row(
                OTHER_ORG,
                "inc_6",
                RAO,
                ResolutionCause::NoisyThreshold,
                T0 + 60 * SEC,
            ),
        ] {
            upsert_with(&db, &r).await.unwrap();
        }
        let got = list_for_subject_with(&db, ORG, "alert", ALERT, 10)
            .await
            .unwrap();
        assert_eq!(keys(&got), [("inc_2", RAO), ("inc_3", KIM), ("inc_1", RAO)]);
        let got = list_for_subject_with(&db, ORG, "alert", ALERT, 2)
            .await
            .unwrap();
        assert_eq!(keys(&got), [("inc_2", RAO), ("inc_3", KIM)]);
    }

    #[tokio::test]
    async fn delete_by_org_leaves_other_orgs() {
        let db = db().await;
        for r in [
            row(ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0),
            row(OTHER_ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0),
        ] {
            upsert_with(&db, &r).await.unwrap();
        }
        delete_by_org_with(&db, ORG).await.unwrap();
        assert!(
            list_for_incident_with(&db, ORG, INC)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_for_incident_with(&db, OTHER_ORG, INC)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn to_correction_maps_the_row_and_skips_unknown_causes() {
        let api = to_correction(Model {
            note: Some("raised the pool".to_string()),
            ..row(ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0)
        })
        .unwrap();
        assert_eq!(
            api,
            RcaCauseCorrection {
                org_id: ORG.to_string(),
                incident_id: INC.to_string(),
                author_email: RAO.to_string(),
                cause: ResolutionCause::CapacityOrLoad,
                note: Some("raised the pool".to_string()),
                created_at: T0,
                updated_at: T0,
            }
        );
        assert!(
            to_correction(Model {
                cause: "solar_flare".to_string(),
                ..row(ORG, INC, RAO, ResolutionCause::CapacityOrLoad, T0)
            })
            .is_none()
        );
    }
}
