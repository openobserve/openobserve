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

//! Self CPU/memory profiling into `_meta.self_profiles` (feature `profiling`).

mod convert;
mod job;
mod sample;
mod sink;

pub use job::run;
pub use sample::{dump_cpu_profile, dump_memory_flamegraph, dump_memory_pprof, jemalloc_stats};

pub(crate) const STREAM_NAME: &str = "self_profiles";
pub(crate) const SERVICE_NAME: &str = "openobserve";
pub(crate) const CPU_FREQUENCY_HZ: i32 = 100;
