// Copyright 2023 Zinc Labs Inc.
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

pub mod alerts;
pub mod authz;
pub mod clusters;
pub mod dashboards;
pub mod enrichment_table;
pub mod functions;
pub mod kv;
pub mod logs;
pub mod metrics;
pub mod organization;
pub mod prom;
pub mod rum;
pub mod search;
pub mod status;
pub mod stream;
pub mod syslog;
pub mod traces;
pub mod users;

pub const CONTENT_TYPE_JSON: &str = "application/json";
pub const CONTENT_TYPE_PROTO: &str = "application/x-protobuf";
