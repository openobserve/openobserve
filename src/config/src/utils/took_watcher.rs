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

use std::fmt;

use tokio::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct Split {
    pub name: String,
    pub duration: Duration,
}

#[derive(Clone)]
pub struct TookWatcher {
    start_time: Instant,
    last_split: Option<Instant>,
    splits: Vec<Split>,
}

impl TookWatcher {
    /// Creates and starts the internal timer
    pub fn new() -> Self {
        TookWatcher {
            start_time: Instant::now(),
            last_split: None,
            splits: Vec::new(),
        }
    }

    /// Get total elapsed time since stopwatch started
    pub fn total_elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }

    /// Convenience method to get total time in milliseconds
    pub fn total_millis(&self) -> u64 {
        self.total_elapsed().as_millis() as u64
    }

    /// Convenience method to get total time as f64 seconds
    pub fn total_secs_f64(&self) -> f64 {
        self.total_elapsed().as_secs_f64()
    }

    /// Get elapsed time since last split WITHOUT recording a new split.
    /// This is safe to call in loops for timeout checking.
    pub fn split_elapsed(&self) -> Duration {
        match self.last_split {
            Some(ref instant) => instant.elapsed(),
            None => self.start_time.elapsed(),
        }
    }

    /// Convenience method to get elapsed time in milliseconds without mutating
    pub fn split_elapsed_millis(&self) -> u64 {
        self.split_elapsed().as_millis() as u64
    }

    /// Convenience method to get elapsed time as f64 seconds without mutating
    pub fn split_elapsed_secs_f64(&self) -> f64 {
        self.split_elapsed().as_secs_f64()
    }

    /// Record a named split and return the duration since last split
    pub fn record_split(&mut self, name: impl Into<String>) -> Duration {
        let duration = self.split_elapsed();

        self.splits.push(Split {
            name: name.into(),
            duration,
        });

        self.last_split = Some(Instant::now());
        duration
    }

    /// Get all recorded splits
    pub fn get_splits(&self) -> &[Split] {
        &self.splits
    }

    /// Generate a formatted summary of all splits
    pub fn get_summary(&self) -> String {
        format!(
            "total: {} ms, breakdown: {}",
            self.total_millis(),
            self.splits
                .iter()
                .map(|s| format!("{}={}ms", s.name, s.duration.as_millis()))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

impl Default for TookWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for TookWatcher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StopWatch")
            .field("elapsed_ms", &self.split_elapsed_millis())
            .field("total_ms", &self.total_millis())
            .field("splits", &self.splits.len())
            .finish()
    }
}

impl fmt::Display for TookWatcher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}ms", self.total_millis())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_took_watcher_total_elapsed() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let elapsed = watcher.total_elapsed();
        assert!(elapsed.as_millis() >= 10);
    }

    #[tokio::test]
    async fn test_took_watcher_total_millis() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let millis = watcher.total_millis();
        assert!(millis >= 10);
    }

    #[tokio::test]
    async fn test_took_watcher_total_secs_f64() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(100)).await;

        let secs = watcher.total_secs_f64();
        assert!(secs >= 0.1);
    }

    #[tokio::test]
    async fn test_took_watcher_split_elapsed() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let elapsed = watcher.split_elapsed();
        assert!(elapsed.as_millis() >= 10);
    }

    #[tokio::test]
    async fn test_took_watcher_split_elapsed_millis() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let millis = watcher.split_elapsed_millis();
        assert!(millis >= 10);
    }

    #[tokio::test]
    async fn test_took_watcher_split_elapsed_secs_f64() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(100)).await;

        let secs = watcher.split_elapsed_secs_f64();
        assert!(secs >= 0.1);
    }

    #[tokio::test]
    async fn test_took_watcher_record_split() {
        let mut watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let duration = watcher.record_split("first");
        assert!(duration.as_millis() >= 10);
        assert_eq!(watcher.get_splits().len(), 1);
        assert_eq!(watcher.get_splits()[0].name, "first");
    }

    #[tokio::test]
    async fn test_took_watcher_multiple_splits() {
        let mut watcher = TookWatcher::new();

        tokio::time::sleep(Duration::from_millis(10)).await;
        watcher.record_split("first");

        tokio::time::sleep(Duration::from_millis(10)).await;
        watcher.record_split("second");

        tokio::time::sleep(Duration::from_millis(10)).await;
        watcher.record_split("third");

        let splits = watcher.get_splits();
        assert_eq!(splits.len(), 3);
        assert_eq!(splits[0].name, "first");
        assert_eq!(splits[1].name, "second");
        assert_eq!(splits[2].name, "third");
    }

    #[tokio::test]
    async fn test_took_watcher_split_elapsed_after_record() {
        let mut watcher = TookWatcher::new();

        tokio::time::sleep(Duration::from_millis(20)).await;
        watcher.record_split("first");

        // Reset the timer
        tokio::time::sleep(Duration::from_millis(10)).await;

        // split_elapsed should measure from last record_split
        let elapsed = watcher.split_elapsed_millis();
        assert!(elapsed >= 10);
        assert!(elapsed < 20); // Should be much less than total time
    }

    #[tokio::test]
    async fn test_took_watcher_get_summary() {
        let mut watcher = TookWatcher::new();

        tokio::time::sleep(Duration::from_millis(10)).await;
        watcher.record_split("operation1");

        tokio::time::sleep(Duration::from_millis(10)).await;
        watcher.record_split("operation2");

        let summary = watcher.get_summary();
        assert!(summary.contains("total:"));
        assert!(summary.contains("ms"));
        assert!(summary.contains("operation1"));
        assert!(summary.contains("operation2"));
    }

    #[test]
    fn test_took_watcher_split_structure() {
        let split = Split {
            name: "test".to_string(),
            duration: Duration::from_millis(100),
        };

        assert_eq!(split.name, "test");
        assert_eq!(split.duration.as_millis(), 100);
    }

    #[test]
    fn test_took_watcher_split_clone() {
        let split = Split {
            name: "test".to_string(),
            duration: Duration::from_millis(100),
        };

        let cloned = split.clone();
        assert_eq!(cloned.name, split.name);
        assert_eq!(cloned.duration, split.duration);
    }

    #[tokio::test]
    async fn test_took_watcher_display_implementation() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let display_string = format!("{}", watcher);
        assert!(display_string.ends_with("ms"));
        assert!(display_string.len() > 2); // Should have some digits
    }

    #[tokio::test]
    async fn test_took_watcher_debug_implementation() {
        let watcher = TookWatcher::new();
        let debug_string = format!("{:?}", watcher);

        assert!(debug_string.contains("StopWatch"));
        assert!(debug_string.contains("elapsed_ms"));
        assert!(debug_string.contains("total_ms"));
        assert!(debug_string.contains("splits"));
    }

    #[tokio::test]
    async fn test_took_watcher_split_elapsed_without_mutation() {
        let watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;

        // Call multiple times should not change anything
        let elapsed1 = watcher.split_elapsed_millis();
        let elapsed2 = watcher.split_elapsed_millis();

        // Both should be roughly the same (within a reasonable margin)
        assert!((elapsed2 as i64 - elapsed1 as i64).abs() < 50);
    }

    #[tokio::test]
    async fn test_took_watcher_empty_summary() {
        let watcher = TookWatcher::new();
        let summary = watcher.get_summary();

        assert!(summary.contains("total:"));
        assert!(summary.contains("breakdown:"));
    }

    #[tokio::test]
    async fn test_took_watcher_clone() {
        let mut watcher = TookWatcher::new();
        tokio::time::sleep(Duration::from_millis(10)).await;
        watcher.record_split("test");

        let cloned = watcher.clone();
        assert_eq!(cloned.get_splits().len(), watcher.get_splits().len());
        assert_eq!(cloned.get_splits()[0].name, "test");
    }
}
