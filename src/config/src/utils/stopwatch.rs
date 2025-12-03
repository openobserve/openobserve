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
pub struct StopWatch {
    start_time: Instant,
    last_split: Option<Instant>,
    splits: Vec<Split>,
}

impl StopWatch {
    /// Creates and starts the internal timer
    pub fn new() -> Self {
        StopWatch {
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

impl Default for StopWatch {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for StopWatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StopWatch")
            .field("elapsed_ms", &self.split_elapsed_millis())
            .field("total_ms", &self.total_millis())
            .field("splits", &self.splits.len())
            .finish()
    }
}

impl fmt::Display for StopWatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}ms", self.total_millis())
    }
}
