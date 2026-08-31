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

//! Public status pages. Only the unauthenticated read plane exists so far;
//! admin CRUD arrives with the working module.

pub mod admin;
pub mod public;

#[cfg(test)]
mod shell_tests {
    const SHELL: &str = include_str!("status_page.html");

    #[test]
    fn shell_has_the_password_unlock_form() {
        assert!(SHELL.contains(r#"type="password""#));
        assert!(SHELL.contains(r#"autocomplete="current-password""#));
        assert!(SHELL.contains(r#"role="alert""#));
        assert!(SHELL.contains("/auth\""));
        assert!(SHELL.contains("credentials: \"same-origin\""));
    }

    // A published page answers 202 until its first snapshot lands; the shell must not read that as
    // locked.
    #[test]
    fn shell_treats_a_202_as_building_not_locked() {
        assert!(SHELL.contains("r.status === 202"));
        assert!(SHELL.contains("Collecting first data"));
    }

    // CSP allows 'unsafe-inline', so nothing enforces this at runtime; this test is the XSS guard.
    #[test]
    fn shell_builds_dom_without_innerhtml_or_inline_handlers() {
        assert!(!SHELL.contains("innerHTML"));
        assert!(!SHELL.contains("outerHTML"));
        assert!(!SHELL.contains("insertAdjacentHTML"));
        let inline_handler = regex::Regex::new(r"\son[a-z]+=").unwrap();
        assert!(inline_handler.find(SHELL).is_none());
    }

    // `logo_img` is stored as a bare base64 payload with no MIME type (the uploader strips it), so
    // the shell must sniff a real type rather than emit the invalid type-less `data:image;base64,`.
    #[test]
    fn shell_never_emits_a_type_less_image_data_uri() {
        assert!(!SHELL.contains("data:image;base64,"));
    }

    // `none` is a truthy string, so the eyebrow must decode through a map rather than test the raw
    // value; otherwise visitors read `Incident \u{b7} partial_outage` and `Info \u{b7} none`.
    #[test]
    fn shell_decodes_notice_impact_instead_of_printing_the_raw_enum() {
        assert!(!SHELL.contains("String(n.impact)"));
        assert!(SHELL.contains("var IMPACT = {"));
        for label in ["Degraded", "Partial outage", "Major outage"] {
            assert!(SHELL.contains(label));
        }
    }

    // Impact `none` carries no information for a visitor; it must contribute no eyebrow segment.
    #[test]
    fn shell_impact_map_has_no_label_for_none() {
        let map = SHELL
            .split("var IMPACT = {")
            .nth(1)
            .and_then(|s| s.split("};").next())
            .expect("IMPACT map");
        assert!(!map.contains("none:"));
        assert!(map.contains("degraded:"));
        assert!(map.contains("partial_outage:"));
        assert!(map.contains("major_outage:"));
    }

    #[test]
    fn shell_sets_the_favicon_from_the_brand_image() {
        assert!(SHELL.contains(r#"rel="icon""#));
        assert!(SHELL.contains("faviconFrom"));
        assert!(SHELL.contains("data:image/svg+xml"));
    }
}
