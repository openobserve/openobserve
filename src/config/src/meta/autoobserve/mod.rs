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

pub mod marks;

/// The AutoObserve engine's kv namespace; the generic `/kv` handler cannot read or write it.
pub const KV_PREFIX: &str = "_o2_ao/";
/// Grouped by alert, so deleting an alert lists one prefix (P4-D1).
pub const DISMISSAL_PREFIX: &str = "_o2_ao/dismissal/";
pub const KV_MARK_PREFIX: &str = "_o2_ao/mark/";
pub const KV_SUGGESTION_PREFIX: &str = "_o2_ao/suggestion/";
/// Every engine stream starts with this (ENT `autoobserve::names`), so it is the writer's scope.
pub const AUTOOBSERVE_STREAM_PREFIX: &str = "_o2_autoobserve_";

/// Whether a user-supplied kv key could land in the reserved namespace, however it is encoded.
pub fn is_reserved_kv_key(key: &str) -> bool {
    let mut decoded = key.to_string();
    // Each decode that changes the key shortens it, so this ends.
    while let Ok(next) = urlencoding::decode(&decoded) {
        if next == decoded {
            break;
        }
        decoded = next.into_owned();
    }
    let rest = decoded.trim_start_matches(|c: char| c == '/' || c.is_whitespace());
    rest.get(..KV_PREFIX.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(KV_PREFIX))
}

pub fn suggestion_key(id: &str) -> String {
    format!("{KV_SUGGESTION_PREFIX}{id}")
}

pub fn dismissal_alert_prefix(alert_id: &str) -> String {
    format!("{DISMISSAL_PREFIX}{alert_id}/")
}

pub fn dismissal_key(alert_id: &str, finding_id: &str) -> String {
    format!("{}{finding_id}", dismissal_alert_prefix(alert_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_keys_are_reserved() {
        assert!(is_reserved_kv_key(KV_PREFIX));
        assert!(is_reserved_kv_key(&marks::protected_key("a1", "g")));
        assert!(is_reserved_kv_key(&suggestion_key("s1")));
        assert_eq!(suggestion_key("s1"), "_o2_ao/suggestion/s1");
    }

    #[test]
    fn dismissal_keys_are_reserved_and_grouped_by_alert() {
        let key = dismissal_key("a1", "f1");
        assert_eq!(key, "_o2_ao/dismissal/a1/f1");
        assert!(is_reserved_kv_key(&key));
        assert!(key.starts_with(&dismissal_alert_prefix("a1")));
        assert!(!dismissal_key("a10", "f1").starts_with(&dismissal_alert_prefix("a1")));
    }

    #[test]
    fn disguised_engine_keys_are_reserved() {
        for key in [
            "_O2_AO/mark/protected/alert/a1/g-0",
            "_o2_Ao/x",
            "/_o2_ao/mark/x",
            "///_o2_ao/mark/x",
            "  _o2_ao/mark/x  ",
            "\t/ _o2_ao/x",
            "_o2_ao%2Fmark%2Fx",
            "_o2_ao%2fmark",
            "%5Fo2_ao/mark",
            "%2F_o2_ao/mark",
            "%20_o2_ao/mark",
            "_o2_ao%252Fmark",
            "%25255Fo2%25255Fao%25252F",
        ] {
            assert!(is_reserved_kv_key(key), "{key:?} slipped past the guard");
        }
    }

    #[test]
    fn ordinary_keys_are_not_reserved() {
        for key in [
            "",
            "/",
            "_o2_ao",
            "_o2_aox/mark",
            "o2_ao/mark",
            "x_o2_ao/mark",
            "my/_o2_ao/mark",
            "dashboard/settings",
            "%",
            "%E0%A4%A",
            "100%",
            "_o2_\u{e5}o/mark",
        ] {
            assert!(!is_reserved_kv_key(key), "{key:?} was refused");
        }
    }
}
