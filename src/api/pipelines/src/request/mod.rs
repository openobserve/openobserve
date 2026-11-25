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

pub mod enrichment_table;
pub mod functions;
pub mod pipeline;
pub mod pipelines;
#[cfg(feature = "enterprise")]
pub mod re_pattern;

use openobserve_api_common::request::{BulkDeleteRequest, BulkDeleteResponse};

/// What a handler's OpenFGA check asks about: one object, or every object of its type in the org.
#[cfg(feature = "enterprise")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Target<'a> {
    One(&'a str),
    All,
}

/// Whether `user_id` holds `method` on `target`; an org-wide grant also covers `One` (self-parent).
#[cfg(feature = "enterprise")]
pub(crate) async fn allowed(
    org_id: &str,
    user_id: &str,
    object_type: &str,
    target: Target<'_>,
    method: &str,
) -> bool {
    #[cfg(test)]
    if let Some(allowed) = tests::granted(user_id, object_type, target, method) {
        return allowed;
    }
    match target {
        Target::One(id) => {
            openobserve_core::auth::check_permissions(
                id,
                org_id,
                user_id,
                object_type,
                method,
                None,
                false,
                false,
                true,
            )
            .await
        }
        Target::All => {
            openobserve_core::auth::check_permissions(
                org_id,
                org_id,
                user_id,
                object_type,
                method,
                None,
                true,
                false,
                false,
            )
            .await
        }
    }
}

#[cfg(all(test, feature = "enterprise"))]
pub(crate) mod tests {
    use std::cell::RefCell;

    use super::Target;

    thread_local! {
        static GRANTS: RefCell<ahash::HashMap<String, Vec<String>>> = RefCell::default();
    }

    /// Gives `user_id` exactly these `(object type, target, method)` grants on this test thread.
    pub(crate) fn grant(user_id: &str, grants: &[(&str, Target<'_>, &str)]) {
        let grants = grants
            .iter()
            .map(|(object_type, target, method)| key(object_type, *target, method))
            .collect();
        GRANTS.with(|g| g.borrow_mut().insert(user_id.to_string(), grants));
    }

    /// `None` leaves users without a [`grant`] to the real check.
    pub(super) fn granted(
        user_id: &str,
        object_type: &str,
        target: Target<'_>,
        method: &str,
    ) -> Option<bool> {
        let wanted = key(object_type, target, method);
        GRANTS.with(|g| g.borrow().get(user_id).map(|keys| keys.contains(&wanted)))
    }

    fn key(object_type: &str, target: Target<'_>, method: &str) -> String {
        format!("{object_type}/{target:?}/{method}")
    }
}
