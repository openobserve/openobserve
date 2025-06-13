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

use std::sync::Arc;

use ::datafusion::datasource::TableProvider;
use config::meta::{search::ScanStats, stream::StreamType};
use infra::errors::Result;

pub mod flight;
pub mod storage;
pub mod wal;

pub type SearchTable = Result<(Vec<Arc<dyn TableProvider>>, ScanStats)>;

#[derive(Debug)]
pub struct QueryParams {
    pub trace_id: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub time_range: Option<(i64, i64)>,
    pub work_group: Option<String>,
    pub use_inverted_index: bool,
}
