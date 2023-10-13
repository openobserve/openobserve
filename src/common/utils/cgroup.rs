// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use sysinfo::SystemExt;

/// Get cpu limit by cgroup or return the node cpu cores
pub fn get_cpu_limit() -> usize {
    let mut cpu_num = read_cpu_cgroup_v1();
    if cpu_num == 0 {
        cpu_num = read_cpu_cgroup_v2();
    }
    if cpu_num > 0 {
        if cpu_num < 100000 {
            1 // maybe the limit less than 1 core
        } else {
            cpu_num / 100000
        }
    } else {
        let mut system = sysinfo::System::new();
        system.refresh_cpu();
        system.cpus().len()
    }
}

/// Get memory limit by cgroup or return the node memory size
pub fn get_memory_limit() -> usize {
    let mut mem_size = read_memory_cgroup_v1();
    if mem_size == 0 {
        mem_size = read_memory_cgroup_v2();
    };
    let node_mem_size = {
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        system.total_memory() as usize
    };
    if mem_size == 0 || mem_size > node_mem_size {
        node_mem_size
    } else {
        mem_size
    }
}

fn read_cpu_cgroup_v1() -> usize {
    if let Ok(val) = std::fs::read_to_string("/sys/fs/cgroup/cpu.max") {
        if !val.is_empty() && !val.to_lowercase().starts_with("max") {
            let columns = val.split(' ').collect::<Vec<&str>>();
            return columns[0].parse::<usize>().unwrap_or_default();
        }
    };
    0
}

fn read_memory_cgroup_v1() -> usize {
    if let Ok(val) = std::fs::read_to_string("/sys/fs/cgroup/memory.max") {
        if !val.is_empty() && !val.to_lowercase().starts_with("max") {
            return val.trim_end().parse::<usize>().unwrap_or_default();
        }
    };
    0
}

/// Get cpu limit by cgroup v2: if there is no limit, default is: -1
fn read_cpu_cgroup_v2() -> usize {
    if let Ok(val) = std::fs::read_to_string("/sys/fs/cgroup/cpu/cpu.cfs_quota_us") {
        val.trim().to_string().parse::<usize>().unwrap_or_default()
    } else {
        0
    }
}

/// Get memory limit by cgroup v2: if there is no limit, default is: 9223372036854775807
fn read_memory_cgroup_v2() -> usize {
    if let Ok(val) = std::fs::read_to_string("/sys/fs/cgroup/memory/memory.limit_in_bytes") {
        val.trim_end().parse::<usize>().unwrap_or_default()
    } else {
        0
    }
}
