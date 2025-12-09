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

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use datafusion::execution::memory_pool::{
    MemoryConsumer, MemoryLimit, MemoryPool, MemoryReservation,
};

/// A memory pool wrapper that tracks the peak memory usage during DataFusion execution.
/// When dropped, it logs the peak memory usage.
#[derive(Debug)]
pub struct PeakMemoryPool {
    trace_id: String,
    inner: Arc<dyn MemoryPool>,
    peak_memory: Arc<AtomicUsize>,
}

impl PeakMemoryPool {
    pub fn new(inner: Arc<dyn MemoryPool>, trace_id: String) -> Self {
        Self {
            trace_id,
            inner,
            peak_memory: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn update_peak(&self, current: usize) {
        self.peak_memory.fetch_max(current, Ordering::Relaxed);
    }
}

impl MemoryPool for PeakMemoryPool {
    fn register(&self, consumer: &MemoryConsumer) {
        self.inner.register(consumer);
    }

    fn unregister(&self, consumer: &MemoryConsumer) {
        self.inner.unregister(consumer);
    }

    fn grow(&self, reservation: &MemoryReservation, additional: usize) {
        self.inner.grow(reservation, additional);
        let current = self.inner.reserved();
        self.update_peak(current);
    }

    fn shrink(&self, reservation: &MemoryReservation, size: usize) {
        self.inner.shrink(reservation, size);
    }

    fn try_grow(
        &self,
        reservation: &MemoryReservation,
        additional: usize,
    ) -> Result<(), datafusion::error::DataFusionError> {
        let result = self.inner.try_grow(reservation, additional);
        if result.is_ok() {
            let current = self.inner.reserved();
            self.update_peak(current);
        }
        result
    }

    fn reserved(&self) -> usize {
        self.inner.reserved()
    }

    fn memory_limit(&self) -> MemoryLimit {
        self.inner.memory_limit()
    }
}

impl Drop for PeakMemoryPool {
    fn drop(&mut self) {
        let peak = self.peak_memory.load(Ordering::Relaxed);
        let peak_mb = peak as f64 / (1024.0 * 1024.0);
        log::info!(
            "[trace_id {}] DataFusion peak memory usage: {peak} bytes ({peak_mb:.2} MB)",
            self.trace_id,
        );
    }
}
