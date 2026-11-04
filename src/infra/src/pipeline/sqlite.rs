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

use async_trait::async_trait;
use config::{
    meta::{
        pipeline::{Pipeline, components::PipelineSource},
        stream::StreamParams,
    },
    utils::json,
};

use crate::{
    db::sqlite::{CLIENT_RO, CLIENT_RW, drop_column},
    errors::{DbError, Error, Result},
};

pub struct SqlitePipelineTable {}

impl SqlitePipelineTable {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for SqlitePipelineTable {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::PipelineTable for SqlitePipelineTable {
    async fn create_table(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        sqlx::query(
            r#"
CREATE TABLE IF NOT EXISTS pipeline
(
    id              VARCHAR(256) not null primary key,
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
    edges           TEXT
);
            "#,
        )
        .execute(&client)
        .await?;

        // drop created_at column for old version <= 0.40.0
        drop_column(&client, "pipeline", "created_at").await?;

        Ok(())
    }

    async fn create_table_index(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let queries = vec![
            "CREATE INDEX IF NOT EXISTS pipeline_org_idx ON pipeline (org);",
            "CREATE INDEX IF NOT EXISTS pipeline_org_src_type_stream_params_idx ON pipeline (org, source_type, stream_org, stream_name, stream_type);",
        ];

        for query in queries {
            sqlx::query(query).execute(&client).await?;
        }
        Ok(())
    }

    async fn drop_table(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        sqlx::query("DROP TABLE IF EXISTS pipeline;")
            .execute(&client)
            .await?;
        Ok(())
    }

    async fn put(&self, pipeline: &Pipeline) -> Result<()> {
        let client = CLIENT_RW.clone();
        let mut tx = client.begin().await?;

        if let Err(e) = match &pipeline.source {
            PipelineSource::Realtime(stream_params) => {
                let (source_type, stream_org, stream_name, stream_type): (&str, &str, &str, &str) = (
                    "realtime",
                    stream_params.org_id.as_str(),
                    stream_params.stream_name.as_str(),
                    stream_params.stream_type.as_str(),
                );
                let kind_str = match &pipeline.kind {
                    config::meta::pipeline::PipelineKind::User => "user",
                    config::meta::pipeline::PipelineKind::Evaluation => "evaluation",
                };
                sqlx::query(
                    r#"
INSERT INTO pipeline (id, version, enabled, name, description, org, source_type, stream_org, stream_name, stream_type, kind, nodes, edges)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
                .bind(kind_str)
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
                let kind_str = match &pipeline.kind {
                    config::meta::pipeline::PipelineKind::User => "user",
                    config::meta::pipeline::PipelineKind::Evaluation => "evaluation",
                };
                sqlx::query(
                    r#"
INSERT INTO pipeline (id, version, enabled, name, description, org, source_type, derived_stream, kind, nodes, edges)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
                .bind(kind_str)
                .bind(json::to_string(&pipeline.nodes).expect("Serializing pipeline nodes error"))
                .bind(json::to_string(&pipeline.edges).expect("Serializing pipeline edges error"))
                .execute(&mut *tx)
                .await
            }
        } {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback push pipeline error: {e}");
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit push pipeline error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);
        Ok(())
    }

    async fn update(&self, pipeline: &Pipeline) -> Result<()> {
        let client = CLIENT_RW.clone();
        let mut tx = client.begin().await?;

        if let Err(e) = match &pipeline.source {
            PipelineSource::Realtime(stream_params) => {
                let (source_type, stream_org, stream_name, stream_type): (&str, &str, &str, &str) = (
                    "realtime",
                    stream_params.org_id.as_str(),
                    stream_params.stream_name.as_str(),
                    stream_params.stream_type.as_str(),
                );
                let kind_str = match &pipeline.kind {
                    config::meta::pipeline::PipelineKind::User => "user",
                    config::meta::pipeline::PipelineKind::Evaluation => "evaluation",
                };
                sqlx::query(
                    r#"
UPDATE pipeline
    SET version = $1, enabled = $2, name = $3, description = $4, org = $5, source_type = $6, stream_org = $7, stream_name = $8, stream_type = $9, kind = $10, nodes = $11, edges = $12
    WHERE id = $13;
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
                .bind(kind_str)
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
                let kind_str = match &pipeline.kind {
                    config::meta::pipeline::PipelineKind::User => "user",
                    config::meta::pipeline::PipelineKind::Evaluation => "evaluation",
                };
                sqlx::query(
                    r#"
UPDATE pipeline
    SET version = $1, enabled = $2, name = $3, description = $4, org = $5, source_type = $6, derived_stream = $7, kind = $8, nodes = $9, edges = $10
    WHERE id = $11;
                    "#,
                )
                .bind(pipeline.version)
                .bind(pipeline.enabled)
                .bind(&pipeline.name)
                .bind(&pipeline.description)
                .bind(&pipeline.org)
                .bind(source_type)
                .bind(derived_stream_str)
                .bind(kind_str)
                .bind(json::to_string(&pipeline.nodes).expect("Serializing pipeline nodes error"))
                .bind(json::to_string(&pipeline.edges).expect("Serializing pipeline edges error"))
                .bind(&pipeline.id)
                .execute(&mut *tx)
                .await
            }
        } {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback push pipeline error: {e}");
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit push pipeline error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);
        Ok(())
    }

    async fn get_by_stream(&self, stream_params: &StreamParams) -> Result<Vec<Pipeline>> {
        let pool = CLIENT_RO.clone();
        let query = r#"
SELECT * FROM pipeline WHERE org = $1 AND source_type = $2 AND stream_org = $3 AND stream_name = $4 AND stream_type = $5 ORDER BY kind ASC, id ASC;
        "#;
        let rows = sqlx::query(query)
            .bind(stream_params.org_id.as_str())
            .bind("realtime")
            .bind(stream_params.org_id.as_str())
            .bind(stream_params.stream_name.as_str())
            .bind(stream_params.stream_type.as_str())
            .fetch_all(&pool)
            .await?;
        Ok(super::decode_rows(rows))
    }

    async fn get_by_id(&self, pipeline_id: &str) -> Result<super::Decoded> {
        let pool = CLIENT_RO.clone();
        let query = "SELECT * FROM pipeline WHERE id = $1;";
        let row = sqlx::query(query)
            .bind(pipeline_id)
            .fetch_optional(&pool)
            .await
            .map_err(|_| Error::from(DbError::KeyNotExists(pipeline_id.to_string())))?;
        super::decode_row(pipeline_id, row)
    }

    async fn get_with_same_source_stream(&self, pipeline: &Pipeline) -> Result<Vec<Pipeline>> {
        let pool = CLIENT_RO.clone();
        let similar_pipelines = match &pipeline.source {
            PipelineSource::Realtime(stream_params) => {
                let rows = sqlx::query(
                    r#"
SELECT * FROM pipeline 
    WHERE source_type = $1 AND stream_org = $2 AND stream_name = $3 AND stream_type = $4
    ORDER BY kind ASC, id ASC;
                "#,
                )
                .bind("realtime")
                .bind(stream_params.org_id.as_str())
                .bind(stream_params.stream_name.as_str())
                .bind(stream_params.stream_type.as_str())
                .fetch_all(&pool)
                .await?;
                super::decode_rows(rows)
            }
            PipelineSource::Scheduled(_) => {
                // only checks for realtime pipelines
                return Err(Error::from(DbError::KeyNotExists("".to_string())));
            }
        };

        Ok(similar_pipelines)
    }

    async fn list(&self) -> Result<super::DecodedPipelines> {
        let client = CLIENT_RO.clone();
        let query = "SELECT * FROM pipeline ORDER BY id;";
        match sqlx::query(query).fetch_all(&client).await {
            Ok(rows) => Ok(super::decode_all_rows(rows)),
            Err(e) => {
                log::debug!("[SQLITE] list all pipelines error: {e}");
                Ok(super::DecodedPipelines::default())
            }
        }
    }

    async fn list_by_org(&self, org: &str) -> Result<super::DecodedPipelines> {
        let client = CLIENT_RO.clone();
        let query = "SELECT * FROM pipeline WHERE org = $1 ORDER BY id;";
        match sqlx::query(query).bind(org).fetch_all(&client).await {
            Ok(rows) => Ok(super::decode_all_rows(rows)),
            Err(e) => {
                log::error!("[SQLITE] list pipeline by org error: {e}");
                Err(e.into())
            }
        }
    }

    async fn delete_by_org(&self, org: &str) -> Result<Vec<String>> {
        let client = CLIENT_RW.clone();
        Ok(
            sqlx::query_scalar("DELETE FROM pipeline WHERE org = $1 RETURNING id;")
                .bind(org)
                .fetch_all(&client)
                .await?,
        )
    }

    async fn list_streams_with_pipeline(&self, org: &str) -> Result<Vec<Pipeline>> {
        let client = CLIENT_RO.clone();
        let query = r#"
SELECT * FROM pipeline WHERE org = $1 AND source_type = $2 ORDER BY id;
        "#;
        match sqlx::query(query)
            .bind(org)
            .bind("realtime")
            .fetch_all(&client)
            .await
        {
            Ok(rows) => Ok(super::decode_rows(rows)),
            Err(e) => {
                log::debug!("[SQLITE] list streams with pipelines error: {e}");
                Ok(vec![])
            }
        }
    }

    async fn delete(&self, pipeline_id: &str) -> Result<Pipeline> {
        let client = CLIENT_RW.clone();
        let mut tx = client.begin().await?;

        let pipeline = sqlx::query_as::<_, Pipeline>("SELECT * FROM pipeline WHERE id = $1;")
            .bind(pipeline_id)
            .fetch_one(&mut *tx)
            .await?;

        sqlx::query(r#"DELETE FROM pipeline WHERE id = $1;"#)
            .bind(pipeline_id)
            .execute(&mut *tx)
            .await?;

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit delete pipeline error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);
        Ok(pipeline)
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;
    use crate::table::testing::{capture_error_logs, logged_errors_containing};

    fn stream_node() -> json::Value {
        json::json!({"id": "in", "io_type": "input", "position": {"x": 0.0, "y": 0.0},
                     "data": {"node_type": "stream", "org_id": "o", "stream_name": "s",
                              "stream_type": "logs"}})
    }

    fn condition_group(operator: &str) -> json::Value {
        json::json!({"filterType": "group", "logicalOperator": "AND", "conditions": [
            {"filterType": "condition", "column": "level", "operator": operator,
             "value": "error", "logicalOperator": "AND"}]})
    }

    fn condition_nodes(operator: &str) -> String {
        json::json!([stream_node(), {"id": "c", "io_type": "default",
            "position": {"x": 0.0, "y": 0.0},
            "data": {"node_type": "condition", "version": 2,
                     "conditions": condition_group(operator)}}])
        .to_string()
    }

    fn scheduled_source(operator: &str) -> String {
        json::json!({"org_id": "o", "stream_type": "logs", "query_condition": {
            "type": "custom",
            "conditions": {"version": 2, "conditions": condition_group(operator)}}})
        .to_string()
    }

    /// One readable pipeline, three this version cannot read: a Condition node and a scheduled
    /// source with an unknown operator, and junk nodes.
    async fn pool_with_unreadable_rows() -> sqlx::Pool<sqlx::Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE pipeline (id TEXT PRIMARY KEY, version INT, enabled BOOLEAN, name TEXT,
             description TEXT, org TEXT, source_type TEXT, stream_org TEXT, stream_name TEXT,
             stream_type TEXT, derived_stream TEXT, nodes TEXT, edges TEXT);",
        )
        .execute(&pool)
        .await
        .unwrap();
        let rows = [
            ("p1_good", "realtime", None, condition_nodes("=")),
            ("p2_in_node", "realtime", None, condition_nodes("future_op")),
            (
                "p3_in_source",
                "scheduled",
                Some(scheduled_source("future_op")),
                condition_nodes("="),
            ),
            ("p4_junk", "realtime", None, "not json".to_string()),
        ];
        for (id, source_type, derived_stream, nodes) in rows {
            sqlx::query(
                "INSERT INTO pipeline VALUES ($1, 1, true, $2, '', 'o', $3, 'o', 's', 'logs', $4,
                 $5, '[]');",
            )
            .bind(id)
            .bind(id)
            .bind(source_type)
            .bind(derived_stream)
            .bind(nodes)
            .execute(&pool)
            .await
            .unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn test_decode_rows_skips_and_logs_pipelines_it_cannot_read() {
        capture_error_logs();
        let pool = pool_with_unreadable_rows().await;
        let rows = sqlx::query("SELECT * FROM pipeline ORDER BY id;")
            .fetch_all(&pool)
            .await
            .unwrap();

        let ids: Vec<String> = super::super::decode_rows(rows)
            .into_iter()
            .map(|p| p.id)
            .collect();

        assert_eq!(ids, ["p1_good"]);
        for id in ["p2_in_node", "p3_in_source", "p4_junk"] {
            let logged = logged_errors_containing(&format!("org=o id={id}"));
            assert!(!logged.is_empty(), "{id} was not logged");
        }
        assert!(
            logged_errors_containing("id=p2_in_node")
                .iter()
                .any(|l| l.contains("unknown variant `future_op`"))
        );
    }

    #[tokio::test]
    async fn test_decode_all_rows_reports_the_rows_it_cannot_read() {
        let pool = pool_with_unreadable_rows().await;
        let rows = sqlx::query("SELECT * FROM pipeline ORDER BY id;")
            .fetch_all(&pool)
            .await
            .unwrap();

        let decoded = super::super::decode_all_rows(rows);

        let ids: Vec<&str> = decoded.pipelines.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["p1_good"]);
        let unreadable: Vec<(&str, bool, Option<&StreamParams>)> = decoded
            .unreadable
            .iter()
            .map(|u| (u.id.as_str(), u.enabled, u.realtime_stream.as_ref()))
            .collect();
        let stream = StreamParams::new("o", "s", StreamType::Logs);
        assert_eq!(
            unreadable,
            [
                ("p2_in_node", true, Some(&stream)),
                ("p3_in_source", true, None),
                ("p4_junk", true, Some(&stream)),
            ]
        );
        assert_eq!(decoded.unreadable[0].name, "p2_in_node");
        let err = decoded.into_fully_decoded().unwrap_err().to_string();
        assert!(err.contains("org=o id=p2_in_node is unreadable"), "{err}");
    }

    #[tokio::test]
    async fn test_decode_row_of_an_unreadable_pipeline_is_an_error_not_missing() {
        let pool = pool_with_unreadable_rows().await;
        let fetch = |id: &'static str| {
            sqlx::query("SELECT * FROM pipeline WHERE id = $1;")
                .bind(id)
                .fetch_optional(&pool)
        };

        let good = super::super::decode_row("p1_good", fetch("p1_good").await.unwrap());
        assert_eq!(good.unwrap().unwrap().id, "p1_good");
        let bad = super::super::decode_row("p3_in_source", fetch("p3_in_source").await.unwrap())
            .unwrap()
            .unwrap_err();
        assert_eq!((bad.id.as_str(), bad.org.as_str()), ("p3_in_source", "o"));
        assert!(bad.error.contains("unknown variant `future_op`"), "{bad:?}");
        let missing = super::super::decode_row("nope", fetch("nope").await.unwrap());
        assert!(matches!(
            missing,
            Err(Error::DbError(DbError::KeyNotExists(_)))
        ));
    }

    #[test]
    fn test_sqlite_pipeline_table_new() {
        let _table = SqlitePipelineTable::new();
    }

    #[test]
    fn test_sqlite_pipeline_table_default() {
        let _table = SqlitePipelineTable::default();
    }
}
