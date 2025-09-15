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

/// Duration in seconds to sleep when a job is paused
pub const PAUSE_SLEEP_DURATION: u64 = 60;

/// Macro for spawning pausable jobs with flexible configuration.
/// Prefer using this macro for jobs that need to execute at some interval as its
/// reactive to the changes in the configuration.
///
/// Note:
/// 1. A job gets an interval from config and checks if it should be paused
/// 2. If paused (interval <= 0 by default), it sleeps for 60 seconds and checks again
/// 3. If not paused, it sleeps for the interval and executes the job logic
///
/// # Syntax
/// ```rust
/// spawn_pausable_job!(
///     "job_name",
///     interval_expression,
///     {
///         // job logic here
///     }
/// );
///
/// // With options:
/// spawn_pausable_job!(
///     "job_name",
///     interval_expression,
///     {
///         // job logic here
///     },
///     sleep_after,  // sleep after job logic instead of before
///     pause_if: custom_pause_condition  // override default <= 0 condition
/// );
/// ```
///
/// # Examples
/// ```rust
/// use config::utils::pausable_job::spawn_pausable_job;
/// use config::get_config;
///
/// // Basic usage (sleep before, pause when <= 0)
/// spawn_pausable_job!(
///     "memory_cache_gc",
///     get_config().memory_cache.gc_interval,
///     {
///         if let Err(e) = gc().await {
///             log::error!("gc error: {}", e);
///         }
///     }
/// );
///
/// // Sleep after job logic
/// spawn_pausable_job!(
///     "metrics_update",
///     60,
///     {
///         update_metrics().await;
///     },
///     sleep_after
/// );
///
/// // Custom pause condition
/// spawn_pausable_job!(
///     "compactor",
///     get_config().compact.interval,
///     {
///         run_compaction().await;
///     },
///     pause_if: !get_config().compact.enabled
/// );
/// ```
#[macro_export]
macro_rules! spawn_pausable_job {
    // Basic usage: sleep before, pause when <= 0
    ($job_name:expr, $interval_expr:expr, $job_logic:block) => {
        spawn_pausable_job!($job_name, $interval_expr, $job_logic, sleep_before, pause_if: $interval_expr <= 0)
    };

    // With sleep_after option
    ($job_name:expr, $interval_expr:expr, $job_logic:block, sleep_after) => {
        spawn_pausable_job!($job_name, $interval_expr, $job_logic, sleep_after, pause_if: $interval_expr <= 0)
    };

    // With custom pause condition, default sleep_before
    ($job_name:expr, $interval_expr:expr, $job_logic:block, pause_if: $pause_condition:expr) => {
        spawn_pausable_job!($job_name, $interval_expr, $job_logic, sleep_before, pause_if: $pause_condition)
    };

    // Full syntax with all options
    ($job_name:expr, $interval_expr:expr, $job_logic:block, $sleep_timing:ident, pause_if: $pause_condition:expr) => {{
        let job_name = $job_name.to_string();
        tokio::task::spawn(async move {
            log::info!("[{}] pausable job started", job_name);

            loop {
                let interval = $interval_expr;

                // Check pause condition (default: interval <= 0, or custom condition)
                if $pause_condition {
                    log::debug!("[{}] job is paused, checking again in {}s", job_name, $crate::utils::pausable_job::PAUSE_SLEEP_DURATION);
                    tokio::time::sleep(tokio::time::Duration::from_secs($crate::utils::pausable_job::PAUSE_SLEEP_DURATION)).await;
                    continue;
                }

                // Sleep before job logic (default behavior)
                spawn_pausable_job!(@sleep_before, $sleep_timing, interval);

                // Execute job logic
                log::debug!("[{}] executing job", job_name);
                $job_logic

                // Sleep after job logic (if specified)
                spawn_pausable_job!(@sleep_after, $sleep_timing, interval);
            }
        })
    }};

    // Internal helper for sleep before
    (@sleep_before, sleep_before, $interval:expr) => {
        tokio::time::sleep(tokio::time::Duration::from_secs($interval as u64)).await;
    };
    (@sleep_before, sleep_after, $interval:expr) => {};

    // Internal helper for sleep after
    (@sleep_after, sleep_after, $interval:expr) => {
        tokio::time::sleep(tokio::time::Duration::from_secs($interval as u64)).await;
    };
    (@sleep_after, sleep_before, $interval:expr) => {};
}
