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

//! Synthetic monitoring: check CRUD, scheduling, dispatch and result handling.
//!
//! Lives in OSS. The private-VPC-agent path — `job_api::lease`, agent register
//! and heartbeat, private locations and the agent install flow — stays in
//! `o2_enterprise` and calls in here.
//!
//! ## Why this is its own crate
//!
//! The super-cluster applier (`super_cluster_queue`) must be structurally
//! incapable of re-publishing a message it has just applied, or region A
//! applying region B's write echoes it back forever. Today that is guaranteed
//! by the crate graph rather than by convention: the applier writes through
//! `infra::table`, and `infra` cannot reference `o2_enterprise`.
//!
//! This crate publishes (behind `#[cfg(feature = "enterprise")]`), so
//! **`super_cluster_queue` must never depend on it.** Putting these modules in
//! `openobserve-core` would have broken that — `super_cluster_queue` depends on
//! core — and demoted a compile-time impossibility to a lint.

pub mod alerting;

#[cfg(test)]
mod tests {
    /// Every publish helper on the synthetics queue: checks and the two config
    /// tables. Assembled at runtime so the search cannot match its own text.
    fn any_publish_prefix() -> String {
        ["queue", "synthetics_"].join("::")
    }

    /// The check publish helpers share this prefix.
    fn publish_prefix() -> String {
        ["queue", "synthetics_check"].join("::")
    }

    /// The OSS half of the enterprise `nothing_on_the_run_path_publishes`
    /// guarantee, and the reason replication traffic scales with edits rather
    /// than with runs.
    ///
    /// `claim_due` and `advance_schedule` live in `infra::table`, which cannot
    /// reach the enterprise crate at all, so the only place a per-run publish
    /// could be introduced is one of these callers. If one ever grows one,
    /// 1,000 checks on a 1-minute schedule become 1,000 messages a minute
    /// forever — and nothing else in the system would notice.
    ///
    /// The enterprise copy walks the files still in `o2_enterprise`; this walks
    /// the ones that have moved here, with the same allowance table. A file
    /// arriving in this crate must be added to one list or the other, never
    /// dropped from both.
    #[test]
    fn nothing_on_the_run_path_publishes() {
        let prefix = publish_prefix();
        let any = any_publish_prefix();
        // A slice rather than an array literal: the list grows a file per
        // migration step, and `for … in [one_thing]` is a clippy error today
        // that would be reverted tomorrow.
        let files: &[(&str, &str)] = &[("alerting", include_str!("alerting.rs"))];
        for (name, source) in files {
            assert!(
                !source.contains(&prefix),
                "{name} is off the user-CRUD path; only the check service may publish a check"
            );
            // Nothing here is allowed a publish yet. When `dispatcher` moves in
            // it brings one — minting an org's default probe token when it has
            // none — and that becomes a named arm here rather than a raised
            // ceiling for the whole list.
            let allowed = 0;
            assert_eq!(
                source.matches(&any).count(),
                allowed,
                "{name} may publish exactly {allowed} time(s) on the synthetics queue"
            );
            assert_eq!(
                source
                    .matches(&["super_cluster", "enabled"].join("."))
                    .count(),
                allowed,
                "{name}'s publishes must each carry their own super-cluster guard"
            );
        }
    }
}
