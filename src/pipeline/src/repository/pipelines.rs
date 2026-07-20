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

use config::meta::{pipeline::Pipeline, stream::StreamParams};

use super::PipelineError;

pub async fn put(pipeline: &Pipeline) -> Result<(), PipelineError> {
    infra::pipeline::put(pipeline).await?;
    Ok(())
}

pub async fn list_streams_with_pipeline(org_id: &str) -> Result<Vec<StreamParams>, PipelineError> {
    Ok(infra::pipeline::list_streams_with_pipeline(org_id).await?)
}

pub async fn get_by_stream(stream: &StreamParams) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(infra::pipeline::get_by_stream(stream).await?)
}

pub async fn get_by_id(pipeline_id: &str) -> Result<Pipeline, PipelineError> {
    Ok(infra::pipeline::get_by_id(pipeline_id).await?)
}

pub async fn get_with_same_source_stream(
    pipeline: &Pipeline,
) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(infra::pipeline::get_with_same_source_stream(pipeline).await?)
}

pub async fn list() -> Result<Vec<Pipeline>, PipelineError> {
    Ok(infra::pipeline::list().await?)
}

pub async fn list_by_org(org_id: &str) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(infra::pipeline::list_by_org(org_id).await?)
}

pub async fn delete(pipeline_id: &str) -> Result<(), PipelineError> {
    infra::pipeline::delete(pipeline_id).await?;
    Ok(())
}
