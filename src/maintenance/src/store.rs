// Copyright 2026 OpenObserve Inc.

use bytes::Bytes;
use infra::{db as infra_db, errors::Result};
pub(crate) use infra_db::{Event, NEED_WATCH, NO_NEED_WATCH, get_coordinator};

pub(crate) async fn get(key: &str) -> Result<Bytes> {
    infra_db::get_db().await.get(key).await
}

#[cfg(feature = "enterprise")]
fn is_local_compact_claim(key: &str, value: &Bytes) -> bool {
    key.starts_with("/compact/delete") && String::from_utf8_lossy(value).ne("OK")
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
        && !is_local_compact_claim(key, &value)
    {
        o2_enterprise::enterprise::super_cluster::queue::put(key, value, need_watch, start_dt)
            .await
            .map_err(|error| infra::errors::Error::Message(error.to_string()))?;
    }
    Ok(())
}

pub(crate) async fn delete_if_exists(key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::delete(key, with_prefix, need_watch, None)
            .await
            .map_err(|error| infra::errors::Error::Message(error.to_string()))?;
    }
    infra_db::get_db()
        .await
        .delete_if_exists(key, with_prefix, need_watch)
        .await
}

pub(crate) async fn list(prefix: &str) -> Result<hashbrown::HashMap<String, Bytes>> {
    infra_db::get_db().await.list(prefix).await
}
