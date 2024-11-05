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
use config::meta::{
    meta_store::MetaStore,
    pipeline::{components::PipelineSource, Pipeline},
    stream::StreamParams,
};
use once_cell::sync::Lazy;

use crate::errors::Result;

pub mod mysql;
pub mod postgres;
pub mod sqlite;

static CLIENT: Lazy<Box<dyn PipelineTable>> = Lazy::new(connect);

pub fn connect() -> Box<dyn PipelineTable> {
    match config::get_config().common.meta_store.as_str().into() {
        MetaStore::MySQL => Box::<mysql::MySqlPipelineTable>::default(),
        MetaStore::PostgreSQL => Box::<postgres::PostgresPipelineTable>::default(),
        _ => Box::<sqlite::SqlitePipelineTable>::default(),
    }
}

#[async_trait]
pub trait PipelineTable: Sync + Send + 'static {
    async fn create_table(&self) -> Result<()>;
    async fn create_table_index(&self) -> Result<()>;
    async fn drop_table(&self) -> Result<()>;
    async fn put(&self, pipeline: &Pipeline) -> Result<()>;
    async fn update(&self, pipeline: &Pipeline) -> Result<()>;
    async fn get_by_stream(&self, stream_params: &StreamParams) -> Result<Pipeline>;
    async fn get_by_id(&self, pipeline_id: &str) -> Result<Pipeline>;
    async fn get_with_same_source_stream(&self, pipeline: &Pipeline) -> Result<Pipeline>;
    async fn list(&self) -> Result<Vec<Pipeline>>;
    async fn list_by_org(&self, org: &str) -> Result<Vec<Pipeline>>;
    async fn list_streams_with_pipeline(&self, org: &str) -> Result<Vec<Pipeline>>;
    async fn delete(&self, pipeline_id: &str) -> Result<Pipeline>;
}

/// Initializes the PipelineTable - creates table and index
pub async fn init() -> Result<()> {
    CLIENT.create_table().await?;
    CLIENT.create_table_index().await?;
    Ok(())
}

/// Creates a pipeline entry in the table
#[inline]
pub async fn put(pipeline: &Pipeline) -> Result<()> {
    CLIENT.put(pipeline).await
}

/// Updates a pipeline entry by id
#[inline]
pub async fn update(pipeline: &Pipeline) -> Result<()> {
    CLIENT.update(pipeline).await
}

/// Finds the pipeline associated with the StreamParams within an organization
#[inline]
pub async fn get_by_stream(stream_params: &StreamParams) -> Result<Pipeline> {
    CLIENT.get_by_stream(stream_params).await
}

/// Finds all streams with existing pipelines.
#[inline]
pub async fn list_streams_with_pipeline(org: &str) -> Result<Vec<StreamParams>> {
    CLIENT
        .list_streams_with_pipeline(org)
        .await
        .map(|pipelines| {
            pipelines
                .into_iter()
                .filter_map(|pl| match pl.source {
                    PipelineSource::Realtime(stream_params) => Some(stream_params),
                    PipelineSource::Scheduled(_) => None,
                })
                .collect()
        })
}

/// Finds the pipeline by id
#[inline]
pub async fn get_by_id(pipeline_id: &str) -> Result<Pipeline> {
    CLIENT.get_by_id(pipeline_id).await
}

/// Finds the pipeline with the same source and structure
#[inline]
pub async fn get_with_same_source_stream(pipeline: &Pipeline) -> Result<Pipeline> {
    CLIENT.get_with_same_source_stream(pipeline).await
}

/// Lists all pipelines
#[inline]
pub async fn list() -> Result<Vec<Pipeline>> {
    CLIENT.list().await
}

/// Lists all pipelines within an organization
#[inline]
pub async fn list_by_org(org: &str) -> Result<Vec<Pipeline>> {
    CLIENT.list_by_org(org).await
}

/// Deletes the pipeline by id
#[inline]
pub async fn delete(pipeline_id: &str) -> Result<Pipeline> {
    CLIENT.delete(pipeline_id).await
}

/// DropTable first. Used for testing migration.
#[inline]
pub async fn drop_table() -> Result<()> {
    CLIENT.drop_table().await?;
    Ok(())
}
