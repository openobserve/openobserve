// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use chrono::{DateTime, FixedOffset, TimeZone, Utc};

#[inline(always)]
pub fn parse_str_to_time(s: &str) -> Result<DateTime<FixedOffset>, anyhow::Error> {
    if s.contains('T') && !s.contains(' ') {
        if s.len() == 19 {
            let fmt = "%Y-%m-%dT%H:%M:%S";
            let ret = Utc.datetime_from_str(s, fmt)?;
            Ok(ret.into())
        } else {
            Ok(chrono::DateTime::parse_from_rfc3339(s)?)
        }
    } else if s.contains(' ') && s.len() == 19 {
        let fmt = "%Y-%m-%d %H:%M:%S";
        let ret = Utc.datetime_from_str(s, fmt)?;
        Ok(ret.into())
    } else {
        Ok(chrono::DateTime::parse_from_rfc2822(s)?)
    }
}

#[inline(always)]
pub fn parse_str_to_timestamp_micros(v: &str) -> Result<i64, anyhow::Error> {
    let n: i64 = match v.parse() {
        Ok(i) => i,
        Err(_) => match parse_str_to_time(v) {
            Ok(v) => {
                return Ok(v.timestamp_micros());
            }
            Err(_) => {
                return Err(anyhow::anyhow!("invalid time format [string]"));
            }
        },
    };
    parse_i64_to_timestamp_micros(n)
}

#[inline(always)]
pub fn parse_i64_to_timestamp_micros(v: i64) -> Result<i64, anyhow::Error> {
    if v == 0 {
        return Ok(0);
    }
    if v > (1e18 as i64) {
        // nanoseconds
        Ok(v / 1000)
    } else if v > (1e15 as i64) {
        // microseconds
        Ok(v)
    } else if v > (1e12 as i64) {
        // milliseconds
        Ok(v * 1000)
    } else if v > (1e9 as i64) {
        // seconds
        Ok(v * 1000 * 1000)
    } else {
        Err(anyhow::anyhow!("Invalid time format [timestamp:value]"))
    }
}

#[inline(always)]
pub fn parse_timestamp_micro_from_value(v: &serde_json::Value) -> Result<i64, anyhow::Error> {
    let n = match v {
        serde_json::Value::String(s) => parse_str_to_timestamp_micros(s)?,
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                n.as_i64().unwrap()
            } else if n.is_u64() {
                n.as_u64().unwrap() as i64
            } else if n.is_f64() {
                n.as_f64().unwrap() as i64
            } else {
                return Err(anyhow::anyhow!("Invalid time format [timestamp]"));
            }
        }
        _ => return Err(anyhow::anyhow!("Invalid time format [type]")),
    };
    parse_i64_to_timestamp_micros(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_str_to_time() {
        let s = "2021-01-01T00:00:00";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609459200000000);

        let s = "2021-01-01T00:00:00Z";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609459200000000);

        let s = "2021-01-01T00:00:00+08:00";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609430400000000);

        let s = "2021-01-01T00:00:00-08:00";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609488000000000);

        let s = "2021-01-01 00:00:00";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609459200000000);

        let s = "2021-01-01T00:00:00.000000Z";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609459200000000);

        let s = "2021-01-01T00:00:00.000000+08:00";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1609430400000000);

        let s = "Wed, 8 Mar 2023 16:46:51 CST";
        let t = parse_str_to_time(s).unwrap();
        assert_eq!(t.timestamp_micros(), 1678315611000000);

        // let s = "Wed, 8 Mar 2023 16:46:51 GMT+8";
        // let t = parse_str_to_time(s).unwrap();
        // assert_eq!(t.timestamp_micros(), 1678315611000000);

        // let s = "Wed Mar  8 16:46:51 CST 2023";
        // let t = parse_str_to_time(s).unwrap();
        // assert_eq!(t.timestamp_micros(), 1678315611000000);

        // let s = "Mar 8, 2023, 2:29 PM GMT+8";
        // let t = parse_str_to_time(s).unwrap();
        // assert_eq!(t.timestamp_micros(), 1609459200000000);
    }

    #[test]
    fn test_parse_str_to_timestamp_micros() {
        let s = "2021-01-01T00:00:00";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609459200000000);

        let s = "2021-01-01T00:00:00Z";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609459200000000);

        let s = "2021-01-01T00:00:00+08:00";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609430400000000);

        let s = "2021-01-01T00:00:00-08:00";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609488000000000);

        let s = "2021-01-01 00:00:00";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609459200000000);

        let s = "2021-01-01T00:00:00.000000Z";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609459200000000);

        let s = "2021-01-01T00:00:00.000000+08:00";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1609430400000000);

        let s = "Wed, 8 Mar 2023 16:46:51 CST";
        let t = parse_str_to_timestamp_micros(s).unwrap();
        assert_eq!(t, 1678315611000000);
    }

    #[test]
    fn test_parse_i64_to_timestamp_micros() {
        let n = 1609459200000000;
        let t = parse_i64_to_timestamp_micros(n).unwrap();
        assert_eq!(t, 1609459200000000);

        let n = 1609459200000;
        let t = parse_i64_to_timestamp_micros(n).unwrap();
        assert_eq!(t, 1609459200000000);

        let n = 1609459200;
        let t = parse_i64_to_timestamp_micros(n).unwrap();
        assert_eq!(t, 1609459200000000);
    }

    #[test]
    fn test_parse_timestamp_micro_from_value() {
        let v = serde_json::json!(1609459200000000i64);
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609459200000000);

        let v = serde_json::json!("2021-01-01T00:00:00");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609459200000000);

        let v = serde_json::json!("2021-01-01T00:00:00Z");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609459200000000);

        let v = serde_json::json!("2021-01-01T00:00:00+08:00");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609430400000000);

        let v = serde_json::json!("2021-01-01T00:00:00-08:00");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609488000000000);

        let v = serde_json::json!("2021-01-01 00:00:00");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609459200000000);

        let v = serde_json::json!("2021-01-01T00:00:00.000000Z");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1609459200000000);

        let v = serde_json::json!("Wed, 8 Mar 2023 16:46:51 CST");
        let t = parse_timestamp_micro_from_value(&v).unwrap();
        assert_eq!(t, 1678315611000000);
    }
}
