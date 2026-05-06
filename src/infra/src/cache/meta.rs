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

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ResultCacheMeta {
    pub start_time: i64,
    pub end_time: i64,
    pub is_aggregate: bool,
    pub is_descending: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_result_cache_meta_fields() {
        let m = ResultCacheMeta {
            start_time: 1000,
            end_time: 2000,
            is_aggregate: true,
            is_descending: false,
        };
        assert_eq!(m.start_time, 1000);
        assert_eq!(m.end_time, 2000);
        assert!(m.is_aggregate);
        assert!(!m.is_descending);
    }

    #[test]
    fn test_result_cache_meta_clone() {
        let m = ResultCacheMeta {
            start_time: 10,
            end_time: 20,
            is_aggregate: false,
            is_descending: true,
        };
        let c = m.clone();
        assert_eq!(c, m);
    }

    #[test]
    fn test_result_cache_meta_eq() {
        let a = ResultCacheMeta {
            start_time: 0,
            end_time: 0,
            is_aggregate: false,
            is_descending: false,
        };
        let b = a.clone();
        assert_eq!(a, b);
    }
}
