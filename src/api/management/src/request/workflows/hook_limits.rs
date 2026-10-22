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

use std::{
    net::{IpAddr, Ipv6Addr},
    sync::LazyLock,
    time::Duration,
};

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

/// IPv6 callers own a whole /64, so one host cannot spread over 2^64 keys.
pub fn ip_key(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => {
                let s = v6.segments();
                format!("{}/64", Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
            }
        },
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
    use std::net::Ipv4Addr;

    use super::*;

    #[test]
    fn ipv6_addresses_share_a_slash_64_key() {
        let a: IpAddr = "2001:db8:1:2:aaaa::1".parse().unwrap();
        let b: IpAddr = "2001:db8:1:2:bbbb:cccc:dddd:eeee".parse().unwrap();
        let other: IpAddr = "2001:db8:1:3::1".parse().unwrap();
        assert_eq!(ip_key(a), ip_key(b));
        assert_ne!(ip_key(a), ip_key(other));
        assert_eq!(ip_key(a), "2001:db8:1:2::/64");
    }

    #[test]
    fn ipv4_addresses_are_keyed_per_host() {
        let a = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7));
        let b = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 8));
        assert_ne!(ip_key(a), ip_key(b));
        assert_eq!(ip_key(a), "203.0.113.7");
        let mapped = IpAddr::V6(Ipv4Addr::new(203, 0, 113, 7).to_ipv6_mapped());
        assert_eq!(
            ip_key(mapped),
            "203.0.113.7",
            "a v4-mapped address keys as v4"
        );
    }

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
