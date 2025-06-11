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

/// Convert bytes to human readable format
pub fn bytes_to_human_readable(bytes: f64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    let mut bytes = bytes;
    let mut index = 0;

    if bytes == 0.0 {
        return "0 B".to_string();
    }

    while bytes >= 1024.0 && index < units.len() - 1 {
        bytes /= 1024.0;
        index += 1;
    }

    format!("{:.2} {}", bytes, units[index])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bytes_to_human_readable_zero() {
        assert_eq!(bytes_to_human_readable(0.0), "0 B");
    }

    #[test]
    fn test_bytes_to_human_readable_bytes() {
        assert_eq!(bytes_to_human_readable(500.0), "500.00 B");
        assert_eq!(bytes_to_human_readable(1023.0), "1023.00 B");
    }

    #[test]
    fn test_bytes_to_human_readable_kilobytes() {
        assert_eq!(bytes_to_human_readable(1024.0), "1.00 KB");
        assert_eq!(bytes_to_human_readable(1536.0), "1.50 KB");
        assert_eq!(bytes_to_human_readable(1024.0 * 1023.0), "1023.00 KB");
    }

    #[test]
    fn test_bytes_to_human_readable_megabytes() {
        assert_eq!(bytes_to_human_readable(1024.0 * 1024.0), "1.00 MB");
        assert_eq!(bytes_to_human_readable(1024.0 * 1024.0 * 1.5), "1.50 MB");
    }

    #[test]
    fn test_bytes_to_human_readable_gigabytes() {
        assert_eq!(bytes_to_human_readable(1024.0 * 1024.0 * 1024.0), "1.00 GB");
        assert_eq!(
            bytes_to_human_readable(1024.0 * 1024.0 * 1024.0 * 2.5),
            "2.50 GB"
        );
    }

    #[test]
    fn test_bytes_to_human_readable_large_values() {
        assert_eq!(
            bytes_to_human_readable(1024.0 * 1024.0 * 1024.0 * 1024.0),
            "1.00 TB"
        );
        assert_eq!(
            bytes_to_human_readable(1024.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0),
            "1.00 PB"
        );
    }

    #[test]
    fn test_bytes_to_human_readable_decimal_precision() {
        assert_eq!(bytes_to_human_readable(1024.0 * 1.234), "1.23 KB");
        assert_eq!(bytes_to_human_readable(1024.0 * 1024.0 * 1.234), "1.23 MB");
    }
}
