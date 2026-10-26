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

use std::{fmt::Display, future::Future};

/// Drops this node's copy before the broadcast, so a failed broadcast cannot leave it here.
pub async fn evict<E>(
    local: impl Future<Output = ()>,
    broadcast: impl Future<Output = Result<(), E>>,
) -> Result<(), E> {
    local.await;
    broadcast.await
}

/// Evicts each item before its row delete, so a failed eviction keeps the row, and again after it.
pub async fn evict_then_delete<T, E, Local, LocalFut, Broadcast, BroadcastFut, Delete, DeleteFut>(
    items: Vec<T>,
    mut local: Local,
    mut broadcast: Broadcast,
    mut delete: Delete,
) -> Result<(), E>
where
    T: Clone,
    E: Display,
    Local: FnMut(T) -> LocalFut,
    LocalFut: Future<Output = ()>,
    Broadcast: FnMut(T) -> BroadcastFut,
    BroadcastFut: Future<Output = Result<(), E>>,
    Delete: FnMut(T) -> DeleteFut,
    DeleteFut: Future<Output = Result<(), E>>,
{
    for item in items {
        evict(local(item.clone()), broadcast(item.clone())).await?;
        delete(item.clone()).await?;
        // A read miss before the delete can refill the cache, and no retry lists a deleted row.
        if let Err(e) = evict(local(item.clone()), broadcast(item)).await {
            log::warn!("[TEARDOWN] eviction after the row delete failed: {e}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        sync::{
            Mutex,
            atomic::{AtomicBool, Ordering},
        },
    };

    use super::*;

    #[tokio::test]
    async fn test_a_failed_eviction_is_retried_from_the_surviving_rows() {
        let rows = Mutex::new(vec!["a".to_string(), "b".to_string()]);
        let evicted = Mutex::new(HashSet::new());
        let broadcast_down = AtomicBool::new(true);
        let (rows, evicted, broadcast_down) = (&rows, &evicted, &broadcast_down);
        let run = || async move {
            let listed = rows.lock().unwrap().clone();
            evict_then_delete(
                listed,
                |_: String| async {},
                move |row: String| async move {
                    if broadcast_down.swap(false, Ordering::SeqCst) {
                        return Err("broadcast failed");
                    }
                    evicted.lock().unwrap().insert(row);
                    Ok(())
                },
                move |row: String| async move {
                    rows.lock().unwrap().retain(|r| *r != row);
                    Ok(())
                },
            )
            .await
        };
        assert!(run().await.is_err(), "the first broadcast fails");
        assert_eq!(
            rows.lock().unwrap().len(),
            2,
            "no row goes before its eviction"
        );
        run().await.unwrap();
        assert!(rows.lock().unwrap().is_empty());
        let evicted = evicted.lock().unwrap();
        assert!(
            evicted.contains("a") && evicted.contains("b"),
            "{evicted:?}"
        );
    }

    #[tokio::test]
    async fn test_a_copy_reloaded_before_the_row_delete_is_evicted() {
        let rows = Mutex::new(vec!["a".to_string(), "b".to_string()]);
        let cache = Mutex::new(HashSet::from(["a".to_string(), "b".to_string()]));
        let (rows, cache) = (&rows, &cache);
        let listed = rows.lock().unwrap().clone();
        evict_then_delete(
            listed,
            move |row: String| async move {
                cache.lock().unwrap().remove(&row);
            },
            |_: String| async { Ok::<(), String>(()) },
            move |row: String| async move {
                cache.lock().unwrap().insert(row.clone());
                rows.lock().unwrap().retain(|r| *r != row);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert!(rows.lock().unwrap().is_empty());
        let reloaded = cache.lock().unwrap().clone();
        assert!(
            reloaded.is_empty(),
            "a reader's reload between eviction and delete survived: {reloaded:?}"
        );
    }

    #[tokio::test]
    async fn test_a_failed_broadcast_still_evicts_this_node() {
        let dropped = AtomicBool::new(false);
        let evicted = evict(async { dropped.store(true, Ordering::SeqCst) }, async {
            Err::<(), _>("broadcast failed")
        })
        .await;
        assert!(evicted.is_err());
        assert!(dropped.load(Ordering::SeqCst), "this node kept its copy");
    }

    #[tokio::test]
    async fn test_a_failed_broadcast_after_the_row_delete_still_evicts_this_node() {
        let cache = Mutex::new(HashSet::from(["a".to_string()]));
        let broadcasts = AtomicBool::new(false);
        let (cache, broadcasts) = (&cache, &broadcasts);
        evict_then_delete(
            vec!["a".to_string()],
            move |row: String| async move {
                cache.lock().unwrap().remove(&row);
            },
            move |_: String| async move {
                if broadcasts.swap(true, Ordering::SeqCst) {
                    return Err("broadcast failed");
                }
                Ok(())
            },
            move |row: String| async move {
                cache.lock().unwrap().insert(row);
                Ok(())
            },
        )
        .await
        .unwrap();
        let left = cache.lock().unwrap().clone();
        assert!(
            left.is_empty(),
            "a reload survived the failed broadcast: {left:?}"
        );
    }
}
