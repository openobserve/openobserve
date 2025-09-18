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

//! These models define the schemas of HTTP request and response JSON bodies in
//! pipeline API endpoints.

use std::collections::HashMap;

use config::meta::{
    pipeline::{
        Pipeline as meta_pipeline,
        components::{Edge, Node, PipelineSource},
        default_status,
    },
    triggers::Trigger,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct Pipeline {
    #[serde(default)]
    #[serde(rename = "pipeline_id")]
    pub id: String,
    #[serde(default)]
    pub version: i32,
    #[serde(default = "default_status")]
    pub enabled: bool,
    #[serde(default)]
    pub org: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source: PipelineSource,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub paused_at: Option<i64>,
}

impl Pipeline {
    fn from(meta_pipeline: meta_pipeline, paused_at: Option<i64>) -> Self {
        Self {
            id: meta_pipeline.id,
            version: meta_pipeline.version,
            enabled: meta_pipeline.enabled,
            org: meta_pipeline.org,
            name: meta_pipeline.name,
            description: meta_pipeline.description,
            source: meta_pipeline.source,
            nodes: meta_pipeline.nodes,
            edges: meta_pipeline.edges,
            paused_at,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct PipelineList {
    pub list: Vec<Pipeline>,
}

impl PipelineList {
    pub fn from(pipelines: Vec<meta_pipeline>, triggers: Vec<Trigger>) -> Self {
        let triggers_map = triggers
            .into_iter()
            .map(|trigger| (trigger.module_key.to_string(), trigger))
            .collect::<HashMap<_, _>>();
        let mut list = vec![];
        for pipeline in pipelines {
            let paused_at = pipeline.get_derived_stream().and_then(|derived_stream| {
                triggers_map
                    .get(&derived_stream.get_scheduler_module_key(&pipeline.name, &pipeline.id))
                    .and_then(|trigger| trigger.end_time)
            });
            list.push(Pipeline::from(pipeline, paused_at));
        }

        PipelineList { list }
    }
}

#[derive(Deserialize, ToSchema)]
pub struct PipelineBulkEnableRequest {
    pub ids: Vec<String>,
}

#[derive(Default, Serialize, ToSchema)]
pub struct PipelineBulkEnableResponse {
    pub successful: Vec<String>,
    pub unsuccessful: Vec<String>,
    pub err: Option<String>,
}
