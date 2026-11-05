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

use std::{net::IpAddr, sync::LazyLock as Lazy};

use datafusion::{
    arrow::datatypes::DataType,
    common::Result,
    logical_expr::{
        ColumnarValue, ScalarFunctionArgs, ScalarUDF, ScalarUDFImpl, Signature, Volatility,
    },
};

use super::eval_bools;

pub const IS_PRIVATE_IP_UDF_NAME: &str = "is_private_ip";

/// `is_private_ip(ip)`: whether `ip` is in RFC 1918 or `fc00::/7`, NULL when it is not an address.
pub static IS_PRIVATE_IP_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(IsPrivateIpUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct IsPrivateIpUdf {
    signature: Signature,
}

impl IsPrivateIpUdf {
    fn new() -> Self {
        Self {
            signature: Signature::string(1, Volatility::Immutable),
        }
    }
}

impl ScalarUDFImpl for IsPrivateIpUdf {
    fn name(&self) -> &str {
        IS_PRIVATE_IP_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        eval_bools(
            &args.args[0],
            args.number_rows,
            IS_PRIVATE_IP_UDF_NAME,
            |ip| match ip.parse::<IpAddr>().ok()? {
                IpAddr::V4(ip) => Some(ip.is_private()),
                IpAddr::V6(ip) => Some(ip.is_unique_local()),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::query_column;

    #[tokio::test]
    async fn private_means_rfc1918_or_unique_local() {
        for (ip, expected) in [
            ("10.0.0.1", "true"),
            ("172.16.0.1", "true"),
            ("172.31.255.255", "true"),
            ("192.168.1.1", "true"),
            ("172.32.0.1", "false"),
            ("8.8.8.8", "false"),
            ("127.0.0.1", "false"),
            ("169.254.1.1", "false"),
            ("100.64.0.1", "false"),
            ("fc00::1", "true"),
            ("fd12:3456::1", "true"),
            ("fe80::1", "false"),
            ("::1", "false"),
            ("2001:db8::1", "false"),
            ("::ffff:10.0.0.1", "false"),
            ("abc", "NULL"),
        ] {
            let sql = format!("SELECT is_private_ip(ip) FROM (VALUES ('{ip}')) AS t(ip)");
            assert_eq!(query_column(&sql).await.unwrap(), vec![expected], "{ip}");
        }
    }

    #[tokio::test]
    async fn null_gives_null_and_every_string_type_is_accepted() {
        assert_eq!(
            query_column("SELECT is_private_ip(ip) FROM (VALUES (NULL)) AS t(ip)")
                .await
                .unwrap(),
            vec!["NULL"]
        );
        for cast in ["LargeUtf8", "Utf8View"] {
            let sql = format!(
                "SELECT is_private_ip(arrow_cast(ip, '{cast}')) FROM (VALUES ('10.0.0.1')) AS t(ip)"
            );
            assert_eq!(query_column(&sql).await.unwrap(), vec!["true"], "{cast}");
        }
    }
}
