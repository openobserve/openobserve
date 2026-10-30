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

use datafusion::{arrow::array::BooleanArray, prelude::SessionContext};

async fn like(value: &str, pattern: &str) -> bool {
    let sql = format!("SELECT '{value}' LIKE '{pattern}'");
    let batches = SessionContext::new()
        .sql(&sql)
        .await
        .unwrap()
        .collect()
        .await
        .unwrap();
    batches[0]
        .column(0)
        .as_any()
        .downcast_ref::<BooleanArray>()
        .unwrap()
        .value(0)
}

// The editor escapes % and _ with a backslash and writes no ESCAPE clause.
#[tokio::test]
async fn like_escapes_with_a_backslash_without_an_escape_clause() {
    assert!(like("50%", r"50\%").await);
    assert!(!like("500", r"50\%").await);
    assert!(like("a_b", r"a\_b").await);
    assert!(!like("axb", r"a\_b").await);
    assert!(like(r"a\b", r"a\\b").await);
    assert!(like("50% off", r"50\%%").await);
}
