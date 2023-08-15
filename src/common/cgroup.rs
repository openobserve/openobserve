// Copyright 2022 Zinc Labs Inc. and Contributors
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

/// Get cpu limit by cgroup or return the node cpu cores
pub fn get_cpu_limit() -> usize {
    let cpu_num = if let Ok(val) = std::fs::read_to_string("/sys/fs/cgroup/cpu.max") {
        if !val.to_lowercase().starts_with("max") {
            let columns = val.split(' ').collect::<Vec<&str>>();
            let val = columns[0].parse::<usize>().unwrap_or_default();
            if val < 100000 {
                1 // maybe the limit less than 1 core
            } else {
                val / 100000
            }
        } else {
            0
        }
    } else {
        0
    };
    if cpu_num > 0 {
        cpu_num
    } else {
        let cpu_num = sys_info::cpu_num().expect("Failed to get cpu info");
        cpu_num as usize
    }
}

/// Get memory limit by cgroup or return the node memory size
pub fn get_memory_limit() -> usize {
    let mem_size = if let Ok(val) = std::fs::read_to_string("/sys/fs/cgroup/memory.max") {
        if !val.to_lowercase().starts_with("max") {
            val.parse::<usize>().unwrap_or_default()
        } else {
            0
        }
    } else {
        0
    };
    if mem_size > 0 {
        mem_size
    } else {
        let meminfo = sys_info::mem_info().expect("Failed to get memory info");
        meminfo.total as usize * 1024 // the meminfo.total is in KB
    }
}
