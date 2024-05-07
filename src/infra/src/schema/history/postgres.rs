// Copyright 2024 Zinc Labs Inc.
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

use async_trait::async_trait;
use config::{meta::stream::StreamType, utils::json};
use datafusion::arrow::datatypes::Schema;

use crate::{
    db::postgres::CLIENT,
    errors::{Error, Result},
};

pub struct PostgresSchemaHistory {}

impl PostgresSchemaHistory {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for PostgresSchemaHistory {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::SchemaHistory for PostgresSchemaHistory {
    async fn create_table(&self) -> Result<()> {
        create_table().await
    }

    async fn create_table_index(&self) -> Result<()> {
        create_table_index().await
    }

    async fn create(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        start_dt: i64,
        schema: Schema,
    ) -> Result<()> {
        let value = json::to_string(&schema)?;
        let pool = CLIENT.clone();
        match sqlx::query(
            r#"
INSERT INTO schema_history (org, stream_type, stream_name, start_dt, value)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT DO NOTHING;
            "#,
        )
        .bind(org_id)
        .bind(stream_type.to_string())
        .bind(stream_name)
        .bind(start_dt)
        .bind(value)
        .execute(&pool)
        .await
        {
            Err(sqlx::Error::Database(e)) => {
                if e.is_unique_violation() {
                    Ok(())
                } else {
                    Err(Error::Message(e.to_string()))
                }
            }
            Err(e) => Err(e.into()),
            Ok(_) => Ok(()),
        }
    }
}

pub async fn create_table() -> Result<()> {
    let pool = CLIENT.clone();
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS schema_history
(
    id           BIGINT GENERATED ALWAYS AS IDENTITY,
    org          VARCHAR(100) not null,
    stream_type  VARCHAR(32)  not null,
    stream_name  VARCHAR(256) not null,
    start_dt     BIGINT not null,
    value        TEXT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(())
}

pub async fn create_table_index() -> Result<()> {
    let pool = CLIENT.clone();
    let sqls = vec![
        (
            "schema_history",
            "CREATE INDEX IF NOT EXISTS schema_history_org_idx on schema_history (org);",
        ),
        (
            "schema_history",
            "CREATE INDEX IF NOT EXISTS schema_history_stream_idx on schema_history (org, stream_type, stream_name);",
        ),
        (
            "schema_history",
            "CREATE UNIQUE INDEX IF NOT EXISTS schema_history_stream_version_idx on schema_history (org, stream_type, stream_name, start_dt);",
        ),
    ];
    for (table, sql) in sqls {
        if let Err(e) = sqlx::query(sql).execute(&pool).await {
            log::error!("[POSTGRES] create table {} index error: {}", table, e);
            return Err(e.into());
        }
    }

    Ok(())
}
