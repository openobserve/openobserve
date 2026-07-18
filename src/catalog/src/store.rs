// Copyright 2026 OpenObserve Inc.

use bytes::Bytes;
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use infra::errors::Error;
use infra::{db as infra_db, errors::Result};

pub(crate) async fn get(key: &str) -> Result<Bytes> {
    infra_db::get_db().await.get(key).await
}

pub(crate) async fn put(
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
            .map_err(|error| Error::Message(error.to_string()))?;
    }
    Ok(())
}

pub(crate) async fn delete(
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
        .map_err(|error| Error::Message(error.to_string()))?;
    }

    infra_db::get_db()
        .await
        .delete(key, with_prefix, need_watch, start_dt)
        .await
}

pub(crate) async fn list(prefix: &str) -> Result<HashMap<String, Bytes>> {
    infra_db::get_db().await.list(prefix).await
}

pub(crate) async fn list_values_by_start_dt(
    prefix: &str,
    start_dt: Option<(i64, i64)>,
) -> Result<Vec<(i64, Bytes)>> {
    infra_db::get_db()
        .await
        .list_values_by_start_dt(prefix, start_dt)
        .await
}
