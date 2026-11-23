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

//! Per-node limiters of the workflow hook routes; `Counters` lives in this crate, not in core.

use std::{sync::LazyLock, time::Duration};

use tokio::sync::{Semaphore, SemaphorePermit};

use crate::request::public_rate_limit::{Counters, MAX_KEYS};

pub const MINUTE: Duration = Duration::from_secs(60);
pub const BUSY_RETRY_AFTER_SECS: u64 = 1;
pub const STATUS_POLLS_PER_CALL: u32 = 4;

pub static LIMITERS: LazyLock<HookLimiters> = LazyLock::new(HookLimiters::from_config);

pub struct HookLimiters {
    pub ip: Counters,
    pub org: Counters,
    pub trigger: Counters,
    pub status: Counters,
    pub org_bytes: Counters,
    pub preauth: Semaphore,
    pub unresolved_ip: Semaphore,
}

impl HookLimiters {
    pub fn from_config() -> Self {
        let limit = &config::get_config().limit;
        Self {
            ip: Counters::fail_open(MAX_KEYS),
            org: Counters::default(),
            trigger: Counters::default(),
            status: Counters::default(),
            org_bytes: Counters::default(),
            preauth: Semaphore::new(limit.workflow_hook_preauth_slots),
            unresolved_ip: Semaphore::new(limit.workflow_hook_unresolved_ip_slots),
        }
    }
}

/// The trigger's own budget never exceeds the org's.
pub fn trigger_budget(rate_limit_per_minute: i32, org_rpm: u32) -> u32 {
    u32::try_from(rate_limit_per_minute)
        .unwrap_or_default()
        .min(org_rpm)
}

pub fn status_budget(trigger_budget: u32) -> u32 {
    trigger_budget.saturating_mul(STATUS_POLLS_PER_CALL)
}

/// A full gate refuses at once rather than queueing, so a flood cannot hold the verify phase.
pub fn enter(gate: &Semaphore) -> Option<SemaphorePermit<'_>> {
    gate.try_acquire().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_trigger_budget_is_capped_by_the_org() {
        assert_eq!(trigger_budget(60, 1200), 60);
        assert_eq!(trigger_budget(5000, 1200), 1200);
        assert_eq!(trigger_budget(0, 1200), 0);
        assert_eq!(trigger_budget(-3, 1200), 0);
        assert_eq!(status_budget(60), 240);
    }

    #[test]
    fn a_full_gate_refuses_at_once() {
        let gate = Semaphore::new(1);
        let held = enter(&gate).unwrap();
        assert!(enter(&gate).is_none());
        drop(held);
        assert!(enter(&gate).is_some());
    }

    #[test]
    fn limits_read_their_config() {
        let limiters = HookLimiters::from_config();
        let limit = &config::get_config().limit;
        assert_eq!(
            limiters.preauth.available_permits(),
            limit.workflow_hook_preauth_slots
        );
        assert_eq!(
            limiters.unresolved_ip.available_permits(),
            limit.workflow_hook_unresolved_ip_slots
        );
    }
}
