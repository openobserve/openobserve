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

use proto::cluster_rpc::{
    DeleteResultCacheRequest, DeleteResultCacheResponse, query_cache_server::QueryCache,
};
use search_service::cache::cacher;
use tonic::{Request, Response, Status};

#[derive(Default)]
pub struct QueryCacheServerImpl;

#[tonic::async_trait]
impl QueryCache for QueryCacheServerImpl {
    async fn delete_result_cache(
        &self,
        request: Request<DeleteResultCacheRequest>,
    ) -> Result<Response<DeleteResultCacheResponse>, Status> {
        let req: DeleteResultCacheRequest = request.into_inner();
        if !is_org_scoped(&req.path) {
            return Err(Status::invalid_argument(
                "cache path must start with an org id and must not contain '.' or '..' segments",
            ));
        }
        let deleted = cacher::delete_cache(&req.path, req.ts, None, None)
            .await
            .is_ok();

        Ok(Response::new(DeleteResultCacheResponse { deleted }))
    }
}

// the path is a prefix under the shared cache dir, so it must name one org and never climb out
fn is_org_scoped(path: &str) -> bool {
    !path.split('/').next().unwrap_or_default().is_empty()
        && !path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_cache_server_impl_default() {
        let _server = QueryCacheServerImpl;
    }

    #[tokio::test]
    async fn test_delete_rejects_paths_outside_an_org() {
        for path in [
            "",
            "/",
            "/default",
            "..",
            "../default",
            "default/../other",
            "default/..",
        ] {
            let request = Request::new(DeleteResultCacheRequest {
                path: path.to_string(),
                ts: 0,
            });
            let status = QueryCacheServerImpl
                .delete_result_cache(request)
                .await
                .unwrap_err();
            assert_eq!(status.code(), tonic::Code::InvalidArgument, "{path:?}");
        }
    }

    #[tokio::test]
    async fn test_delete_accepts_org_scoped_paths() {
        for path in ["qc-scope-test", "qc-scope-test/logs/app"] {
            let request = Request::new(DeleteResultCacheRequest {
                path: path.to_string(),
                ts: 0,
            });
            assert!(
                QueryCacheServerImpl
                    .delete_result_cache(request)
                    .await
                    .is_ok()
            );
        }
    }
}
