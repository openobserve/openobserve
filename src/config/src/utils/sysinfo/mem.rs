// Copyright 2025 OpenObserve Inc.
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

use sysinfo::{ProcessExt, SystemExt};

// Get total memory in bytes
pub fn get_total_memory() -> usize {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.total_memory() as usize
}

// Get used memory in bytes
pub fn get_memory_usage() -> usize {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.used_memory() as usize
}

// Get process memory usage in bytes
pub fn get_process_memory_usage() -> usize {
    let Ok(pid) = sysinfo::get_current_pid() else {
        return 0;
    };
    let mut system = sysinfo::System::new();
    system.refresh_process(pid);
    system
        .process(pid)
        .map(|p| p.memory() as usize)
        .unwrap_or_default()
}

// Get memory usage from memory stats
pub fn get_memory_usage_from_memory_stats() -> usize {
    memory_stats::memory_stats()
        .map(|memory_stats| memory_stats.physical_mem)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sysinfo_get_memory_usage() {
        let memory_usage_v1 = get_process_memory_usage();
        let memory_usage_v2 = get_memory_usage_from_memory_stats();
        // the diff should be less than 1%
        let diff = if memory_usage_v1 > memory_usage_v2 {
            memory_usage_v1 - memory_usage_v2
        } else {
            memory_usage_v2 - memory_usage_v1
        };
        let capp = memory_usage_v1 / 100;
        println!("memory_usage: {}", memory_usage_v1);
        println!("memory_stats: {}", memory_usage_v2);
        println!("diff: {}", diff);
        println!("capp: {}", capp);
        assert!(diff <= capp);
    }
}
