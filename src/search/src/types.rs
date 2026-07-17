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

use config::meta::stream::StreamType;
use datafusion::sql::TableReference;

#[derive(Debug)]
pub struct QueryParams {
    pub trace_id: String,
    pub org_id: String,
    pub stream: TableReference,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub time_range: (i64, i64),
    pub work_group: Option<String>,
    pub use_inverted_index: bool,
}
