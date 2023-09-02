// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
pub async fn unlock(locker: &Option<etcd::Locker>) -> Result<()> {
    if let Some(locker) = locker {
        locker.unlock().await
    } else {
        Ok(())
    }
}
