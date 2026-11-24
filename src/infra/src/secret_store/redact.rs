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

use std::fmt;

use base64::{
    Engine,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
};
use config::meta::secret_store::SecretErrorCode;
use serde::{Serialize, Serializer};
use zeroize::Zeroizing;

pub struct Redactor {
    needles: Vec<Zeroizing<String>>,
}

impl Redactor {
    pub fn for_attempt<'a>(values: impl IntoIterator<Item = &'a str>) -> Self {
        let mut needles = Vec::new();
        for value in values.into_iter().filter(|value| !value.is_empty()) {
            let percent = urlencoding::encode(value).into_owned();
            let lower_percent = lowercase_percent_escapes(&percent);
            needles.extend(
                [
                    value.to_owned(),
                    STANDARD.encode(value),
                    STANDARD_NO_PAD.encode(value),
                    URL_SAFE.encode(value),
                    URL_SAFE_NO_PAD.encode(value),
                    percent,
                    lower_percent,
                ]
                .map(Zeroizing::new),
            );
        }
        needles.sort_unstable_by(|a, b| {
            b.len()
                .cmp(&a.len())
                .then_with(|| a.as_str().cmp(b.as_str()))
        });
        needles.dedup();
        Self { needles }
    }

    pub fn redact(&self, text: &str) -> String {
        if self.is_empty() {
            return text.to_owned();
        }
        let mut output = String::with_capacity(text.len());
        let mut end = 0;
        // Match the original text so overlapping secrets stay covered and replacement markers stay
        // intact.
        for (start, _) in text.char_indices() {
            let Some(needle) = self
                .needles
                .iter()
                .find(|needle| text[start..].starts_with(needle.as_str()))
            else {
                continue;
            };
            if start >= end {
                output.push_str(&text[end..start]);
                output.push_str("[REDACTED]");
            }
            end = end.max(start + needle.len());
        }
        output.push_str(&text[end..]);
        output
    }

    pub fn is_empty(&self) -> bool {
        self.needles.is_empty()
    }
}

impl fmt::Debug for Redactor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Redactor")
            .field("needles", &self.needles.len())
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeClass {
    Timeout,
    Dns,
    Tls,
    Connect,
    RedirectRefused,
    Http4xx,
    Http5xx,
    SecretError(SecretErrorCode),
}

impl Serialize for OutcomeClass {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let class = match self {
            Self::Timeout => "timeout",
            Self::Dns => "dns",
            Self::Tls => "tls",
            Self::Connect => "connect",
            Self::RedirectRefused => "redirect_refused",
            Self::Http4xx => "http_4xx",
            Self::Http5xx => "http_5xx",
            Self::SecretError(code) => {
                return serializer.collect_str(&format_args!("secret_error:{code}"));
            }
        };
        serializer.serialize_str(class)
    }
}

#[derive(Debug, Serialize)]
pub struct HumanOutcome {
    pub ok: bool,
    pub status: Option<u16>,
    pub class: Option<OutcomeClass>,
}

impl HumanOutcome {
    pub fn from_status(status: u16) -> Self {
        Self {
            ok: (200..300).contains(&status),
            status: Some(status),
            class: match status {
                400..=499 => Some(OutcomeClass::Http4xx),
                500..=599 => Some(OutcomeClass::Http5xx),
                _ => None,
            },
        }
    }
}

fn lowercase_percent_escapes(encoded: &str) -> String {
    let mut out = String::with_capacity(encoded.len());
    let mut hex_left = 0;
    for ch in encoded.chars() {
        if hex_left > 0 {
            out.push(ch.to_ascii_lowercase());
            hex_left -= 1;
        } else {
            hex_left = if ch == '%' { 2 } else { 0 };
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn redacts_canary_in_transport_adapter_and_last_error_text() {
        let canary = "x/🗝~ +!";
        let redactor = Redactor::for_attempt([canary, canary, ""]);
        let echoed = format!(
            "{canary} eC/wn5edfiArIQ== eC_wn5edfiArIQ== eC_wn5edfiArIQ x%2F%F0%9F%97%9D~%20%2B%21"
        );
        for label in ["transport", "adapter", "last-error"] {
            assert_eq!(
                redactor.redact(&format!("{label}: {echoed}")),
                format!("{label}: [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED]")
            );
        }
        assert_eq!(format!("{redactor:?}"), "Redactor { needles: 7 }");
    }

    #[test]
    fn redacts_unpadded_standard_base64_and_lowercase_percent_encoding() {
        let canary = "x/🗝~ +!";
        let redactor = Redactor::for_attempt([canary]);
        assert_eq!(
            redactor.redact("eC/wn5edfiArIQ x%2f%f0%9f%97%9d~%20%2b%21"),
            "[REDACTED] [REDACTED]"
        );
    }

    #[test]
    fn longest_match_and_overlapping_secrets_are_fully_redacted() {
        let redactor = Redactor::for_attempt(["abc", "abcdef", "defgh", "REDACT"]);
        assert_eq!(redactor.redact("abcdef"), "[REDACTED]");
        assert_eq!(redactor.redact("abcdefgh abc"), "[REDACTED] [REDACTED]");
    }

    #[test]
    fn empty_values_are_ignored() {
        let redactor = Redactor::for_attempt([""]);
        assert!(redactor.is_empty());
        assert_eq!(redactor.redact("message"), "message");
    }

    #[test]
    fn status_outcomes_serialize_with_http_error_classes() {
        for (status, ok, class) in [
            (200, true, None),
            (299, true, None),
            (302, false, None),
            (404, false, Some("http_4xx")),
            (502, false, Some("http_5xx")),
        ] {
            assert_eq!(
                serde_json::to_value(HumanOutcome::from_status(status)).unwrap(),
                json!({"ok": ok, "status": status, "class": class})
            );
        }
    }

    #[test]
    fn transport_and_secret_errors_serialize_as_stable_strings() {
        for (class, wire) in [
            (OutcomeClass::Timeout, "timeout"),
            (OutcomeClass::Dns, "dns"),
            (OutcomeClass::Tls, "tls"),
            (OutcomeClass::Connect, "connect"),
            (OutcomeClass::RedirectRefused, "redirect_refused"),
            (
                OutcomeClass::SecretError(SecretErrorCode::SecretUnset),
                "secret_error:secret_unset",
            ),
        ] {
            let outcome = HumanOutcome {
                ok: false,
                status: None,
                class: Some(class),
            };
            assert_eq!(
                serde_json::to_value(outcome).unwrap(),
                json!({"ok": false, "status": null, "class": wire})
            );
        }
    }
}
