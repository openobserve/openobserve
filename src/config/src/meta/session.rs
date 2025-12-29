// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Request to assume a role in a target organization
///
/// This allows meta service accounts to obtain temporary session tokens
/// for accessing a target organization with a specific role.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct AssumeRoleRequest {
    /// Target organization ID
    pub org_id: String,
    /// Role name to assume (must be assigned to the service account in the target org)
    pub role_name: String,
    /// Optional duration in seconds (default: 3600, max: 86400)
    #[serde(default)]
    pub duration_seconds: Option<u64>,
}

/// Response from assume role operation
///
/// Contains the session credentials needed to access the target organization.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AssumeRoleResponse {
    /// Session ID to use for authentication
    pub session_id: String,
    /// Target organization ID
    pub org_id: String,
    /// Assumed role name
    pub role_name: String,
    /// Expiration timestamp (ISO 8601)
    pub expires_at: String,
    /// Duration in seconds until expiration
    pub expires_in: u64,
}
