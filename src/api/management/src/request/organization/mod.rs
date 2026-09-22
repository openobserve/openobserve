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
pub mod assume_service_account;
#[cfg(feature = "cloud")]
pub mod billing_group;
pub mod es;
pub mod ingestion_tokens;
pub mod org;
pub mod settings;
#[cfg(feature = "enterprise")]
pub mod storage;
pub mod system_settings;

use axum::response::Response;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// The authorization decision for a credential-exposing endpoint.
///
/// Factored out of [`require_credential_access`] so the policy can be unit
/// tested without a database, an OpenFGA server or a live request. The caller
/// is allowed when either branch says yes:
///
/// * `is_admin_or_root` — the DB-role check. This is the *only* control in OSS and in enterprise
///   with OpenFGA disabled, and it preserves the behaviour this guard shipped with.
/// * `fga_allowed` — an affirmative fine-grained decision, which is only ever consulted when
///   `fga_consulted` is true. `passcode` ("Ingestion Token") is a first-class, user-grantable FGA
///   resource, so an org admin can create a custom role that grants it and assign that role to a
///   non-Admin member. Honouring `fga_allowed` is what keeps that supported configuration working
///   rather than collapsing this endpoint to Admin/Root-only on enterprise.
///
/// `fga_consulted` is deliberately a separate input from `fga_allowed` rather
/// than being folded into it. "FGA was not consulted" and "FGA said no" must
/// not collapse to the same value: the first has to fall back to the DB-role
/// check, the second has already fallen back to it and found nothing. Keeping
/// them apart is also what makes the OpenFGA-disabled case safe — see
/// [`require_credential_access`].
const fn credential_access_allowed(
    is_admin_or_root: bool,
    fga_consulted: bool,
    fga_allowed: bool,
) -> bool {
    is_admin_or_root || (fga_consulted && fga_allowed)
}

/// Authorize an endpoint that exposes or rotates a long-lived credential.
///
/// The callers are the five routes that expose the org-wide `o2oi_` ingestion
/// token:
///
/// * `GET` and `PUT /{org}/passcode` — the two endpoints of GHSA-7hqf-3j8r-xf8p, which returned and
///   rotated that token for any authenticated org member.
/// * `GET`, `POST /{org}/ingestion-tokens` and `PATCH /{org}/ingestion-tokens/{name}` — the
///   named-token surface onto the same credential. GHSA-8vc5-vfg9-w34m added Admin/Root checks
///   here, but wrapped them in `#[cfg(not(feature = "enterprise"))]`, so on enterprise builds they
///   were compiled out and — with OpenFGA disabled, the shipped default — nothing checked at all.
///   Routing them through this guard closes that gap without changing OSS behaviour.
///
/// Incident-integration token rotation is deliberately *not* a caller: it was
/// never part of either advisory and keeps the authorization it already had.
///
/// Allows the caller when they are Admin/Root, or — in enterprise with OpenFGA
/// actually enabled — when a fine-grained check affirmatively grants them
/// `fga_permission` on `resource` in this org. `resource` and `fga_permission`
/// must match what the enterprise route table declares for the path being
/// guarded, so that a role grant made in the IAM editor means the same thing
/// here as it does in the middleware. All five call sites use
/// `resource = "passcode"`, with three permissions: `LIST` for both `GET`s,
/// `POST` for `POST /{org}/ingestion-tokens`, and `PUT` for `PUT
/// /{org}/passcode` and for `PATCH /{org}/ingestion-tokens/{name}` (the route
/// table maps that PATCH to `PUT`, because no type in `model.fga` defines a
/// `PATCH` relation).
///
/// ## Why the handler re-checks at all
///
/// The RBAC middleware cannot be relied on to have authorized the caller:
/// `check_permissions` is short-circuited whenever `AuthExtractor::bypass_check`
/// is set, which happens for any session-authenticated request and for routes
/// declared `bypass` in the enterprise route table — including
/// `POST /{org}/organizations/assume_service_account`, which mints exactly such
/// a session. A caller arriving that way has had no FGA decision made about it.
///
/// ## Why delegating to `check_permissions` does not reopen that hole
///
/// [`openobserve_core::auth::check_permissions`] does not read the incoming
/// request's `AuthExtractor`. It builds a fresh one with `bypass_check: false`
/// hardcoded and evaluates FGA from scratch for (user, permission, object,
/// org). So the decision made here is a genuine one no matter how the request
/// authenticated: a bypassed session caller is evaluated on its own merits
/// rather than waved through, which is precisely the property the bypass path
/// lacks.
///
/// ## Why the OpenFGA-enabled check is not redundant
///
/// `openobserve_core::authz::check_permissions` returns `true` unconditionally when
/// OpenFGA is disabled — it is answering "does FGA object?", and a disabled
/// FGA objects to nothing. `O2_OPENFGA_ENABLED` defaults to **false**, so
/// OR-ing that answer in unguarded would allow every authenticated user on a
/// default-config enterprise deployment — i.e. it would leave the advisory
/// wide open exactly where it is most likely to be exploited. Gating on
/// `enabled` keeps `fga_consulted` false there, so such deployments fall back
/// to the DB-role check alone. That is a deliberate tightening of `/passcode`
/// on FGA-disabled enterprise, where previously no check ran at all; it is
/// the fix, not collateral. Note this is a check that FGA *is* enabled before
/// trusting its answer — not the inverse, `!enabled`, gating of the guard
/// itself, which would have left the advisory open on the default config.
///
/// Returns `Err(response)` with a 403 naming `action` when the caller is not
/// permitted. Root users always pass.
pub(crate) async fn require_credential_access(
    org_id: &str,
    user_id: &str,
    action: &str,
    #[cfg_attr(not(feature = "enterprise"), allow(unused_variables))] resource: &str,
    #[cfg_attr(not(feature = "enterprise"), allow(unused_variables))] fga_permission: &str,
) -> Result<(), Response> {
    if db::user::is_root_user(user_id) {
        return Ok(());
    }

    let is_admin_or_root = matches!(
        openobserve_core::users::get_user(Some(org_id), user_id).await,
        Some(initiator)
            if initiator.role == config::meta::user::UserRole::Admin
                || initiator.role == config::meta::user::UserRole::Root
    );

    // OSS has no fine-grained authorization at all, so the DB-role check above
    // stays the sole control and the decision is unchanged from today.
    #[cfg(not(feature = "enterprise"))]
    let (fga_consulted, fga_allowed) = (false, false);

    #[cfg(feature = "enterprise")]
    let (fga_consulted, fga_allowed) = {
        // Short-circuit: an Admin/Root caller is already allowed, so skip the
        // round trip to OpenFGA entirely.
        if is_admin_or_root || !o2_openfga::config::get_config().enabled {
            (false, false)
        } else {
            (
                true,
                openobserve_core::auth::check_permissions(
                    org_id,
                    org_id,
                    user_id,
                    resource,
                    fga_permission,
                    None,
                    // `use_all_org` MUST match what the enterprise route table
                    // resolves for this path, or the handler asks FGA a
                    // different question than the middleware does and a real
                    // grant reads as absent. `{org}/passcode` is declared
                    // `entity: EntitySource::Org`, which `resolve_permission`
                    // maps to `use_all_org = true`; that widens the checked
                    // object from `passcode:{org}` to `passcode:_all_{org}`.
                    // Custom role grants are only ever written against the
                    // `_all_` object (`roles.rs` builds every one as
                    // `{resource}:_all_{org_id}`), and `passcode` is in
                    // `NON_SELF_PARENTS`, so no `selfParent` edge links the two
                    // — passing `false` here would look up an object that never
                    // has tuples and deny every non-Admin unconditionally.
                    true,
                    false,
                    false,
                )
                .await,
            )
        }
    };

    if credential_access_allowed(is_admin_or_root, fga_consulted, fga_allowed) {
        Ok(())
    } else {
        Err(MetaHttpResponse::forbidden(format!(
            "Admin or Root role required to {action}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::credential_access_allowed;

    #[test]
    fn admin_or_root_is_allowed_regardless_of_fga() {
        // The DB-role check alone suffices; this is the OSS and
        // OpenFGA-disabled path, where FGA is never consulted.
        assert!(credential_access_allowed(true, false, false));
        // And an Admin stays allowed even if an FGA answer were somehow
        // negative — the two branches are OR-ed, not AND-ed.
        assert!(credential_access_allowed(true, true, false));
        assert!(credential_access_allowed(true, true, true));
    }

    #[test]
    fn non_admin_needs_an_affirmative_fga_grant() {
        // The custom-role case this guard exists to stop breaking: a non-Admin
        // holding an explicit "Ingestion Token" grant is allowed.
        assert!(credential_access_allowed(false, true, true));
        // FGA ran and said no: denied.
        assert!(!credential_access_allowed(false, true, false));
    }

    #[test]
    fn unconsulted_fga_never_allows_a_non_admin() {
        // This is the case that must not regress. `fga_allowed` is meaningless
        // when FGA was not consulted (OSS, OpenFGA disabled), so a stale or
        // defaulted `true` must not grant access on its own.
        assert!(!credential_access_allowed(false, false, true));
        assert!(!credential_access_allowed(false, false, false));
    }

    #[test]
    fn allowing_requires_both_fga_inputs() {
        // Guards the exact shape of the expression: neither `fga_consulted`
        // nor `fga_allowed` alone may admit a non-Admin. A mutation replacing
        // the `&&` with `||` is caught by one of these two.
        for (consulted, allowed) in [(true, false), (false, true), (false, false)] {
            assert!(
                !credential_access_allowed(false, consulted, allowed),
                "non-admin allowed with fga_consulted={consulted}, fga_allowed={allowed}"
            );
        }
        assert!(credential_access_allowed(false, true, true));
    }
}
