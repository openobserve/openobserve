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

use config::meta::cluster::NodeInfo;
use datafusion::sql::TableReference;
use hashbrown::HashMap;

pub enum PhysicalOptimizerContext {
    RemoteScan(RemoteScanContext),
}

pub struct RemoteScanContext {
    pub nodes: Vec<Arc<dyn NodeInfo>>,
    pub partitioned_file_lists: HashMap<TableReference, Vec<Vec<i64>>>,
    pub context: opentelemetry::Context,
    pub is_leader: bool,
}
