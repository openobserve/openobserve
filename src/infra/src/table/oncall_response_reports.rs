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

//! What an L0 run reported for one record — one row per run, both subject types.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

use super::entity::oncall_response_reports::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors};

/// Upsert on `(org_id, response_id)` — a re-analysis must replace the row, and
/// a replayed super-cluster message must not duplicate it.
pub async fn put(
    org_id: &str,
    response_id: &str,
    report: &str,
    model: Option<&str>,
    generated_at: i64,
) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    put_with(client, org_id, response_id, report, model, generated_at).await
}

/// [`put`] against a caller-supplied connection.
pub async fn put_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    response_id: &str,
    report: &str,
    model: Option<&str>,
    generated_at: i64,
) -> Result<(), errors::Error> {
    let active_model = ActiveModel {
        org_id: Set(org_id.to_string()),
        response_id: Set(response_id.to_string()),
        report: Set(report.to_string()),
        model: Set(model.map(str::to_string)),
        generated_at: Set(generated_at),
    };
    Entity::insert(active_model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([Column::OrgId, Column::ResponseId])
                .update_columns([Column::Report, Column::Model, Column::GeneratedAt])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn get(org_id: &str, response_id: &str) -> Result<Option<Model>, errors::Error> {
    let client = get_orm_client_rw().await;
    get_with(client, org_id, response_id).await
}

/// [`get`] against a caller-supplied connection.
pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    response_id: &str,
) -> Result<Option<Model>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ResponseId.eq(response_id))
        .one(conn)
        .await?)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, Schema};

    use super::*;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        let stmt = schema.create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    #[tokio::test]
    async fn test_put_then_get_round_trips_and_second_put_replaces() {
        let db = db().await;

        put_with(
            &db,
            "default",
            "resp_1",
            "## RCA\nfound it",
            Some("claude"),
            1000,
        )
        .await
        .unwrap();
        let got = get_with(&db, "default", "resp_1").await.unwrap().unwrap();
        assert_eq!(got.report, "## RCA\nfound it");
        assert_eq!(got.model.as_deref(), Some("claude"));
        assert_eq!(got.generated_at, 1000);

        // A re-analysis, or a replayed super-cluster message, must replace — not duplicate.
        put_with(&db, "default", "resp_1", "## RCA v2", None, 2000)
            .await
            .unwrap();
        let got = get_with(&db, "default", "resp_1").await.unwrap().unwrap();
        assert_eq!(got.report, "## RCA v2");
        assert_eq!(got.model, None);
        assert_eq!(got.generated_at, 2000);

        let count = Entity::find().all(&db).await.unwrap().len();
        assert_eq!(count, 1, "the second put must replace, not duplicate");
    }
}
