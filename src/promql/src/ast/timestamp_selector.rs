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

use promql_parser::parser::{Expr, Function, FunctionArgs, VectorSelector};

/// The instant selector under `timestamp(...)`, which reads sample times instead of step times.
pub(crate) fn timestamp_selector<'a>(
    func: &Function,
    args: &'a FunctionArgs,
) -> Option<&'a VectorSelector> {
    if func.name != "timestamp" {
        return None;
    }
    let [arg] = args.args.as_slice() else {
        return None;
    };
    let mut arg: &Expr = arg;
    while let Expr::Paren(paren) = arg {
        arg = &paren.expr;
    }
    match arg {
        Expr::VectorSelector(vs) => Some(vs),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    #[test]
    fn test_timestamp_selector_sees_through_parens_only() {
        let selector_of = |query: &str| match parser::parse(query).unwrap() {
            Expr::Call(call) => timestamp_selector(&call.func, &call.args).map(|vs| vs.to_string()),
            other => panic!("{query} is not a call: {other:?}"),
        };
        assert_eq!(
            selector_of("timestamp(((a{b=\"c\"})))").as_deref(),
            Some("a{b=\"c\"}")
        );
        assert_eq!(
            selector_of("timestamp(a offset 1m)").as_deref(),
            Some("a offset 1m")
        );
        assert_eq!(selector_of("timestamp(-a)"), None);
        assert_eq!(selector_of("timestamp(sum(a))"), None);
        assert_eq!(selector_of("abs(a)"), None);
        assert_eq!(selector_of("timestamp(a * 1)"), None);
        assert_eq!(selector_of("timestamp(timestamp(a))"), None);
    }
}
