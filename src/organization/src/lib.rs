// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Organization, membership, user, and service-account management.

use std::sync::{Arc, OnceLock};

use common::meta::stream::Stream;
use config::meta::{function::Transform, stream::StreamType};

pub mod auth;
pub mod organization;
pub mod repository;
pub mod users;

pub mod db {
    use bytes::Bytes;
    use hashbrown::HashMap;
    use infra::{db as infra_db, errors::Result};
    pub use infra_db::{Event, NEED_WATCH, get_coordinator};

    pub mod org_users {
        pub use crate::repository::org_users::*;
    }
    pub mod organization {
        pub use crate::repository::organization::*;
    }
    pub mod user {
        pub use crate::repository::user::*;
    }
    pub mod org_ingestion_tokens {
        pub use openobserve_ingestion::repository::org_ingestion_tokens::*;
    }

    pub async fn get(key: &str) -> Result<Bytes> {
        infra_db::get_db().await.get(key).await
    }

    pub async fn put(
        key: &str,
        value: Bytes,
        need_watch: bool,
        start_dt: Option<i64>,
    ) -> Result<()> {
        infra_db::get_db()
            .await
            .put(key, value.clone(), need_watch, start_dt)
            .await?;
        #[cfg(feature = "enterprise")]
        if o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
        {
            o2_enterprise::enterprise::super_cluster::queue::put(key, value, need_watch, start_dt)
                .await
                .map_err(|err| infra::errors::Error::Message(err.to_string()))?;
        }
        Ok(())
    }

    pub async fn delete(
        key: &str,
        with_prefix: bool,
        need_watch: bool,
        start_dt: Option<i64>,
    ) -> Result<()> {
        #[cfg(feature = "enterprise")]
        if o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
        {
            o2_enterprise::enterprise::super_cluster::queue::delete(
                key,
                with_prefix,
                need_watch,
                start_dt,
            )
            .await
            .map_err(|err| infra::errors::Error::Message(err.to_string()))?;
        }
        infra_db::get_db()
            .await
            .delete(key, with_prefix, need_watch, start_dt)
            .await
    }

    pub async fn list(prefix: &str) -> Result<HashMap<String, Bytes>> {
        infra_db::get_db().await.list(prefix).await
    }
}

#[async_trait::async_trait]
pub trait Runtime: Send + Sync {
    async fn streams(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        fetch_schema: bool,
        permitted_streams: Option<Vec<String>>,
    ) -> Vec<Stream>;

    async fn transforms(&self, org_id: &str) -> anyhow::Result<Vec<Transform>>;
}

static RUNTIME: OnceLock<Arc<dyn Runtime>> = OnceLock::new();

pub fn install_runtime(runtime: Arc<dyn Runtime>) -> Result<(), &'static str> {
    RUNTIME
        .set(runtime)
        .map_err(|_| "organization runtime is already installed")
}

pub(crate) async fn streams(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
    permitted_streams: Option<Vec<String>>,
) -> Vec<Stream> {
    match RUNTIME.get() {
        Some(runtime) => {
            runtime
                .streams(org_id, stream_type, fetch_schema, permitted_streams)
                .await
        }
        None => Vec::new(),
    }
}

pub(crate) async fn transforms(org_id: &str) -> anyhow::Result<Vec<Transform>> {
    let runtime = RUNTIME
        .get()
        .ok_or_else(|| anyhow::anyhow!("organization runtime is not installed"))?;
    runtime.transforms(org_id).await
}

#[cfg(feature = "cloud")]
pub(crate) fn org_is_blocked(org_id: &str) -> bool {
    use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};

    ORG_STATUS_CACHE
        .get(org_id)
        .is_some_and(|status| matches!(*status, OrgStatus::Deleting | OrgStatus::PendingDeletion))
}
