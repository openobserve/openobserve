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

use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema};

pub fn change_schema_to_utf8_view(schema: Schema) -> Schema {
    let fields = schema
        .fields()
        .iter()
        .map(|f| {
            if f.data_type() == &DataType::Utf8 {
                Arc::new(Field::new(f.name(), DataType::Utf8View, f.is_nullable()))
            } else {
                f.clone()
            }
        })
        .collect::<Vec<_>>();
    Schema::new(fields)
}
