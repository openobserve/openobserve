use crate::common::infra::{config::CONFIG, db::etcd, errors::Result};

/// lock key in etcd, wait_ttl is 0 means wait forever
#[inline(always)]
pub async fn lock(key: &str, wait_ttl: u64) -> Result<Option<etcd::Locker>> {
    if CONFIG.common.local_mode {
        return Ok(None);
    }
    let mut lock = etcd::Locker::new(key);
    lock.lock(wait_ttl).await?;
    Ok(Some(lock))
}

#[inline(always)]
pub async fn unlock(locker: &mut Option<etcd::Locker>) -> Result<()> {
    if let Some(locker) = locker {
        locker.unlock().await
    } else {
        Ok(())
    }
}
