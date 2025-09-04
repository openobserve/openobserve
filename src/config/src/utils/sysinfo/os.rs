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

pub fn get_os_name() -> String {
    sysinfo::System::name().unwrap_or("unknown".to_string())
}

pub fn get_os_version() -> String {
    sysinfo::System::os_version().unwrap_or("unknown".to_string())
}

pub fn get_hostname() -> String {
    sysinfo::System::host_name().unwrap_or("unknown".to_string())
}

#[cfg(target_os = "linux")]
pub fn get_open_fds() -> usize {
    match std::fs::read_dir("/proc/self/fd") {
        Ok(entries) => entries.count(),
        Err(e) => {
            log::warn!("Failed to read open file descriptors: {e}");
            0
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn get_open_fds() -> usize {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_os_name() {
        let os_name = get_os_name();
        assert!(!os_name.is_empty());
        assert_ne!(os_name, "unknown");
    }

    #[test]
    fn test_get_os_version() {
        let os_version = get_os_version();
        assert!(!os_version.is_empty());
        assert_ne!(os_version, "unknown");
    }

    #[test]
    fn test_get_hostname() {
        let hostname = get_hostname();
        assert!(!hostname.is_empty());
        assert_ne!(hostname, "unknown");
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_get_open_fds() {
        let open_fds = get_open_fds();
        assert!(open_fds > 0);
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn test_get_open_fds() {
        let open_fds = get_open_fds();
        assert_eq!(open_fds, 0);
    }
}
