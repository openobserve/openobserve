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

use axum::http::Method;

use super::validator::{AuthError, AuthValidationResult};

/// Set only by the validator; a request extension, so a client can never supply it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegatedCaller {
    pub link_id: String,
    pub installation_id: String,
    pub org: String,
    pub jti: String,
}

pub async fn validate_delegated(
    _token: &str,
    _path: &str,
    _path_prefix: &str,
    _method: &Method,
) -> Result<AuthValidationResult, AuthError> {
    Err(AuthError::Unauthorized(
        "slack phase0: not implemented".to_string(),
    ))
}
