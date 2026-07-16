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

pub mod codec;
mod common;
mod decoder_stream;
pub mod display;
pub mod distribute_analyze_exec;
pub mod empty_exec;
pub mod enrich_exec;
#[cfg(feature = "enterprise")]
pub mod enrichment_exec;
pub mod node;
pub mod remote_scan_exec;
mod utils;
mod visitors;

pub use visitors::{NewEmptyExecVisitor, ReplaceTableScanExec};
