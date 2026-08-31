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

    // CSP allows 'unsafe-inline', so nothing enforces this at runtime; this test is the XSS guard.
    #[test]
    fn shell_builds_dom_without_innerhtml_or_inline_handlers() {
        assert!(!SHELL.contains("innerHTML"));
        assert!(!SHELL.contains("outerHTML"));
        assert!(!SHELL.contains("insertAdjacentHTML"));
        let inline_handler = regex::Regex::new(r"\son[a-z]+=").unwrap();
        assert!(inline_handler.find(SHELL).is_none());
    }
}
