// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Application capabilities injected into organization management.

struct CoreOrganizationRuntime;

#[async_trait::async_trait]
impl openobserve_organization::Runtime for CoreOrganizationRuntime {
    async fn streams(
        &self,
        org_id: &str,
        stream_type: Option<config::meta::stream::StreamType>,
        fetch_schema: bool,
        permitted_streams: Option<Vec<String>>,
    ) -> Vec<common::meta::stream::Stream> {
        openobserve_catalog::stream::get_streams(
            org_id,
            stream_type,
            fetch_schema,
            permitted_streams,
        )
        .await
    }

    async fn transforms(
        &self,
        org_id: &str,
    ) -> anyhow::Result<Vec<config::meta::function::Transform>> {
        openobserve_transform::repository::list(org_id).await
    }

    async fn stream_schemas(
        &self,
        org_id: &str,
    ) -> anyhow::Result<Vec<common::meta::stream::StreamSchema>> {
        openobserve_catalog::schema::list(org_id, None, false).await
    }

    async fn delete_stream_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
    ) -> anyhow::Result<()> {
        openobserve_catalog::schema::delete(org_id, stream_name, Some(stream_type)).await
    }
}

pub(crate) fn install_runtime() {
    let _ = openobserve_organization::install_runtime(std::sync::Arc::new(CoreOrganizationRuntime));
}
