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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PathParamProxyURL {
    pub target_url: String,
    pub org_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_param_proxy_url() {
        let proxy_url = PathParamProxyURL {
            target_url: "http://example.com".to_string(),
            org_id: "org123".to_string(),
        };

        assert_eq!(proxy_url.target_url, "http://example.com");
        assert_eq!(proxy_url.org_id, "org123");
    }

    #[test]
    fn test_path_param_proxy_url_default() {
        let proxy_url = PathParamProxyURL::default();
        assert_eq!(proxy_url.target_url, "");
        assert_eq!(proxy_url.org_id, "");
    }
}
