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

use super::synthetics::MAX_VARIABLES;

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
    /// Optional so an update that never mentions `kind` is not read as an
    /// attempt to change it — the field defaults to `Plain`, and a client
    /// editing a secret's description sends no kind at all.
    #[serde(default)]
    pub kind: Option<SyntheticsVariableKind>,
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

/// Every environment's resolved set in one response, keyed by environment name.
///
/// One entry per environment the check targets (`""` for an unscoped check), so
/// the editor switches environments without a request per flip. The merge runs
/// server-side per environment — `overridden` genuinely varies by environment,
/// so a client cannot reconstruct this from declarations.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ResolvedVariablesGrouped {
    /// Environment names in the check's stored order; a single `""` when unscoped.
    pub environments: Vec<String>,
    pub resolved: HashMap<String, Vec<ResolvedVariableView>>,
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

/// A shared variable's identity for cap arithmetic: name and scope, no value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedVariableScope {
    pub name: String,
    /// `None` is the unscoped tier, which merges into every check in the org.
    pub env: Option<String>,
}

/// One check as the variable cap sees it: what it defines and where it runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckVariableFootprint {
    /// Identity, because two checks in an org may share a name.
    pub id: String,
    /// Only ever used to name the check in the error.
    pub name: String,
    pub own_names: Vec<String>,
    /// Environment ids. Empty means unscoped, which resolves globals only.
    pub environments: Vec<String>,
}

/// The org's checks and shared rows together.
///
/// Neither half alone can answer how many variables a check resolves, which is
/// why the write-time gate takes a whole state rather than the row being
/// written.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OrgVariableState {
    pub checks: Vec<CheckVariableFootprint>,
    pub shared: Vec<SharedVariableScope>,
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

/// Validates a create/update body against what is already stored.
///
/// `has_stored_value` is what makes an update legal without a value: a secret's
/// value cannot be round-tripped, so an omitted one means "leave it alone" —
/// but only when there is something to leave alone. `stored_kind` is `None` on
/// a create and the stored kind on an update, which is what makes kind
/// immutable: both kinds hold the same encrypted value, so `kind` is the entire
/// difference between a write-only secret and one any reader with GET can
/// fetch, and an update that rewrote it would turn write access into read
/// access permanently.
pub fn validate_variable_request(
    req: &SyntheticsVariableRequest,
    env: Option<&str>,
    has_stored_value: bool,
    stored_kind: Option<SyntheticsVariableKind>,
) -> Result<(), String> {
    validate_variable_name(&normalize_variable_name(&req.name))?;
    if let (Some(requested), Some(stored)) = (req.kind, stored_kind)
        && requested != stored
    {
        let stored = match stored {
            SyntheticsVariableKind::Secret => "a secret",
            SyntheticsVariableKind::Plain => "plain",
        };
        return Err(format!(
            "kind: a variable's kind is fixed when it is created; this one is stored as {stored}"
        ));
    }
    if req.kind.unwrap_or_default() == SyntheticsVariableKind::Secret && env.is_none() {
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

/// Rejects a write that would push a check past `MAX_VARIABLES`.
///
/// The cap has always been enforced at resolve time, which is too late to point
/// at a cause: an unscoped variable merges into every check in the org, so one
/// call that returned 200 breaks every check at its next scheduled run. This is
/// the same arithmetic run before the write instead.
///
/// Compared rather than absolute, because an org can be pushed over the limit by
/// an upgrade and must still be able to edit and delete its way back under. A
/// check is refused when it gains an over-cap environment, or when its worst
/// over-cap environment gets worse — so narrowing is always allowed and
/// spreading never is.
pub fn variable_cap_error(before: &OrgVariableState, after: &OrgVariableState) -> Option<String> {
    let was = over_cap_counts(before);
    let now = over_cap_counts(after);

    let broken: Vec<&CheckVariableFootprint> = after
        .checks
        .iter()
        .filter(|check| {
            let (was, now) = (was.get(&check.id), now.get(&check.id));
            let count = |c: Option<&Vec<usize>>| c.map_or(0, Vec::len);
            let worst = |c: Option<&Vec<usize>>| c.and_then(|v| v.iter().max().copied());
            count(now) > count(was) || worst(now) > worst(was)
        })
        .collect();
    if broken.is_empty() {
        return None;
    }
    let names: BTreeSet<&str> = broken.iter().map(|c| c.name.as_str()).collect();
    Some(format!(
        "variables: this would push {} check(s) past the {MAX_VARIABLES} variable limit: {}",
        names.len(),
        names.into_iter().collect::<Vec<_>>().join(", ")
    ))
}

/// Each check's resolved-set sizes that exceed the cap, one per environment.
///
/// Kept per environment rather than collapsed to the check's maximum: a check
/// with one environment already over the cap would otherwise shield every other
/// environment it targets, which could then climb to that same figure unnoticed.
/// The tiers merge by name, so a name a check redefines resolves once — counting
/// rows rather than names would refuse writes that are actually fine.
fn over_cap_counts(state: &OrgVariableState) -> HashMap<String, Vec<usize>> {
    let mut over: HashMap<String, Vec<usize>> = HashMap::new();
    for check in &state.checks {
        // An unscoped check still has one resolved set: the globals.
        let targets: Vec<Option<&str>> = if check.environments.is_empty() {
            vec![None]
        } else {
            check
                .environments
                .iter()
                .map(|e| Some(e.as_str()))
                .collect()
        };
        for env in targets {
            let mut names: BTreeSet<&str> = state
                .shared
                .iter()
                // As `resolve_shared_variables`: unscoped is everywhere.
                .filter(|v| match (v.env.as_deref(), env) {
                    (None, _) => true,
                    (Some(row), Some(target)) => row == target,
                    (Some(_), None) => false,
                })
                .map(|v| v.name.as_str())
                .collect();
            names.extend(check.own_names.iter().map(String::as_str));
            if names.len() > MAX_VARIABLES {
                over.entry(check.id.clone()).or_default().push(names.len());
            }
        }
    }
    over
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
            kind: Some(SyntheticsVariableKind::Secret),
            ..Default::default()
        };
        assert!(validate_variable_request(&req, None, false, None).is_err());
        assert!(validate_variable_request(&req, Some("env-id"), false, None).is_ok());
    }

    #[test]
    fn an_update_may_omit_the_value_only_when_one_is_stored() {
        let req = SyntheticsVariableRequest {
            name: "TOKEN".into(),
            value: None,
            kind: Some(SyntheticsVariableKind::Secret),
            ..Default::default()
        };
        let stored = Some(SyntheticsVariableKind::Secret);
        assert!(validate_variable_request(&req, Some("env-id"), true, stored).is_ok());
        assert!(validate_variable_request(&req, Some("env-id"), false, stored).is_err());
    }

    fn footprint(name: &str, own: &[&str], envs: &[&str]) -> CheckVariableFootprint {
        CheckVariableFootprint {
            id: format!("id-{name}"),
            name: name.to_string(),
            own_names: own.iter().map(|s| s.to_string()).collect(),
            environments: envs.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn globals(count: usize) -> Vec<SharedVariableScope> {
        (0..count)
            .map(|i| SharedVariableScope {
                name: format!("G{i}"),
                env: None,
            })
            .collect()
    }

    fn scoped(name: &str, env: &str) -> SharedVariableScope {
        SharedVariableScope {
            name: name.to_string(),
            env: Some(env.to_string()),
        }
    }

    fn state(
        checks: Vec<CheckVariableFootprint>,
        shared: Vec<SharedVariableScope>,
    ) -> OrgVariableState {
        OrgVariableState { checks, shared }
    }

    /// Straddles the boundary in one test, because comparing a state with itself is `None` for
    /// any implementation and proves nothing.
    #[test]
    fn a_check_lands_exactly_on_the_limit_without_being_rejected() {
        let checks = || vec![footprint("Login", &[], &[])];
        assert_eq!(
            variable_cap_error(
                &state(checks(), globals(MAX_VARIABLES - 1)),
                &state(checks(), globals(MAX_VARIABLES))
            ),
            None,
            "the {MAX_VARIABLES}th variable is allowed"
        );
        assert!(
            variable_cap_error(
                &state(checks(), globals(MAX_VARIABLES)),
                &state(checks(), globals(MAX_VARIABLES + 1))
            )
            .is_some(),
            "the one after it is not"
        );
    }

    #[test]
    fn one_global_past_the_limit_is_rejected_and_names_the_check() {
        let before = state(vec![footprint("Login", &[], &[])], globals(MAX_VARIABLES));
        let after = state(
            vec![footprint("Login", &[], &[])],
            globals(MAX_VARIABLES + 1),
        );

        let err =
            variable_cap_error(&before, &after).expect("the write past the limit must be rejected");
        assert!(err.contains("Login"), "{err}");
        assert!(err.contains(&MAX_VARIABLES.to_string()), "{err}");
    }

    /// The failure the resolve-time error catches today: one global is added and the check that
    /// already defines a lot of its own tips over.
    #[test]
    fn a_checks_own_variables_count_towards_the_limit() {
        let own: Vec<String> = (0..MAX_VARIABLES - 1).map(|i| format!("C{i}")).collect();
        let own_refs: Vec<&str> = own.iter().map(String::as_str).collect();
        let checks = || vec![footprint("Checkout", &own_refs, &[])];

        assert_eq!(
            variable_cap_error(&state(checks(), globals(0)), &state(checks(), globals(1))),
            None,
            "49 own + 1 global is exactly the limit"
        );
        assert!(
            variable_cap_error(&state(checks(), globals(1)), &state(checks(), globals(2)))
                .is_some()
        );
    }

    /// The tiers merge by name, so a check overriding a global resolves one variable, not two.
    #[test]
    fn a_name_the_check_also_defines_is_not_counted_twice() {
        // Counting rows rather than merged names would make this 51 and refuse it.
        let checks = || vec![footprint("Login", &["G0"], &[])];
        assert_eq!(
            variable_cap_error(
                &state(checks(), globals(MAX_VARIABLES - 1)),
                &state(checks(), globals(MAX_VARIABLES))
            ),
            None
        );
    }

    /// The cap is per check *and* environment: a scoped variable only tips over the
    /// environments that actually resolve it.
    #[test]
    fn every_environment_a_check_targets_is_measured() {
        let checks = || vec![footprint("Login", &[], &["e-prod", "e-stg"])];
        let before = state(checks(), globals(MAX_VARIABLES));

        let mut prod_rows = globals(MAX_VARIABLES);
        prod_rows.push(scoped("PROD_ONLY", "e-prod"));
        assert!(variable_cap_error(&before, &state(checks(), prod_rows)).is_some());

        let mut qa_rows = globals(MAX_VARIABLES);
        qa_rows.push(scoped("QA_ONLY", "e-qa"));
        assert_eq!(variable_cap_error(&before, &state(checks(), qa_rows)), None);
    }

    #[test]
    fn an_unscoped_check_resolves_globals_only() {
        let checks = || vec![footprint("Login", &[], &[])];
        let before = state(checks(), globals(MAX_VARIABLES));
        let mut rows = globals(MAX_VARIABLES);
        rows.push(scoped("PROD_ONLY", "e-prod"));

        assert_eq!(variable_cap_error(&before, &state(checks(), rows)), None);
    }

    /// The same gate has to run when the check moves, not just when a variable does — pointing
    /// a check at an environment resolves that environment's rows for the first time.
    #[test]
    fn a_check_that_takes_on_an_overflowing_environment_is_refused() {
        let mut shared = globals(MAX_VARIABLES);
        shared.push(scoped("PROD_ONLY", "e-prod"));

        let before = state(vec![footprint("Login", &[], &[])], shared.clone());
        let after = state(vec![footprint("Login", &[], &["e-prod"])], shared);

        let err = variable_cap_error(&before, &after).expect("targeting e-prod overflows");
        assert!(err.contains("Login"), "{err}");
    }

    /// One unscoped variable merges into every check in the org, so the blast radius is the
    /// point: naming one check would hide the rest.
    #[test]
    fn the_error_names_every_check_the_write_would_break() {
        let checks = || {
            vec![
                footprint("Login", &[], &[]),
                footprint("Checkout", &[], &[]),
                footprint("Search", &["G0"], &[]),
            ]
        };
        // Search redefines G0, so it merges to the same count as the other two.
        let err = variable_cap_error(
            &state(checks(), globals(MAX_VARIABLES)),
            &state(checks(), globals(MAX_VARIABLES + 1)),
        )
        .expect("all three checks tip over");
        for name in ["Login", "Checkout", "Search"] {
            assert!(err.contains(name), "{err}");
        }
    }

    /// Upgrading into an over-limit state must not lock the org out of the only writes that fix
    /// it.
    #[test]
    fn an_org_already_over_the_limit_can_still_edit_and_delete_its_way_back() {
        let checks = || vec![footprint("Login", &[], &[])];
        let over = state(checks(), globals(MAX_VARIABLES + 5));

        assert_eq!(
            variable_cap_error(&over, &over),
            None,
            "an edit that holds the count steady is how they fix it"
        );
        assert_eq!(
            variable_cap_error(&over, &state(checks(), globals(MAX_VARIABLES + 4))),
            None,
            "a delete moves towards the limit"
        );
        assert!(
            variable_cap_error(&over, &state(checks(), globals(MAX_VARIABLES + 6))).is_some(),
            "but making it worse is still refused"
        );
    }

    /// Footprints are keyed by id: keyed by name, the second check would overwrite the first
    /// and one of them would go unmeasured. Same name AND same environment, so the two differ
    /// only by id: keyed by name the second would overwrite the first and go unmeasured.
    #[test]
    fn two_checks_sharing_a_name_are_measured_separately() {
        let checks = || {
            vec![
                CheckVariableFootprint {
                    id: "c1".into(),
                    name: "Login".into(),
                    own_names: vec!["G0".into()],
                    environments: vec!["e-prod".into()],
                },
                CheckVariableFootprint {
                    id: "c2".into(),
                    name: "Login".into(),
                    own_names: vec!["OWN".into()],
                    environments: vec!["e-prod".into()],
                },
            ]
        };
        // c1 merges its name into the globals and stays at the limit; c2 adds one.
        let err = variable_cap_error(
            &state(checks(), globals(MAX_VARIABLES - 1)),
            &state(checks(), globals(MAX_VARIABLES)),
        )
        .expect("c2 overflows");
        // Exactly one: collapsing the two by name would drag c1 over with it.
        assert!(err.contains("1 check(s)"), "{err}");
    }

    /// Narrowing is how an org that upgraded into an over-limit state digs out. Comparing per
    /// (check, environment) refuses it, because the new pair has no predecessor to be measured
    /// against.
    #[test]
    fn a_check_may_drop_an_environment_even_while_it_is_over_the_limit() {
        let mut shared = globals(MAX_VARIABLES + 5);
        for i in 0..5 {
            shared.push(scoped(&format!("P{i}"), "e-prod"));
        }
        let before = state(vec![footprint("Login", &[], &["e-prod"])], shared.clone());
        let after = state(vec![footprint("Login", &[], &[])], shared);

        assert_eq!(
            variable_cap_error(&before, &after),
            None,
            "60 resolved down to 55 is strictly better, even though 55 is over"
        );
    }

    #[test]
    fn a_check_may_take_on_an_environment_that_adds_nothing() {
        let mut shared = globals(MAX_VARIABLES + 5);
        shared.push(scoped("PROD_ONLY", "e-prod"));
        let before = state(vec![footprint("Login", &[], &[])], shared.clone());
        let after = state(vec![footprint("Login", &[], &["e-empty"])], shared);

        assert_eq!(
            variable_cap_error(&before, &after),
            None,
            "an environment with no rows of its own leaves the count where it was"
        );
    }

    /// A check's worst environment must not shield the others. Once one
    /// environment is over the cap, taking the per-check maximum makes every
    /// other environment of that check free to climb up to it unnoticed.
    #[test]
    fn a_second_environment_cannot_cross_the_cap_behind_a_worse_one() {
        let checks = || vec![footprint("Login", &[], &["e-a", "e-b"])];
        let rows = |b: usize| {
            let mut rows = globals(MAX_VARIABLES - 5);
            for i in 0..15 {
                rows.push(scoped(&format!("A{i}"), "e-a"));
            }
            for i in 0..b {
                rows.push(scoped(&format!("B{i}"), "e-b"));
            }
            rows
        };
        // e-a resolves 60 and is already broken; e-b sits exactly on the limit.
        let before = state(checks(), rows(5));
        let after = state(checks(), rows(6));

        let err = variable_cap_error(&before, &after)
            .expect("e-b crossing the cap must be refused even while e-a is worse");
        assert!(err.contains("Login"), "{err}");
    }

    #[test]
    fn an_over_limit_check_cannot_take_on_another_environment_that_is_also_over() {
        // Recovery means fewer broken environments, not more of them.
        let mut shared = globals(MAX_VARIABLES - 5);
        for i in 0..15 {
            shared.push(scoped(&format!("A{i}"), "e-a"));
        }
        for i in 0..10 {
            shared.push(scoped(&format!("B{i}"), "e-b"));
        }
        let before = state(vec![footprint("Login", &[], &["e-a"])], shared.clone());
        let after = state(vec![footprint("Login", &[], &["e-a", "e-b"])], shared);

        assert!(
            variable_cap_error(&before, &after).is_some(),
            "adding a second broken environment is not recovery"
        );
    }

    #[test]
    fn an_org_with_no_checks_has_nothing_to_protect() {
        assert_eq!(
            variable_cap_error(
                &state(vec![], vec![]),
                &state(vec![], globals(MAX_VARIABLES + 10))
            ),
            None
        );
    }

    /// Both kinds store the same encrypted value, so `kind` is the entire difference between a
    /// write-only secret and one anyone with GET reads.
    #[test]
    fn a_stored_secret_cannot_be_demoted_to_a_plain_variable() {
        let req = SyntheticsVariableRequest {
            name: "API_KEY".into(),
            value: None,
            kind: Some(SyntheticsVariableKind::Plain),
            ..Default::default()
        };
        let err = validate_variable_request(
            &req,
            Some("env-id"),
            true,
            Some(SyntheticsVariableKind::Secret),
        )
        .expect_err("demoting a secret must be rejected");
        assert!(err.starts_with("kind:"), "{err}");
    }

    /// `kind` defaults to Plain, so reading an omitted field as a demotion would 400 every
    /// client that edits a secret's description.
    #[test]
    fn an_update_that_never_mentions_kind_leaves_a_secret_alone() {
        let req = SyntheticsVariableRequest {
            name: "API_KEY".into(),
            value: None,
            kind: None,
            ..Default::default()
        };
        assert!(
            validate_variable_request(
                &req,
                Some("env-id"),
                true,
                Some(SyntheticsVariableKind::Secret)
            )
            .is_ok()
        );
    }

    #[test]
    fn editing_a_plain_variables_metadata_still_works() {
        let req = SyntheticsVariableRequest {
            name: "BASE_URL".into(),
            value: None,
            kind: Some(SyntheticsVariableKind::Plain),
            description: "the storefront".into(),
            ..Default::default()
        };
        assert!(
            validate_variable_request(&req, None, true, Some(SyntheticsVariableKind::Plain))
                .is_ok()
        );
    }

    /// Immutable in both directions: the value was readable while it was plain, so calling it a
    /// secret afterwards claims a guarantee that never held.
    #[test]
    fn a_stored_plain_variable_cannot_be_turned_into_a_secret() {
        let req = SyntheticsVariableRequest {
            name: "BASE_URL".into(),
            value: None,
            kind: Some(SyntheticsVariableKind::Secret),
            ..Default::default()
        };
        assert!(
            validate_variable_request(
                &req,
                Some("env-id"),
                true,
                Some(SyntheticsVariableKind::Plain)
            )
            .is_err()
        );
    }

    #[test]
    fn an_update_that_keeps_the_stored_kind_is_accepted() {
        let req = SyntheticsVariableRequest {
            name: "API_KEY".into(),
            value: None,
            kind: Some(SyntheticsVariableKind::Secret),
            ..Default::default()
        };
        assert!(
            validate_variable_request(
                &req,
                Some("env-id"),
                true,
                Some(SyntheticsVariableKind::Secret)
            )
            .is_ok()
        );
    }

    /// No stored kind means there is nothing to change, so the only rule that applies is the
    /// one that ties a secret to an environment.
    #[test]
    fn a_create_may_pick_either_kind() {
        for kind in [
            SyntheticsVariableKind::Plain,
            SyntheticsVariableKind::Secret,
        ] {
            let req = SyntheticsVariableRequest {
                name: "TOKEN".into(),
                value: Some("v".into()),
                kind: Some(kind),
                ..Default::default()
            };
            assert!(validate_variable_request(&req, Some("env-id"), false, None).is_ok());
        }
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
