// Copyright 2025 OpenObserve Inc.
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
use config::{meta::stream::StreamType, metrics::DB_QUERY_NUMS, utils::json};
use datafusion::arrow::datatypes::Schema;

use crate::{
    db::{
        IndexStatement,
        mysql::{CLIENT, CLIENT_DDL, create_index},
    },
    errors::{Error, Result},
};

pub struct MysqlSchemaHistory {}

impl MysqlSchemaHistory {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for MysqlSchemaHistory {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::SchemaHistory for MysqlSchemaHistory {
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
        DB_QUERY_NUMS
            .with_label_values(&["insert", "schema_history", ""])
            .inc();
        match sqlx::query(
            r#"
INSERT IGNORE INTO schema_history (org, stream_type, stream_name, start_dt, value)
    VALUES (?, ?, ?, ?, ?);
            "#,
        )
        .bind(org_id)
        .bind(stream_type.as_str())
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
    let pool = CLIENT_DDL.clone();
    DB_QUERY_NUMS
        .with_label_values(&["create", "schema_history", ""])
        .inc();
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS schema_history
(
    id           BIGINT not null primary key AUTO_INCREMENT,
    org          VARCHAR(100) not null,
    stream_type  VARCHAR(32)  not null,
    stream_name  VARCHAR(256) not null,
    start_dt     BIGINT       not null,
    value        LONGTEXT     not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(())
}

pub async fn create_table_index() -> Result<()> {
    create_index(IndexStatement::new(
        "schema_history_org_idx",
        "schema_history",
        false,
        &["org"],
    ))
    .await?;
    create_index(IndexStatement::new(
        "schema_history_stream_idx",
        "schema_history",
        false,
        &["org", "stream_type", "stream_name"],
    ))
    .await?;
    create_index(IndexStatement::new(
        "schema_history_stream_version_idx",
        "schema_history",
        true,
        &["org", "stream_type", "stream_name", "start_dt"],
    ))
    .await?;

    Ok(())
}
