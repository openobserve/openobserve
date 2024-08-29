// Copyright 2024 Zinc Labs Inc.
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

use config::meta::stream::StreamType;
use proto::cluster_rpc::{FlightSearchRequest, SearchType};

#[derive(Debug, Clone)]
pub struct Request {
    pub trace_id: String,
    pub org_id: String,
    pub stream_type: StreamType,
    #[allow(dead_code)]
    pub search_type: SearchType, // for super cluster
    pub timeout: i64,
    pub user_id: Option<String>,
    pub work_group: Option<String>,
    pub time_range: Option<(i64, i64)>,
    pub search_event_type: Option<String>, // node rule
}

impl Default for Request {
    fn default() -> Self {
        Self {
            trace_id: "".to_string(),
            org_id: "".to_string(),
            stream_type: StreamType::default(),
            search_type: SearchType::default(),
            timeout: 0,
            user_id: None,
            work_group: None,
            time_range: None,
            search_event_type: None,
        }
    }
}

impl Request {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        trace_id: String,
        org_id: String,
        stream_type: StreamType,
        search_type: SearchType,
        timeout: i64,
        user_id: Option<String>,
        time_range: Option<(i64, i64)>,
        search_event_type: Option<String>,
    ) -> Self {
        Self {
            trace_id,
            org_id,
            stream_type,
            search_type,
            timeout,
            user_id,
            work_group: None,
            time_range,
            search_event_type,
        }
    }

    pub fn add_user_id(&mut self, user_id: Option<String>) {
        self.user_id = user_id;
    }

    pub fn add_work_group(&mut self, work_group: Option<String>) {
        self.work_group = work_group;
    }

    pub fn add_time_range(&mut self, time_range: Option<(i64, i64)>) {
        self.time_range = time_range;
    }

    pub fn add_search_event_type(&mut self, search_event_type: Option<String>) {
        self.search_event_type = search_event_type;
    }
}

impl From<FlightSearchRequest> for Request {
    fn from(request: FlightSearchRequest) -> Self {
        Self {
            trace_id: request.trace_id,
            org_id: request.org_id,
            stream_type: StreamType::from(request.stream_type.as_str()),
            search_type: SearchType::try_from(request.search_type).unwrap_or_default(),
            timeout: request.timeout,
            user_id: request.user_id,
            work_group: request.work_group,
            time_range: Some((request.start_time, request.end_time)),
            search_event_type: request.search_event_type,
        }
    }
}

// message FlightSearchRequest {
//     string                       trace_id = 1;
//     uint32                      partition = 2;
//     string                         org_id = 3;
//     string                    stream_type = 4;
//     SearchType                search_type = 5;
//     bytes                            plan = 6;
//     repeated FileKey            file_list = 7;
//     repeated PartitionKeys partition_keys = 8;
//     repeated string        match_all_keys = 9;
//     int64                     start_time = 10;
//     int64                       end_time = 11;
//     int64                        timeout = 12;
//     bool                       is_leader = 13;
//     optional string           work_group = 14;
//     optional string              user_id = 15;
// }
