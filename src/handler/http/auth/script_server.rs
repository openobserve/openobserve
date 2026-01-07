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

use super::validator::{AuthError, AuthValidationResult, RequestData};
use crate::common::utils::auth::AuthExtractor;

/// Validator for script server authentication
pub async fn validator(
    req_data: &RequestData,
    auth_info: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    // Use the standard validator for script server authentication
    // Script server uses the same authentication mechanism as the main API
    super::validator::oo_validator(req_data, auth_info).await
}
