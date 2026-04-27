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

pub struct DiskUsage {
    pub mount_point: String,
    pub total_space: u64,
    pub available_space: u64,
}

pub fn get_disk_usage() -> Vec<DiskUsage> {
    let mut disks: Vec<_> = sysinfo::Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskUsage {
            mount_point: d.mount_point().to_str().unwrap().to_string(),
            total_space: d.total_space(),
            available_space: d.available_space(),
        })
        .collect();
    disks.sort_by(|a, b| b.mount_point.cmp(&a.mount_point));
    disks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_disk_usage_returns_vec() {
        let disks = get_disk_usage();
        assert!(!disks.is_empty(), "should have at least one disk");
    }

    #[test]
    fn test_disk_usage_available_leq_total() {
        for disk in get_disk_usage() {
            assert!(
                disk.available_space <= disk.total_space,
                "available should not exceed total"
            );
        }
    }

    #[test]
    fn test_disk_usage_sorted_descending() {
        let disks = get_disk_usage();
        for i in 1..disks.len() {
            assert!(
                disks[i - 1].mount_point >= disks[i].mount_point,
                "disks should be sorted descending by mount point"
            );
        }
    }
}
