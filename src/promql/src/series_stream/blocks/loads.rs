// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::{Arc, Mutex};

use anyhow::{Result, anyhow};
use hashbrown::HashMap;
use tokio::sync::Notify;

use super::{CacheKey, CachedIndex};

#[derive(Default)]
pub(super) struct LoadRegistry {
    entries: Mutex<HashMap<CacheKey, Arc<Flight>>>,
}

impl LoadRegistry {
    pub(super) fn claim(self: &Arc<Self>, key: CacheKey) -> Claim {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(flight) = entries.get(&key) {
            return Claim::Waiter(Arc::clone(flight));
        }
        let flight = Arc::new(Flight {
            result: Mutex::new(FlightState::Pending),
            ready: Notify::new(),
        });
        entries.insert(key.clone(), Arc::clone(&flight));
        Claim::Owner(Owner {
            registry: Arc::clone(self),
            key,
            flight,
            completed: false,
        })
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

pub(super) enum Claim {
    Owner(Owner),
    Waiter(Arc<Flight>),
}

pub(super) struct Flight {
    result: Mutex<FlightState>,
    ready: Notify,
}

impl Flight {
    pub(super) async fn wait(&self) -> Result<Option<Arc<CachedIndex>>> {
        loop {
            let notified = self.ready.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            match &*self
                .result
                .lock()
                .unwrap_or_else(|error| error.into_inner())
            {
                FlightState::Ready(result) => {
                    return result
                        .as_ref()
                        .map(|value| Some(Arc::clone(value)))
                        .map_err(|error| anyhow!(error.clone()));
                }
                FlightState::Cancelled => return Ok(None),
                FlightState::Pending => {}
            }
            notified.await;
        }
    }
}

enum FlightState {
    Pending,
    Ready(Result<Arc<CachedIndex>, String>),
    Cancelled,
}

pub(super) struct Owner {
    registry: Arc<LoadRegistry>,
    key: CacheKey,
    flight: Arc<Flight>,
    completed: bool,
}

impl Owner {
    pub(super) fn complete(mut self, result: &Result<Arc<CachedIndex>>) {
        let value = result
            .as_ref()
            .map(Arc::clone)
            .map_err(|error| format!("{error:#}"));
        *self
            .flight
            .result
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = FlightState::Ready(value);
        self.completed = true;
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        if !self.completed {
            *self
                .flight
                .result
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = FlightState::Cancelled;
        }
        let mut entries = self
            .registry
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries
            .get(&self.key)
            .is_some_and(|flight| Arc::ptr_eq(flight, &self.flight))
        {
            entries.remove(&self.key);
        }
        drop(entries);
        self.flight.ready.notify_waiters();
    }
}
