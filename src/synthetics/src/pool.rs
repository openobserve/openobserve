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
//! ## Why this is a struct of function pointers and not a call
//!
//! The pool itself is `openobserve_core::trial_quota` (item 2.1 gave it its own
//! key, so synthetics steps and AI credits cannot drain each other). This crate
//! does **not** depend on `openobserve-core` — see the crate doc: the edge does
//! not exist, and adding one is not this item's to add.
//!
//! Two callers need the pool and they sit on different nodes:
//!
//!   * the **ack** reconcile runs on API nodes and is served by `openobserve-api-management`, which
//!     already depends on both crates. It needs nothing from here: `job_api::ack` RETURNS the
//!     adjustment as data ([`crate::job_api::StepPoolAdjustment`]) and that crate applies it.
//!   * the **enqueue** deduct runs inside [`crate::scheduler::run`], which is ours. It cannot
//!     return the decision to anybody — it has to have the answer before it writes the job row.
//!
//! So the scheduler gets the pool handed to it. [`StepPoolHooks`] is passed to
//! [`crate::init`] **by value**, which is what makes it safe: the compiler
//! forces `openobserve-jobs` to say what the pool is, so it cannot be forgotten
//! the way an unset `OnceCell` can be. That is the same reasoning `job_api`'s
//! module doc gives for returning usage rows rather than installing a callback —
//! SPEC §11 **F6** is a wiring mistake that produces no error, and the only
//! defence against it is making the wiring non-optional.
//!
//! `fn` pointers rather than a trait object because these must be callable from
//! a synchronous context and `dyn Trait` cannot hold an `async fn`. The core
//! side is synchronous for exactly this reason; the NATS broadcast it owes the
//! other nodes is detached there.
//!
//! ## Fail-OPEN
//!
//! With no hooks installed the scheduler does not deduct and does not gate.
//! Every gate in §7.1 can only ever STOP a customer's monitoring, so a build or
//! wiring mistake must not be able to stop it — the same reasoning the trial
//! gate's `FAIL OPEN` comment gives for a failed billing read. The cost of
//! failing open is unmetered free usage for the length of the mistake, which is
//! recoverable; the cost of failing closed is silently dark monitoring for
//! every org, which is not.

use std::sync::OnceLock;

/// The pool operations [`crate::scheduler`] needs, supplied by whoever starts
/// the workers.
///
/// `Copy`, so it can be read out of the [`OnceLock`] without a lock or a clone
/// on the enqueue path.
#[derive(Clone, Copy)]
pub struct StepPoolHooks {
    /// Reserve `steps` from the org's one-time grant — SPEC §7.1 gate 3, the
    /// `configured x combos` no-retry baseline of §6.3.
    ///
    /// All or nothing: `false` means the grant cannot cover this run and §7.3
    /// decides what happens to the slot. A partial reservation would let a run
    /// start that the grant cannot pay for.
    pub try_deduct: fn(org_id: &str, steps: u64) -> bool,
    /// Give `steps` back — the enqueue did not happen (E10/E11, T29).
    pub refund: fn(org_id: &str, steps: u64),
    /// Steps left in the org's one-time grant — SPEC §6.1.
    ///
    /// Read by the REAPER, not by the enqueue: `try_deduct` already answers
    /// "does the grant cover this run?" for the enqueue. The reaper is asking a
    /// different question — *did* the enqueue reserve anything? — and it has no
    /// record of the answer, exactly as the ack has none (see
    /// `job_api::billing::pool_adjustment_for_ack`'s "the approximation, stated
    /// plainly"). Zero means the grant is spent, which is how BOTH sides read
    /// "the enqueue reserved nothing": the ack calls that state
    /// [`crate::job_api::StepPoolView::Spent`] and does not reconcile, and the
    /// reaper does not refund. The two paths must agree — a job either acks or
    /// is reaped, and it must not be treated as funded by one and unfunded by
    /// the other.
    pub remaining: fn(org_id: &str) -> u64,
    /// Give back the reservation of a job that will NEVER ack — SPEC §6.3,
    /// E10, item **2.3**.
    ///
    /// Distinct from [`Self::refund`] because it is **idempotent**: it applies
    /// at most once per `idempotency_key`, which is
    /// `(synthetics_id, location, scheduled_ts, job_id)` joined by `\u{1f}` —
    /// the same key, built by the same [`crate::job_api::adjustment_key`], that
    /// the ack-side reconcile uses. `refund` is keyless because its two call
    /// sites happen inside the enqueue that failed, where nothing else can
    /// possibly have refunded the same slot; the reaper's does not have that
    /// luxury.
    ///
    /// Returns whether the refund MOVED the grant. `false` means this key had
    /// already been applied — not a failure.
    pub dead_letter_refund: fn(org_id: &str, steps: u64, idempotency_key: &str) -> bool,
}

impl std::fmt::Debug for StepPoolHooks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StepPoolHooks")
    }
}

/// Set once, by [`crate::init`], before any worker is spawned.
static HOOKS: OnceLock<StepPoolHooks> = OnceLock::new();

/// Install the pool. Called by [`crate::init`] and nowhere else.
///
/// Later calls are ignored rather than panicking: `init` can legitimately run
/// more than once in a test binary, and a scheduler that refuses to start
/// because the pool was already installed is a worse outcome than a pool that
/// is installed once.
pub(crate) fn install(hooks: StepPoolHooks) {
    if HOOKS.set(hooks).is_err() {
        tracing::debug!("[synthetics] step pool already installed — keeping the first one");
    }
}

/// The installed pool, or `None` on a build or a node that has none.
///
/// `None` means DO NOT GATE — see the module doc's fail-open note.
///
/// Read only by `scheduler::resolve_pool_gate`, which is `cfg(cloud)`: an OSS or
/// self-hosted Enterprise build has no pool to read and no policy to read it
/// against (§8.1), so there the reader is compiled out and this is dead.
#[cfg_attr(not(feature = "cloud"), allow(dead_code))]
pub(crate) fn hooks() -> Option<StepPoolHooks> {
    HOOKS.get().copied()
}
