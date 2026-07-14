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

//! Core application services extracted from the production frontend crate.

#![recursion_limit = "256"]

#[cfg(feature = "enterprise")]
pub mod cipher;
pub mod common;
pub mod job;
pub mod service;

pub(crate) static USER_AGENT_REGEX_FILE: &[u8] = include_bytes!("../ua_regex/regexes.yaml");
