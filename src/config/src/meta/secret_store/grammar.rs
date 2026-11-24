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

use std::{fmt, net::IpAddr, sync::LazyLock};

use regex::Regex;
use url::{Host, Url};

use super::{ConsumerType, SecretErrorCode};
use crate::meta::synthetics_variables::RESERVED_VARIABLE_PREFIX;

const CREDENTIAL_METADATA: &[(&str, &str)] = &[("pagerduty", "routing_key")];

// A namespace typo must survive the scan so callers can refuse it before rendering.
static STORE_REF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x) \{\{ (?:
            (?<kind>secrets|vars) \. (?<name>[A-Za-z_][A-Za-z0-9_]{0,127}) \}\}
          | (?i: \s* (?:secrets?|vars?) \s* \. )
        )",
    )
    .unwrap()
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RefKind {
    Secret,
    Var,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefToken {
    pub kind: RefKind,
    pub name: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Slot {
    UrlScheme,
    UrlUserinfo,
    UrlHost,
    UrlPort,
    UrlPath,
    UrlQuery,
    HeaderName,
    HeaderValue,
    Metadata { platform: String, key: String },
    TemplateBody,
    TemplateTitle,
    CheckUrl,
    BasicPassword,
    BearerToken,
    CheckHeaderValue,
    CookieValue,
    BrowserSecretSlot,
    StepValue,
    CookieDomain,
    McpHeaderValue,
    CliEnvValue,
    CredentialFile,
    Command,
    McpUrlHost,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PinPattern {
    host: PinHost,
    port: u16,
}

impl PinPattern {
    pub fn parse(entry: &str) -> Result<Self, SecretErrorCode> {
        let invalid = SecretErrorCode::PinEntryInvalid;
        let authority = match entry.split_once("://") {
            Some((scheme, rest)) if scheme.eq_ignore_ascii_case("https") => {
                rest.strip_suffix('/').unwrap_or(rest)
            }
            Some(_) => return Err(invalid),
            None => entry,
        };

        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) if !authority.ends_with(']') => {
                if !port.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(invalid);
                }
                let port = port.parse::<u16>().map_err(|_| invalid)?;
                if port == 0 {
                    return Err(invalid);
                }
                (host, port)
            }
            _ => (authority, 443),
        };
        let suffix = host.strip_prefix("*.");
        let parsed = Host::parse(suffix.unwrap_or(host)).map_err(|_| invalid)?;
        let host = PinHost::from_host(parsed, suffix.is_some())?;
        Ok(Self { host, port })
    }

    pub fn matches(&self, url: &str) -> bool {
        let Ok(url) = Url::parse(url) else {
            return false;
        };
        if url.scheme() != "https" || url.port_or_known_default() != Some(self.port) {
            return false;
        }
        let Some(host) = url.host() else { return false };
        PinHost::from_host(host.to_owned(), false).is_ok_and(|host| self.host.covers(&host))
    }

    pub fn covers(&self, other: &Self) -> bool {
        self.port == other.port && self.host.covers(&other.host)
    }
}

impl fmt::Display for PinPattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("https://")?;
        match &self.host {
            PinHost::Exact(name) => f.write_str(name)?,
            PinHost::Wildcard(suffix) => write!(f, "*.{suffix}")?,
            PinHost::Ip(IpAddr::V4(ip)) => write!(f, "{ip}")?,
            PinHost::Ip(IpAddr::V6(ip)) => write!(f, "[{ip}]")?,
        }
        write!(f, ":{}", self.port)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PinHost {
    Exact(String),
    Wildcard(String),
    Ip(IpAddr),
}

impl PinHost {
    fn from_host(host: Host<String>, wildcard: bool) -> Result<Self, SecretErrorCode> {
        match host {
            Host::Domain(mut name) => {
                if name.ends_with('.') {
                    name.pop();
                }
                if name.contains('*') || name.split('.').any(str::is_empty) {
                    return Err(SecretErrorCode::PinEntryInvalid);
                }
                Ok(if wildcard {
                    Self::Wildcard(name)
                } else {
                    Self::Exact(name)
                })
            }
            Host::Ipv4(ip) if !wildcard => Ok(Self::Ip(ip.into())),
            Host::Ipv6(ip) if !wildcard => Ok(Self::Ip(ip.into())),
            _ => Err(SecretErrorCode::PinEntryInvalid),
        }
    }

    fn covers(&self, other: &Self) -> bool {
        if self == other {
            return true;
        }
        match (self, other) {
            (Self::Wildcard(suffix), Self::Exact(name) | Self::Wildcard(name)) => name
                .strip_suffix(suffix)
                .is_some_and(|prefix| prefix.ends_with('.')),
            _ => false,
        }
    }
}

pub fn parse_refs(text: &str) -> Result<Vec<RefToken>, SecretErrorCode> {
    STORE_REF
        .captures_iter(text)
        .map(|captures| {
            let Some(namespace) = captures.name("kind") else {
                return Err(SecretErrorCode::RefTypo);
            };
            let kind = if namespace.as_str() == "secrets" {
                RefKind::Secret
            } else {
                RefKind::Var
            };
            let token = captures.get_match();
            Ok(RefToken {
                kind,
                name: captures["name"].to_owned(),
                start: token.start(),
                end: token.end(),
            })
        })
        .collect()
}

pub fn has_secret_ref(text: &str) -> bool {
    STORE_REF.captures_iter(text).any(|captures| {
        captures
            .name("kind")
            .is_some_and(|namespace| namespace.as_str() == "secrets")
    })
}

pub fn slot_allows(consumer: ConsumerType, slot: &Slot, kind: RefKind) -> bool {
    match consumer {
        ConsumerType::AlertDestination | ConsumerType::PipelineDestination => match slot {
            Slot::HeaderValue | Slot::UrlPath | Slot::UrlQuery => true,
            Slot::Metadata { platform, key } => {
                CREDENTIAL_METADATA.contains(&(platform.as_str(), key.as_str()))
            }
            _ => false,
        },
        ConsumerType::SyntheticsCheck => match slot {
            Slot::CheckUrl => kind == RefKind::Var,
            Slot::BasicPassword
            | Slot::BearerToken
            | Slot::CheckHeaderValue
            | Slot::CookieValue
            | Slot::BrowserSecretSlot
            | Slot::StepValue => true,
            _ => false,
        },
        ConsumerType::AiToolset => *slot == Slot::McpHeaderValue,
    }
}

pub fn check_slot(
    consumer: ConsumerType,
    slot: &Slot,
    text: &str,
) -> Result<Vec<RefToken>, SecretErrorCode> {
    let tokens = parse_refs(text)?;
    if tokens
        .iter()
        .any(|token| !slot_allows(consumer, slot, token.kind))
    {
        return Err(SecretErrorCode::RefNotAllowedInField);
    }
    Ok(tokens)
}

pub fn check_template_text(text: &str) -> Result<(), SecretErrorCode> {
    if parse_refs(text)?.is_empty() {
        Ok(())
    } else {
        Err(SecretErrorCode::RefNotAllowedInField)
    }
}

pub fn check_request_url(
    url_text: &str,
    skip_tls_verify: bool,
    consumer_has_secret_ref: bool,
) -> Result<(), SecretErrorCode> {
    if !consumer_has_secret_ref {
        return Ok(());
    }
    let (scheme, authority) = match url_text.split_once("://") {
        Some((scheme, rest)) => (scheme, rest.split_once('/').map_or(rest, |(host, _)| host)),
        None => ("", url_text),
    };
    if scheme.contains("{{") || authority.contains("{{") {
        return Err(SecretErrorCode::TemplatedAuthorityRefused);
    }
    if skip_tls_verify || !scheme.eq_ignore_ascii_case("https") {
        return Err(SecretErrorCode::InsecureTransport);
    }
    Ok(())
}

pub fn check_header_name(name: &str, consumer_has_secret_ref: bool) -> Result<(), SecretErrorCode> {
    let name = name.trim();
    if consumer_has_secret_ref
        && (name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case(":authority"))
    {
        return Err(SecretErrorCode::AuthorityOverrideRefused);
    }
    Ok(())
}

pub fn check_synthetics_url(
    url_text: &str,
    write_only_names: &[&str],
) -> Result<(), SecretErrorCode> {
    check_slot(ConsumerType::SyntheticsCheck, &Slot::CheckUrl, url_text)?;
    for placeholder in url_text.split("{{").skip(1) {
        if let Some((name, _)) = placeholder.split_once("}}") {
            let name = name.trim();
            if name.starts_with(RESERVED_VARIABLE_PREFIX)
                || (!name.starts_with("vars.") && write_only_names.contains(&name))
            {
                return Err(SecretErrorCode::RefNotAllowedInField);
            }
        }
    }
    Ok(())
}

pub fn parse_pins(entries: &[String]) -> Result<Vec<PinPattern>, SecretErrorCode> {
    entries
        .iter()
        .map(|entry| PinPattern::parse(entry))
        .collect()
}

pub fn all_match(pins: &[PinPattern], url: &str) -> bool {
    pins.iter().any(|pin| pin.matches(url))
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use strum::IntoEnumIterator;

    use super::*;

    #[derive(Deserialize)]
    struct PinVectors {
        parse: Vec<ParseVector>,
        #[serde(rename = "match")]
        matches: Vec<MatchVector>,
    }

    #[derive(Deserialize)]
    struct ParseVector {
        entry: String,
        ok: Option<String>,
    }

    #[derive(Deserialize)]
    struct MatchVector {
        pin: String,
        url: String,
        #[serde(rename = "match")]
        expected: bool,
    }

    #[test]
    fn refs_preserve_names_and_byte_spans() {
        let text = "é{{secrets.A}}/{{vars._b2}}{{NAME}}";
        assert_eq!(
            parse_refs(text).unwrap(),
            [
                RefToken {
                    kind: RefKind::Secret,
                    name: "A".into(),
                    start: 2,
                    end: 15
                },
                RefToken {
                    kind: RefKind::Var,
                    name: "_b2".into(),
                    start: 16,
                    end: 28
                },
            ]
        );
        assert!(has_secret_ref(text));
        assert!(has_secret_ref("{{Vars.X}}{{secrets.A}}"));
        assert!(!has_secret_ref("{{NAME}}{{vars.X}}"));
        assert!(
            parse_refs("{{NAME}} {{secret}} {{vars}}")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn ref_typos_fail_instead_of_becoming_literal_text() {
        for text in [
            "{{secret.X}}",
            "{{Secrets.X}}",
            "{{Vars.X}}",
            "{{var.X}}",
            "{{ secrets.X}}",
            "{{secrets.X }}",
            "{{secrets. X}}",
            "{{secrets.}}",
            "{{secrets.X-Y}}",
            "{{secrets.X}",
            "{{vars.0X}}",
            "{{vars.é}}",
        ] {
            assert_eq!(parse_refs(text), Err(SecretErrorCode::RefTypo), "{text}");
        }
        for (length, valid) in [(128, true), (129, false)] {
            let name = "x".repeat(length);
            let result = parse_refs(&format!("{{{{vars.{name}}}}}"));
            if valid {
                assert_eq!(result.unwrap()[0].name, name);
            } else {
                assert_eq!(result, Err(SecretErrorCode::RefTypo));
            }
        }
    }

    #[test]
    fn slot_table_covers_every_consumer_and_ref_kind() {
        use ConsumerType::*;
        use Slot::*;

        let destinations = &[AlertDestination, PipelineDestination][..];
        let checks = &[SyntheticsCheck][..];
        let tools = &[AiToolset][..];
        let none = &[][..];
        let metadata = |platform: &str, key: &str| Metadata {
            platform: platform.into(),
            key: key.into(),
        };
        for (slot, secret_consumers, var_consumers) in [
            (UrlScheme, none, none),
            (UrlUserinfo, none, none),
            (UrlHost, none, none),
            (UrlPort, none, none),
            (UrlPath, destinations, destinations),
            (UrlQuery, destinations, destinations),
            (HeaderName, none, none),
            (HeaderValue, destinations, destinations),
            (
                metadata("pagerduty", "routing_key"),
                destinations,
                destinations,
            ),
            (
                metadata("servicenow", "credential_resolutionCode"),
                none,
                none,
            ),
            (metadata("other", "routing_key"), none, none),
            (metadata("pagerduty", "message"), none, none),
            (TemplateBody, none, none),
            (TemplateTitle, none, none),
            (CheckUrl, none, checks),
            (BasicPassword, checks, checks),
            (BearerToken, checks, checks),
            (CheckHeaderValue, checks, checks),
            (CookieValue, checks, checks),
            (BrowserSecretSlot, checks, checks),
            (StepValue, checks, checks),
            (CookieDomain, none, none),
            (McpHeaderValue, tools, tools),
            (CliEnvValue, none, none),
            (CredentialFile, none, none),
            (Command, none, none),
            (McpUrlHost, none, none),
        ] {
            for consumer in ConsumerType::iter() {
                for (kind, allowed) in [
                    (RefKind::Secret, secret_consumers),
                    (RefKind::Var, var_consumers),
                ] {
                    assert_eq!(
                        slot_allows(consumer, &slot, kind),
                        allowed.contains(&consumer),
                        "{consumer:?} {slot:?} {kind:?}",
                    );
                }
            }
        }
    }

    #[test]
    fn slot_checks_parse_before_enforcing_permissions() {
        let text = "{{vars.X}}{{secrets.Y}}";
        let consumer = ConsumerType::AlertDestination;
        assert_eq!(
            check_slot(consumer, &Slot::HeaderValue, text),
            parse_refs(text)
        );
        assert_eq!(
            check_slot(consumer, &Slot::UrlHost, text),
            Err(SecretErrorCode::RefNotAllowedInField),
        );
        assert_eq!(
            check_slot(consumer, &Slot::UrlHost, "{{vars.X}}{{secret.Y}}"),
            Err(SecretErrorCode::RefTypo),
        );
        assert!(
            check_slot(consumer, &Slot::UrlHost, "host")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn templates_refuse_store_refs_and_typos() {
        for text in ["key={{secrets.X}}", "{{vars.X}}"] {
            assert_eq!(
                check_template_text(text),
                Err(SecretErrorCode::RefNotAllowedInField)
            );
        }
        assert_eq!(
            check_template_text("{{Vars.X}}"),
            Err(SecretErrorCode::RefTypo)
        );
        assert_eq!(check_template_text("{{NAME}}"), Ok(()));
    }

    #[test]
    fn secret_bearing_requests_need_literal_authorities() {
        for url in [
            "https://{{vars.HOST}}/x",
            "https://{{USER}}@h/",
            "https://h:{{vars.PORT}}/",
            "{{SCHEME}}://h/",
            "http://{{HOST}}",
            "{{HOST}}",
            "https://h?key={{vars.V}}",
        ] {
            assert_eq!(
                check_request_url(url, false, true),
                Err(SecretErrorCode::TemplatedAuthorityRefused),
                "{url}",
            );
            assert_eq!(check_request_url(url, false, false), Ok(()), "{url}");
        }
        assert_eq!(
            check_request_url("HTTPS://h/{{vars.X}}", false, true),
            Ok(())
        );
    }

    #[test]
    fn secret_bearing_requests_refuse_authority_overrides() {
        for header in ["Host", ":authority", " HoSt ", "\t:AUTHORITY"] {
            assert_eq!(
                check_header_name(header, true),
                Err(SecretErrorCode::AuthorityOverrideRefused)
            );
            assert_eq!(check_header_name(header, false), Ok(()));
        }
        assert_eq!(check_header_name("X-Host", true), Ok(()));
    }

    #[test]
    fn insecure_transport_requires_absence_of_secret_refs() {
        for (url, skip_verify) in [("http://h/", false), ("https://h/", true)] {
            assert_eq!(
                check_request_url(url, skip_verify, true),
                Err(SecretErrorCode::InsecureTransport)
            );
            assert_eq!(check_request_url(url, skip_verify, false), Ok(()));
        }
    }

    #[test]
    fn synthetics_refuses_direct_and_indirect_write_only_values() {
        let write_only = &["MY_SLOT", "vars.V"];
        for url in [
            "https://h/{{secrets.T}}",
            "https://h/?key={{secrets.T}}",
            "https://{{secrets.T}}/",
            "/step/{{secrets.T}}",
            "https://h/{{MY_SLOT}}",
            "/step/{{ MY_SLOT }}",
            "/step/{{_AUTH_TOKEN}}",
            "/step/{{_AUTH_PASSWORD}}",
            "/step/{{_AUTH_CUSTOM}}",
        ] {
            assert_eq!(
                check_synthetics_url(url, write_only),
                Err(SecretErrorCode::RefNotAllowedInField),
                "{url}"
            );
        }
        for url in ["https://h/?v={{vars.V}}", "/step/{{PLAIN}}"] {
            assert_eq!(check_synthetics_url(url, write_only), Ok(()), "{url}");
        }
        assert_eq!(
            check_synthetics_url("/{{secret.T}}", write_only),
            Err(SecretErrorCode::RefTypo)
        );
    }

    #[test]
    fn shared_pin_vectors() {
        let vectors: PinVectors = serde_json::from_str(include_str!("pin_vectors.json")).unwrap();
        for vector in vectors.parse {
            assert_eq!(
                PinPattern::parse(&vector.entry).map(|pin| pin.to_string()),
                vector.ok.ok_or(SecretErrorCode::PinEntryInvalid),
                "entry {:?}",
                vector.entry,
            );
        }
        for vector in vectors.matches {
            let pin = PinPattern::parse(&vector.pin).unwrap();
            assert_eq!(
                pin.matches(&vector.url),
                vector.expected,
                "{} against {}",
                vector.pin,
                vector.url
            );
        }
    }

    #[test]
    fn pin_coverage_requires_a_subset_of_origins() {
        for (outer, inner, covers) in [
            ("h", "https://H:443/", true),
            ("h", "x.h", false),
            ("h", "*.h", false),
            ("*.s", "*.s", true),
            ("*.s", "a.s", true),
            ("*.s", "*.a.b.s", true),
            ("*.a.s", "*.s", false),
            ("*.s", "s", false),
            ("*.s", "as", false),
            ("*.s", "a.s:8443", false),
            ("h", "h:8443", false),
            ("[::1]", "[0:0:0:0:0:0:0:1]", true),
            ("10.0.0.1", "10.0.0.2", false),
        ] {
            let outer = PinPattern::parse(outer).unwrap();
            let inner = PinPattern::parse(inner).unwrap();
            assert_eq!(outer.covers(&inner), covers, "{outer} covers {inner}");
        }
    }

    #[test]
    fn pin_lists_accept_any_matching_origin() {
        let pins = parse_pins(&["a".into(), "b".into()]).unwrap();
        assert!(all_match(&pins, "https://b/path"));
        assert!(!all_match(&pins, "https://c/"));
        assert!(!all_match(&[], "https://a/"));
        assert!(matches!(
            parse_pins(&["a".into(), "*".into()]),
            Err(SecretErrorCode::PinEntryInvalid)
        ));
    }
}
