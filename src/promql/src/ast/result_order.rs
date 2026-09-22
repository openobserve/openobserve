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

use promql_parser::parser::Expr;

/// Direction of a top-level `sort`/`sort_desc`, `Some(true)` meaning descending.
pub fn top_level_sort_descending(expr: &Expr) -> Option<bool> {
    match expr {
        Expr::Paren(paren) => top_level_sort_descending(&paren.expr),
        Expr::Call(call) => match call.func.name {
            "sort" => Some(false),
            "sort_desc" => Some(true),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    fn order(query: &str) -> Option<bool> {
        top_level_sort_descending(&parser::parse(query).unwrap())
    }

    #[test]
    fn test_top_level_sort_descending() {
        assert_eq!(order("sort(up)"), Some(false));
        assert_eq!(order("sort_desc(up)"), Some(true));
        assert_eq!(order("(sort_desc(topk(3, up)))"), Some(true));
        assert_eq!(order("up"), None);
        assert_eq!(order("sort(up) * 2"), None);
        assert_eq!(order("sum(sort(up))"), None);
    }
}
