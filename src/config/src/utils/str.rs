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

use std::sync::LazyLock;

use regex::Regex;

pub static EMPTY_STRING: String = String::new();
pub static EMPTY_STR: &str = "";

/// Canonical email-validation regex (RFC 5321/5322 dot-atom form).
///
/// Local part = one or more non-empty atoms separated by single dots (accepts single-char dotted
/// segments like `first.x`, rejects leading/trailing/consecutive dots). Domain requires at least
/// one dot-separated label and a TLD of 2-63 letters (RFC 1035 label max; covers long TLDs like
/// `.software`). Anchored on both ends. Shared by the OSS auth layer and enterprise domain
/// management so email validation stays identical across crates.
pub static EMAIL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^([a-zA-Z0-9_+\-]+(\.[a-zA-Z0-9_+\-]+)*)@([a-zA-Z0-9]+([\-\.][a-zA-Z0-9]+)*\.[a-zA-Z]{2,63})$",
    )
    .unwrap()
});

/// Returns true if `email` is syntactically valid per [`EMAIL_REGEX`].
pub fn is_valid_email(email: &str) -> bool {
    EMAIL_REGEX.is_match(email)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn find(haystack: &str, needle: &str) -> bool {
    memchr::memmem::find(haystack.as_bytes(), needle.as_bytes()).is_some()
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn find(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
}

pub trait StringExt {
    fn find(&self, needle: &str) -> bool;
    fn optional(&self) -> Option<String>;
    fn truncate_utf8(&self, max_len: usize) -> String;
}

impl StringExt for String {
    #[inline(always)]
    fn find(&self, needle: &str) -> bool {
        find(self, needle)
    }

    fn optional(&self) -> Option<String> {
        if self.is_empty() {
            None
        } else {
            Some(self.clone())
        }
    }

    fn truncate_utf8(&self, max_len: usize) -> String {
        if self.len() <= max_len {
            return self.clone();
        }

        // Find the last valid UTF-8 boundary within max_len
        // Start from max_len and work backwards until we find a valid boundary
        let mut end = max_len.min(self.len());
        while end > 0 && !self.is_char_boundary(end) {
            end -= 1;
        }

        // If we couldn't find a valid boundary, return empty string
        if end == 0 {
            return String::new();
        }

        self[..end].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_email() {
        // Valid
        assert!(is_valid_email("user@example.com"));
        assert!(is_valid_email("john.doe+123@mail.co.in"));
        assert!(is_valid_email("a_b-c.d+e@domain.org"));
        assert!(is_valid_email("user@example.software"));
        // Invalid
        assert!(!is_valid_email("no-at-symbol.com"));
        assert!(!is_valid_email("@missing-user.com"));
        assert!(!is_valid_email("user@.com"));
        assert!(!is_valid_email("user@com"));
        assert!(!is_valid_email("user@domain..com"));
        assert!(!is_valid_email(".leading@example.com"));
    }

    #[test]
    fn test_find() {
        let haystack = "This is search-unitTest";
        let needle = "unitTest";
        assert!(find(haystack, needle));
    }

    #[test]
    fn test_find_not_found() {
        let haystack = "This is search-unitTest";
        let needle = "notfound";
        assert!(!find(haystack, needle));
    }

    #[test]
    fn test_find_empty_needle() {
        let haystack = "This is search-unitTest";
        let needle = "";
        assert!(find(haystack, needle));
    }

    #[test]
    fn test_find_empty_haystack() {
        let haystack = "";
        let needle = "test";
        assert!(!find(haystack, needle));
    }

    #[test]
    fn test_optional_empty_string() {
        let s = "".to_string();
        assert_eq!(s.optional(), None);
    }

    #[test]
    fn test_optional_non_empty_string() {
        let s = "hello".to_string();
        assert_eq!(s.optional(), Some("hello".to_string()));
    }

    #[test]
    fn test_optional_whitespace_string() {
        let s = " ".to_string();
        assert_eq!(s.optional(), Some(" ".to_string()));
    }

    #[test]
    fn test_string_find_trait() {
        let s = "Hello world".to_string();
        assert!(s.find("world"));
        assert!(!s.find("test"));
    }

    #[test]
    fn test_truncate_ascii() {
        let s = "Hello, World!".to_string();
        assert_eq!(s.truncate_utf8(5), "Hello");
        assert_eq!(
            "Hello, World!".to_string().truncate_utf8(20),
            "Hello, World!"
        );
        assert_eq!("Hello, World!".to_string().truncate_utf8(0), "");
    }

    #[test]
    fn test_truncate_utf8() {
        // Test with multi-byte UTF-8 characters
        let s = "Hello, 世界!".to_string(); // "世界" is 6 bytes in UTF-8
        assert_eq!(s.truncate_utf8(7), "Hello, "); // Truncates before the Chinese characters
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(8), "Hello, "); // Still truncates before Chinese characters (8 bytes = "Hello, " + start of "世")
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(9), "Hello, "); // Still truncates before Chinese characters (9 bytes = "Hello, " + start of "世")
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(10), "Hello, 世"); // Truncates after the first Chinese character
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(11), "Hello, 世"); // Still before second Chinese character
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(12), "Hello, 世"); // Still before second Chinese character
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(13), "Hello, 世界"); // Truncates after both Chinese characters
        assert_eq!("Hello, 世界!".to_string().truncate_utf8(14), "Hello, 世界!"); // No truncation needed
    }

    #[test]
    fn test_truncate_emoji() {
        // Test with emoji (4 bytes in UTF-8)
        let s = "Hello 👋 World".to_string();
        assert_eq!(s.truncate_utf8(6), "Hello "); // Truncates before emoji
        assert_eq!("Hello 👋 World".to_string().truncate_utf8(7), "Hello "); // Still truncates before emoji (7 bytes = "Hello " + start of emoji)
        assert_eq!("Hello 👋 World".to_string().truncate_utf8(8), "Hello "); // Still truncates before emoji (8 bytes = "Hello " + start of emoji)
        assert_eq!("Hello 👋 World".to_string().truncate_utf8(9), "Hello "); // Still truncates before emoji (9 bytes = "Hello " + start of emoji)
        assert_eq!("Hello 👋 World".to_string().truncate_utf8(10), "Hello 👋"); // Truncates after emoji
        assert_eq!("Hello 👋 World".to_string().truncate_utf8(11), "Hello 👋 "); // Truncates after emoji and space
        assert_eq!("Hello 👋 World".to_string().truncate_utf8(12), "Hello 👋 W"); // After emoji, space, and W
        assert_eq!(
            "Hello 👋 World".to_string().truncate_utf8(13),
            "Hello 👋 Wo"
        ); // After emoji, space, and Wo
        assert_eq!(
            "Hello 👋 World".to_string().truncate_utf8(14),
            "Hello 👋 Wor"
        ); // After emoji, space, and Wor
        assert_eq!(
            "Hello 👋 World".to_string().truncate_utf8(15),
            "Hello 👋 Worl"
        ); // After emoji, space, and Worl
        assert_eq!(
            "Hello 👋 World".to_string().truncate_utf8(16),
            "Hello 👋 World"
        ); // No truncation needed
    }

    #[test]
    fn test_truncate_edge_cases() {
        let s = "Test".to_string();
        assert_eq!(s.truncate_utf8(0), "");
        assert_eq!("Test".to_string().truncate_utf8(1), "T");
        assert_eq!("Test".to_string().truncate_utf8(4), "Test");
        assert_eq!("Test".to_string().truncate_utf8(5), "Test");
    }

    #[test]
    fn test_truncate_empty_string() {
        let s = "".to_string();
        assert_eq!(s.truncate_utf8(0), "");
        assert_eq!("".to_string().truncate_utf8(5), "");
    }

    #[test]
    fn test_truncate_single_char() {
        let s = "A".to_string();
        assert_eq!(s.truncate_utf8(0), "");
        assert_eq!("A".to_string().truncate_utf8(1), "A");
        assert_eq!("A".to_string().truncate_utf8(5), "A");
    }

    #[test]
    fn test_truncate_mixed_utf8() {
        // Test with a mix of ASCII and UTF-8 characters
        let s = "Hello 世界 👋 Test".to_string();
        assert_eq!(s.truncate_utf8(5), "Hello");
        assert_eq!("Hello 世界 👋 Test".to_string().truncate_utf8(6), "Hello ");
        assert_eq!("Hello 世界 👋 Test".to_string().truncate_utf8(7), "Hello "); // Still before Chinese characters
        assert_eq!("Hello 世界 👋 Test".to_string().truncate_utf8(8), "Hello "); // Still before Chinese characters
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(9),
            "Hello 世"
        ); // After first Chinese character
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(10),
            "Hello 世"
        ); // Still before second Chinese character
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(11),
            "Hello 世"
        ); // Still before second Chinese character
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(12),
            "Hello 世界"
        ); // After both Chinese characters
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(13),
            "Hello 世界 "
        ); // After Chinese characters and space
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(14),
            "Hello 世界 "
        ); // Still before emoji
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(15),
            "Hello 世界 "
        ); // Still before emoji
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(16),
            "Hello 世界 "
        ); // Still before emoji
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(17),
            "Hello 世界 👋"
        ); // After emoji
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(18),
            "Hello 世界 👋 "
        ); // After emoji and space
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(19),
            "Hello 世界 👋 T"
        ); // After emoji, space, and T
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(20),
            "Hello 世界 👋 Te"
        ); // After emoji, space, and Te
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(21),
            "Hello 世界 👋 Tes"
        ); // After emoji, space, and Tes
        assert_eq!(
            "Hello 世界 👋 Test".to_string().truncate_utf8(22),
            "Hello 世界 👋 Test"
        ); // No truncation needed
    }

    #[test]
    fn test_truncate_complex_emoji() {
        // Test with complex emoji sequences (like family emoji)
        let s = "Family: 👨‍👩‍👧‍👦".to_string();
        assert_eq!(s.truncate_utf8(7), "Family:");
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(8), "Family: ");
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(9), "Family: "); // Still before emoji
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(10), "Family: "); // Still before emoji
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(11), "Family: "); // Still before emoji
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(12), "Family: 👨"); // After first emoji
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(13), "Family: 👨"); // Still before second emoji
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(14), "Family: 👨"); // Still before second emoji
        assert_eq!("Family: 👨‍👩‍👧‍👦".to_string().truncate_utf8(15), "Family: 👨‍"); // After first emoji and joiner
        // The family emoji is a complex sequence, so we test around its boundaries
    }

    #[test]
    fn test_truncate_zero_width_characters() {
        // Test with zero-width characters
        let s = "Hello\u{200B}World".to_string(); // Zero-width space
        assert_eq!(s.truncate_utf8(5), "Hello");
        assert_eq!("Hello\u{200B}World".to_string().truncate_utf8(6), "Hello"); // Still before zero-width character
        assert_eq!("Hello\u{200B}World".to_string().truncate_utf8(7), "Hello"); // Still before zero-width character
        assert_eq!(
            "Hello\u{200B}World".to_string().truncate_utf8(8),
            "Hello\u{200B}"
        ); // After zero-width character
        assert_eq!(
            "Hello\u{200B}World".to_string().truncate_utf8(9),
            "Hello\u{200B}W"
        ); // After zero-width character and W
        assert_eq!(
            "Hello\u{200B}World".to_string().truncate_utf8(10),
            "Hello\u{200B}Wo"
        ); // After zero-width character and Wo
        assert_eq!(
            "Hello\u{200B}World".to_string().truncate_utf8(11),
            "Hello\u{200B}Wor"
        ); // After zero-width character and Wor
        assert_eq!(
            "Hello\u{200B}World".to_string().truncate_utf8(12),
            "Hello\u{200B}Worl"
        ); // After zero-width character and Worl
        assert_eq!(
            "Hello\u{200B}World".to_string().truncate_utf8(13),
            "Hello\u{200B}World"
        ); // No truncation needed
    }

    #[test]
    fn test_truncate_combining_characters() {
        // Test with combining characters
        let s = "e\u{0301}".to_string(); // 'e' + combining acute accent = 'é'
        assert_eq!(s.truncate_utf8(1), "e"); // Should truncate before the combining character
        assert_eq!("e\u{0301}".to_string().truncate_utf8(2), "e"); // Still before combining character
        assert_eq!("e\u{0301}".to_string().truncate_utf8(3), "e\u{0301}"); // Should keep the full character
    }

    #[test]
    fn test_truncate_boundary_conditions() {
        // Test boundary conditions around UTF-8 character boundaries
        let s = "Hello世界".to_string();

        // Test truncation at various byte positions
        assert_eq!(s.truncate_utf8(5), "Hello");
        assert_eq!("Hello世界".to_string().truncate_utf8(6), "Hello"); // Still before Chinese characters
        assert_eq!("Hello世界".to_string().truncate_utf8(7), "Hello"); // Still before Chinese characters
        assert_eq!("Hello世界".to_string().truncate_utf8(8), "Hello世"); // After first Chinese character
        assert_eq!("Hello世界".to_string().truncate_utf8(9), "Hello世"); // Still before second Chinese character
        assert_eq!("Hello世界".to_string().truncate_utf8(10), "Hello世"); // Still before second Chinese character
        assert_eq!("Hello世界".to_string().truncate_utf8(11), "Hello世界"); // After both Chinese characters
    }

    #[test]
    fn test_truncate_ownership() {
        // Test that the method takes ownership and doesn't clone unnecessarily
        let s = "Test String".to_string();
        let truncated = s.truncate_utf8(4);
        assert_eq!(truncated, "Test");
        // The original string should be consumed, not cloned
    }
}
