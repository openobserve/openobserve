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

//! Alert tags — Feature 2 (PT-6, PT-7, PT-8).
//!
//! Tags are the **selection primitive**: normalized, validated, and used to
//! filter the alert list and (later) to scope composite membership and
//! muting. They are NOT `context_attributes` — that field is free-form KV
//! shipped into notification payloads, with no validation and a different
//! purpose. The two stay separate.
//!
//! Format: bare (`prod`) or `key:value` (`service:checkout`).
//!
//! **Unicode-aware (D22).** We have international users, so `café`,
//! `münchen` and `日本` are valid tags: a tag starts with a Unicode *letter*
//! and its body is Unicode alphanumerics plus `_ - . / :`.
//!
//! Normalization **repairs** rather than rejects wherever the intent is
//! unambiguous — case and surrounding whitespace are fixed silently, because
//! rejecting `Prod` would be a papercut with no upside. Anything that changes
//! meaning (illegal characters, a leading digit, over-length) is an error
//! that names the offending tag.
//!
//! **Deliberate divergence from Datadog (D22):** they silently rewrite
//! unsupported characters to `_`. We reject, because a silent rewrite changes
//! the tag's *selector identity* — a filter that used to match quietly stops
//! matching. Import-time normalization belongs in the importer, where a
//! transformation is expected and can be reported to the user.

use std::collections::HashSet;

/// Longest single tag, in **characters** (`chars().count()`), not bytes.
///
/// With Unicode tags (D22) the two differ — `日本語` is 3 characters but 9
/// bytes — so byte-length would silently impose a much shorter limit on
/// non-Latin scripts.
pub const MAX_TAG_LEN: usize = 200;

/// Most tags on one alert, measured on what would be STORED (i.e. after
/// de-duplication). Our own operational cap — unbounded tag lists are a
/// payload and UI hazard, and nothing legitimate needs more.
pub const MAX_TAGS: usize = 64;

/// Hard bound on the RAW input length, checked before any normalization.
///
/// [`MAX_TAGS`] is measured after de-duplication, which means a caller could
/// otherwise force unbounded lowercasing/validating work with a giant list of
/// duplicates before being rejected. Generous enough that no legitimate
/// request trips it.
pub const MAX_INPUT_TAGS: usize = MAX_TAGS * 10;

/// Why a tag list was rejected. Every variant carries the offending tag so
/// the API can tell the user exactly which one to fix (PT-7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TagError {
    /// Does not begin with a Unicode letter.
    MustStartWithLetter(String),
    /// Contains a character that is neither a Unicode alphanumeric nor one of
    /// `_ - . / :`.
    IllegalCharacter { tag: String, ch: char },
    /// Longer than [`MAX_TAG_LEN`] CHARACTERS (not bytes).
    TooLong { tag: String, len: usize },
    /// More than [`MAX_TAGS`] tags would be stored (counted AFTER
    /// de-duplication, so the number is what the user would end up with).
    TooMany(usize),
    /// The raw input exceeded [`MAX_INPUT_TAGS`] before normalization.
    TooManyRaw(usize),
}

impl std::fmt::Display for TagError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MustStartWithLetter(t) => {
                write!(f, "tag `{t}` must start with a letter")
            }
            Self::IllegalCharacter { tag, ch } => {
                write!(
                    f,
                    "tag `{tag}` contains an illegal character `{ch}`; allowed: letters, digits, and _ - . / :"
                )
            }
            Self::TooLong { tag, len } => {
                write!(
                    f,
                    "tag `{tag}` is {len} characters; the maximum is {MAX_TAG_LEN}"
                )
            }
            Self::TooMany(n) => {
                write!(f, "{n} distinct tags; the maximum is {MAX_TAGS} per alert")
            }
            Self::TooManyRaw(n) => {
                write!(
                    f,
                    "{n} tags supplied; refusing to process more than {MAX_INPUT_TAGS} entries"
                )
            }
        }
    }
}

impl std::error::Error for TagError {}

/// Normalize and validate a tag list for storage (PT-7).
///
/// Repairs silently: lowercases, trims surrounding whitespace, drops entries
/// that are empty once trimmed (a trailing comma in the UI is not an error),
/// and de-duplicates **after** normalization, keeping first-seen order so the
/// stored list is stable and predictable.
///
/// Errors on anything that would change meaning, naming the offending tag.
///
/// **Validation order is part of the contract** so error messages are stable:
///
/// 1. raw input bound ([`MAX_INPUT_TAGS`]) — cheapest, before any work;
/// 2. per tag, in order: trim → drop-if-empty → Unicode-lowercase → must-start-with-a-letter →
///    charset → character length. Structural problems are reported before length, because "you used
///    a `!`" is more actionable than "your 300-character string is too long";
/// 3. de-duplicate;
/// 4. stored-count cap ([`MAX_TAGS`]).
pub fn normalize_tags(tags: &[String]) -> Result<Vec<String>, TagError> {
    // 1. Raw bound first — before any per-entry work, so a duplicate-stuffed payload cannot force
    //    unbounded normalization (the MAX_TAGS cap is measured post-dedup and would be reached too
    //    late).
    if tags.len() > MAX_INPUT_TAGS {
        return Err(TagError::TooManyRaw(tags.len()));
    }

    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for raw in tags {
        // 2. Repairs that cannot change meaning.
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue; // separator artifact, not a user error
        }
        // Unicode lowercase, NOT full case folding: folding maps `ß` -> `ss`,
        // silently rewriting the user's tag and changing its selector
        // identity (D22).
        let tag = trimmed.to_lowercase();

        validate_tag(&tag)?;

        // 3. De-duplicate, first-seen order wins so storage is stable.
        if seen.insert(tag.clone()) {
            out.push(tag);
        }
    }

    // 4. Cap what would be STORED, so a list that only exceeds it before de-duplication still
    //    saves.
    if out.len() > MAX_TAGS {
        return Err(TagError::TooMany(out.len()));
    }
    Ok(out)
}

/// Per-tag rules, applied in the documented order: structural problems are
/// reported before length, because "you used a `!`" points at the real fix.
fn validate_tag(tag: &str) -> Result<(), TagError> {
    match tag.chars().next() {
        // Unicode letter (D22) — `café`, `münchen`, `日本` all qualify.
        Some(c) if c.is_alphabetic() => {}
        _ => return Err(TagError::MustStartWithLetter(tag.to_string())),
    }

    for ch in tag.chars() {
        // "Unicode" means letters and digits, not "any codepoint": symbols
        // and emoji stay illegal.
        if !(ch.is_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':')) {
            return Err(TagError::IllegalCharacter {
                tag: tag.to_string(),
                ch,
            });
        }
    }

    // CHARACTERS, not bytes — byte length would give non-Latin scripts a
    // fraction of the allowance.
    let len = tag.chars().count();
    if len > MAX_TAG_LEN {
        return Err(TagError::TooLong {
            tag: tag.to_string(),
            len,
        });
    }
    Ok(())
}

/// Normalize tags for a FILTER (`?tags=a,b`) — lenient counterpart of
/// [`normalize_tags`].
///
/// A filter must never 400. An unparseable or unknown tag simply matches
/// nothing, which is the honest answer to "show me alerts tagged `!!!`".
/// This applies the same case/whitespace repair so a user typing `Prod` in
/// the URL still matches the stored `prod` — the bug this exists to prevent
/// is a filter that silently returns zero rows because the caller forgot to
/// normalize.
///
/// **Invalid tokens are KEPT, never dropped.** Dropping them would be a
/// privilege-escalating bug rather than a nicety: `?tags=!!!` would normalize
/// to an EMPTY filter, and an empty filter matches *every* alert — so a
/// request that should return nothing would return everything. A preserved
/// `!!!` cannot match any stored tag (storage rejects that character), which
/// yields the correct empty result. Only blank entries — separator artifacts
/// from `?tags=a,,b` — are removed.
pub fn normalize_filter_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for raw in tags {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue; // `?tags=a,,b` — separator artifact
        }
        // NOTE: deliberately no `validate_tag` call. Keeping an invalid token
        // is what makes `?tags=!!!` match nothing instead of everything.
        let tag = trimmed.to_lowercase();
        if seen.insert(tag.clone()) {
            out.push(tag);
        }
    }
    out
}

/// AND semantics for the list filter (PT-8): every requested tag must be
/// present on the alert. An empty filter matches everything.
///
/// Both sides are expected to be normalized already — stored tags by
/// [`normalize_tags`] at save, the filter by [`normalize_filter_tags`] at
/// parse. This is a pure containment check.
pub fn matches_all_tags(alert_tags: &[String], filter: &[String]) -> bool {
    // AND: every requested tag must be present. Whole-token equality, never
    // substring — `service` must not match `service:checkout` (D20).
    filter
        .iter()
        .all(|wanted| alert_tags.iter().any(|have| have == wanted))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    // ── Accepted shapes ─────────────────────────────────────────────────────

    #[test]
    fn test_bare_and_key_value_tags_are_both_valid() {
        let out = normalize_tags(&v(&["prod", "service:checkout"])).unwrap();
        assert_eq!(out, v(&["prod", "service:checkout"]));
    }

    #[test]
    fn test_full_legal_punctuation_set_is_accepted() {
        // _ - . / : — all of it, in one tag.
        let tag = "web.server-01/prod:v2_x";
        let out = normalize_tags(&v(&[tag])).unwrap();
        assert_eq!(out, v(&[tag]));
    }

    // ── Unicode (D22) ───────────────────────────────────────────────────────

    /// We have international users: accented Latin, Cyrillic and CJK tags are
    /// first-class, not an edge case.
    #[test]
    fn test_unicode_letters_are_valid_tags() {
        for tag in ["café", "münchen", "日本", "team:москва", "ключ:значение"]
        {
            assert!(
                normalize_tags(&v(&[tag])).is_ok(),
                "`{tag}` must be a valid tag under D22"
            );
        }
    }

    #[test]
    fn test_unicode_tag_may_start_with_a_non_ascii_letter() {
        assert_eq!(
            normalize_tags(&v(&["日本:tokyo"])).unwrap(),
            v(&["日本:tokyo"])
        );
    }

    /// Case handling is Unicode-aware, so dedup works across scripts.
    #[test]
    fn test_unicode_case_is_lowercased_and_deduplicated() {
        let out = normalize_tags(&v(&["CAFÉ", "café", "Café"])).unwrap();
        assert_eq!(out, v(&["café"]), "one distinct tag after lowercasing");
    }

    /// Unicode **lowercasing**, deliberately NOT full case folding (D22).
    ///
    /// Full folding maps `ß` → `ss`, so `Straße` would be stored as
    /// `strasse` — silently rewriting what the user typed, which is exactly
    /// the selector-identity change D22 rejects. `CAFÉ`/`café` alone cannot
    /// tell the two policies apart; this case can.
    #[test]
    fn test_lowercasing_is_not_full_case_folding() {
        let sharp_s = normalize_tags(&v(&["Straße"])).unwrap();
        assert_eq!(sharp_s, v(&["straße"]), "ß must be preserved, not expanded");

        let expanded = normalize_tags(&v(&["STRASSE"])).unwrap();
        assert_eq!(expanded, v(&["strasse"]));

        assert_ne!(
            sharp_s, expanded,
            "these are DISTINCT tags; folding them together would rewrite the user's tag"
        );
    }

    /// Symbols and emoji are still illegal — "Unicode" means letters and
    /// digits, not "anything".
    #[test]
    fn test_unicode_does_not_mean_symbols_are_allowed() {
        for bad in ["emoji🔥", "a→b", "a✓"] {
            assert!(
                matches!(
                    normalize_tags(&v(&[bad])).unwrap_err(),
                    TagError::IllegalCharacter { .. }
                ),
                "`{bad}` must still be rejected"
            );
        }
    }

    /// The length limit counts CHARACTERS. Measured in bytes, a 200-character
    /// CJK tag would be ~600 and get rejected — silently giving non-Latin
    /// scripts a third of the allowance.
    #[test]
    fn test_length_limit_counts_characters_not_bytes() {
        let cjk = format!("日{}", "本".repeat(MAX_TAG_LEN - 1));
        assert_eq!(cjk.chars().count(), MAX_TAG_LEN);
        assert!(cjk.len() > MAX_TAG_LEN, "precondition: bytes exceed chars");
        assert!(
            normalize_tags(&v(&[&cjk])).is_ok(),
            "200 characters must pass regardless of byte length"
        );

        let over = format!("日{}", "本".repeat(MAX_TAG_LEN));
        match normalize_tags(&v(&[&over])).unwrap_err() {
            TagError::TooLong { len, .. } => {
                assert_eq!(len, MAX_TAG_LEN + 1, "len must be a CHARACTER count")
            }
            other => panic!("expected TooLong, got {other:?}"),
        }
    }

    #[test]
    fn test_empty_input_is_valid_and_yields_no_tags() {
        assert_eq!(normalize_tags(&[]).unwrap(), Vec::<String>::new());
    }

    // ── Silent repairs ──────────────────────────────────────────────────────

    #[test]
    fn test_case_is_normalized_rather_than_rejected() {
        let out = normalize_tags(&v(&["Prod", "SERVICE:Checkout"])).unwrap();
        assert_eq!(out, v(&["prod", "service:checkout"]));
    }

    #[test]
    fn test_surrounding_whitespace_is_trimmed() {
        let out = normalize_tags(&v(&["  prod  ", "\tenv:dev\n"])).unwrap();
        assert_eq!(out, v(&["prod", "env:dev"]));
    }

    /// A trailing comma in the tag input yields an empty entry; that is a UI
    /// artifact, not a user error.
    #[test]
    fn test_blank_entries_are_dropped_not_rejected() {
        let out = normalize_tags(&v(&["prod", "", "   ", "dev"])).unwrap();
        assert_eq!(out, v(&["prod", "dev"]));
    }

    #[test]
    fn test_duplicates_collapse_after_normalization_keeping_first_order() {
        let out = normalize_tags(&v(&["prod", "Prod", " PROD ", "dev", "prod"])).unwrap();
        assert_eq!(out, v(&["prod", "dev"]), "first-seen order must be stable");
    }

    // ── Rejections, each naming the offending tag ───────────────────────────

    #[test]
    fn test_tag_must_start_with_a_letter() {
        for bad in [
            "1prod", "_prod", ":prod", "-prod", ".prod", "/prod", "1日本", "٣test",
        ] {
            let err = normalize_tags(&v(&[bad])).unwrap_err();
            assert_eq!(err, TagError::MustStartWithLetter(bad.to_string()));
            assert!(
                err.to_string().contains(bad),
                "message must name the tag, got: {err}"
            );
        }
    }

    #[test]
    fn test_illegal_characters_are_rejected() {
        for bad in ["prod!", "a b", "emoji🔥", "a,b", "a=b", "a#b"] {
            let err = normalize_tags(&v(&[bad])).unwrap_err();
            match &err {
                TagError::IllegalCharacter { tag, .. } => assert_eq!(tag, bad),
                other => panic!("expected IllegalCharacter for `{bad}`, got {other:?}"),
            }
            assert!(err.to_string().contains(bad));
        }
    }

    /// A comma is the list separator in `?tags=a,b`; allowing it inside a tag
    /// would make the filter ambiguous.
    #[test]
    fn test_comma_is_illegal_because_it_separates_the_filter_list() {
        assert!(matches!(
            normalize_tags(&v(&["a,b"])).unwrap_err(),
            TagError::IllegalCharacter { .. }
        ));
    }

    #[test]
    fn test_length_boundary_is_inclusive() {
        let at_limit = format!("a{}", "b".repeat(MAX_TAG_LEN - 1));
        assert_eq!(at_limit.len(), MAX_TAG_LEN);
        assert!(normalize_tags(&v(&[&at_limit])).is_ok(), "200 chars is OK");

        let over = format!("a{}", "b".repeat(MAX_TAG_LEN));
        match normalize_tags(&v(&[&over])).unwrap_err() {
            TagError::TooLong { len, .. } => assert_eq!(len, MAX_TAG_LEN + 1),
            other => panic!("expected TooLong, got {other:?}"),
        }
    }

    #[test]
    fn test_tag_count_cap_is_inclusive() {
        let ok: Vec<String> = (0..MAX_TAGS).map(|i| format!("tag{i}")).collect();
        assert_eq!(normalize_tags(&ok).unwrap().len(), MAX_TAGS);

        // 70 raw entries that collapse to 65 distinct tags. Using 65 UNIQUE
        // inputs would leave the count ambiguous — input-count and stored-count
        // would both be 65, so the test would pass under either reading.
        let mut too_many: Vec<String> = (0..MAX_TAGS + 1).map(|i| format!("tag{i}")).collect();
        for i in 0..5 {
            too_many.push(format!("TAG{i}")); // duplicates after lowercasing
        }
        assert_eq!(too_many.len(), MAX_TAGS + 6);
        assert_eq!(
            normalize_tags(&too_many).unwrap_err(),
            TagError::TooMany(MAX_TAGS + 1),
            "the count must be what would be STORED (65), not what was sent (70)"
        );
    }

    /// The cap applies to what is STORED, so a list that only exceeds it
    /// before de-duplication must pass.
    #[test]
    fn test_cap_is_measured_after_deduplication() {
        let mut dupes: Vec<String> = (0..MAX_TAGS).map(|i| format!("tag{i}")).collect();
        dupes.push("tag0".to_string());
        dupes.push("TAG1".to_string());
        let out = normalize_tags(&dupes).expect("duplicates must not trip the cap");
        assert_eq!(out.len(), MAX_TAGS);
    }

    // ── Validation ORDER is part of the contract (defect #4) ────────────────

    /// A tag that is BOTH over-length and illegal must report the illegal
    /// character: "you used a `!`" is actionable, "your 300-char string is
    /// too long" sends the user to fix the wrong thing.
    #[test]
    fn test_structural_errors_are_reported_before_length() {
        let bad = format!("a{}!", "b".repeat(MAX_TAG_LEN));
        match normalize_tags(&v(&[&bad])).unwrap_err() {
            TagError::IllegalCharacter { ch, .. } => assert_eq!(ch, '!'),
            other => panic!("expected IllegalCharacter to win over TooLong, got {other:?}"),
        }
    }

    /// Leading-character is checked before charset, so `1a!` names the more
    /// fundamental problem rather than the incidental `!`.
    #[test]
    fn test_start_check_precedes_charset_check() {
        assert_eq!(
            normalize_tags(&v(&["1a!"])).unwrap_err(),
            TagError::MustStartWithLetter("1a!".to_string())
        );
    }

    /// An over-cap list containing an invalid tag reports the INVALID TAG:
    /// trimming the list would not make the bad tag legal.
    #[test]
    fn test_invalid_tag_is_reported_before_the_stored_count_cap() {
        let mut many: Vec<String> = (0..MAX_TAGS + 1).map(|i| format!("tag{i}")).collect();
        many.push("bad!".to_string());
        assert!(matches!(
            normalize_tags(&many).unwrap_err(),
            TagError::IllegalCharacter { .. }
        ));
    }

    /// ...but an absurd RAW payload is refused before any of that work.
    #[test]
    fn test_raw_input_bound_precedes_all_per_tag_work() {
        let huge: Vec<String> = (0..MAX_INPUT_TAGS + 1)
            .map(|_| "bad!".to_string())
            .collect();
        assert_eq!(
            normalize_tags(&huge).unwrap_err(),
            TagError::TooManyRaw(MAX_INPUT_TAGS + 1),
            "a giant payload must be refused before per-tag validation runs"
        );
    }

    #[test]
    fn test_raw_bound_is_inclusive_and_dedup_still_applies_under_it() {
        // MAX_INPUT_TAGS identical entries: passes the raw bound, dedupes to 1.
        let at_bound: Vec<String> = (0..MAX_INPUT_TAGS).map(|_| "prod".to_string()).collect();
        assert_eq!(normalize_tags(&at_bound).unwrap(), v(&["prod"]));
    }

    // ── Lenient filter parsing (defect #5) ──────────────────────────────────

    /// The filter path must never error — an unknown or malformed tag simply
    /// matches nothing.
    #[test]
    fn test_filter_parsing_is_lenient_where_saving_is_strict() {
        let out = normalize_filter_tags(&v(&["Prod", "  env:DEV  ", "", "!!!"]));
        // Case/whitespace repaired identically to the save path...
        assert!(out.contains(&"prod".to_string()));
        assert!(out.contains(&"env:dev".to_string()));
        // ...blanks dropped, and the malformed entry is NOT an error...
        assert!(!out.contains(&"".to_string()));
        // ...but the malformed entry is RETAINED as a token (see below).
        assert!(
            out.contains(&"!!!".to_string()),
            "invalid tokens must survive normalization, got {out:?}"
        );
    }

    /// REGRESSION GUARD for a privilege-escalating bug: if the filter parser
    /// DROPPED invalid tokens, `?tags=!!!` would become the empty filter —
    /// and the empty filter matches every alert. A request that must return
    /// nothing would instead return everything.
    #[test]
    fn test_invalid_only_filter_matches_nothing_not_everything() {
        let stored = normalize_tags(&v(&["prod", "service:checkout"])).unwrap();
        let filter = normalize_filter_tags(&v(&["!!!"]));
        assert!(
            !filter.is_empty(),
            "must not collapse to the match-all filter"
        );
        assert!(
            !matches_all_tags(&stored, &filter),
            "an invalid-only filter must match nothing"
        );
    }

    /// The AND semantics must also hold when one term is valid and one is not.
    #[test]
    fn test_mixed_valid_and_invalid_filter_matches_nothing() {
        let stored = normalize_tags(&v(&["prod"])).unwrap();
        let filter = normalize_filter_tags(&v(&["prod", "!!!"]));
        assert!(
            !matches_all_tags(&stored, &filter),
            "one unsatisfiable term must fail the whole AND filter"
        );
    }

    /// Blanks ARE dropped — `?tags=a,,b` is a separator artifact, not a
    /// request for a tag named "". An all-blank filter is "no filter".
    #[test]
    fn test_blank_only_filter_is_treated_as_no_filter() {
        let filter = normalize_filter_tags(&v(&["", "   ", ""]));
        assert!(filter.is_empty());
        assert!(matches_all_tags(&v(&["prod"]), &filter));
    }

    /// The bug this pairing exists to prevent: a user types `Prod` in the URL
    /// and gets zero rows because the stored form is `prod`.
    #[test]
    fn test_filter_normalization_makes_mixed_case_urls_match_stored_tags() {
        let stored = normalize_tags(&v(&["Prod", "Service:Checkout"])).unwrap();
        let filter = normalize_filter_tags(&v(&["PROD", "service:CHECKOUT"]));
        assert!(
            matches_all_tags(&stored, &filter),
            "stored {stored:?} should match filter {filter:?}"
        );
    }

    // ── Filtering (PT-8) ────────────────────────────────────────────────────

    #[test]
    fn test_filter_requires_every_tag_and_semantics() {
        let alert = v(&["prod", "service:checkout", "team:payments"]);
        assert!(matches_all_tags(&alert, &v(&["prod"])));
        assert!(matches_all_tags(&alert, &v(&["prod", "team:payments"])));
        // AND, not OR: one missing tag fails the whole filter.
        assert!(!matches_all_tags(&alert, &v(&["prod", "env:staging"])));
        assert!(!matches_all_tags(&alert, &v(&["nope"])));
    }

    #[test]
    fn test_empty_filter_matches_everything() {
        assert!(matches_all_tags(&v(&["prod"]), &[]));
        assert!(matches_all_tags(&[], &[]));
    }

    #[test]
    fn test_untagged_alert_matches_no_non_empty_filter() {
        assert!(!matches_all_tags(&[], &v(&["prod"])));
    }

    /// Tags are exact tokens, not substrings: `service:checkout` must not be
    /// matched by `service` or by `checkout`.
    #[test]
    fn test_filter_matches_whole_tags_not_substrings() {
        let alert = v(&["service:checkout"]);
        assert!(!matches_all_tags(&alert, &v(&["service"])));
        assert!(!matches_all_tags(&alert, &v(&["checkout"])));
        assert!(matches_all_tags(&alert, &v(&["service:checkout"])));
    }
}
