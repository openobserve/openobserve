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

#![feature(variant_count)]
#![recursion_limit = "256"]

pub mod cli;
pub mod handler;
pub mod migration;
pub mod router;

#[cfg(feature = "enterprise")]
pub use openobserve_core::cipher;
pub use openobserve_core::{common, job, service};

#[cfg(feature = "enterprise")]
pub mod super_cluster_queue;
