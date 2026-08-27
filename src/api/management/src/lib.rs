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

//! Management and control-plane HTTP APIs.

#![recursion_limit = "256"]
#![feature(variant_count)]

#[allow(clippy::single_component_path_imports)]
use common;
use openobserve_core as service;

/// **T39 / F6 — the `cloud` feature must reach `openobserve-synthetics`.**
///
/// `#[cfg(feature = "cloud")]` in a crate that does not DEFINE `cloud` compiles
/// to nothing silently, taking the synthetics billing emit with it. This crate
/// defines `cloud` and depends on that crate, so it is a place that can tell.
/// Do not remove or silence it: `src/synthetics/tests/build_shapes.sh` relies on
/// this assert firing during THIS crate's compile, and silencing re-opens F6.
#[cfg(feature = "cloud")]
const _: () = assert!(
    openobserve_synthetics::BUILT_WITH_CLOUD,
    "this crate was built with `cloud` but openobserve-synthetics was not: its `cfg(feature = \
     \"cloud\")` blocks — including the synthetics billing emit — compiled to NOTHING. Add \
     `openobserve-synthetics/cloud` to this crate's `cloud` feature (spec item 1.3 / F6)."
);

pub mod models;
pub mod request;
