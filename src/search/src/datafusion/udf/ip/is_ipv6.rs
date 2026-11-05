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

use std::{net::Ipv6Addr, sync::LazyLock as Lazy};

use datafusion::{
    arrow::datatypes::DataType,
    common::Result,
    logical_expr::{
        ColumnarValue, ScalarFunctionArgs, ScalarUDF, ScalarUDFImpl, Signature, Volatility,
    },
};

use super::eval_bools;

pub const IS_IPV6_UDF_NAME: &str = "is_ipv6";

/// `is_ipv6(s)`: whether `s` is an IPv6 address, including `::ffff:`-mapped ones.
pub static IS_IPV6_UDF: Lazy<ScalarUDF> = Lazy::new(|| ScalarUDF::from(IsIpv6Udf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct IsIpv6Udf {
    signature: Signature,
}

impl IsIpv6Udf {
    fn new() -> Self {
        Self {
            signature: Signature::string(1, Volatility::Immutable),
        }
    }
}

impl ScalarUDFImpl for IsIpv6Udf {
    fn name(&self) -> &str {
        IS_IPV6_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        eval_bools(&args.args[0], args.number_rows, IS_IPV6_UDF_NAME, |s| {
            Some(s.parse::<Ipv6Addr>().is_ok())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::query_column;

    #[tokio::test]
    async fn only_ipv6_text_is_ipv6() {
        let rows = query_column(
            "SELECT is_ipv6(s) FROM (VALUES ('2001:db8::1'), ('::1'), ('::'), ('::ffff:1.2.3.4'), \
             ('1.2.3.4'), ('fe80::1%eth0'), ('[::1]'), ('2001:db8::/32'), ('abc'), (NULL)) AS t(s)",
        )
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                "true", "true", "true", "true", "false", "false", "false", "false", "false", "NULL"
            ]
        );
    }

    #[tokio::test]
    async fn accepts_every_string_type() {
        for cast in ["Utf8", "LargeUtf8", "Utf8View"] {
            let sql =
                format!("SELECT is_ipv6(arrow_cast(s, '{cast}')) FROM (VALUES ('::1')) AS t(s)");
            assert_eq!(query_column(&sql).await.unwrap(), vec!["true"], "{cast}");
        }
    }
}
