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

use proto::cluster_rpc;

#[allow(dead_code)]
#[derive(Debug)]
pub struct RemoteExecNode {
    plan: Vec<u8>,
    path: String,
}

impl RemoteExecNode {
    pub fn new(plan: Vec<u8>, path: String) -> Self {
        Self { plan, path }
    }

    pub fn get_plan(&self) -> &Vec<u8> {
        &self.plan
    }

    pub fn get_path(&self) -> &String {
        &self.path
    }
}

impl TryInto<cluster_rpc::RemoteExecNode> for RemoteExecNode {
    type Error = datafusion::common::DataFusionError;

    fn try_into(self) -> Result<cluster_rpc::RemoteExecNode, Self::Error> {
        Ok(cluster_rpc::RemoteExecNode {
            plan: self.plan,
            path: self.path,
        })
    }
}

impl TryInto<RemoteExecNode> for cluster_rpc::RemoteExecNode {
    type Error = datafusion::common::DataFusionError;

    fn try_into(self) -> Result<RemoteExecNode, Self::Error> {
        Ok(RemoteExecNode {
            plan: self.plan,
            path: self.path,
        })
    }
}
