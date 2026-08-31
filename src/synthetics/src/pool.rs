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

//! The free step pool, as the SCHEDULER sees it — SPEC §6, items 2.3 / 2.4.
//!
//! The pool lives in `openobserve_core::trial_quota`, which this crate does not
//! depend on, so the scheduler is handed `fn` pointers instead — not a trait
//! object, because they are called from a synchronous context and `dyn Trait`
//! cannot hold an `async fn`. [`StepPoolHooks`] is passed to [`crate::init`]
//! **by value** so the compiler forces the caller to supply it: SPEC §11 **F6**
//! is a wiring mistake that produces no error and no log at all.
//!
//! **Fail-OPEN.** With no hooks installed the scheduler does not deduct and does
//! not gate. Every gate in §7.1 can only ever STOP a customer's monitoring, so a
//! build or wiring mistake must not be able to stop it: unmetered free usage for
//! the length of the mistake is recoverable, silently dark monitoring is not.

use std::sync::OnceLock;

/// The pool operations [`crate::scheduler`] needs, supplied by whoever starts
/// the workers. `Copy`, so the enqueue path reads it without a lock or a clone.
#[derive(Clone, Copy)]
pub struct StepPoolHooks {
    /// Reserve `steps` from the org's one-time grant — SPEC §7.1 gate 3, the
    /// `configured x combos` no-retry baseline of §6.3. All or nothing: a
    /// partial reservation would let a run start the grant cannot pay for.
    pub try_deduct: fn(org_id: &str, is_browser: bool, steps: u64) -> bool,
    /// Give `steps` back — the enqueue did not happen (E10/E11, T29).
    pub refund: fn(org_id: &str, is_browser: bool, steps: u64),
    /// Steps left in the org's one-time grant — SPEC §6.1.
    ///
    /// Read by the REAPER, not the enqueue, to ask what neither side records:
    /// *did* the enqueue reserve anything? Zero means the grant is spent, and
    /// BOTH sides must read it the same way — the ack calls that state
    /// [`crate::job_api::StepPoolView::Spent`] and does not reconcile, the
    /// reaper does not refund. A job either acks or is reaped; it must not be
    /// treated as funded by one path and unfunded by the other.
    pub remaining: fn(org_id: &str, is_browser: bool) -> u64,
    /// Give back the reservation of a job that will NEVER ack — SPEC §6.3, E10.
    ///
    /// Idempotent, unlike [`Self::refund`]: applied at most once per
    /// `idempotency_key` = `(synthetics_id, location, scheduled_ts, job_id)`
    /// joined by `\u{1f}`, the same key built by the same
    /// [`crate::job_api::adjustment_key`] the ack-side reconcile uses. Returns
    /// whether the refund MOVED the grant; `false` means already applied.
    pub dead_letter_refund:
        fn(org_id: &str, is_browser: bool, steps: u64, idempotency_key: &str) -> bool,
}

impl std::fmt::Debug for StepPoolHooks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StepPoolHooks")
    }
}

/// Set once, by [`crate::init`], before any worker is spawned.
static HOOKS: OnceLock<StepPoolHooks> = OnceLock::new();

/// Install the pool. Called by [`crate::init`] and nowhere else. Later calls are
/// ignored rather than panicking: `init` can legitimately run more than once in
/// a test binary.
pub(crate) fn install(hooks: StepPoolHooks) {
    if HOOKS.set(hooks).is_err() {
        tracing::debug!("[synthetics] step pool already installed — keeping the first one");
    }
}

/// The installed pool, or `None` on a build or a node that has none, which means
/// DO NOT GATE — see the module doc's fail-open note. Read only by
/// `scheduler::resolve_pool_gate`, which is `cfg(cloud)`: an OSS or self-hosted
/// build has no pool and no policy to read it against (§8.1), so this is dead
/// there.
#[cfg_attr(not(feature = "cloud"), allow(dead_code))]
pub(crate) fn hooks() -> Option<StepPoolHooks> {
    HOOKS.get().copied()
}
