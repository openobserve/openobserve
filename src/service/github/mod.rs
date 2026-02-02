// Copyright 2025 OpenObserve Inc.
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

//! Generic GitHub Data Fetching Service
//!
//! This service provides a generic, reusable way to fetch data from GitHub repositories.
//! It includes caching, retry logic, and error handling.
//!
//! ## Usage Example
//! ```no_run
//! use crate::service::github::GitHubDataService;
//!
//! let service = GitHubDataService::new();
//! let data = service
//!     .fetch_json::<Vec<Pattern>>(
//!         "https://raw.githubusercontent.com/openobserve/sdr_patterns/main/regex.json",
//!     )
//!     .await?;
//! ```

pub mod adapters;
pub mod cache;
pub mod client;
pub mod types;

pub use client::GitHubDataService;
pub use types::{GitHubError, GitHubServiceConfig};
