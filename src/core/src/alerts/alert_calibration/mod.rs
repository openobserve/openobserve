// Copyright 2026 OpenObserve Inc.
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

//! The OSS half of alert calibration: the search the collector cannot reach, and the digest sink.

pub mod sink;

use std::pin::Pin;

use config::{
    ider,
    meta::{
        cluster::RoleGroup,
        search::{Request, Response},
        stream::StreamType,
    },
};
use o2_enterprise::enterprise::alert_calibration_collect::collector::AlertCalibrationSearchPort;
use search_service::grpc_search::grpc_search;

/// Enterprise cannot depend on `search_service`, so its collector's search is injected from here.
pub(crate) struct SearchAdapter;

impl AlertCalibrationSearchPort for SearchAdapter {
    fn search(
        &self,
        org_id: String,
        request: Request,
        role_group: Option<RoleGroup>,
    ) -> Pin<Box<dyn Future<Output = Result<Response, anyhow::Error>> + Send>> {
        Box::pin(async move {
            // `grpc_search` is the entry point that honours `role_group`.
            grpc_search(
                &ider::generate(),
                &org_id,
                StreamType::Logs,
                None,
                &request,
                role_group,
            )
            .await
            .map_err(Into::into)
        })
    }
}
