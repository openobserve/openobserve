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

//! Test helpers shared by more than one feature module's tests.
//!
//! Everything here was a private helper inside the single `mod tests` that the
//! service layer used to carry. Splitting that module per feature left six
//! helpers with callers in more than one of the new modules, and a helper may
//! not be duplicated into each — two copies drift, and a scrape asserting on
//! "the" helper would then assert on whichever copy it happened to find.
//!
//! So they live here once, `pub(super)`, and each feature module's `mod tests`
//! reaches them with `use super::super::testutil::*`. A helper used by exactly
//! ONE feature stays in that feature's own `mod tests` — only genuinely shared
//! ones belong in this file.

use super::*;

/// Every canonical column present — the schema-complete case. Builders are
/// pure, so the schema lookup itself is exercised at the handler level.
pub(super) fn all_cols() -> HashSet<String> {
    server_vantage::ALL_DBM_FIELDS
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// Bundle the two projection halves the builder takes, for a DEADLOCKS read.
pub(super) fn proj<'a>(
    present: &'a HashSet<String>,
    raw: Option<&'a RawDeadlockFallback>,
) -> DbmProjection<'a> {
    DbmProjection {
        present,
        raw: raw.map(RawProjection::Deadlock),
    }
}

/// A stream schema with exactly these fields, for the presence gates.
///
/// Types are irrelevant to the gates — they only ever ask whether a name
/// resolves — so everything is a nullable Utf8. Nullable deliberately: the
/// one column DataFusion cannot null-fill is a NON-nullable missing one, and
/// nothing the projection may name is allowed to be that.
#[cfg(feature = "enterprise")]
pub(super) fn schema_of(fields: &[&str]) -> arrow_schema::Schema {
    arrow_schema::Schema::new(
        fields
            .iter()
            .map(|f| arrow_schema::Field::new(*f, arrow_schema::DataType::Utf8, true))
            .collect::<Vec<_>>(),
    )
}

/// Prove one read gates on the vantage it belongs to.
///
/// Still a source assertion, because it cannot be a behavioural one:
/// `can_read_stream` is unconditionally permissive on OSS (see
/// `can_read_stream_is_permissive_on_oss`), so no OSS-observable response
/// distinguishes a Logs check from a Traces one. What CHANGED is how much
/// this has to scrape — the stream-type rule is asserted for real in
/// `test_required_stream_matches_the_vantage`, leaving this to check only
/// that the named function exists, contains a gate, and names the right
/// vantage at it.
///
/// The guards are the point: a moved or renamed function fails LOUDLY here
/// (not found, or found but trivial) rather than silently scraping a
/// neighbour and passing on its gate.
pub(super) fn assert_gates_on_vantage(fn_name: &str, vantage: DbmVantage) {
    let src = dbm_prod_source();
    let code = src;
    let start = code
        .find(&format!("async fn {fn_name}"))
        .unwrap_or_else(|| panic!("{fn_name} must exist — a renamed fn must fail, not pass"));
    let body = code[start..]
        .split("\n}\n")
        .next()
        .unwrap_or_else(|| panic!("{fn_name} must have a body"));

    // Guard: the scrape found a REAL function body, not a stub or the tail
    // of a doc comment. Every read gated here parses a range and reads a
    // stream, so both landmarks must be present.
    assert!(
        body.len() > 300,
        "{fn_name}'s scraped body is {} bytes — too short to be the real \
         function; the scrape is pointing at the wrong place",
        body.len()
    );
    assert!(
        body.contains("resolve_range(") || body.contains("start_time"),
        "{fn_name}'s scraped body carries no window handling — the scrape \
         is pointing at the wrong function"
    );

    let call = body
        .find("can_read_stream(")
        .unwrap_or_else(|| panic!("{fn_name} must check read permission at all"));
    let args = &body[call..body.len().min(call + 200)];
    let expected = match vantage {
        DbmVantage::Server => "DbmVantage::Server",
        DbmVantage::Client => "DbmVantage::Client",
    };
    assert!(
        args.contains(expected),
        "{fn_name} reads from the {vantage:?} vantage, so its gate must name \
         {expected}; naming the other one checks the wrong OFGA object and \
         silently authorizes"
    );
    // And never the raw literal: a hand-written StreamType at a gate is the
    // copy-paste this mapping exists to prevent.
    assert!(
        !args.contains("StreamType::"),
        "{fn_name} must reach its stream type through required_stream_for, \
         never by writing StreamType:: at the gate"
    );
}

/// The explicit `?stream=` gate must run BEFORE the history backfill.
///
/// `get_dbm_query_history` takes `backfill_stream` from the caller's
/// `?stream=` and runs up to `HISTORY_BACKFILL_MAX_WINDOWS` raw-span
/// aggregations through `rollup::run_dbm_search` with `user_id: None`. The
/// `involved_streams` gate catches the same param but runs after that loop:
/// its 403 discards the aggregates, so nothing leaks, yet the queries have
/// already executed against another team's stream and their duration is
/// observable. `get_dbm_query_endpoints` (`can_read_stream` at the top,
/// before range parsing) is the pattern.
///
/// One endpoint's WHOLE implementation: the handler plus the body fn it
/// delegates to, concatenated in call order.
///
/// The handler/service split moved most of every endpoint out of the
/// `get_dbm_*` fn and into a `read_*` fn in the service layer. The
/// invariants the scrapes pin — "the gate runs before the backfill", "the
/// limit is shared with the standalone endpoint" — are properties of the
/// endpoint, not of whichever file a line ended up in, so they are asserted
/// over both halves together.
///
/// Both halves are REQUIRED. If either is missing the scrape panics rather
/// than quietly asserting over half an endpoint and passing: a body fn that
/// is renamed, or a handler that stops delegating, is exactly the drift
/// these tests exist to catch.
#[cfg(test)]
pub(super) fn endpoint_impl(handler_fn: &str, body_fn: &str) -> String {
    let src = dbm_prod_source();
    let handler = src
        .split(&format!("pub async fn {handler_fn}("))
        .nth(1)
        .unwrap_or_else(|| {
            panic!("{handler_fn} must exist — a renamed handler must fail, not pass")
        })
        .split("\npub ")
        .next()
        .unwrap();
    let body = src
        .split(&format!("async fn {body_fn}("))
        .nth(1)
        .unwrap_or_else(|| panic!("{body_fn} must exist — a renamed body fn must fail, not pass"))
        .split("\n}\n")
        .next()
        .unwrap();
    // The handler must actually reach the body it is being scraped with,
    // or this concatenation would assert over two unrelated functions.
    assert!(
        handler.contains(&format!("{body_fn}(")),
        "{handler_fn} must delegate to {body_fn} — scraping them together \
         only means anything if one calls the other"
    );
    format!("{handler}\n{body}")
}

/// The gate must run BEFORE the range parsing, or a caller distinguishes an
/// existing stream from a missing one by whether they get a 400 or a 403.
///
/// Same guard discipline as [`assert_gates_on_vantage`]: a scrape that
/// cannot find its landmarks fails rather than passing vacuously.
pub(super) fn assert_gate_precedes_range(fn_name: &str) {
    let src = dbm_prod_source();
    let code = src;
    let start = code
        .find(&format!("async fn {fn_name}"))
        .unwrap_or_else(|| panic!("{fn_name} must exist"));
    let body = code[start..]
        .split("\n}\n")
        .next()
        .unwrap_or_else(|| panic!("{fn_name} must have a body"));
    assert!(
        body.len() > 300,
        "{fn_name}'s scraped body is too short to be the real function"
    );
    let perm = body
        .find("can_read_stream(")
        .unwrap_or_else(|| panic!("{fn_name} must check read permission"));
    let range = body
        .find("resolve_range(")
        .unwrap_or_else(|| panic!("{fn_name} must resolve a range"));
    assert!(
        perm < range,
        "{fn_name}'s stream permission check must run BEFORE the range parsing"
    );
}
