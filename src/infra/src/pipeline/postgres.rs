// Copyright 2024 OpenObserve Inc.
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
use config::{
    meta::{
        pipeline::{components::PipelineSource, Pipeline},
        stream::StreamParams,
    },
    utils::json,
};

use crate::{
    db::postgres::CLIENT,
    errors::{DbError, Error, Result},
};

pub struct PostgresPipelineTable {}

impl PostgresPipelineTable {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for PostgresPipelineTable {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::PipelineTable for PostgresPipelineTable {
    async fn create_table(&self) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(
            r#"
CREATE TABLE IF NOT EXISTS pipeline
(
    id              VARCHAR(256) PRIMARY KEY,
    version         INT not null,
    enabled         BOOLEAN default true not null,
    name            VARCHAR(256) not null,
    description     TEXT,
    org             VARCHAR(100) not null,
    source_type     VARCHAR(50) not null,
    stream_org      VARCHAR(100),
    stream_name     VARCHAR(256),
    stream_type     VARCHAR(50),
    derived_stream  TEXT,
    nodes           TEXT,
    edges           TEXT,
    created_at      TIMESTAMP default CURRENT_TIMESTAMP
);
            "#,
        )
        .execute(&pool)
        .await?;
        Ok(())
    }

    async fn create_table_index(&self) -> Result<()> {
        let pool = CLIENT.clone();

        let queries = vec![
            "CREATE INDEX IF NOT EXISTS pipeline_org_idx ON pipeline (org);",
            "CREATE INDEX IF NOT EXISTS pipeline_org_src_type_stream_params_idx ON pipeline (org, source_type, stream_org, stream_name, stream_type);",
        ];

        for query in queries {
            if let Err(e) = sqlx::query(query).execute(&pool).await {
                log::error!(
                    "[POSTGRES] create table index for pipeline table error: {}",
                    e
                );
                return Err(e.into());
            }
        }
        Ok(())
    }

    async fn drop_table(&self) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query("DROP TABLE IF EXISTS pipeline;")
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn put(&self, pipeline: &Pipeline) -> Result<()> {
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;

        if let Err(e) = match &pipeline.source {
            PipelineSource::Realtime(stream_params) => {
                let (source_type, stream_org, stream_name, stream_type): (&str, &str, &str, &str) = (
                    "realtime",
                    stream_params.org_id.as_str(),
                    stream_params.stream_name.as_str(),
                    stream_params.stream_type.as_str(),
                );
                sqlx::query(
                    r#"
INSERT INTO pipeline (id, version, enabled, name, description, org, source_type, stream_org, stream_name, stream_type, nodes, edges)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT DO NOTHING;
                    "#,
                )
                .bind(&pipeline.id)
                .bind(pipeline.version)
                .bind(pipeline.enabled)
                .bind(&pipeline.name)
                .bind(&pipeline.description)
                .bind(&pipeline.org)
                .bind(source_type)
                .bind(stream_org)
                .bind(stream_name)
                .bind(stream_type)
                .bind(json::to_string(&pipeline.nodes).expect("Serializing pipeline nodes error"))
                .bind(json::to_string(&pipeline.edges).expect("Serializing pipeline edges error"))
                .execute(&mut *tx)
                .await
            }
            PipelineSource::Scheduled(derived_stream) => {
                let (source_type, derived_stream_str) = (
                    "scheduled",
                    json::to_string(&derived_stream)
                        .expect("Serializing pipeline DerivedStream error"),
                );

                sqlx::query(
                    r#"
INSERT INTO pipeline (id, version, enabled, name, description, org, source_type, derived_stream, nodes, edges)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT DO NOTHING;
                    "#,
                )
                .bind(&pipeline.id)
                .bind(pipeline.version)
                .bind(pipeline.enabled)
                .bind(&pipeline.name)
                .bind(&pipeline.description)
                .bind(&pipeline.org)
                .bind(source_type)
                .bind(derived_stream_str)
                .bind(json::to_string(&pipeline.nodes).expect("Serializing pipeline nodes error"))
                .bind(json::to_string(&pipeline.edges).expect("Serializing pipeline edges error"))
                .execute(&mut *tx)
                .await
            }
        } {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback push pipeline error: {}", e);
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit push pipeline error: {}", e);
            return Err(e.into());
        }
        Ok(())
    }

    async fn update(&self, pipeline: &Pipeline) -> Result<()> {
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;

        if let Err(e) = match &pipeline.source {
            PipelineSource::Realtime(stream_params) => {
                let (source_type, stream_org, stream_name, stream_type): (&str, &str, &str, &str) = (
                    "realtime",
                    stream_params.org_id.as_str(),
                    stream_params.stream_name.as_str(),
                    stream_params.stream_type.as_str(),
                );
                sqlx::query(
                    r#"
UPDATE pipeline
    SET version = $1, enabled = $2, name = $3, description = $4, org = $5, source_type = $6, stream_org = $7, stream_name = $8, stream_type = $9, nodes = $10, edges = $11
    WHERE id = $12;
                    "#,
                )
                .bind(pipeline.version)
                .bind(pipeline.enabled)
                .bind(&pipeline.name)
                .bind(&pipeline.description)
                .bind(&pipeline.org)
                .bind(source_type)
                .bind(stream_org)
                .bind(stream_name)
                .bind(stream_type)
                .bind(json::to_string(&pipeline.nodes).expect("Serializing pipeline nodes error"))
                .bind(json::to_string(&pipeline.edges).expect("Serializing pipeline edges error"))
                .bind(&pipeline.id)
                .execute(&mut *tx)
                .await
            }
            PipelineSource::Scheduled(derived_stream) => {
                let (source_type, derived_stream_str) = (
                    "scheduled",
                    json::to_string(&derived_stream)
                        .expect("Serializing pipeline DerivedStream error"),
                );

                sqlx::query(
                    r#"
UPDATE pipeline
    SET version = $1, enabled = $2, name = $3, description = $4, org = $5, source_type = $6, derived_stream = $7, nodes = $8, edges = $9
    WHERE id = $10;
                    "#,
                )
                .bind(pipeline.version)
                .bind(pipeline.enabled)
                .bind(&pipeline.name)
                .bind(&pipeline.description)
                .bind(&pipeline.org)
                .bind(source_type)
                .bind(derived_stream_str)
                .bind(json::to_string(&pipeline.nodes).expect("Serializing pipeline nodes error"))
                .bind(json::to_string(&pipeline.edges).expect("Serializing pipeline edges error"))
                .bind(&pipeline.id)
                .execute(&mut *tx)
                .await
            }
        } {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback push pipeline error: {}", e);
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit push pipeline error: {}", e);
            return Err(e.into());
        }
        Ok(())
    }

    async fn get_by_stream(&self, stream_params: &StreamParams) -> Result<Pipeline> {
        let pool = CLIENT.clone();
        let query = r#"
SELECT * FROM pipeline WHERE org = $1 AND source_type = $2 AND stream_org = $3 AND stream_name = $4 AND stream_type = $5;
        "#;
        let pipeline = sqlx::query_as::<_, Pipeline>(query)
            .bind(stream_params.org_id.as_str())
            .bind("realtime")
            .bind(stream_params.org_id.as_str())
            .bind(stream_params.stream_name.as_str())
            .bind(stream_params.stream_type.as_str())
            .fetch_one(&pool)
            .await?;
        Ok(pipeline)
    }

    async fn get_by_id(&self, pipeline_id: &str) -> Result<Pipeline> {
        let pool = CLIENT.clone();
        let query = "SELECT * FROM pipeline WHERE id = $1;";
        let pipeline = match sqlx::query_as::<_, Pipeline>(query)
            .bind(pipeline_id)
            .fetch_one(&pool)
            .await
        {
            Ok(pipeline) => pipeline,
            Err(e) => {
                log::error!("[POSTGRES] get pipeline by id error: {}", e);
                return Err(Error::from(DbError::KeyNotExists(pipeline_id.to_string())));
            }
        };
        Ok(pipeline)
    }

    async fn get_with_same_source_stream(&self, pipeline: &Pipeline) -> Result<Pipeline> {
        let pool = CLIENT.clone();
        let similar_pipeline = match &pipeline.source {
            PipelineSource::Realtime(stream_params) => {
                sqlx::query_as::<_, Pipeline>(
                    r#"
SELECT * FROM pipeline
    WHERE source_type = $1 AND stream_org = $2 AND stream_name = $3 AND stream_type = $4;
                "#,
                )
                .bind("realtime")
                .bind(stream_params.org_id.as_str())
                .bind(stream_params.stream_name.as_str())
                .bind(stream_params.stream_type.as_str())
                .fetch_one(&pool)
                .await?
            }
            PipelineSource::Scheduled(_) => {
                // only checks for realtime pipelines
                return Err(Error::from(DbError::KeyNotExists(
                    "No matching pipeline found for scheduled source".to_string(),
                )));
            }
        };

        Ok(similar_pipeline)
    }

    async fn list(&self) -> Result<Vec<Pipeline>> {
        let pool = CLIENT.clone();
        let query = "SELECT * FROM pipeline ORDER BY id;";
        match sqlx::query_as::<_, Pipeline>(query).fetch_all(&pool).await {
            Ok(pipelines) => Ok(pipelines),
            Err(e) => {
                log::debug!("[POSTGRES] list all pipelines  error: {}", e);
                Ok(vec![]) // Return empty vector instead of error
            }
        }
    }

    async fn list_by_org(&self, org: &str) -> Result<Vec<Pipeline>> {
        let pool = CLIENT.clone();
        let query = "SELECT * FROM pipeline WHERE org = $1 ORDER BY id;";
        match sqlx::query_as::<_, Pipeline>(query)
            .bind(org)
            .fetch_all(&pool)
            .await
        {
            Ok(pipelines) => Ok(pipelines),
            Err(e) => {
                log::debug!("[POSTGRES] list pipelines by org error: {}", e);
                Ok(vec![])
            }
        }
    }

    async fn list_streams_with_pipeline(&self, org: &str) -> Result<Vec<Pipeline>> {
        let pool = CLIENT.clone();
        let query = r#"
SELECT * FROM pipeline WHERE org = $1 AND source_type = $2 ORDER BY id;
        "#;
        match sqlx::query_as::<_, Pipeline>(query)
            .bind(org)
            .bind("realtime")
            .fetch_all(&pool)
            .await
        {
            Ok(pipelines) => Ok(pipelines),
            Err(e) => {
                log::debug!("[POSTGRES] list streams with pipelines error: {}", e);
                Ok(vec![])
            }
        }
    }

    async fn delete(&self, pipeline_id: &str) -> Result<Pipeline> {
        let pool = CLIENT.clone();

        let pipeline = sqlx::query_as::<_, Pipeline>("SELECT * FROM pipeline WHERE id = $1;")
            .bind(pipeline_id)
            .fetch_one(&pool)
            .await?;

        sqlx::query(r#"DELETE FROM pipeline WHERE id = $1;"#)
            .bind(pipeline_id)
            .execute(&pool)
            .await?;

        Ok(pipeline)
    }
}
