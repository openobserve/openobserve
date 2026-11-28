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

//! How OpenObserve signs in to ServiceNow: the method, its save check and its refusal texts.

use config::meta::{
    destinations::{DestinationType, Endpoint},
    secret_store::grammar::{self, RefKind},
};
use reqwest::StatusCode;

use super::platform::{Platform, platform_of};

pub const AUTH_KEY: &str = "servicenow_auth";
pub const USERNAME_KEY: &str = "servicenow_username";
pub const PASSWORD_KEY: &str = "servicenow_password";
pub const RATE_LIMIT_RULE_HEADER: &str = "x-ratelimit-rule";
const API_KEY_HEADER: &str = "x-sn-apikey";
const SIGN_IN_KEYS: [&str; 3] = [AUTH_KEY, USERNAME_KEY, PASSWORD_KEY];
const BASIC_REFUSED: &str = "ServiceNow refused the username and password (401). The account \
                             may need the snc_basic_auth_api_access role, may have MFA turned \
                             on, or an API access policy may block password sign-in.";
const API_KEY_REFUSED: &str =
    "ServiceNow refused the API key (401). Check the key with your ServiceNow team.";
const REQUEST_FORBIDDEN: &str = "ServiceNow refused the request (403). The account OpenObserve \
                                 signs in with needs a role that can create incidents, such as \
                                 itil, or a table ACL blocks it. Ask your ServiceNow team.";

/// A sign-in method named by `servicenow_auth`; a destination without one keeps its own headers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignIn {
    Basic,
    ApiKey,
}

impl SignIn {
    /// The method the endpoint's metadata names, or `None` when it names none. [pure]
    pub fn of(endpoint: &Endpoint) -> Result<Option<Self>, String> {
        match endpoint.metadata.get(AUTH_KEY).map(String::as_str) {
            None => Ok(None),
            Some("basic") => Ok(Some(Self::Basic)),
            Some("api_key") => Ok(Some(Self::ApiKey)),
            Some(_) => Err(format!("{AUTH_KEY} must be basic or api_key.")),
        }
    }
}

/// The sign-in method of a ServiceNow destination; other destinations never have one. [pure]
pub fn sign_in_of(dest_type: &DestinationType) -> Result<Option<SignIn>, String> {
    match dest_type {
        DestinationType::Http(endpoint) if is_servicenow(dest_type) => SignIn::of(endpoint),
        DestinationType::Http(_)
        | DestinationType::Email(_)
        | DestinationType::Sns(_)
        | DestinationType::SlackApp(_) => Ok(None),
    }
}

/// Refuses a sign-in that is incomplete, mixed with another credential or off ServiceNow. [pure]
pub fn check(dest_type: &DestinationType) -> Result<(), String> {
    let DestinationType::Http(endpoint) = dest_type else {
        return Ok(());
    };
    if !is_servicenow(dest_type) {
        return refuse_keys(
            endpoint,
            &SIGN_IN_KEYS,
            "is only used by a ServiceNow destination",
        );
    }
    // Without a method the destination signs in with its own headers, as before (D11).
    let not_basic = "is only used when servicenow_auth is basic";
    match SignIn::of(endpoint)? {
        None => refuse_keys(endpoint, &[USERNAME_KEY, PASSWORD_KEY], not_basic),
        Some(SignIn::Basic) => check_basic(endpoint),
        Some(SignIn::ApiKey) => {
            refuse_keys(endpoint, &[USERNAME_KEY, PASSWORD_KEY], not_basic)?;
            check_api_key(endpoint)
        }
    }
}

/// The text a refused request shows after "{destination}:", or `None` to keep today's. [pure]
pub fn rejection(
    sign_in: Option<SignIn>,
    status: StatusCode,
    rate_rule: Option<&str>,
) -> Option<String> {
    let sign_in = sign_in?;
    let text = match status {
        StatusCode::UNAUTHORIZED => match sign_in {
            SignIn::Basic => BASIC_REFUSED,
            SignIn::ApiKey => API_KEY_REFUSED,
        }
        .to_owned(),
        StatusCode::FORBIDDEN => REQUEST_FORBIDDEN.to_owned(),
        StatusCode::TOO_MANY_REQUESTS => {
            let rule = rate_rule
                .map(str::trim)
                .filter(|rule| !rule.is_empty())
                .map(|rule| format!(" ({rule})"))
                .unwrap_or_default();
            format!(
                "ServiceNow is rate limiting requests{rule}. A ServiceNow admin can raise the \
                 limit for this user."
            )
        }
        _ => return None,
    };
    Some(text)
}

fn is_servicenow(dest_type: &DestinationType) -> bool {
    platform_of(dest_type) == Some(Platform::ServiceNow)
}

fn has_header(endpoint: &Endpoint, name: &str) -> bool {
    header_values(endpoint, name).next().is_some()
}

fn header_values<'a>(endpoint: &'a Endpoint, name: &str) -> impl Iterator<Item = &'a str> {
    endpoint
        .headers
        .iter()
        .flatten()
        .filter(move |(key, _)| key.trim().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn refuse_keys(endpoint: &Endpoint, keys: &[&str], reason: &str) -> Result<(), String> {
    match keys
        .iter()
        .find(|key| endpoint.metadata.contains_key(**key))
    {
        Some(key) => Err(format!("{key} {reason}.")),
        None => Ok(()),
    }
}

fn check_basic(endpoint: &Endpoint) -> Result<(), String> {
    if endpoint
        .metadata
        .get(USERNAME_KEY)
        .is_none_or(|username| username.trim().is_empty())
    {
        return Err(format!("servicenow_auth basic needs {USERNAME_KEY}."));
    }
    // Basic splits user and password at the first ':' (RFC 7617), so a username cannot hold one.
    if endpoint
        .metadata
        .get(USERNAME_KEY)
        .is_some_and(|username| username.contains(':'))
    {
        return Err(format!("{USERNAME_KEY} cannot contain ':'."));
    }
    let password = endpoint
        .metadata
        .get(PASSWORD_KEY)
        .map_or("", String::as_str);
    if !is_one_secret(password) {
        return Err(format!(
            "{PASSWORD_KEY} must be exactly one {{{{secrets.NAME}}}} reference and nothing else."
        ));
    }
    if has_header(endpoint, "authorization") {
        return Err(
            "Remove the Authorization header: servicenow_auth basic signs in with \
             servicenow_username and servicenow_password."
                .into(),
        );
    }
    if has_header(endpoint, API_KEY_HEADER) {
        return Err(format!(
            "The {API_KEY_HEADER} header is only used when servicenow_auth is api_key."
        ));
    }
    Ok(())
}

fn check_api_key(endpoint: &Endpoint) -> Result<(), String> {
    let mut keys = header_values(endpoint, API_KEY_HEADER);
    match (keys.next(), keys.next()) {
        (Some(key), None) if is_one_secret(key) => Ok(()),
        (None, _) => Err(format!(
            "servicenow_auth api_key needs an {API_KEY_HEADER} header."
        )),
        _ => Err(format!(
            "The {API_KEY_HEADER} header must be exactly one {{{{secrets.NAME}}}} reference and \
             nothing else."
        )),
    }
}

fn is_one_secret(text: &str) -> bool {
    matches!(
        grammar::parse_refs(text).as_deref(),
        Ok([token]) if token.kind == RefKind::Secret && token.start == 0 && token.end == text.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "{{secrets.SN_PW}}";

    fn destination(
        platform: &str,
        metadata: &[(&str, &str)],
        headers: &[(&str, &str)],
    ) -> DestinationType {
        DestinationType::Http(Endpoint {
            url: "https://acme.service-now.com/api/now/table/incident".into(),
            destination_type: Some(platform.into()),
            metadata: metadata
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            headers: Some(
                headers
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            ),
            ..Default::default()
        })
    }

    #[test]
    fn the_save_check_refuses_each_mixed_or_incomplete_sign_in() {
        let basic = [
            (AUTH_KEY, "basic"),
            (USERNAME_KEY, "abcd"),
            (PASSWORD_KEY, SECRET),
        ];
        let api_key = [(AUTH_KEY, "api_key")];
        let apikey_header = [(API_KEY_HEADER, "{{secrets.SN_KEY}}")];
        let plain_basic = [("Authorization", "Basic YWJjZDpwdw==")];
        let refused = |field: &str| Some(field.to_owned());
        for (case, platform, metadata, headers, expected) in [
            (
                "old plain Basic",
                "servicenow",
                &[][..],
                &plain_basic[..],
                None,
            ),
            (
                "basic with a secret",
                "servicenow",
                &basic[..],
                &[][..],
                None,
            ),
            (
                "api_key with its header",
                "servicenow",
                &api_key[..],
                &apikey_header[..],
                None,
            ),
            (
                "a webhook may send x-sn-apikey",
                "webhook",
                &[][..],
                &apikey_header[..],
                None,
            ),
            (
                "oauth is not offered yet",
                "servicenow",
                &[(AUTH_KEY, "oauth")][..],
                &[][..],
                refused(AUTH_KEY),
            ),
            (
                "unknown method",
                "servicenow",
                &[(AUTH_KEY, "Basic")][..],
                &[][..],
                refused(AUTH_KEY),
            ),
            (
                "basic without a username",
                "servicenow",
                &[(AUTH_KEY, "basic"), (PASSWORD_KEY, SECRET)][..],
                &[][..],
                refused(USERNAME_KEY),
            ),
            (
                "basic with a colon in the username",
                "servicenow",
                &[
                    (AUTH_KEY, "basic"),
                    (USERNAME_KEY, "svc:ops"),
                    (PASSWORD_KEY, SECRET),
                ][..],
                &[][..],
                refused(USERNAME_KEY),
            ),
            (
                "basic with a blank username",
                "servicenow",
                &[
                    (AUTH_KEY, "basic"),
                    (USERNAME_KEY, " "),
                    (PASSWORD_KEY, SECRET),
                ][..],
                &[][..],
                refused(USERNAME_KEY),
            ),
            (
                "basic without a password",
                "servicenow",
                &[(AUTH_KEY, "basic"), (USERNAME_KEY, "abcd")][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
            (
                "basic with a plain password",
                "servicenow",
                &[
                    (AUTH_KEY, "basic"),
                    (USERNAME_KEY, "abcd"),
                    (PASSWORD_KEY, "hunter2"),
                ][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
            (
                "basic with text around the reference",
                "servicenow",
                &[
                    (AUTH_KEY, "basic"),
                    (USERNAME_KEY, "abcd"),
                    (PASSWORD_KEY, "x{{secrets.SN_PW}}"),
                ][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
            (
                "basic with two references",
                "servicenow",
                &[
                    (AUTH_KEY, "basic"),
                    (USERNAME_KEY, "abcd"),
                    (PASSWORD_KEY, "{{secrets.A}}{{secrets.B}}"),
                ][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
            (
                "basic with a variable",
                "servicenow",
                &[
                    (AUTH_KEY, "basic"),
                    (USERNAME_KEY, "abcd"),
                    (PASSWORD_KEY, "{{vars.PW}}"),
                ][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
            (
                "basic and an Authorization header",
                "servicenow",
                &basic[..],
                &[("authorization", "Basic YWJjZDpwdw==")][..],
                refused("Authorization"),
            ),
            (
                "basic and an x-sn-apikey header",
                "servicenow",
                &basic[..],
                &[("X-SN-ApiKey", "{{secrets.SN_KEY}}")][..],
                refused(API_KEY_HEADER),
            ),
            (
                "api_key without its header",
                "servicenow",
                &api_key[..],
                &[][..],
                refused(API_KEY_HEADER),
            ),
            (
                "api_key with a typed key",
                "servicenow",
                &api_key[..],
                &[(API_KEY_HEADER, "abc123")][..],
                refused(API_KEY_HEADER),
            ),
            (
                "api_key with an empty key",
                "servicenow",
                &api_key[..],
                &[(API_KEY_HEADER, "")][..],
                refused(API_KEY_HEADER),
            ),
            (
                "api_key with text around the reference",
                "servicenow",
                &api_key[..],
                &[(API_KEY_HEADER, "key {{secrets.SN_KEY}}")][..],
                refused(API_KEY_HEADER),
            ),
            (
                "api_key with a password",
                "servicenow",
                &[(AUTH_KEY, "api_key"), (PASSWORD_KEY, SECRET)][..],
                &apikey_header[..],
                refused(PASSWORD_KEY),
            ),
            (
                "api_key with a username",
                "servicenow",
                &[(AUTH_KEY, "api_key"), (USERNAME_KEY, "abcd")][..],
                &apikey_header[..],
                refused(USERNAME_KEY),
            ),
            (
                "a password without a method",
                "servicenow",
                &[(PASSWORD_KEY, SECRET)][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
            (
                "sign-in keys on another platform",
                "pagerduty",
                &[(AUTH_KEY, "basic")][..],
                &[][..],
                refused(AUTH_KEY),
            ),
            (
                "a password on another platform",
                "webhook",
                &[(PASSWORD_KEY, SECRET)][..],
                &[][..],
                refused(PASSWORD_KEY),
            ),
        ] {
            let result = check(&destination(platform, metadata, headers));
            match expected {
                None => assert_eq!(result, Ok(()), "{case}"),
                Some(field) => {
                    let message = result.expect_err(case);
                    assert!(message.contains(&field), "{case}: {message}");
                }
            }
        }
    }

    #[test]
    fn a_refused_request_names_the_sign_in_and_never_the_body() {
        let basic_401 = "ServiceNow refused the username and password (401). The account may need \
                         the snc_basic_auth_api_access role, may have MFA turned on, or an API \
                         access policy may block password sign-in.";
        let api_key_401 = "ServiceNow refused the API key (401). Check the key with your \
                           ServiceNow team.";
        let forbidden = "ServiceNow refused the request (403). The account OpenObserve signs in \
                         with needs a role that can create incidents, such as itil, or a table \
                         ACL blocks it. Ask your ServiceNow team.";
        let limited = |rule: &str| {
            format!(
                "ServiceNow is rate limiting requests{rule}. A ServiceNow admin can raise the \
                 limit for this user."
            )
        };
        use SignIn::*;
        for (sign_in, status, rule, expected) in [
            (Some(Basic), 401, None, Some(basic_401.to_owned())),
            (Some(ApiKey), 401, None, Some(api_key_401.to_owned())),
            (Some(Basic), 403, None, Some(forbidden.to_owned())),
            (Some(ApiKey), 403, None, Some(forbidden.to_owned())),
            (
                Some(Basic),
                429,
                Some("incident-create"),
                Some(limited(" (incident-create)")),
            ),
            (Some(ApiKey), 429, None, Some(limited(""))),
            (Some(Basic), 500, None, None),
            (Some(ApiKey), 404, None, None),
            (None, 401, None, None),
            (None, 403, None, None),
            (None, 429, Some("incident-create"), None),
        ] {
            let status = StatusCode::from_u16(status).unwrap();
            assert_eq!(
                rejection(sign_in, status, rule),
                expected,
                "{sign_in:?} {status}"
            );
        }
    }
}
