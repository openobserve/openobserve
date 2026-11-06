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
    common::{Result, ScalarValue, exec_err},
    logical_expr::{
        ColumnarValue, ScalarFunctionArgs, ScalarUDF, ScalarUDFImpl, Signature, Volatility,
    },
};

use super::{constant_str, eval_bools, parse_prefix_len, v4_mask, v6_mask};

pub const IP_CIDR_CONTAINS_UDF_NAME: &str = "ip_cidr_contains";

/// `ip_cidr_contains(cidr, ip)`: whether `ip` is in the constant `cidr`; NULL for a non-address.
pub static IP_CIDR_CONTAINS_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(IpCidrContainsUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct IpCidrContainsUdf {
    signature: Signature,
}

impl IpCidrContainsUdf {
    fn new() -> Self {
        Self {
            signature: Signature::string(2, Volatility::Immutable),
        }
    }
}

impl ScalarUDFImpl for IpCidrContainsUdf {
    fn name(&self) -> &str {
        IP_CIDR_CONTAINS_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        let Some(text) = constant_str(&args.args[0], IP_CIDR_CONTAINS_UDF_NAME, "cidr")? else {
            return Ok(ColumnarValue::Scalar(ScalarValue::Boolean(None)));
        };
        let Some(cidr) = Cidr::parse(text) else {
            return exec_err!("{IP_CIDR_CONTAINS_UDF_NAME}: invalid CIDR '{text}'");
        };
        eval_bools(
            &args.args[1],
            args.number_rows,
            IP_CIDR_CONTAINS_UDF_NAME,
            |ip| ip.parse::<IpAddr>().ok().map(|ip| cidr.contains(ip)),
        )
    }
}

/// A network with its host bits cleared, kept as integers so each row is one AND and one compare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cidr {
    V4 { network: u32, mask: u32 },
    V6 { network: u128, mask: u128 },
}

impl Cidr {
    /// Parses `address/length`, accepting host bits and clearing them.
    fn parse(text: &str) -> Option<Self> {
        let (address, len) = text.split_once('/')?;
        match address.parse::<IpAddr>().ok()? {
            IpAddr::V4(address) => {
                let mask = v4_mask(parse_prefix_len(len, 32)?);
                Some(Self::V4 {
                    network: u32::from(address) & mask,
                    mask,
                })
            }
            IpAddr::V6(address) => {
                let mask = v6_mask(parse_prefix_len(len, 128)?);
                Some(Self::V6 {
                    network: u128::from(address) & mask,
                    mask,
                })
            }
        }
    }

    fn contains(self, ip: IpAddr) -> bool {
        match (self, ip) {
            (Self::V4 { network, mask }, IpAddr::V4(ip)) => u32::from(ip) & mask == network,
            (Self::V6 { network, mask }, IpAddr::V6(ip)) => u128::from(ip) & mask == network,
            // A `::ffff:`-mapped address is IPv6 text, so it never matches an IPv4 CIDR.
            (Self::V4 { .. }, IpAddr::V6(_)) | (Self::V6 { .. }, IpAddr::V4(_)) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::query_column;

    async fn contains(cidr: &str, ip: &str) -> String {
        let sql = format!("SELECT ip_cidr_contains('{cidr}', ip) FROM (VALUES ('{ip}')) AS t(ip)");
        query_column(&sql).await.unwrap().remove(0)
    }

    #[tokio::test]
    async fn matches_ipv4_and_ipv6_networks() {
        for (cidr, ip, expected) in [
            ("10.0.0.0/8", "10.1.2.3", "true"),
            ("10.0.0.0/8", "11.0.0.1", "false"),
            ("192.168.1.0/24", "192.168.1.255", "true"),
            ("192.168.1.0/24", "192.168.2.0", "false"),
            ("0.0.0.0/0", "8.8.8.8", "true"),
            ("10.1.2.3/32", "10.1.2.3", "true"),
            ("2001:db8::/32", "2001:db8:1::5", "true"),
            ("2001:db8::/32", "2001:db9::1", "false"),
            ("::/0", "2001:db8::1", "true"),
        ] {
            assert_eq!(contains(cidr, ip).await, expected, "{cidr} vs {ip}");
        }
    }

    #[tokio::test]
    async fn host_bits_in_the_cidr_are_cleared() {
        assert_eq!(contains("10.1.2.3/8", "10.200.0.1").await, "true");
        assert_eq!(contains("2001:db8::1/32", "2001:db8:ffff::1").await, "true");
    }

    #[tokio::test]
    async fn family_mismatch_is_false_and_mapped_addresses_stay_ipv6() {
        for (cidr, ip) in [
            ("10.0.0.0/8", "2001:db8::1"),
            ("2001:db8::/32", "10.1.2.3"),
            ("10.0.0.0/8", "::ffff:10.1.2.3"),
            ("::ffff:0:0/96", "10.1.2.3"),
        ] {
            assert_eq!(contains(cidr, ip).await, "false", "{cidr} vs {ip}");
        }
        assert_eq!(
            contains("::ffff:10.0.0.0/104", "::ffff:10.1.2.3").await,
            "true"
        );
    }

    #[tokio::test]
    async fn invalid_or_null_ip_gives_null() {
        let rows = query_column(
            "SELECT ip_cidr_contains('10.0.0.0/8', ip) FROM (VALUES ('abc'), (''), ('10.1.2.3:80'), ('[::1]'), (' 10.1.2.3'), (NULL)) AS t(ip)",
        )
        .await
        .unwrap();
        assert_eq!(rows, vec!["NULL"; 6]);
    }

    #[tokio::test]
    async fn invalid_cidr_is_an_error() {
        for cidr in [
            "10.0.0.0/33",
            "2001:db8::/129",
            "10.0.0.0",
            "10.0.0.0/",
            "10.0.0.0/+8",
            "10.0.0.0/ 8",
            " 10.0.0.0/8",
            "abc/8",
            "",
        ] {
            let sql = format!(
                "SELECT ip_cidr_contains('{cidr}', ip) FROM (VALUES ('10.1.2.3')) AS t(ip)"
            );
            assert!(query_column(&sql).await.is_err(), "cidr {cidr:?}");
        }
    }

    #[tokio::test]
    async fn null_cidr_gives_null() {
        let rows =
            query_column("SELECT ip_cidr_contains(NULL, ip) FROM (VALUES ('10.1.2.3')) AS t(ip)")
                .await
                .unwrap();
        assert_eq!(rows, vec!["NULL"]);
    }

    #[tokio::test]
    async fn cidr_from_a_column_is_an_error() {
        let result = query_column(
            "SELECT ip_cidr_contains(c, ip) FROM (VALUES ('10.0.0.0/8', '10.1.2.3')) AS t(c, ip)",
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn accepts_every_string_type() {
        for cast in ["Utf8", "LargeUtf8", "Utf8View"] {
            let sql = format!(
                "SELECT ip_cidr_contains('10.0.0.0/8', arrow_cast(ip, '{cast}')) FROM (VALUES ('10.1.2.3')) AS t(ip)"
            );
            assert_eq!(query_column(&sql).await.unwrap(), vec!["true"], "{cast}");
        }
    }
}
