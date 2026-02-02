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

use config::get_config;

pub mod handlers;
#[cfg(feature = "enterprise")]
pub mod query_optimization_recommendation;
pub mod worker;

// The main function that creates and runs the scheduler
pub async fn run() -> Result<(), anyhow::Error> {
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
    let scheduler_config = worker::SchedulerConfig {
        alert_schedule_concurrency: cfg.limit.alert_schedule_concurrency,
        alert_schedule_timeout: cfg.limit.alert_schedule_timeout,
        report_schedule_timeout: cfg.limit.report_schedule_timeout,
        poll_interval_secs: cfg.limit.alert_schedule_interval as u64, // Can be configurable
        keep_alive_interval_secs,
    };

    // Create and run scheduler
    let scheduler = worker::Scheduler::new(scheduler_config);
    scheduler.run().await
}
