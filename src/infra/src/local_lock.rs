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

use once_cell::sync::Lazy;
use scc::{HashMap, hash_map::OccupiedEntry};

static LOCAL_LOCKER: Lazy<HashMap<String, ()>> = Lazy::new(HashMap::new);

// Use this when you absolutely definitely want to async block on the securing this one key!
// !!! This method shouldn't be used in an iterative loop - it WILL cause a deadlock!!!
// Use the fallible lock_multi to secure multiple locks at once, and plan for fallibility!
pub async fn lock(key: &str) -> OccupiedEntry<'_, String, ()> {
    LOCAL_LOCKER
        .entry_async(key.to_string())
        .await
        .or_insert_with(|| ())
}

// The unlock() operation doesn't exist because dropping the OccupiedEntry will free the access
// of this entry for other callers.
// TODO: Eventually this table will gather dead keys that'll cost memory
// (O(N*Sizeof(String))) but not necessarily perf! This issue should be addressed along with the
// global variable anti-pattern refactoring.

// Better sync utility to secure
pub fn lock_multi<T: Iterator<Item = impl AsRef<str>>>(
    keys: T,
) -> impl Iterator<Item = Option<OccupiedEntry<'static, String, ()>>> {
    keys.map(|key| {
        // We'll avoid spinlocking that comes with entry_sync() - we'll rather fail fast
        // than waste precious CPU time. This also prevents deadlocking if the caller is
        // also cautious about the implementation. A partially acquired lock_multi() will
        // be seen undesirable and may chose to retry - thereby the current Iterator of
        // occupied entries will be dropped - effectively freeing the locks implicitly.
        LOCAL_LOCKER
            .try_entry(key.as_ref().to_string())
            .map(|entry| entry.or_insert(()))
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tokio::{
        sync::RwLock,
        time::{Duration, sleep},
    };

    use super::*;

    #[tokio::test]
    async fn test_concurrent_lock_access() {
        let shared_data = Arc::new(RwLock::new(0));
        let num_tasks = 5;
        let mut handles = Vec::new();

        for i in 0..num_tasks {
            let shared_data = shared_data.clone();
            handles.push(tokio::spawn(async move {
                // All tasks try to get the same lock
                let _guard = lock("test_key").await;

                // Read current value
                let current = *shared_data.read().await;

                // Simulate some work
                sleep(Duration::from_millis(50)).await;

                // Only increment if data hasn't been modified
                if current == 0 {
                    let mut data = shared_data.write().await;
                    *data += 1;
                    println!("Task {} modified the data to {}", i, i + 1);
                } else {
                    println!("Task {} found data already modified: {}", i, current);
                }
            }));
        }

        // Wait for all tasks to complete
        for handle in handles {
            handle.await.unwrap();
        }

        // Verify that only one task modified the data
        let final_value = *shared_data.read().await;
        assert_eq!(final_value, 1);
        assert_eq!(LOCAL_LOCKER.len(), 1);
    }
}
