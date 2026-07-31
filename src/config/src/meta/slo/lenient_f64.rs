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

//! Deserializing `f64` under `serde_json/arbitrary_precision` (D61).
//!
//! The workspace enables `serde_json`'s `arbitrary_precision` feature
//! (`Cargo.toml`). That feature changes how a number is represented **inside a
//! buffered `Value`**: instead of an f64 it becomes a one-key map,
//! `{"$serde_json::private::Number": "14.4"}`. Nothing buffers in the common
//! path, so this is invisible until something does — and then a plain
//! `f64` field fails with `invalid type: map, expected f64`.
//!
//! Two things buffer:
//!
//! * an **internally-tagged enum**, which is why `SliConfig` and `CountSource` use adjacent tagging
//!   instead (D61);
//! * **`#[serde(flatten)]`**, which is how an `SloCondition` reaches this code — it arrives nested
//!   inside `CreateAlertRequestBody`'s flattened `alert` field.
//!
//! The second was found by end-to-end testing, not by review: every unit test
//! deserialized `SloCondition` directly, where no buffering happens and a
//! plain `f64` works fine.

use serde::{Deserialize, Deserializer, de::Error};

/// Deserialize an `f64` that may have been buffered into an
/// arbitrary-precision map.
pub fn deserialize<'de, D>(d: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    match Lenient::deserialize(d)? {
        Lenient::Num(v) => Ok(v),
        Lenient::Buffered(v) => from_value(&v).ok_or_else(|| D::Error::custom("expected a number")),
    }
}

/// The `Option` form, for fields like `warning`.
pub fn deserialize_opt<'de, D>(d: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    match Option::<Lenient>::deserialize(d)? {
        None => Ok(None),
        Some(Lenient::Num(v)) => Ok(Some(v)),
        Some(Lenient::Buffered(v)) => Ok(Some(
            from_value(&v).ok_or_else(|| D::Error::custom("expected a number"))?,
        )),
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Lenient {
    /// The ordinary path — no buffering happened.
    Num(f64),
    /// A buffered value, which under `arbitrary_precision` is a map.
    Buffered(serde_json::Value),
}

/// Pull an f64 out of a `Value`, including the arbitrary-precision map form.
fn from_value(v: &serde_json::Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    // `{"$serde_json::private::Number": "14.4"}` — the private key is not
    // matched by name because it is private and could change; any one-key map
    // whose value parses as a number is accepted instead.
    let obj = v.as_object()?;
    if obj.len() != 1 {
        return None;
    }
    let raw = obj.values().next()?;
    raw.as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| raw.as_f64())
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Holder {
        #[serde(deserialize_with = "deserialize")]
        critical: f64,
        #[serde(default, deserialize_with = "deserialize_opt")]
        warning: Option<f64>,
    }

    /// The ordinary path must keep working exactly as before.
    #[test]
    fn a_plain_number_deserializes() {
        let h: Holder = serde_json::from_str(r#"{"critical": 14.4, "warning": 6}"#).unwrap();
        assert_eq!(h.critical, 14.4);
        assert_eq!(h.warning, Some(6.0));
    }

    #[test]
    fn an_absent_option_is_none() {
        let h: Holder = serde_json::from_str(r#"{"critical": 1.0}"#).unwrap();
        assert_eq!(h.warning, None);
    }

    #[test]
    fn an_explicit_null_option_is_none() {
        let h: Holder = serde_json::from_str(r#"{"critical": 1.0, "warning": null}"#).unwrap();
        assert_eq!(h.warning, None);
    }

    /// The failure this module exists for. Reproduces the buffering that
    /// `#[serde(flatten)]` performs: the JSON is parsed to a `Value` first,
    /// which under `arbitrary_precision` turns every number into a map.
    #[test]
    fn a_number_buffered_through_value_deserializes() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"critical": 14.4, "warning": 6}"#).unwrap();
        let h: Holder = serde_json::from_value(v).expect("must survive buffering");
        assert_eq!(h.critical, 14.4);
        assert_eq!(h.warning, Some(6.0));
    }

    /// The end-to-end shape: a struct reached through a flatten, which is how
    /// an SloCondition arrives inside CreateAlertRequestBody.
    #[test]
    fn a_number_inside_a_flattened_struct_deserializes() {
        #[derive(Debug, Deserialize)]
        struct Outer {
            name: String,
            #[serde(flatten)]
            inner: Holder,
        }
        let o: Outer =
            serde_json::from_str(r#"{"name":"a","critical": 14.4, "warning": 6}"#).unwrap();
        assert_eq!(o.name, "a");
        assert_eq!(o.inner.critical, 14.4);
        assert_eq!(o.inner.warning, Some(6.0));
    }

    #[test]
    fn a_string_is_still_rejected() {
        assert!(serde_json::from_str::<Holder>(r#"{"critical": "high"}"#).is_err());
    }

    #[test]
    fn an_integer_widens() {
        let h: Holder = serde_json::from_str(r#"{"critical": 14}"#).unwrap();
        assert_eq!(h.critical, 14.0);
    }
}
