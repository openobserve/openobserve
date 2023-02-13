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

pub fn parse_str_to_time(s: &str) -> Result<DateTime<FixedOffset>, anyhow::Error> {
    if s.contains('T') {
        if s.len() == 19 {
            let fmt = "%Y-%m-%dT%H:%M:%S";
            let ret = Utc.datetime_from_str(s, fmt)?;
            Ok(ret.into())
        } else {
            Ok(chrono::DateTime::parse_from_rfc3339(s)?)
        }
    } else if s.contains(',') {
        Ok(chrono::DateTime::parse_from_rfc2822(s)?)
    } else {
        let fmt = "%Y-%m-%d %H:%M:%S";
        let ret = Utc.datetime_from_str(s, fmt)?;
        Ok(ret.into())
    }
}

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
