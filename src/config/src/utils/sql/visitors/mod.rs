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

mod distinct;
mod subquery;
mod timestamp;
mod union;
mod window_function;

pub(super) use distinct::has_distinct;
pub(super) use subquery::has_subquery;
pub use timestamp::TimestampVisitor;
pub(super) use timestamp::has_timestamp;
pub(super) use union::{has_union, is_multi_search_eligible_for_histogram};
pub(super) use window_function::has_window_functions;
