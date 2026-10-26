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

use infra::{coordinator::get_coordinator, errors, table::org_storage_providers};

/// Deletes the org's storage provider row and evicts its account on every node.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    org_storage_providers::delete_by_org(org_id).await?;
    infra::storage::accounts::remove_account(org_id).await;
    let key = format!("{}{org_id}", org_storage_providers::OSP_PREFIX);
    get_coordinator()
        .await
        .delete(&key, false, true, None)
        .await
}
