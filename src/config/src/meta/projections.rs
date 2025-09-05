// Copyright 2025 OpenObserve Inc.
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

use std::collections::HashSet;
/// Mapping of projection expression to underlying columns
#[derive(Debug, Clone)]
pub struct ProjectionColumnMapping {
    /// The output field name (alias if present, otherwise expression string)
    pub output_field: String,
    /// The projection expression as string (for context/debugging)
    pub projection_expr: String,
    /// Set of underlying column names that contribute to this projection
    pub source_columns: HashSet<String>,
}
