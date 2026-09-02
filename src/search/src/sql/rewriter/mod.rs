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

pub mod add_new_filter;
pub mod add_o2_id;
pub mod add_ordering_term;
pub mod add_timestamp;
pub mod harden_string_literal;
pub mod match_all_raw;
pub mod remove_dashboard_placeholder;
pub mod track_total_hits;

/// Function names that are valid user-facing SQL but appear in NO registry,
/// because a rewriter desugars them before planning.
///
/// Exported so the function catalog served to the query editor can union them
/// in. Built from `registered_function_names()` alone, the catalog would
/// silently drop functions users rely on today.
pub const REWRITER_FUNCTION_ALIASES: &[&str] = &["match_all_raw", "match_all_raw_ignore_case"];

/// The canonical function each alias is rewritten to.
pub fn rewriter_alias_target(alias: &str) -> Option<&'static str> {
    match alias {
        "match_all_raw" | "match_all_raw_ignore_case" => Some("match_all"),
        _ => None,
    }
}
