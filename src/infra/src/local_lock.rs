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

use std::sync::Arc;

use hashbrown::HashMap;
use once_cell::sync::Lazy;
use tokio::sync::{Mutex, MutexGuard, RwLock};

use super::errors::Result;

static LOCAL_LOCKER: Lazy<RwLock<HashMap<String, LockHolder>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Clone)]
pub struct LockHolder {
    key: Arc<String>,
    lock: Arc<Mutex<bool>>,
}

impl Drop for LockHolder {
    fn drop(&mut self) {
        log::debug!("local lock key: {} released", self.key);
    }
}

impl LockHolder {
    fn new(key: &str) -> Self {
        Self {
            key: Arc::new(key.to_string()),
            lock: Arc::new(Mutex::new(false)),
        }
    }
    pub async fn lock(&self) -> MutexGuard<'_, bool> {
        let guard = self.lock.lock().await;
        log::debug!("local lock key: {} acquired", self.key);
        guard
    }
}

pub async fn lock(key: &str) -> Result<LockHolder> {
    let mut w = LOCAL_LOCKER.write().await;
    let locker = match w.get(key) {
        Some(v) => v.clone(),
        None => {
            let locker = LockHolder::new(key);
            w.insert(key.to_string(), locker.clone());
            locker
        }
    };
    drop(w);
    Ok(locker)
}
