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

//! Self CPU (feature `cpu-profiling`) and memory (feature `profiling`) profiling.

mod convert;
mod job;
mod sample;
mod sink;

pub use job::run;
pub use sample::dump_cpu_profile;
#[cfg(feature = "profiling")]
pub use sample::{dump_memory_flamegraph, dump_memory_pprof, jemalloc_stats};

pub(crate) const SERVICE_NAME: &str = "openobserve";
pub(crate) const CPU_FREQUENCY_HZ: i32 = 100;

#[cfg(test)]
mod tests {
    use config::{META_ORG_ID, meta::self_reporting::usage::is_system_stream};

    use super::*;

    #[test]
    fn test_stream_name_is_a_meta_system_stream() {
        assert!(is_system_stream(META_ORG_ID, STREAM_NAME));
    }
}
