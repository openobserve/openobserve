// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Background jobs kept separate from the request-serving frontends.

#![recursion_limit = "256"]

#[allow(clippy::single_component_path_imports)]
use common;
use openobserve_core as service;

/// **T39 / F6 — the `cloud` feature must reach `openobserve-synthetics`.**
///
/// `#[cfg(feature = "cloud")]` in a crate that does not DEFINE `cloud` compiles
/// to nothing, silently taking the synthetics billing emit with it — revenue
/// loss no runtime test can catch. Do not remove or silence this assert: it must
/// fire during this crate's `--features cloud` compile, and the fix is
/// `openobserve-synthetics/cloud` in this crate's `cloud` feature (item 1.3).
#[cfg(feature = "cloud")]
const _: () = assert!(
    openobserve_synthetics::BUILT_WITH_CLOUD,
    "this crate was built with `cloud` but openobserve-synthetics was not: its `cfg(feature = \
     \"cloud\")` blocks — including the synthetics billing emit — compiled to NOTHING. Add \
     `openobserve-synthetics/cloud` to this crate's `cloud` feature (spec item 1.3 / F6)."
);

pub mod job;
