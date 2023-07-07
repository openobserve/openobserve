use crate::common::infra::{config::CONFIG, db::etcd, errors::Result};

#[inline(always)]
pub async fn lock(key: &str) -> Result<Option<etcd::Locker>> {
    if CONFIG.common.local_mode {
        return Ok(None);
    }
    let mut lock = etcd::Locker::new(key);
    lock.lock(0).await?;
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
