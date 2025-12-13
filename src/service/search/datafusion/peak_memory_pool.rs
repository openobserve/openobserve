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
    pub peak_memory: Arc<AtomicUsize>,
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

    #[cfg(test)]
    pub fn peak_memory(&self) -> usize {
        self.peak_memory.load(Ordering::Relaxed)
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

#[cfg(test)]
mod tests {
    use datafusion::execution::memory_pool::{GreedyMemoryPool, UnboundedMemoryPool};

    use super::*;

    #[test]
    fn test_new_peak_memory_pool() {
        let inner = Arc::new(GreedyMemoryPool::new(1024 * 1024)); // 1MB limit
        let trace_id = "test-trace-123".to_string();
        let pool = PeakMemoryPool::new(inner.clone(), trace_id.clone());

        assert_eq!(pool.trace_id, trace_id);
        assert_eq!(pool.reserved(), 0);
        assert_eq!(pool.peak_memory(), 0);
    }

    #[test]
    fn test_peak_memory_tracking_with_grow() {
        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = Arc::new(PeakMemoryPool::new(inner.clone(), "test-grow".to_string()));
        let pool_dyn: Arc<dyn MemoryPool> = pool.clone();

        let consumer = MemoryConsumer::new("test-consumer");
        let reservation = consumer.register(&pool_dyn);

        // First allocation
        pool.grow(&reservation, 1024);
        assert_eq!(pool.reserved(), 1024);
        assert_eq!(pool.peak_memory(), 1024);

        // Second allocation - peak should increase
        pool.grow(&reservation, 2048);
        assert_eq!(pool.reserved(), 3072);
        assert_eq!(pool.peak_memory(), 3072);

        // Shrink - peak should remain at maximum
        pool.shrink(&reservation, 1024);
        assert_eq!(pool.reserved(), 2048);
        assert_eq!(pool.peak_memory(), 3072);

        // Grow again but less than peak - peak unchanged
        pool.grow(&reservation, 512);
        assert_eq!(pool.reserved(), 2560);
        assert_eq!(pool.peak_memory(), 3072);
    }

    #[test]
    fn test_peak_memory_tracking_with_try_grow() {
        let inner = Arc::new(GreedyMemoryPool::new(10 * 1024)); // 10KB limit
        let pool = Arc::new(PeakMemoryPool::new(
            inner.clone(),
            "test-try-grow".to_string(),
        ));
        let pool_dyn: Arc<dyn MemoryPool> = pool.clone();

        let consumer = MemoryConsumer::new("test-consumer");
        let reservation = consumer.register(&pool_dyn);

        // Successful allocation
        let result = pool.try_grow(&reservation, 5 * 1024);
        assert!(result.is_ok());
        assert_eq!(pool.reserved(), 5 * 1024);
        assert_eq!(pool.peak_memory(), 5 * 1024);

        // Another successful allocation
        let result = pool.try_grow(&reservation, 3 * 1024);
        assert!(result.is_ok());
        assert_eq!(pool.reserved(), 8 * 1024);
        assert_eq!(pool.peak_memory(), 8 * 1024);

        // Failed allocation - peak should not change
        let result = pool.try_grow(&reservation, 10 * 1024);
        assert!(result.is_err());
        assert_eq!(pool.reserved(), 8 * 1024);
        assert_eq!(pool.peak_memory(), 8 * 1024);
    }

    #[test]
    fn test_multiple_consumers() {
        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = Arc::new(PeakMemoryPool::new(
            inner.clone(),
            "test-multi-consumer".to_string(),
        ));
        let pool_dyn: Arc<dyn MemoryPool> = pool.clone();

        let consumer1 = MemoryConsumer::new("consumer-1");
        let consumer2 = MemoryConsumer::new("consumer-2");

        let reservation1 = consumer1.register(&pool_dyn);
        let reservation2 = consumer2.register(&pool_dyn);

        // Allocate for consumer 1
        pool.grow(&reservation1, 1024);
        assert_eq!(pool.reserved(), 1024);
        assert_eq!(pool.peak_memory(), 1024);

        // Allocate for consumer 2
        pool.grow(&reservation2, 2048);
        assert_eq!(pool.reserved(), 3072);
        assert_eq!(pool.peak_memory(), 3072);

        // Shrink consumer 1
        pool.shrink(&reservation1, 1024);
        assert_eq!(pool.reserved(), 2048);
        assert_eq!(pool.peak_memory(), 3072);

        // Shrink consumer 2
        pool.shrink(&reservation2, 2048);
        assert_eq!(pool.reserved(), 0);
        assert_eq!(pool.peak_memory(), 3072);
    }

    #[test]
    fn test_register_unregister() {
        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = PeakMemoryPool::new(inner.clone(), "test-register".to_string());

        let consumer = MemoryConsumer::new("test-consumer");

        // Register should not panic
        pool.register(&consumer);

        // Unregister should not panic
        pool.unregister(&consumer);
    }

    #[test]
    fn test_memory_limit() {
        let limit = 5 * 1024 * 1024; // 5MB
        let inner = Arc::new(GreedyMemoryPool::new(limit));
        let pool = PeakMemoryPool::new(inner.clone(), "test-limit".to_string());

        match pool.memory_limit() {
            MemoryLimit::Finite(size) => assert_eq!(size, limit),
            _ => panic!("Expected finite memory pool"),
        }
    }

    #[test]
    fn test_memory_limit_unbounded() {
        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = PeakMemoryPool::new(inner.clone(), "test-unbounded".to_string());

        match pool.memory_limit() {
            MemoryLimit::Infinite => {
                // Expected
            }
            _ => panic!("Expected infinite memory pool"),
        }
    }

    #[test]
    fn test_reserved_reflects_inner() {
        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = Arc::new(PeakMemoryPool::new(
            inner.clone(),
            "test-reserved".to_string(),
        ));
        let pool_dyn: Arc<dyn MemoryPool> = pool.clone();

        let consumer = MemoryConsumer::new("test-consumer");
        let reservation = consumer.register(&pool_dyn);

        assert_eq!(pool.reserved(), 0);
        assert_eq!(inner.reserved(), 0);

        pool.grow(&reservation, 4096);

        assert_eq!(pool.reserved(), 4096);
        assert_eq!(inner.reserved(), 4096);
    }

    #[test]
    fn test_peak_never_decreases() {
        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = Arc::new(PeakMemoryPool::new(
            inner.clone(),
            "test-peak-stable".to_string(),
        ));
        let pool_dyn: Arc<dyn MemoryPool> = pool.clone();

        let consumer = MemoryConsumer::new("test-consumer");
        let reservation = consumer.register(&pool_dyn);

        // Series of allocations and deallocations
        let sizes = vec![1000, 5000, 3000, 10000, 2000, 8000];
        let mut overall_max = 0;

        for size in sizes {
            pool.grow(&reservation, size);
            let current = pool.reserved();
            // Update our tracking of max we've seen
            if current > overall_max {
                overall_max = current;
            }
            let peak = pool.peak_memory();
            assert_eq!(
                peak, overall_max,
                "Peak should track the maximum allocation"
            );

            pool.shrink(&reservation, size / 2);
            let peak_after_shrink = pool.peak_memory();
            assert!(
                peak_after_shrink >= peak,
                "Peak should never decrease after shrink"
            );
            assert_eq!(
                peak_after_shrink, overall_max,
                "Peak should remain at maximum"
            );
        }
    }

    #[test]
    fn test_concurrent_updates() {
        use std::thread;

        let inner = Arc::new(UnboundedMemoryPool::default());
        let pool = Arc::new(PeakMemoryPool::new(
            inner.clone(),
            "test-concurrent".to_string(),
        ));
        let pool_dyn: Arc<dyn MemoryPool> = pool.clone();

        let mut handles = vec![];

        for i in 0..10 {
            let pool_clone = pool.clone();
            let pool_dyn_clone = pool_dyn.clone();
            let handle = thread::spawn(move || {
                let consumer = MemoryConsumer::new(format!("consumer-{i}"));
                let reservation = consumer.register(&pool_dyn_clone);

                // Each thread allocates some memory
                pool_clone.grow(&reservation, 1024 * (i + 1));
                pool_clone.shrink(&reservation, 512 * (i + 1));
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Peak should be tracked correctly despite concurrent updates
        let peak = pool.peak_memory();
        assert!(peak > 0, "Peak should be greater than 0 after allocations");
    }
}
