// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pub mod alert_manager;
pub mod alerts;
pub mod compact;
pub mod dashboards;
pub mod db;
pub mod enrichment;
pub mod enrichment_table;
pub mod file_list;
pub mod functions;
pub mod ingestion;
pub mod kv;
pub mod logs;
pub mod metrics;
pub mod organization;
pub mod promql;
pub mod router;
pub mod schema;
pub mod search;
pub mod stream;
pub mod syslogs_route;
pub mod traces;
pub mod triggers;
pub mod usage;
pub mod users;

// generate partition key for query
pub fn get_partition_key_query(s: &str) -> String {
    let mut s = s.replace(['/', '.'], "_");
    s.truncate(100);
    s
}
