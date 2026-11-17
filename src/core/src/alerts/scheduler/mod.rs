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

use config::get_config;

mod calibration;
pub mod handlers;
#[cfg(feature = "enterprise")]
pub mod query_optimization_recommendation;
#[cfg(feature = "enterprise")]
mod siem;
pub mod worker;

pub use calibration::{LastRun, last_run};

// The main function that creates and runs the scheduler
pub async fn run() -> Result<(), anyhow::Error> {
    worker::Scheduler::new(scheduler_config()).run().await
}

/// A region the job election passed over claims only its own AutoObserve row.
pub async fn run_region_local() -> Result<(), anyhow::Error> {
    match worker::Scheduler::region_local(scheduler_config()) {
        Some(scheduler) => scheduler.run().await,
        None => Ok(()),
    }
}

fn scheduler_config() -> worker::SchedulerConfig {
    // Get configuration
    let cfg = get_config();

    // Create scheduler config
    let keep_alive_interval_secs = std::cmp::max(
        60,
        std::cmp::min(
            cfg.limit.alert_schedule_timeout,
            cfg.limit.report_schedule_timeout,
        ) / 4,
    ) as u64;
    worker::SchedulerConfig {
        alert_schedule_concurrency: cfg.limit.alert_schedule_concurrency,
        alert_schedule_timeout: cfg.limit.alert_schedule_timeout,
        report_schedule_timeout: cfg.limit.report_schedule_timeout,
        poll_interval_secs: cfg.limit.alert_schedule_interval as u64, // Can be configurable
        keep_alive_interval_secs,
    }
}
