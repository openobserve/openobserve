// Copyright 2026 OpenObserve Inc.
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

//! HTTP transport primitives shared by independent API domain crates.

#[allow(clippy::single_component_path_imports)]
use common;

pub mod auth;
pub mod extractors;
pub mod request;

/// Custom header name for O2 Assistant session tracking (UUID v7).
pub const X_O2_ASSISTANT_SESSION_ID: axum::http::HeaderName =
    axum::http::HeaderName::from_static("x-o2-assistant-session-id");
