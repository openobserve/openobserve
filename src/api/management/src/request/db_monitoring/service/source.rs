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

//! The DBM read layer's own source, as one string, for the structural tests.
//!
//! Several invariants in this feature are asserted over the SOURCE rather than
//! over behaviour, because what they assert is a wiring property no
//! unit-testable call can observe — a gate that must run BEFORE a read, a
//! search that must hand its response to the partial guard. Those assertions
//! predate the handler/service/model split, when all of it was one file and a
//! single `include_str!("api.rs")` saw everything.
//!
//! The split moved the code, not the invariants. A handler and the body it
//! delegates to now live in two files, and a test asserting "the handler is
//! thin AND the body is extracted" has to see both. Concatenating the layers
//! back into one corpus is what preserves that: the scrapes read the same bytes
//! they always did, and a fn that moves BETWEEN layers stays visible rather
//! than silently vanishing from a scrape and passing on its absence.

/// Every source file the structural scrapes read, in corpus order.
///
/// ══ THE ORDER IS LOAD-BEARING — DO NOT REORDER ═════════════════════════
///
/// The service layer is no longer one file, so the corpus concatenates N of
/// them and the order is part of the contract:
///
/// 1. `../models.rs` — the `*Query` structs FIRST, because every layer below refers to them and a
///    scrape bounding on a struct wants it up front;
/// 2. the feature modules, in the order [`super`] declares them — `common.rs` first, since
///    everything else builds on it, then one file per endpoint family;
/// 3. `../handler.rs` — LAST, unconditionally.
///
/// Why handlers LAST: `test_samples_body_is_extracted_from_the_handler` bounds
/// the handler's text by splitting on the doc comment that FOLLOWS it in the
/// corpus. That worked when handlers were its tail and it still must, so no
/// layer may ever be appended after them.
///
/// Why `common.rs` first among the features: the scrapes that walk forward from
/// a definition to its callers (`endpoint_impl`, `samples_body_src`) assume a
/// definition precedes its uses in the corpus text.
///
/// A file appears exactly ONCE. Listing one twice would double every
/// `match_indices` count, and
/// `test_every_dbm_search_routes_through_the_partial_guard` asserts an EXACT
/// total — a duplicated layer would read as new unguarded searches.
///
/// Adding a feature module means adding it here, in its `mod` order, and never
/// after the handler entry.
#[cfg(test)]
const LAYERS: &[&str] = &[
    include_str!("../models.rs"),
    include_str!("common.rs"),
    include_str!("query_history.rs"),
    include_str!("queries.rs"),
    include_str!("endpoints.rs"),
    include_str!("samples.rs"),
    include_str!("databases.rs"),
    include_str!("deadlocks.rs"),
    include_str!("blocking.rs"),
    include_str!("activity.rs"),
    include_str!("plans.rs"),
    include_str!("server_metrics.rs"),
    include_str!("server_queries.rs"),
    include_str!("server_samples.rs"),
    include_str!("insights.rs"),
    include_str!("table_health.rs"),
    include_str!("instances.rs"),
    include_str!("badges.rs"),
    include_str!("instance_metrics.rs"),
    include_str!("../handler.rs"),
];

/// One layer's source with its `#[cfg(test)]` modules cut off.
///
/// The scrapes want PRODUCTION code only — a test that mentions
/// `can_read_stream(` must not satisfy an assertion about where the real gate
/// is called. In the single-file era one `split("\nmod tests {")` did that,
/// because the tests were the tail of the only file. Across N files a
/// whole-corpus truncation would instead discard every layer appended after the
/// first one that happens to carry tests, so the cut is made PER LAYER and the
/// surviving production halves are rejoined.
#[cfg(test)]
pub(crate) fn prod_half(layer: &'static str) -> &'static str {
    // Both spellings the files use: an attributed module and a bare one.
    let cut = layer
        .find("\n#[cfg(test)]\nmod tests")
        .or_else(|| layer.find("\nmod tests {"))
        .unwrap_or(layer.len());
    &layer[..cut]
}

/// The whole corpus, layers joined in [`LAYERS`] order.
///
/// Returns `&'static str`, not `String`: the scrapes slice into this corpus and
/// hand the slices back out (`samples_body_src`), which a temporary `String`
/// could not outlive. Built once, on first use.
// Unused today — `dbm_prod_source` is what every scrape reads. Kept because
// it is the un-stripped counterpart that defines the corpus, and a future
// scrape wanting test text as well as production text needs exactly this.
#[allow(dead_code)]
#[cfg(test)]
pub(crate) fn dbm_source() -> &'static str {
    static SRC: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SRC.get_or_init(|| LAYERS.join("\n"))
}

/// [`dbm_source`] with every layer's test modules stripped.
///
/// This is what the structural scrapes read. The same layers in the same order,
/// so byte offsets inside a layer are unchanged; only the test tails are gone,
/// which is exactly what the old `split("\nmod tests {")` achieved when there
/// was one file to split.
#[cfg(test)]
pub(crate) fn dbm_prod_source() -> &'static str {
    static SRC: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SRC.get_or_init(|| {
        LAYERS
            .iter()
            .map(|layer| prod_half(layer))
            .collect::<Vec<_>>()
            .join("\n")
    })
}
