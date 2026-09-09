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
use o2_enterprise::enterprise::alert_hygiene_collect::collector::AlertHygieneSearchPort;
use search_service::grpc_search::grpc_search;

/// The OSS half of the injected port; enterprise cannot depend on `search_service`.
#[derive(Clone, Copy, Debug, Default)]
pub struct AlertHygieneSearchAdapter;

impl AlertHygieneSearchPort for AlertHygieneSearchAdapter {
    fn search(
        &self,
        org_id: String,
        request: Request,
        role_group: Option<RoleGroup>,
    ) -> Pin<Box<dyn Future<Output = Result<Response, anyhow::Error>> + Send>> {
        Box::pin(async move {
            let trace_id = ider::generate();
            // `grpc_search` is the only entry point that takes `role_group`; `search` drops it.
            grpc_search(
                &trace_id,
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
