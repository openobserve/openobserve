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

mod complex_query;
mod eligible_for_histogram;
mod explain_query;
mod helpers;
mod simple_aggregate_query;
mod simple_distinct_query;
mod timestamp_selected;
mod visitors;

pub use complex_query::{is_complex_query, is_complex_query_stmt};
pub use eligible_for_histogram::is_eligible_for_histogram;
pub use explain_query::is_explain_query;
pub use simple_aggregate_query::is_simple_aggregate_query;
pub use simple_distinct_query::is_simple_distinct_query;
pub use timestamp_selected::is_timestamp_selected;
pub use visitors::TimestampVisitor;

pub const AGGREGATE_UDF_LIST: [&str; 17] = [
    "min",
    "max",
    "avg",
    "sum",
    "count",
    "median",
    "array_agg",
    "percentile_cont",
    "summary_percentile",
    "first_value",
    "last_value",
    "approx_distinct",
    "approx_median",
    "approx_percentile_cont",
    "approx_percentile_cont_with_weight",
    "approx_topk",
    "approx_topk_distinct",
];
