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

use std::sync::LazyLock as Lazy;

use config::RwHashSet;

static STREAMS: Lazy<RwHashSet<String>> = Lazy::new(Default::default);

pub fn is_running(stream: &str) -> bool {
    STREAMS.contains(stream)
}

pub fn set_running(stream: &str) {
    STREAMS.insert(stream.to_string());
}

pub fn clear_running(stream: &str) {
    STREAMS.remove(stream);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_running_returns_false_for_unknown_stream() {
        assert!(!is_running("compact_test_unknown_xyz_12345"));
    }

    #[test]
    fn test_set_running_makes_stream_active() {
        let stream = "compact_test_set_running_abc_99";
        assert!(!is_running(stream));
        set_running(stream);
        assert!(is_running(stream));
        clear_running(stream);
    }

    #[test]
    fn test_clear_running_removes_stream() {
        let stream = "compact_test_clear_running_def_88";
        set_running(stream);
        assert!(is_running(stream));
        clear_running(stream);
        assert!(!is_running(stream));
    }
}
