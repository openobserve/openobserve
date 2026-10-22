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

//! Worker wake-ups: any hook rate becomes at most four coordinator puts a second per node.

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use bytes::Bytes;
use config::cluster::LOCAL_NODE;
use infra::{coordinator::get_coordinator, db::NEED_WATCH};
use tokio::{sync::Notify, time::MissedTickBehavior};

use super::WAKE_PREFIX;

const COALESCE_EVERY: Duration = Duration::from_millis(250);

static WAKE_PENDING: AtomicBool = AtomicBool::new(false);

/// Never blocks: the request path only sets a flag that the coalescer drains.
pub fn request_wake() {
    WAKE_PENDING.store(true, Ordering::Release);
}

pub async fn run_coalescer() {
    coalesce(&WAKE_PENDING, || {
        tokio::task::spawn(put_wake());
    })
    .await
}

/// Only signals, so the coordinator dispatcher never waits on this channel.
pub async fn watch_wakes(notify: Arc<Notify>) -> Result<(), anyhow::Error> {
    let mut events = get_coordinator().await.watch(WAKE_PREFIX).await?;
    let events = Arc::get_mut(&mut events)
        .ok_or_else(|| anyhow::anyhow!("wake watch receiver is shared"))?;
    while events.recv().await.is_some() {
        notify.notify_one();
    }
    log::warn!("[WORKFLOW_HOOK] wake watch channel closed");
    Ok(())
}

async fn coalesce<F: FnMut()>(pending: &AtomicBool, mut put: F) {
    let mut every = tokio::time::interval(COALESCE_EVERY);
    every.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        every.tick().await;
        if take_pending(pending) {
            put();
        }
    }
}

async fn put_wake() {
    let key = format!("{WAKE_PREFIX}{}", LOCAL_NODE.uuid);
    if let Err(e) = get_coordinator()
        .await
        .put(&key, Bytes::new(), NEED_WATCH, None)
        .await
    {
        log::warn!("[WORKFLOW_HOOK] wake put failed, the worker tick covers it: {e}");
    }
}

fn take_pending(pending: &AtomicBool) -> bool {
    pending.swap(false, Ordering::AcqRel)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_thousand_wake_requests_in_a_second_produce_at_most_four_puts() {
        let pending = Arc::new(AtomicBool::new(false));
        let puts = Arc::new(AtomicUsize::new(0));
        let (flag, counter) = (pending.clone(), puts.clone());
        tokio::spawn(async move {
            coalesce(&flag, || {
                counter.fetch_add(1, Ordering::SeqCst);
            })
            .await
        });
        tokio::task::yield_now().await;
        for _ in 0..1000 {
            pending.store(true, Ordering::Release);
            tokio::time::advance(Duration::from_millis(1)).await;
        }
        tokio::task::yield_now().await;
        let puts = puts.load(Ordering::SeqCst);
        assert!(puts <= 4, "{puts} puts in one second");
        assert!(puts >= 3, "pending wakes must still be put, got {puts}");
    }

    #[tokio::test(start_paused = true)]
    async fn no_put_happens_without_a_wake_request() {
        let pending = Arc::new(AtomicBool::new(false));
        let puts = Arc::new(AtomicUsize::new(0));
        let (flag, counter) = (pending.clone(), puts.clone());
        tokio::spawn(async move {
            coalesce(&flag, || {
                counter.fetch_add(1, Ordering::SeqCst);
            })
            .await
        });
        tokio::time::advance(Duration::from_secs(2)).await;
        tokio::task::yield_now().await;
        assert_eq!(puts.load(Ordering::SeqCst), 0);
    }
}
