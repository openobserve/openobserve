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

use config::meta::stream::FileKey;
use proto::cluster_rpc;

#[allow(dead_code)]
#[derive(Debug)]
pub struct FlightSearchRequest {
    pub trace_id: String,
    pub partition: i32,
    pub org_id: String,
    pub stream_type: String,
    pub plan: Vec<u8>,
    pub file_list: Vec<FileKey>,
    pub timeout: i64,
    pub work_group: String,
    pub user_id: Option<String>,
}

impl TryInto<FlightSearchRequest> for cluster_rpc::FlightSearchRequest {
    type Error = datafusion::common::DataFusionError;

    fn try_into(self) -> Result<FlightSearchRequest, Self::Error> {
        Ok(FlightSearchRequest {
            trace_id: self.trace_id,
            partition: self.partition,
            org_id: self.org_id,
            stream_type: self.stream_type,
            plan: self.plan,
            file_list: self.file_list.iter().map(FileKey::from).collect(),
            timeout: self.timeout,
            work_group: self.work_group,
            user_id: self.user_id,
        })
    }
}

impl TryInto<cluster_rpc::FlightSearchRequest> for FlightSearchRequest {
    type Error = datafusion::common::DataFusionError;

    fn try_into(self) -> Result<cluster_rpc::FlightSearchRequest, Self::Error> {
        Ok(cluster_rpc::FlightSearchRequest {
            trace_id: self.trace_id,
            partition: self.partition,
            org_id: self.org_id,
            stream_type: self.stream_type,
            plan: self.plan,
            file_list: self
                .file_list
                .iter()
                .map(cluster_rpc::FileKey::from)
                .collect(),
            timeout: self.timeout,
            work_group: self.work_group,
            user_id: self.user_id,
        })
    }
}
