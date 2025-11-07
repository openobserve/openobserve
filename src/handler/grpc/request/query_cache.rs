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

use proto::cluster_rpc::{
    DeleteResultCacheRequest, DeleteResultCacheResponse, query_cache_server::QueryCache,
};
use tonic::{Request, Response, Status};

use crate::service::search::cache::cacher;

#[derive(Default)]
pub struct QueryCacheServerImpl;

#[tonic::async_trait]
impl QueryCache for QueryCacheServerImpl {
    async fn delete_result_cache(
        &self,
        request: Request<DeleteResultCacheRequest>,
    ) -> Result<Response<DeleteResultCacheResponse>, Status> {
        let req: DeleteResultCacheRequest = request.into_inner();
        let deleted = cacher::delete_cache(&req.path, req.ts, None, None)
            .await
            .is_ok();

        Ok(Response::new(DeleteResultCacheResponse { deleted }))
    }
}
