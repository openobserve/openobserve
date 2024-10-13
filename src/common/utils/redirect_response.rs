// Copyright 2024 Zinc Labs Inc.
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

use std::fmt;

use actix_web::{HttpResponse, ResponseError};

const DEFAULT_REDIRECT_RELATIVE_URI: &str = "/web";

#[derive(Debug)]
pub struct RedirectResponse {
    pub redirect_relative_uri: String,
}

impl RedirectResponse {
    /// Create a new `RedirectResponse` with the given redirection URL.
    ///
    /// If no URL is provided, a default URL (`/web`) will be used.
    pub fn new(redirect_relative_uri: &str) -> Self {
        RedirectResponse {
            redirect_relative_uri: redirect_relative_uri.to_string(),
        }
    }

    pub fn redirect(&self) -> HttpResponse {
        self.build_redirect_response()
    }

    fn build_redirect_response(&self) -> HttpResponse {
        HttpResponse::Found()
            .append_header(("Location", self.redirect_relative_uri.clone()))
            .finish()
    }
}

impl fmt::Display for RedirectResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Redirecting to {}", self.redirect_relative_uri)
    }
}

impl ResponseError for RedirectResponse {
    /// Generate an HTTP response that performs a redirection to the stored URL.
    fn error_response(&self) -> HttpResponse {
        self.build_redirect_response()
    }
}

impl Default for RedirectResponse {
    fn default() -> Self {
        RedirectResponse {
            redirect_relative_uri: DEFAULT_REDIRECT_RELATIVE_URI.to_string(),
        }
    }
}
