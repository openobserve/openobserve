// Copyright 2023 Zinc Labs Inc.
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

pub mod alerts;
pub mod dashboards;
pub mod enrichment_table;
pub mod functions;
pub mod kv;
pub mod logs;
pub mod metrics;
pub mod organization;
pub mod prom;
pub mod search;
pub mod status;
pub mod stream;
pub mod syslog;
pub mod traces;
pub mod users;

pub const CONTENT_TYPE_JSON: &str = "application/json";
pub const CONTENT_TYPE_PROTO: &str = "application/x-protobuf";
