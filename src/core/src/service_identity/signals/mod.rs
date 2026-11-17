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

pub mod aggregator;
#[cfg(feature = "enterprise")]
pub mod api;
#[cfg(feature = "enterprise")]
pub mod arms;
#[cfg(feature = "enterprise")]
pub mod deploys;
#[cfg(feature = "enterprise")]
pub mod k8s_versions;
pub mod metrics;
#[cfg(feature = "enterprise")]
pub mod processor;
#[cfg(feature = "enterprise")]
pub mod reads;
#[cfg(feature = "enterprise")]
pub mod rum_drill;
#[cfg(feature = "enterprise")]
pub mod snapshot;
#[cfg(feature = "enterprise")]
pub mod verdicts;
#[cfg(feature = "enterprise")]
pub mod writer;

#[cfg(feature = "enterprise")]
pub mod purge;
