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

//! Cluster-coordinator events for the on-call configuration caches
//! (`architecture/06` §3, `CACHING-STRATEGY.md` §3).
//!
//! Every firing used to re-read the same four things — the org's ownership
//! rules, the team's policy, the team and its roster, and the schedule — once
//! per rung and, for the ownership scan, once per impacted service. All four
//! are configuration: they change when somebody edits a form, not when
//! something breaks.
//!
//! So they are cached per node with a short TTL, and this module is the signal
//! that makes the TTL a backstop rather than the mechanism. Writers call an
//! `emit_*` after committing; every node runs [`watch`] and drops the matching
//! entry the instant the event lands.
//!
//! Modelled on [`super::synthetics`], including the reason the handler lives
//! here rather than being passed in: the caches are in `infra::table`, the same
//! crate, so [`watch`] calls the invalidation functions directly.
//!
//! # Why invalidation correctness matters more than hit rate here
//!
//! A stale ownership rule pages the wrong team and a stale schedule pages the
//! wrong person. Both are quiet failures — somebody's phone rings, so the
//! system looks like it worked. Every cache below is therefore invalidated from
//! **every** path that can change what it holds, including the super-cluster
//! apply path, which writes through the ORM rather than through the table
//! module's own write functions. The TTL is short enough that a missed event
//! costs one escalation, never a shift.
//!
//! # Key layout
//!
//! One watch prefix, with a `kind` segment so a single watcher serves all of
//! them:
//!
//! ```text
//! /oncall_cache/ownership/{org_id}            an org's ownership rules changed
//! /oncall_cache/policy/{org_id}/{team_id}     one team's escalation policy changed
//! /oncall_cache/team/{org_id}/{team_id}       one team's name / timezone changed
//! /oncall_cache/members/{team_id}             one team's roster changed
//! /oncall_cache/schedule/{org_id}/{team_id}   a rotation or a cover changed
//! /oncall_cache/ack-spent/{tag}/{expires_at}  an ack token was used up
//! ```
//!
//! `ack-spent` is the odd one out: it is not an invalidation, it is the
//! opposite — "add this to what you already know". It rides the same prefix
//! because it wants exactly the same delivery guarantees and the same one
//! watcher, and because it is the same shape of fact: a small piece of state
//! that every node has to agree on and that nothing may be paged on the wrong
//! side of. `03` §8 requires ack tokens to be single-use, and single-use across
//! one node only is not single-use.
//!
//! `ownership` is keyed by org rather than by rule because the cache holds the
//! whole rule set for an org: routing evaluates all of them in order, so there
//! is no per-rule entry to drop.
//!
//! `schedule` is emitted by override writes as well as schedule writes. Covers
//! live in their own table but are loaded onto the `Schedule`, and an override
//! the page path does not see is worse than no override feature at all — the
//! engineer who arranged cover stops watching and the page still goes to them.

use crate::{db::Event, errors::Error};

pub const ONCALL_CACHE_WATCHER_PREFIX: &str = "/oncall_cache/";

const KIND_OWNERSHIP: &str = "ownership";
const KIND_POLICY: &str = "policy";
const KIND_TEAM: &str = "team";
const KIND_MEMBERS: &str = "members";
const KIND_SCHEDULE: &str = "schedule";
const KIND_ACK_SPENT: &str = "ack-spent";

/// An org's ownership rules changed — created, deleted, or replicated in.
pub async fn emit_ownership_changed(org_id: &str) -> Result<(), Error> {
    emit(&format!(
        "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_OWNERSHIP}/{org_id}"
    ))
    .await
}

/// One team's escalation policy changed.
pub async fn emit_policy_changed(org_id: &str, team_id: &str) -> Result<(), Error> {
    emit(&format!(
        "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_POLICY}/{org_id}/{team_id}"
    ))
    .await
}

/// One team's own row changed, or the team was deleted.
pub async fn emit_team_changed(org_id: &str, team_id: &str) -> Result<(), Error> {
    emit(&format!(
        "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_TEAM}/{org_id}/{team_id}"
    ))
    .await
}

/// One team's roster changed.
///
/// Keyed on the team alone, because membership rows are: they carry no org of
/// their own, and inventing one for the event key would make the emitter and
/// the reader disagree about what identifies a roster.
pub async fn emit_members_changed(team_id: &str) -> Result<(), Error> {
    emit(&format!(
        "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_MEMBERS}/{team_id}"
    ))
    .await
}

/// A team's schedule changed — a rotation edited, or a cover added or removed.
pub async fn emit_schedule_changed(org_id: &str, team_id: &str) -> Result<(), Error> {
    emit(&format!(
        "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_SCHEDULE}/{org_id}/{team_id}"
    ))
    .await
}

/// An acknowledgement token was used and must not work again (`03` §8).
///
/// `tag` is the token's MAC, never the token: the key travels through the
/// coordinator's store and its log, and a full token in either would be a
/// working acknowledgement link sitting in an operator's terminal. The expiry
/// rides along so a receiving node can drop the entry when the link would have
/// died anyway.
pub async fn emit_ack_token_spent(tag: &str, expires_at: i64) -> Result<(), Error> {
    emit_transient(&format!(
        "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_ACK_SPENT}/{tag}/{expires_at}"
    ))
    .await
}

/// Publishes one invalidation.
///
/// A `put`, like [`super::synthetics::emit_tokens_changed`], because the key
/// space is bounded: one key per org, or per team. The store ends up holding
/// one row for every team that has ever had its schedule edited, which is the
/// same order as the number of teams.
async fn emit(key: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(key, bytes::Bytes::from(""), true, None)
        .await?;
    Ok(())
}

/// Publishes a fact whose key space is **not** bounded.
///
/// A spent token is keyed by its own tag, so one key per acknowledgement ever
/// made — a `put` would grow the coordinator's store forever. A delete carries
/// the event and leaves nothing behind, which is the trade
/// [`super::synthetics`] makes in the other direction for the same reason.
///
/// Receivers treat both events identically, so nothing downstream cares which
/// of the two arrived.
async fn emit_transient(key: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator.delete(key, false, true, None).await
}

/// Watches on-call configuration events and invalidates the matching cache.
///
/// Spawned once per node at startup. Every node needs it, not just the
/// alert_manager: the API nodes serve the screens that read the same caches,
/// and an admin who edits a rotation and immediately reloads the page must not
/// be shown what they just replaced.
///
/// `on_ack_token_spent` is passed in for the reason
/// [`super::alerts::watch_events`] takes callbacks: the spent-token set lives in
/// the enterprise crate, which depends on this one, so this one cannot call into
/// it. Everything else here invalidates a cache in `infra::table` and is called
/// directly.
pub async fn watch<F>(on_ack_token_spent: F) -> Result<(), anyhow::Error>
where
    F: Fn(&str, i64) + Send + Sync + 'static,
{
    let cluster_coordinator = super::get_coordinator().await;
    let mut events = cluster_coordinator
        .watch(ONCALL_CACHE_WATCHER_PREFIX)
        .await?;
    let events = std::sync::Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching on-call configuration cache events");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_oncall_cache: event channel closed");
                break;
            }
        };
        let key = match &ev {
            Event::Put(e) => e.key.clone(),
            Event::Delete(e) => e.key.clone(),
            Event::Empty => continue,
        };
        apply(&key, &on_ack_token_spent);
    }
    Ok(())
}

/// Applies one event key to the local caches.
///
/// Unknown kinds are logged at debug and ignored: a node on a newer build may
/// emit a kind this one has never heard of, and refusing to keep watching
/// because of it would freeze every other cache on this node.
fn apply<F: Fn(&str, i64)>(key: &str, on_ack_token_spent: &F) {
    let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
    // parts[0] == "oncall_cache"
    match parts.get(1).copied() {
        Some(KIND_OWNERSHIP) => match parts.get(2) {
            Some(org) => crate::table::oncall_ownership::invalidate_cache(org),
            None => log::error!("watch_oncall_cache: malformed ownership key {key}"),
        },
        Some(KIND_POLICY) => match (parts.get(2), parts.get(3)) {
            (Some(org), Some(team)) => crate::table::oncall_policies::invalidate_cache(org, team),
            _ => log::error!("watch_oncall_cache: malformed policy key {key}"),
        },
        Some(KIND_TEAM) => match (parts.get(2), parts.get(3)) {
            (Some(org), Some(team)) => crate::table::oncall_teams::invalidate_cache(org, team),
            _ => log::error!("watch_oncall_cache: malformed team key {key}"),
        },
        Some(KIND_MEMBERS) => match parts.get(2) {
            Some(team) => crate::table::oncall_teams::invalidate_members_cache(team),
            None => log::error!("watch_oncall_cache: malformed members key {key}"),
        },
        Some(KIND_SCHEDULE) => match (parts.get(2), parts.get(3)) {
            (Some(org), Some(team)) => crate::table::oncall_schedules::invalidate_cache(org, team),
            _ => log::error!("watch_oncall_cache: malformed schedule key {key}"),
        },
        Some(KIND_ACK_SPENT) => match (parts.get(2), parts.get(3).and_then(|e| e.parse().ok())) {
            (Some(tag), Some(expires_at)) => on_ack_token_spent(tag, expires_at),
            // Refused rather than guessed at: an entry with an invented expiry
            // either never lapses or lapses immediately, and one of those two is
            // a link that keeps working.
            _ => log::error!("watch_oncall_cache: malformed ack-spent key {key}"),
        },
        other => log::debug!("watch_oncall_cache: ignoring unknown event kind {other:?} ({key})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every emitted key must sort under the one watch prefix, or the watcher
    /// silently never sees it and the TTL becomes the only invalidation.
    #[test]
    fn test_every_kind_sorts_under_the_watch_prefix() {
        for k in [
            format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_OWNERSHIP}/default"),
            format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_POLICY}/default/team_1"),
            format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_TEAM}/default/team_1"),
            format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_MEMBERS}/team_1"),
            format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_SCHEDULE}/default/team_1"),
            format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_ACK_SPENT}/deadbeef/1700000000000000"),
        ] {
            assert!(k.starts_with(ONCALL_CACHE_WATCHER_PREFIX), "{k}");
        }
    }

    /// The parse the watcher does, pinned against the format the emitters
    /// write. These two drifting apart is exactly the failure that leaves a
    /// stale schedule paging the wrong person with nothing in the log.
    #[test]
    fn test_keys_parse_back_into_kind_and_ids() {
        let key = format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_SCHEDULE}/default/team_1");
        let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
        assert_eq!(parts[0], "oncall_cache");
        assert_eq!(parts[1], KIND_SCHEDULE);
        assert_eq!(parts[2], "default");
        assert_eq!(parts[3], "team_1");

        let members = format!("{ONCALL_CACHE_WATCHER_PREFIX}{KIND_MEMBERS}/team_1");
        let parts: Vec<&str> = members.trim_start_matches('/').split('/').collect();
        assert_eq!(parts[1], KIND_MEMBERS);
        assert_eq!(parts[2], "team_1");
        assert_eq!(parts.len(), 3, "a roster event is keyed on the team alone");
    }

    /// Malformed and unknown keys must not panic — `apply` runs inside the
    /// watch loop, and a panic there stops every later invalidation on the
    /// node.
    #[test]
    fn test_unusable_keys_are_ignored_rather_than_panicking() {
        for key in [
            "/oncall_cache/",
            "/oncall_cache/policy",
            "/oncall_cache/policy/onlyorg",
            "/oncall_cache/team",
            "/oncall_cache/members",
            "/oncall_cache/nonsense/a/b",
            "/oncall_cache/ack-spent/deadbeef",
            "/oncall_cache/ack-spent/deadbeef/not-a-number",
            "/",
            "",
        ] {
            apply(key, &|_tag: &str, _expires_at: i64| {});
        }
    }

    /// Org ids and ksuids are alphanumeric today; this guards the parse against
    /// a future id format that is merely long or mixed-case.
    #[test]
    fn test_ids_with_unusual_shapes_still_parse() {
        let key = format!(
            "{ONCALL_CACHE_WATCHER_PREFIX}{KIND_POLICY}/Org-With_Dash/3HGpH7OjyQHnknWNzXNIDXeF6zi"
        );
        let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
        assert_eq!(parts[2], "Org-With_Dash");
        assert_eq!(parts[3], "3HGpH7OjyQHnknWNzXNIDXeF6zi");
    }
}
