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

/// FGA's answer only counts when it was actually consulted.
const fn credential_access_allowed(
    is_admin_or_root: bool,
    fga_consulted: bool,
    fga_allowed: bool,
) -> bool {
    is_admin_or_root || (fga_consulted && fga_allowed)
}

/// Admin/Root, or the middleware's OpenFGA decision when OpenFGA is on.
pub(crate) async fn require_credential_access(
    org_id: &str,
    user_id: &str,
    action: &str,
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

    #[cfg(not(feature = "enterprise"))]
    let (fga_consulted, fga_allowed) = (false, false);

    #[cfg(feature = "enterprise")]
    let (fga_consulted, fga_allowed) = {
        if is_admin_or_root {
            (false, false)
        } else if o2_openfga::config::get_config().enabled {
            // these routes are bypass: false with the object in the path, so the middleware decided
            (true, true)
        } else {
            (false, false)
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
        assert!(credential_access_allowed(true, false, false));
        assert!(credential_access_allowed(true, true, false));
        assert!(credential_access_allowed(true, true, true));
    }

    #[test]
    fn non_admin_needs_an_affirmative_fga_grant() {
        assert!(credential_access_allowed(false, true, true));
        assert!(!credential_access_allowed(false, true, false));
    }

    #[test]
    fn unconsulted_fga_never_allows_a_non_admin() {
        assert!(!credential_access_allowed(false, false, true));
        assert!(!credential_access_allowed(false, false, false));
    }

    #[test]
    fn allowing_requires_both_fga_inputs() {
        for (consulted, allowed) in [(true, false), (false, true), (false, false)] {
            assert!(
                !credential_access_allowed(false, consulted, allowed),
                "non-admin allowed with fga_consulted={consulted}, fga_allowed={allowed}"
            );
        }
        assert!(credential_access_allowed(false, true, true));
    }
}
