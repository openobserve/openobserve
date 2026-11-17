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

use std::sync::LazyLock as Lazy;

use async_trait::async_trait;
use config::meta::{
    meta_store::MetaStore,
    pipeline::{Pipeline, components::PipelineSource},
    stream::{StreamParams, StreamType},
};
use sqlx::FromRow;

use crate::errors::{DbError, Result};

pub mod postgres;
pub mod sqlite;

static CLIENT: Lazy<Box<dyn PipelineTable>> = Lazy::new(connect);

pub fn connect() -> Box<dyn PipelineTable> {
    match config::get_config().common.meta_store.as_str().into() {
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
    async fn get_by_stream(&self, stream_params: &StreamParams) -> Result<Vec<Pipeline>>;
    async fn get_by_id(&self, pipeline_id: &str) -> Result<Decoded>;
    async fn get_with_same_source_stream(&self, pipeline: &Pipeline) -> Result<Vec<Pipeline>>;
    async fn list(&self) -> Result<DecodedPipelines>;
    async fn list_by_org(&self, org: &str) -> Result<DecodedPipelines>;
    /// Deletes every pipeline of the org and returns their ids.
    async fn delete_by_org(&self, org: &str) -> Result<Vec<String>>;
    async fn list_streams_with_pipeline(&self, org: &str) -> Result<Vec<Pipeline>>;
    async fn delete(&self, pipeline_id: &str) -> Result<Pipeline>;
}

/// One stored pipeline: decoded, or a row this version cannot read.
pub type Decoded = std::result::Result<Pipeline, UnreadablePipeline>;

/// A listing's rows, split into the decoded pipelines and the rows this version cannot read.
#[derive(Debug, Default)]
pub struct DecodedPipelines {
    pub pipelines: Vec<Pipeline>,
    pub unreadable: Vec<UnreadablePipeline>,
}

impl DecodedPipelines {
    /// The pipelines, or an error naming the first unreadable row.
    pub fn into_fully_decoded(self) -> Result<Vec<Pipeline>> {
        match self.unreadable.into_iter().next() {
            Some(row) => Err(row.into_error()),
            None => Ok(self.pipelines),
        }
    }
}

/// The plain columns of a pipeline row whose body this version cannot decode.
#[derive(Debug, Clone, PartialEq)]
pub struct UnreadablePipeline {
    pub id: String,
    pub org: String,
    pub name: String,
    pub enabled: bool,
    /// The source stream when the row is a realtime pipeline.
    pub realtime_stream: Option<StreamParams>,
    pub error: String,
}

impl UnreadablePipeline {
    pub fn into_error(self) -> crate::errors::Error {
        crate::errors::Error::Message(format!(
            "pipeline org={} id={} is unreadable: {}",
            self.org, self.id, self.error
        ))
    }
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
    if get_by_id(&pipeline.id).await.is_ok() {
        CLIENT.update(pipeline).await
    } else {
        CLIENT.put(pipeline).await
    }
}

/// Finds the pipelines associated with the StreamParams within an organization.
/// User pipelines are ordered first, followed by evaluation pipelines.
#[inline]
pub async fn get_by_stream(stream_params: &StreamParams) -> Result<Vec<Pipeline>> {
    CLIENT.get_by_stream(stream_params).await
}

/// Finds all streams with existing user pipelines.
/// Evaluation pipelines are excluded from this list.
#[inline]
pub async fn list_streams_with_pipeline(org: &str) -> Result<Vec<StreamParams>> {
    CLIENT
        .list_streams_with_pipeline(org)
        .await
        .map(|pipelines| {
            pipelines
                .into_iter()
                .filter_map(|pl| match pl.source {
                    PipelineSource::Realtime(stream_params) if pl.is_user() => Some(stream_params),
                    PipelineSource::Realtime(_) | PipelineSource::Scheduled(_) => None,
                })
                .collect()
        })
}

/// Finds the pipeline by id; a row this version cannot read is an error.
#[inline]
pub async fn get_by_id(pipeline_id: &str) -> Result<Pipeline> {
    CLIENT
        .get_by_id(pipeline_id)
        .await?
        .map_err(UnreadablePipeline::into_error)
}

/// Finds the pipeline by id, returning the plain columns of a row this version cannot read.
#[inline]
pub async fn get_decoded_by_id(pipeline_id: &str) -> Result<Decoded> {
    CLIENT.get_by_id(pipeline_id).await
}

/// Finds the pipelines with the same source and structure
#[inline]
pub async fn get_with_same_source_stream(pipeline: &Pipeline) -> Result<Vec<Pipeline>> {
    CLIENT.get_with_same_source_stream(pipeline).await
}

/// Lists all pipelines; a row this version cannot read is logged and skipped.
#[inline]
pub async fn list() -> Result<Vec<Pipeline>> {
    Ok(CLIENT.list().await?.pipelines)
}

/// Lists all pipelines together with the rows this version cannot read.
#[inline]
pub async fn list_decoded() -> Result<DecodedPipelines> {
    CLIENT.list().await
}

/// Lists all pipelines within an organization; a row this version cannot read is skipped.
#[inline]
pub async fn list_by_org(org: &str) -> Result<Vec<Pipeline>> {
    Ok(CLIENT.list_by_org(org).await?.pipelines)
}

/// Lists an organization's pipelines, failing on a row this version cannot read.
#[inline]
pub async fn list_by_org_fully_decoded(org: &str) -> Result<Vec<Pipeline>> {
    CLIENT.list_by_org(org).await?.into_fully_decoded()
}

/// Deletes every pipeline of the organization and returns the removed ids
#[inline]
pub async fn delete_by_org(org: &str) -> Result<Vec<String>> {
    CLIENT.delete_by_org(org).await
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

/// Decodes each row, logging and skipping the ones this version cannot read so they never hide
/// the rest.
pub(crate) fn decode_rows<R>(rows: Vec<R>) -> Vec<Pipeline>
where
    R: sqlx::Row,
    for<'r> Pipeline: sqlx::FromRow<'r, R>,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
    for<'r> bool: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    decode_all_rows(rows).pipelines
}

/// Decodes each row, logging and keeping the plain columns of the ones this version cannot read.
pub(crate) fn decode_all_rows<R>(rows: Vec<R>) -> DecodedPipelines
where
    R: sqlx::Row,
    for<'r> Pipeline: sqlx::FromRow<'r, R>,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
    for<'r> bool: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    let mut decoded = DecodedPipelines::default();
    for row in rows {
        match Pipeline::from_row(&row) {
            Ok(pipeline) => decoded.pipelines.push(pipeline),
            Err(e) => {
                log::error!(
                    "[pipelines] skipped unreadable row {}: {e}",
                    pipeline_row_key(&row)
                );
                decoded.unreadable.push(unreadable_row(&row, &e));
            }
        }
    }
    decoded
}

/// Decodes the row `get_by_id` found; one this version cannot read is not a missing key.
pub(crate) fn decode_row<R>(pipeline_id: &str, row: Option<R>) -> Result<Decoded>
where
    R: sqlx::Row,
    for<'r> Pipeline: sqlx::FromRow<'r, R>,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
    for<'r> bool: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    let Some(row) = row else {
        return Err(DbError::KeyNotExists(pipeline_id.to_string()).into());
    };
    Ok(Pipeline::from_row(&row).map_err(|e| {
        log::error!("[pipelines] unreadable row {}: {e}", pipeline_row_key(&row));
        unreadable_row(&row, &e)
    }))
}

fn pipeline_row_key<R>(row: &R) -> String
where
    R: sqlx::Row,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    let column = |name: &str| row.try_get::<String, _>(name).unwrap_or_default();
    format!("org={} id={}", column("org"), column("id"))
}

fn unreadable_row<R>(row: &R, error: &sqlx::Error) -> UnreadablePipeline
where
    R: sqlx::Row,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
    for<'r> bool: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    let column = |name: &str| row.try_get::<String, _>(name).unwrap_or_default();
    let realtime_stream = (column("source_type") == "realtime").then(|| {
        StreamParams::new(
            &column("stream_org"),
            &column("stream_name"),
            StreamType::from(column("stream_type").as_str()),
        )
    });
    UnreadablePipeline {
        id: column("id"),
        org: column("org"),
        name: column("name"),
        enabled: row.try_get::<bool, _>("enabled").unwrap_or_default(),
        realtime_stream,
        error: error.to_string(),
    }
}
