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

use std::path::{Path, PathBuf};

const CGROUP_ROOT: &str = "/sys/fs/cgroup";
const PROC_SELF_CGROUP: &str = "/proc/self/cgroup";

/// cgroup v1 reports "no limit" as a very large number instead of `max`.
const V1_UNLIMITED: usize = 1 << 60;

/// Get cpu limit by cgroup or return the node cpu cores
pub fn get_cpu_limit() -> usize {
    match cpu_quota_from(Path::new(CGROUP_ROOT), Path::new(PROC_SELF_CGROUP)) {
        Some(cpus) => cpu_count(cpus),
        None => super::cpu::get_cpu_num(),
    }
}

/// Get memory limit by cgroup or return the node memory size
pub fn get_memory_limit() -> usize {
    let node_mem_size = {
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        system.total_memory() as usize
    };
    match memory_limit_from(Path::new(CGROUP_ROOT), Path::new(PROC_SELF_CGROUP)) {
        Some(mem_size) if mem_size > 0 && mem_size < node_mem_size => mem_size,
        _ => node_mem_size,
    }
}

/// Whole cores for a cpu quota, at least 1. A quota below one core still gets one.
fn cpu_count(cpus: f64) -> usize {
    (cpus.floor() as usize).max(1)
}

/// The memory limit in bytes that applies to this process, if any.
///
/// The limit is the smallest one set on the process's cgroup or on any of its ancestors, which is
/// how the kernel enforces it. A limit set by systemd or by a parent cgroup is found this way.
fn memory_limit_from(root: &Path, proc_cgroup: &Path) -> Option<usize> {
    let (dirs, file) = if is_cgroup_v2(root) {
        (cgroup_dirs_v2(root, proc_cgroup), "memory.max")
    } else {
        (
            cgroup_dirs_v1(root, proc_cgroup, "memory"),
            "memory.limit_in_bytes",
        )
    };
    dirs.iter()
        .filter_map(|dir| read_number(&dir.join(file)))
        .filter(|&limit| limit > 0 && limit < V1_UNLIMITED)
        .min()
}

/// The cpu quota in cores that applies to this process, if any, e.g. `0.5` or `2.0`.
///
/// The quota is the smallest one set on the process's cgroup or on any of its ancestors.
fn cpu_quota_from(root: &Path, proc_cgroup: &Path) -> Option<f64> {
    let quotas: Vec<f64> = if is_cgroup_v2(root) {
        cgroup_dirs_v2(root, proc_cgroup)
            .iter()
            .filter_map(|dir| read_cpu_max(&dir.join("cpu.max")))
            .collect()
    } else {
        cgroup_dirs_v1(root, proc_cgroup, "cpu")
            .iter()
            .filter_map(|dir| {
                let quota = read_number(&dir.join("cpu.cfs_quota_us"))?;
                let period = read_number(&dir.join("cpu.cfs_period_us"))?;
                (quota > 0 && period > 0).then(|| quota as f64 / period as f64)
            })
            .collect()
    };
    quotas.into_iter().reduce(f64::min)
}

fn is_cgroup_v2(root: &Path) -> bool {
    root.join("cgroup.controllers").exists()
}

/// The cgroup v2 directories of this process, nearest first, up to the cgroup root.
fn cgroup_dirs_v2(root: &Path, proc_cgroup: &Path) -> Vec<PathBuf> {
    let text = std::fs::read_to_string(proc_cgroup).unwrap_or_default();
    let leaf = text
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .map(|path| root.join(path.trim().trim_start_matches('/')))
        .filter(|dir| dir.is_dir());
    match leaf {
        Some(leaf) => ancestors_until(&leaf, root),
        // Inside a container the path in /proc/self/cgroup is the host path, but the mount only
        // shows the container's own cgroup at its root.
        None => vec![root.to_path_buf()],
    }
}

/// The cgroup v1 directories of this process for one controller, nearest first, up to the
/// controller root. Empty when the controller is not mounted.
fn cgroup_dirs_v1(root: &Path, proc_cgroup: &Path, controller: &str) -> Vec<PathBuf> {
    let base = root.join(controller);
    if !base.is_dir() {
        return Vec::new();
    }
    let text = std::fs::read_to_string(proc_cgroup).unwrap_or_default();
    let leaf = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, ':');
            let _id = parts.next()?;
            let controllers = parts.next()?;
            let path = parts.next()?;
            controllers
                .split(',')
                .any(|c| c == controller)
                .then_some(path)
        })
        .map(|path| base.join(path.trim().trim_start_matches('/')))
        .find(|dir| dir.is_dir());
    match leaf {
        Some(leaf) => ancestors_until(&leaf, &base),
        None => vec![base],
    }
}

/// `start` and each of its parents up to and including `stop`.
fn ancestors_until(start: &Path, stop: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = start.to_path_buf();
    loop {
        dirs.push(current.clone());
        if current == stop || !current.starts_with(stop) {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => break,
        }
    }
    dirs
}

/// Reads a file holding one number. Returns `None` for a missing file, for `max`, and for `-1`.
fn read_number(path: &Path) -> Option<usize> {
    let text = std::fs::read_to_string(path).ok()?;
    text.split_whitespace().next()?.parse::<usize>().ok()
}

/// Reads a cgroup v2 `cpu.max` file (`quota period`) as a number of cores.
fn read_cpu_max(path: &Path) -> Option<f64> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut parts = text.split_whitespace();
    let quota = parts.next()?.parse::<usize>().ok()?;
    let period = parts.next()?.parse::<usize>().ok()?;
    (quota > 0 && period > 0).then(|| quota as f64 / period as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: usize = 1 << 30;

    /// A fake cgroup mount and `/proc/self/cgroup` under a temp dir, removed on drop.
    struct Fixture {
        #[allow(dead_code)]
        tmp: tempfile::TempDir,
        dir: PathBuf,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let tmp = tempfile::Builder::new()
                .prefix(&format!("oo-cgroup-{name}-"))
                .tempdir()
                .unwrap();
            let dir = tmp.path().to_path_buf();
            Self { tmp, dir }
        }

        fn root(&self) -> PathBuf {
            self.dir.join("cgroup")
        }

        fn proc_cgroup(&self) -> PathBuf {
            self.dir.join("proc_self_cgroup")
        }

        fn write(&self, rel: &str, text: &str) {
            let path = self.dir.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }

        fn v2(&self, proc_line: &str) {
            self.write("cgroup/cgroup.controllers", "cpu memory pids\n");
            self.write("proc_self_cgroup", &format!("{proc_line}\n"));
        }

        fn v1(&self, proc_text: &str) {
            std::fs::create_dir_all(self.root().join("memory")).unwrap();
            std::fs::create_dir_all(self.root().join("cpu")).unwrap();
            self.write("proc_self_cgroup", proc_text);
        }

        fn memory(&self) -> Option<usize> {
            memory_limit_from(&self.root(), &self.proc_cgroup())
        }

        fn cpu(&self) -> Option<f64> {
            cpu_quota_from(&self.root(), &self.proc_cgroup())
        }
    }

    #[test]
    fn v2_leaf_limit() {
        let f = Fixture::new("v2_leaf");
        f.v2("0::/lab/box");
        f.write("cgroup/lab/box/memory.max", "2147483648\n");
        f.write("cgroup/lab/box/cpu.max", "50000 100000\n");
        assert_eq!(f.memory(), Some(2 * GIB));
        assert_eq!(f.cpu(), Some(0.5));
    }

    #[test]
    fn v2_limit_on_ancestor() {
        // systemd sets MemoryMax and CPUQuota on the service cgroup; the process may sit below it.
        let f = Fixture::new("v2_ancestor");
        f.v2("0::/system.slice/oo.service/worker");
        f.write("cgroup/system.slice/oo.service/worker/memory.max", "max\n");
        f.write(
            "cgroup/system.slice/oo.service/worker/cpu.max",
            "max 100000\n",
        );
        f.write("cgroup/system.slice/oo.service/memory.max", "1073741824\n");
        f.write("cgroup/system.slice/oo.service/cpu.max", "200000 100000\n");
        assert_eq!(f.memory(), Some(GIB));
        assert_eq!(f.cpu(), Some(2.0));
    }

    #[test]
    fn v2_smallest_limit_in_hierarchy_wins() {
        let f = Fixture::new("v2_min");
        f.v2("0::/a/b");
        f.write("cgroup/a/b/memory.max", "4294967296\n");
        f.write("cgroup/a/memory.max", "1073741824\n");
        f.write("cgroup/a/b/cpu.max", "400000 100000\n");
        f.write("cgroup/a/cpu.max", "100000 100000\n");
        assert_eq!(f.memory(), Some(GIB));
        assert_eq!(f.cpu(), Some(1.0));
    }

    #[test]
    fn v2_container_falls_back_to_root() {
        // In a container the path from /proc/self/cgroup does not exist in the mount.
        let f = Fixture::new("v2_container");
        f.v2("0::/kubepods/burstable/pod-x/container-y");
        f.write("cgroup/memory.max", "1073741824\n");
        f.write("cgroup/cpu.max", "150000 100000\n");
        assert_eq!(f.memory(), Some(GIB));
        assert_eq!(f.cpu(), Some(1.5));
    }

    #[test]
    fn v2_cpu_period_is_honoured() {
        let f = Fixture::new("v2_period");
        f.v2("0::/");
        f.write("cgroup/cpu.max", "100000 50000\n");
        assert_eq!(f.cpu(), Some(2.0));
    }

    #[test]
    fn v2_unlimited() {
        let f = Fixture::new("v2_unlimited");
        f.v2("0::/lab/box");
        f.write("cgroup/lab/box/memory.max", "max\n");
        f.write("cgroup/lab/box/cpu.max", "max 100000\n");
        assert_eq!(f.memory(), None);
        assert_eq!(f.cpu(), None);
    }

    #[test]
    fn v1_leaf_limit() {
        let f = Fixture::new("v1_leaf");
        f.v1("12:memory:/kubepods/pod1\n3:cpu,cpuacct:/kubepods/pod1\n");
        f.write(
            "cgroup/memory/kubepods/pod1/memory.limit_in_bytes",
            "1073741824\n",
        );
        f.write("cgroup/cpu/kubepods/pod1/cpu.cfs_quota_us", "200000\n");
        f.write("cgroup/cpu/kubepods/pod1/cpu.cfs_period_us", "100000\n");
        assert_eq!(f.memory(), Some(GIB));
        assert_eq!(f.cpu(), Some(2.0));
    }

    #[test]
    fn v1_limit_on_ancestor() {
        let f = Fixture::new("v1_ancestor");
        f.v1("12:memory:/kubepods/pod1\n3:cpu,cpuacct:/kubepods/pod1\n");
        f.write(
            "cgroup/memory/kubepods/pod1/memory.limit_in_bytes",
            "9223372036854771712\n",
        );
        f.write(
            "cgroup/memory/kubepods/memory.limit_in_bytes",
            "2147483648\n",
        );
        f.write("cgroup/cpu/kubepods/pod1/cpu.cfs_quota_us", "-1\n");
        f.write("cgroup/cpu/kubepods/pod1/cpu.cfs_period_us", "100000\n");
        f.write("cgroup/cpu/kubepods/cpu.cfs_quota_us", "50000\n");
        f.write("cgroup/cpu/kubepods/cpu.cfs_period_us", "100000\n");
        assert_eq!(f.memory(), Some(2 * GIB));
        assert_eq!(f.cpu(), Some(0.5));
    }

    #[test]
    fn v1_container_falls_back_to_controller_root() {
        let f = Fixture::new("v1_container");
        f.v1("12:memory:/docker/abc\n3:cpu,cpuacct:/docker/abc\n");
        f.write("cgroup/memory/memory.limit_in_bytes", "1073741824\n");
        f.write("cgroup/cpu/cpu.cfs_quota_us", "100000\n");
        f.write("cgroup/cpu/cpu.cfs_period_us", "100000\n");
        assert_eq!(f.memory(), Some(GIB));
        assert_eq!(f.cpu(), Some(1.0));
    }

    #[test]
    fn v1_unlimited() {
        let f = Fixture::new("v1_unlimited");
        f.v1("12:memory:/\n3:cpu,cpuacct:/\n");
        f.write(
            "cgroup/memory/memory.limit_in_bytes",
            "9223372036854771712\n",
        );
        f.write("cgroup/cpu/cpu.cfs_quota_us", "-1\n");
        f.write("cgroup/cpu/cpu.cfs_period_us", "100000\n");
        assert_eq!(f.memory(), None);
        assert_eq!(f.cpu(), None);
    }

    #[test]
    fn no_cgroup_mount() {
        let f = Fixture::new("none");
        std::fs::create_dir_all(f.root()).unwrap();
        assert_eq!(f.memory(), None);
        assert_eq!(f.cpu(), None);
    }

    #[test]
    fn cpu_count_rounds_down_to_at_least_one() {
        assert_eq!(cpu_count(0.5), 1);
        assert_eq!(cpu_count(1.0), 1);
        assert_eq!(cpu_count(1.9), 1);
        assert_eq!(cpu_count(2.0), 2);
    }

    #[test]
    fn test_get_cpu_limit_positive() {
        let limit = get_cpu_limit();
        assert!(limit > 0, "cpu limit should be at least 1");
    }

    #[test]
    fn test_get_memory_limit_positive() {
        let limit = get_memory_limit();
        assert!(limit > 0, "memory limit should be positive");
    }

    #[test]
    fn test_get_cpu_limit_less_than_unrealistic_number() {
        let limit = get_cpu_limit();
        assert!(
            limit < 100_000,
            "cpu limit should be a sane number of cores"
        );
    }
}
