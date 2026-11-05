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

use std::{
    fmt::Write,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    sync::{Arc, LazyLock as Lazy},
};

use datafusion::{
    arrow::{array::StringBuilder, datatypes::DataType},
    common::{Result, ScalarValue, exec_err},
    logical_expr::{
        ColumnarValue, ScalarFunctionArgs, ScalarUDF, ScalarUDFImpl, Signature, TypeSignature,
        Volatility,
    },
};

use super::{constant_str, for_each_row, parse_prefix_len, v4_mask, v6_mask};

pub const IP_SUBNET_UDF_NAME: &str = "ip_subnet";

/// `ip_subnet(ip, prefix [, v6_prefix])`: network address of `ip`; NULL on a family mismatch.
pub static IP_SUBNET_UDF: Lazy<ScalarUDF> = Lazy::new(|| ScalarUDF::from(IpSubnetUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct IpSubnetUdf {
    signature: Signature,
}

impl IpSubnetUdf {
    fn new() -> Self {
        Self {
            signature: Signature::one_of(
                vec![TypeSignature::String(2), TypeSignature::String(3)],
                Volatility::Immutable,
            ),
        }
    }
}

impl ScalarUDFImpl for IpSubnetUdf {
    fn name(&self) -> &str {
        IP_SUBNET_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Utf8)
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        let Some(prefix) = constant_mask(&args.args[1], "prefix")? else {
            return Ok(ColumnarValue::Scalar(ScalarValue::Utf8(None)));
        };
        let v6 = match args.args.get(2) {
            None => prefix,
            Some(arg) => match constant_mask(arg, "v6_prefix")? {
                None => return Ok(ColumnarValue::Scalar(ScalarValue::Utf8(None))),
                Some(Mask::V4(_)) => {
                    return exec_err!(
                        "{IP_SUBNET_UDF_NAME}: `v6_prefix` cannot be an IPv4 netmask"
                    );
                }
                Some(mask) => mask,
            },
        };
        subnets(&args.args[0], args.number_rows, prefix, v6)
    }
}

/// A prefix written as `/length` or as a netmask address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mask {
    Len(u8),
    V4(Ipv4Addr),
    V6(Ipv6Addr),
}

impl Mask {
    fn parse(text: &str) -> Option<Self> {
        if let Some(len) = text.strip_prefix('/') {
            return parse_prefix_len(len, 128).map(Self::Len);
        }
        match text.parse::<IpAddr>().ok()? {
            IpAddr::V4(mask) => Some(Self::V4(mask)),
            IpAddr::V6(mask) => Some(Self::V6(mask)),
        }
    }

    fn apply_v4(self, ip: Ipv4Addr) -> Option<Ipv4Addr> {
        let mask = match self {
            Self::Len(len) if len <= 32 => v4_mask(len),
            Self::V4(mask) => u32::from(mask),
            Self::Len(_) | Self::V6(_) => return None,
        };
        Some(Ipv4Addr::from(u32::from(ip) & mask))
    }

    fn apply_v6(self, ip: Ipv6Addr) -> Option<Ipv6Addr> {
        let mask = match self {
            Self::Len(len) => v6_mask(len),
            Self::V6(mask) => u128::from(mask),
            Self::V4(_) => return None,
        };
        Some(Ipv6Addr::from(u128::from(ip) & mask))
    }
}

fn constant_mask(arg: &ColumnarValue, param: &str) -> Result<Option<Mask>> {
    let Some(text) = constant_str(arg, IP_SUBNET_UDF_NAME, param)? else {
        return Ok(None);
    };
    match Mask::parse(text) {
        Some(mask) => Ok(Some(mask)),
        None => exec_err!("{IP_SUBNET_UDF_NAME}: invalid `{param}` '{text}'"),
    }
}

/// Formats each row's network address straight into the output buffer, NULL where it has none.
fn subnets(arg: &ColumnarValue, number_rows: usize, v4: Mask, v6: Mask) -> Result<ColumnarValue> {
    let mut out = StringBuilder::with_capacity(number_rows, number_rows * 16);
    for_each_row(arg, number_rows, IP_SUBNET_UDF_NAME, |row| {
        match row.and_then(|ip| subnet(ip.parse().ok()?, v4, v6)) {
            Some(net) => {
                // Writing to an in-memory StringBuilder cannot fail.
                write!(out, "{net}").expect("write to StringBuilder");
                out.append_value("");
            }
            None => out.append_null(),
        }
    })?;
    Ok(ColumnarValue::Array(Arc::new(out.finish())))
}

/// Network address of `ip`; IPv4 and `::ffff:`-mapped addresses use `v4`, other IPv6 uses `v6`.
fn subnet(ip: IpAddr, v4: Mask, v6: Mask) -> Option<IpAddr> {
    match ip {
        IpAddr::V4(ip) => v4.apply_v4(ip).map(IpAddr::V4),
        // Same as ClickHouse cutIPv6, Doris cut_ipv6 and ES|QL IP_PREFIX for mapped addresses.
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(embedded) => v4
                .apply_v4(embedded)
                .map(|net| IpAddr::V6(net.to_ipv6_mapped())),
            None => v6.apply_v6(ip).map(IpAddr::V6),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::query_column;

    async fn subnet(args: &str) -> String {
        let sql = format!("SELECT ip_subnet({args}) FROM (VALUES (1)) AS t(x)");
        query_column(&sql).await.unwrap().remove(0)
    }

    async fn subnet_of_column(ip: &str, prefixes: &str) -> String {
        let sql = format!("SELECT ip_subnet(ip, {prefixes}) FROM (VALUES ('{ip}')) AS t(ip)");
        query_column(&sql).await.unwrap().remove(0)
    }

    #[tokio::test]
    async fn masks_ipv4_by_length_or_netmask() {
        for (ip, prefix, expected) in [
            ("192.168.1.77", "/24", "192.168.1.0"),
            ("192.168.1.77", "255.255.0.0", "192.168.0.0"),
            ("10.1.2.3", "/0", "0.0.0.0"),
            ("10.1.2.3", "/32", "10.1.2.3"),
        ] {
            assert_eq!(subnet_of_column(ip, &format!("'{prefix}'")).await, expected);
        }
    }

    #[tokio::test]
    async fn ipv6_uses_v6_prefix_when_given_else_prefix() {
        for (ip, prefixes, expected) in [
            ("2001:db8:1:2::5", "'/24', '/64'", "2001:db8:1:2::"),
            ("2001:db8:1:2::5", "'/24'", "2001:d00::"),
            ("2001:db8:1:2::5", "'ffff:ffff::'", "2001:db8::"),
            (
                "2001:db8:1:2::5",
                "'/24', 'ffff:ffff:ffff::'",
                "2001:db8:1::",
            ),
        ] {
            assert_eq!(subnet_of_column(ip, prefixes).await, expected, "{prefixes}");
        }
    }

    #[tokio::test]
    async fn mapped_address_uses_the_ipv4_prefix_and_stays_mapped() {
        assert_eq!(
            subnet_of_column("::ffff:192.168.1.77", "'/24', '/64'").await,
            "::ffff:192.168.1.0"
        );
        assert_eq!(
            subnet_of_column("::ffff:192.168.1.77", "'/24'").await,
            "::ffff:192.168.1.0"
        );
    }

    #[tokio::test]
    async fn prefix_that_does_not_fit_the_family_gives_null() {
        for (ip, prefixes) in [
            ("10.1.2.3", "'/64'"),
            ("10.1.2.3", "'ffff::'"),
            ("::ffff:10.1.2.3", "'/64'"),
            ("2001:db8::1", "'255.255.255.0'"),
        ] {
            assert_eq!(
                subnet_of_column(ip, prefixes).await,
                "NULL",
                "{ip} {prefixes}"
            );
        }
    }

    #[tokio::test]
    async fn invalid_or_null_ip_gives_null() {
        let rows = query_column(
            "SELECT ip_subnet(ip, '/24') FROM (VALUES ('abc'), (''), ('10.1.2.3/24'), (NULL)) AS t(ip)",
        )
        .await
        .unwrap();
        assert_eq!(rows, vec!["NULL"; 4]);
    }

    #[tokio::test]
    async fn invalid_constant_prefix_is_an_error() {
        for prefixes in [
            "'24'",
            "'/129'",
            "'/'",
            "'abc'",
            "''",
            "'/24', '255.255.255.0'",
            "'/24', '/129'",
        ] {
            let sql =
                format!("SELECT ip_subnet(ip, {prefixes}) FROM (VALUES ('10.1.2.3')) AS t(ip)");
            assert!(query_column(&sql).await.is_err(), "{prefixes}");
        }
    }

    #[tokio::test]
    async fn null_prefix_gives_null() {
        assert_eq!(subnet("'10.1.2.3', NULL").await, "NULL");
        assert_eq!(subnet("'10.1.2.3', '/24', NULL").await, "NULL");
    }

    #[tokio::test]
    async fn prefix_from_a_column_is_an_error() {
        for args in ["ip, p", "ip, '/24', p"] {
            let sql =
                format!("SELECT ip_subnet({args}) FROM (VALUES ('10.1.2.3', '/64')) AS t(ip, p)");
            assert!(query_column(&sql).await.is_err(), "{args}");
        }
    }

    #[tokio::test]
    async fn accepts_every_string_type_and_constant_ips() {
        for cast in ["Utf8", "LargeUtf8", "Utf8View"] {
            let sql = format!(
                "SELECT ip_subnet(arrow_cast(ip, '{cast}'), '/24') FROM (VALUES ('10.1.2.3')) AS t(ip)"
            );
            assert_eq!(
                query_column(&sql).await.unwrap(),
                vec!["10.1.2.0"],
                "{cast}"
            );
        }
        assert_eq!(subnet("'10.1.2.3', '/16'").await, "10.1.0.0");
    }
}
