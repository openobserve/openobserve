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

use std::sync::Arc;

use ::common::{meta::authz::Authz, utils::auth};
use config::meta::{pipeline::PipelineDependencyItem, self_reporting::error::ErrorData};
use openobserve_transform::{PipelineRefreshError, TransformRuntime};

struct CoreTransformRuntime;

#[async_trait::async_trait]
impl TransformRuntime for CoreTransformRuntime {
    async fn set_function_ownership(&self, org_id: &str, function_name: &str) {
        auth::set_ownership(org_id, "functions", Authz::new(function_name)).await;
    }

    async fn remove_function_ownership(&self, org_id: &str, function_name: &str) {
        auth::remove_ownership(org_id, "functions", Authz::new(function_name)).await;
    }

    async fn refresh_pipelines_using_function(
        &self,
        org_id: &str,
        function_name: &str,
    ) -> Result<(), PipelineRefreshError> {
        let Ok(pipelines) = openobserve_pipeline::service::list_by_org(org_id).await else {
            return Ok(());
        };

        for pipeline in pipelines {
            if pipeline.contains_function(function_name)
                && let Err(error) = openobserve_pipeline::service::update(&pipeline, None).await
            {
                return Err(PipelineRefreshError {
                    id: pipeline.id,
                    name: pipeline.name,
                    message: error.to_string(),
                });
            }
        }

        Ok(())
    }

    async fn pipeline_dependencies(
        &self,
        org_id: &str,
        function_name: &str,
    ) -> Vec<PipelineDependencyItem> {
        openobserve_pipeline::service::list_by_org(org_id)
            .await
            .map_or_else(
                |_| Vec::new(),
                |mut pipelines| {
                    pipelines.retain(|pipeline| pipeline.contains_function(function_name));
                    pipelines
                        .into_iter()
                        .map(|pipeline| PipelineDependencyItem {
                            id: pipeline.id,
                            name: pipeline.name,
                        })
                        .collect()
                },
            )
    }

    async fn publish_function_error(&self, error: ErrorData) {
        openobserve_self_reporting::publish_error(error).await;
    }
}

pub fn install_runtime() {
    let _ = openobserve_transform::install_runtime(Arc::new(CoreTransformRuntime));
}
