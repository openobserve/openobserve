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

//! The free step pools, as the SCHEDULER sees them — SPEC §6.
//!
//! The pools live in `openobserve_core::trial_quota`, which this crate does not
//! depend on, so the scheduler is handed a `fn` pointer instead — not a trait
//! object, because the installed value is read from a synchronous context.
//! [`StepPoolHooks`] is passed to [`crate::init`] **by value** so the compiler
//! forces the caller to supply it: SPEC §11 **F6** is a wiring mistake that
//! produces no error and no log at all.
//!
//! **Fail-OPEN.** With no hooks installed the scheduler does not gate. Every
//! gate in §7.1 can only ever STOP a customer's monitoring, so a build or wiring
//! mistake must not be able to stop it: unmetered free usage for the length of
//! the mistake is recoverable, silently dark monitoring is not.

use std::{collections::HashMap, future::Future, pin::Pin, sync::OnceLock};

/// Set once, by [`crate::init`], before any worker is spawned.
static HOOKS: OnceLock<StepPoolHooks> = OnceLock::new();

/// Steps left in one org's three synthetics grants — SPEC §6.1, §6.6.
///
/// Deliberately NOT `Default`: a zeroed value for an org missing from the batch
/// read means "grant spent" and blacks that org's monitoring out, where absent
/// must mean ungated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StepRemaining {
    pub browser: u64,
    pub protocol: u64,
    pub status: u64,
}

/// The batch read's result, boxed because a `fn` pointer cannot name an
/// `async fn`'s opaque future.
pub type RemainingFuture = Pin<Box<dyn Future<Output = HashMap<String, StepRemaining>> + Send>>;

/// The pool operation [`crate::scheduler`] needs, supplied by whoever starts the
/// workers. `Copy`, so the gate reads it without a lock or a clone.
#[derive(Clone, Copy)]
pub struct StepPoolHooks {
    /// One read per tick for every org whose checks were claimed. An org left
    /// out of the answer is UNGATED, never "spent".
    pub remaining_for_orgs: fn(Vec<String>) -> RemainingFuture,
}

/// Install the pools. Called by [`crate::init`] and nowhere else. Later calls
/// are ignored rather than panicking: `init` can legitimately run more than once
/// in a test binary.
pub(crate) fn install(hooks: StepPoolHooks) {
    if HOOKS.set(hooks).is_err() {
        tracing::debug!("[synthetics] step pool already installed — keeping the first one");
    }
}

/// The installed pools, or `None` on a build or a node that has none, which
/// means DO NOT GATE — see the module doc's fail-open note.
#[cfg_attr(not(feature = "cloud"), allow(dead_code))]
pub(crate) fn hooks() -> Option<StepPoolHooks> {
    HOOKS.get().copied()
}
