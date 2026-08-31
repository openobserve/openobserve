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

//! Org-level synthetics variables and the environments that scope them.
//!
//! Two tiers resolve into the probe's flat `env_inject` map: these shared
//! variables first, then the check's own inline `SyntheticVariable`, so the
//! narrower tier wins name by name. An environment is a filter and an access
//! boundary, never a third tier.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Longest accepted variable name. A name past this is a paste accident, not a
/// binding anything types.
pub const MAX_VARIABLE_NAME_LEN: usize = 128;

/// Longest accepted environment name. Names become OpenFGA object ids, so this
/// also bounds the object id.
pub const MAX_ENVIRONMENT_NAME_LEN: usize = 64;

/// Names the probe reserves for credentials it injects itself (`_AUTH_COOKIES`
/// and the `build_env_map` keys). A shared variable claiming one would
/// overwrite the check's own auth at resolve time.
pub const RESERVED_VARIABLE_PREFIX: &str = "_AUTH_";

/// Whether a value is ever readable again after it is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SyntheticsVariableKind {
    #[default]
    Plain,
    /// Write-only. No read DTO carries the value — see [`SyntheticsVariableView`].
    Secret,
}

/// Create/update body for a shared variable.
///
/// `value` is optional so an update can leave a write-only secret alone: the
/// client holds `has_value`, never the value, so it has nothing to send back.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct SyntheticsVariableRequest {
    pub name: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub kind: SyntheticsVariableKind,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub example: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A variable's value as a read path may carry it.
///
/// **The `Secret` variant has no value field**, which is the whole point. A
/// single `value: Option<String>` would serve the list just as well and would
/// quietly lose the guarantee: `None` for a secret is a convention, and a
/// convention is something a later call site can forget. This makes a secret's
/// plaintext on a read path a compile error instead.
///
/// Tagged `kind` because that is what it replaces — the wire shape stays
/// `{"kind": "plain", "value": "…"}` and clients read `kind` unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VariableValueView {
    Plain {
        value: String,
    },
    /// Write-only: presence is all a client ever learns.
    Secret {
        has_value: bool,
    },
}

impl Default for VariableValueView {
    fn default() -> Self {
        Self::Plain {
            value: String::new(),
        }
    }
}

/// What every read path returns for a shared variable.
///
/// A plain value is carried; a secret's cannot be — see [`VariableValueView`].
/// `example` stands in for the value wherever the UI needs to show the shape of
/// one it may not read.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct SyntheticsVariableView {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub value: VariableValueView,
    pub description: String,
    pub example: String,
    pub tags: Vec<String>,
    /// Checks whose definition references `{{NAME}}`.
    ///
    /// Answers "what breaks if I change this?", and is the safety check before
    /// a delete — which is why it is on the list row rather than behind a
    /// second call.
    #[serde(default)]
    pub used_by_checks: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One name in a check's resolved set, and where it comes from.
///
/// Drives the check editor's Inherited group and the `{{` autocomplete. Metadata
/// only — like every read path here, it carries no value.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ResolvedVariableView {
    pub name: String,
    pub kind: SyntheticsVariableKind,
    /// `global`, an environment name, or `check`.
    pub scope: String,
    /// A shared variable this check redefines. The shared row still exists; the
    /// check's value is what resolves.
    pub overridden: bool,
    pub example: String,
    pub description: String,
    pub has_value: bool,
}

/// Where a variable is being moved to, for the two promote flows.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct PromoteVariableRequest {
    /// Destination environment name, or None for the unscoped tier.
    #[serde(default)]
    pub environment: Option<String>,
}

/// One destination of a global → per-environment split.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct SplitTarget {
    pub environment: String,
    pub value: String,
}

/// Splitting a global variable into per-environment rows.
///
/// Values are collected up front rather than filled in afterwards: the failure
/// mode is silent, because scoping `BASE_URL` to production alone means every
/// check running against staging stops resolving it.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct SplitVariableRequest {
    pub targets: Vec<SplitTarget>,
}

/// Create/update body for an environment.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct SyntheticsEnvironmentRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// One environment with its variables inline.
///
/// The list endpoint returns this shape, which renders the whole Environments
/// tab in one call. `variables` is metadata only, so the payload stays bounded
/// no matter how many secrets an environment holds.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct SyntheticsEnvironmentView {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Checks pinned to this environment. Not derivable from this response, so
    /// it is counted server-side; `variables.len()` is, so it is not sent.
    pub checks_count: u64,
    pub variables: Vec<SyntheticsVariableView>,
}

/// Every `{{NAME}}` a piece of text references, as written.
///
/// Case is preserved rather than normalised, because substitution is an exact
/// key lookup on both sides (`envVars[k]` in the probe, `vars[k]` in the
/// editor). `{{base_url}}` does not resolve a variable stored as `BASE_URL`, so
/// counting it as a use would report a binding that does not exist.
pub fn placeholder_names(text: &str) -> BTreeSet<String> {
    let bytes = text.as_bytes();
    let mut found = BTreeSet::new();
    let mut i = 0;
    while let Some(open) = text[i..].find("{{") {
        let start = i + open + 2;
        let mut j = start;
        while j < bytes.len() && (bytes[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        let name_start = j;
        while j < bytes.len() && ((bytes[j] as char).is_ascii_alphanumeric() || bytes[j] == b'_') {
            j += 1;
        }
        let name_end = j;
        while j < bytes.len() && (bytes[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        if name_end > name_start && text[j..].starts_with("}}") {
            found.insert(text[name_start..name_end].to_string());
            i = j + 2;
        } else {
            // Not a placeholder — resume just past the braces so `{{{{X}}` is
            // still seen, rather than skipping the whole run.
            i = start;
        }
    }
    found
}

/// Substitutes `{{NAME}}` from a resolved map, leaving unbound names verbatim.
///
/// The Rust twin of the probe's `substituteSecretsV2` and the editor's
/// `substituteVariables`, and it makes the same choice for the same reason:
/// `{{...}}` is not necessarily a variable reference, so an unbound name is
/// text rather than an empty string.
pub fn substitute_placeholders(text: &str, values: &HashMap<String, String>) -> String {
    if !text.contains("{{") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        out.push_str(&rest[..open]);
        let after = &rest[open + 2..];
        match after.find("}}") {
            Some(close) => {
                let name = after[..close].trim();
                match values.get(name) {
                    Some(value) => out.push_str(value),
                    None => {
                        out.push_str("{{");
                        out.push_str(&after[..close]);
                        out.push_str("}}");
                    }
                }
                rest = &after[close + 2..];
            }
            None => {
                // An unclosed `{{` is ordinary text, not a broken placeholder.
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Upper-cases a variable name, which is how every name is stored.
///
/// Form-level upper-casing is a convenience; this is the enforcement, because an
/// API client can `POST` `base_url` directly and `{{base_url}}` must then bind.
pub fn normalize_variable_name(name: &str) -> String {
    name.trim().to_ascii_uppercase()
}

/// Validates an already-normalised variable name.
pub fn validate_variable_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("name: must not be empty".to_string());
    }
    if name.len() > MAX_VARIABLE_NAME_LEN {
        return Err(format!(
            "name: too long ({} > {MAX_VARIABLE_NAME_LEN} chars)",
            name.len()
        ));
    }
    let valid = name
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(format!(
            "name: invalid name '{name}' (must match [A-Za-z_][A-Za-z0-9_]*)"
        ));
    }
    if name.starts_with(RESERVED_VARIABLE_PREFIX) {
        return Err(format!(
            "name: '{RESERVED_VARIABLE_PREFIX}' is reserved for credentials the probe injects itself"
        ));
    }
    Ok(())
}

/// Validates an environment name.
///
/// Stricter than a variable name because the name becomes an OpenFGA object id:
/// `_` is reserved for OpenFGA's own `_all_{org}` wildcards, and a name carrying
/// one would collide with them.
pub fn validate_environment_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("name: must not be empty".to_string());
    }
    if name.len() > MAX_ENVIRONMENT_NAME_LEN {
        return Err(format!(
            "name: too long ({} > {MAX_ENVIRONMENT_NAME_LEN} chars)",
            name.len()
        ));
    }
    if name.starts_with('_') {
        return Err(
            "name: must not start with '_' — that prefix is reserved for OpenFGA wildcards"
                .to_string(),
        );
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!(
            "name: invalid name '{name}' (letters, digits, '_' and '-' only)"
        ));
    }
    Ok(())
}

/// Validates a create/update body, given whether a value is already stored.
///
/// `has_stored_value` is what makes an update legal without a value: a secret's
/// value cannot be round-tripped, so an omitted one means "leave it alone" —
/// but only when there is something to leave alone.
pub fn validate_variable_request(
    req: &SyntheticsVariableRequest,
    env: Option<&str>,
    has_stored_value: bool,
) -> Result<(), String> {
    validate_variable_name(&normalize_variable_name(&req.name))?;
    if req.kind == SyntheticsVariableKind::Secret && env.is_none() {
        return Err(
            "kind: a secret must belong to an environment — that is what gives it an access \
             boundary"
                .to_string(),
        );
    }
    if req.value.is_none() && !has_stored_value {
        return Err("value: must be set when the variable has no stored value".to_string());
    }
    if req.description.len() > 4096 {
        return Err(format!(
            "description: too long ({} > 4096 chars)",
            req.description.len()
        ));
    }
    if req.example.len() > 4096 {
        return Err(format!(
            "example: too long ({} > 4096 chars)",
            req.example.len()
        ));
    }
    for tag in &req.tags {
        if tag.trim().is_empty() {
            return Err("tags: empty tag not allowed".to_string());
        }
        if tag.len() > 64 {
            return Err(format!("tags: tag too long ({} > 64 chars)", tag.len()));
        }
    }
    Ok(())
}

/// Validates an environment create/update body.
pub fn validate_environment_request(req: &SyntheticsEnvironmentRequest) -> Result<(), String> {
    validate_environment_name(req.name.trim())?;
    if req.description.len() > 4096 {
        return Err(format!(
            "description: too long ({} > 4096 chars)",
            req.description.len()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_stored_upper_cased() {
        // An API client can POST `base_url` directly, so upper-casing in the
        // form is a convenience and this is the enforcement.
        assert_eq!(normalize_variable_name("  base_url "), "BASE_URL");
        assert_eq!(normalize_variable_name("BASE_URL"), "BASE_URL");
    }

    #[test]
    fn variable_names_follow_the_check_tier_rule() {
        assert!(validate_variable_name("BASE_URL").is_ok());
        assert!(validate_variable_name("_PRIVATE").is_ok());
        assert!(validate_variable_name("1ST").is_err());
        assert!(validate_variable_name("HAS-DASH").is_err());
        assert!(validate_variable_name("").is_err());
    }

    #[test]
    fn the_probes_own_credential_prefix_is_reserved() {
        // `_AUTH_COOKIES` and the build_env_map keys are injected by resolve
        // itself; a shared variable claiming one would overwrite the check's auth.
        assert!(validate_variable_name("_AUTH_COOKIES").is_err());
        assert!(validate_variable_name("_AUTHENTIC").is_ok());
    }

    #[test]
    fn environment_names_reject_the_openfga_wildcard_prefix() {
        assert!(validate_environment_name("prod").is_ok());
        assert!(validate_environment_name("pre-prod_1").is_ok());
        assert!(validate_environment_name("_all_acme").is_err());
        assert!(validate_environment_name("has space").is_err());
        assert!(validate_environment_name("").is_err());
    }

    #[test]
    fn a_secret_without_an_environment_is_rejected() {
        let req = SyntheticsVariableRequest {
            name: "TOKEN".into(),
            value: Some("s3cret".into()),
            kind: SyntheticsVariableKind::Secret,
            ..Default::default()
        };
        assert!(validate_variable_request(&req, None, false).is_err());
        assert!(validate_variable_request(&req, Some("env-id"), false).is_ok());
    }

    #[test]
    fn an_update_may_omit_the_value_only_when_one_is_stored() {
        let req = SyntheticsVariableRequest {
            name: "TOKEN".into(),
            value: None,
            kind: SyntheticsVariableKind::Secret,
            ..Default::default()
        };
        assert!(validate_variable_request(&req, Some("env-id"), true).is_ok());
        assert!(validate_variable_request(&req, Some("env-id"), false).is_err());
    }

    #[test]
    fn placeholders_are_found_with_and_without_padding() {
        let found = placeholder_names("{{A}} and {{ B }} and {{\tC\t}}");
        assert_eq!(
            found.into_iter().collect::<Vec<_>>(),
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
    }

    #[test]
    fn placeholder_case_is_preserved() {
        // Substitution is an exact key lookup on both sides, so `{{base_url}}`
        // genuinely does not resolve a variable stored as `BASE_URL`. Folding
        // case here would report a binding that does not exist.
        let found = placeholder_names("{{base_url}}");
        assert!(found.contains("base_url"));
        assert!(!found.contains("BASE_URL"));
    }

    #[test]
    fn malformed_braces_yield_nothing() {
        assert!(placeholder_names("{{}}").is_empty());
        assert!(placeholder_names("{{ }}").is_empty());
        assert!(placeholder_names("{{A").is_empty());
        assert!(placeholder_names("{{A-B}}").is_empty());
        assert!(placeholder_names("plain text").is_empty());
    }

    #[test]
    fn a_placeholder_after_a_malformed_one_is_still_found() {
        // The scan resumes just past the braces rather than past the whole run,
        // so one bad match cannot swallow the next good one.
        assert!(placeholder_names("{{ {{GOOD}}").contains("GOOD"));
    }

    #[test]
    fn substitution_leaves_an_unbound_name_verbatim() {
        // Same choice as the probe and the editor, for the same reason: a check
        // may legitimately put those characters in a URL.
        let values = HashMap::from([("BASE_URL".to_string(), "https://shop.test".to_string())]);
        assert_eq!(
            substitute_placeholders("{{BASE_URL}}/login", &values),
            "https://shop.test/login"
        );
        assert_eq!(
            substitute_placeholders("{{TYPO}}/login", &values),
            "{{TYPO}}/login"
        );
    }

    #[test]
    fn substitution_handles_padding_and_repeats() {
        let values = HashMap::from([("A".to_string(), "1".to_string())]);
        assert_eq!(substitute_placeholders("{{ A }}-{{A}}", &values), "1-1");
    }

    #[test]
    fn an_unclosed_brace_is_ordinary_text() {
        let values = HashMap::from([("A".to_string(), "1".to_string())]);
        assert_eq!(substitute_placeholders("{{A", &values), "{{A");
        assert_eq!(substitute_placeholders("a {{ b", &values), "a {{ b");
    }

    #[test]
    fn text_without_placeholders_is_returned_unchanged() {
        let values = HashMap::from([("A".to_string(), "1".to_string())]);
        assert_eq!(
            substitute_placeholders("https://shop.test", &values),
            "https://shop.test"
        );
    }

    #[test]
    fn a_secret_view_has_no_value_field() {
        // The guarantee this module rests on: serialising a secret cannot emit
        // a value, because the variant has no value to forget to redact.
        let view = SyntheticsVariableView {
            name: "TOKEN".into(),
            value: VariableValueView::Secret { has_value: true },
            ..Default::default()
        };
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("\"value\""), "{json}");
        assert!(json.contains("\"kind\":\"secret\""), "{json}");
        assert!(json.contains("\"has_value\":true"), "{json}");
    }

    #[test]
    fn a_plain_view_carries_its_value() {
        // §6 is about secrets. A BASE_URL you cannot read is one you cannot
        // verify, and hiding it protects nothing.
        let view = SyntheticsVariableView {
            name: "BASE_URL".into(),
            value: VariableValueView::Plain {
                value: "https://shop.test".into(),
            },
            ..Default::default()
        };
        let json = serde_json::to_string(&view).unwrap();
        assert!(json.contains("\"kind\":\"plain\""), "{json}");
        assert!(json.contains("https://shop.test"), "{json}");
        assert!(!json.contains("has_value"), "{json}");
    }
}
