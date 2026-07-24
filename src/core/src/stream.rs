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

//! Temporary orchestration for deleting resources owned by other core services.

use std::{future::Future, io::Error};

use axum::{
    Json, http,
    response::{IntoResponse, Response},
};
use common::meta::http::{ERROR_HEADER, HttpResponse as MetaHttpResponse};
use config::meta::stream::{StreamParams, StreamType};

#[tracing::instrument(skip(cleanup_enrichment_table_resources))]
pub async fn delete_stream<E, EFut>(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    del_related_feature_resources: bool,
    cleanup_enrichment_table_resources: E,
) -> Result<Response, Error>
where
    E: FnOnce(String, String, StreamType) -> EFut,
    EFut: Future<Output = ()>,
{
    ::stream::delete_stream_with_cleanup(
        org_id,
        stream_name,
        stream_type,
        del_related_feature_resources,
        cleanup_related_resources,
        cleanup_enrichment_table_resources,
    )
    .await
}

async fn cleanup_related_resources(
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
) -> Result<(), Response> {
    for pipeline in crate::pipeline::store::get_by_stream(&StreamParams::new(
        &org_id,
        &stream_name,
        stream_type,
    ))
    .await
    {
        if let Err(e) = crate::pipeline::store::delete(&pipeline.id).await {
            return Err((
                http::StatusCode::INTERNAL_SERVER_ERROR,
                [(ERROR_HEADER, format!("failed to delete stream: {e}"))],
                Json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "Error: failed to delete the associated pipeline \"{}\": {e}",
                        pipeline.name
                    ),
                )),
            )
                .into_response());
        }
    }

    if let Ok(alerts) =
        db::alerts::alert::list(&org_id, Some(stream_type), Some(&stream_name)).await
    {
        for alert in alerts {
            if let Err(e) =
                db::alerts::alert::delete_by_name(&org_id, stream_type, &stream_name, &alert.name)
                    .await
            {
                return Err((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(ERROR_HEADER, format!("failed to delete alert: {e}"))],
                    Json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!(
                            "Error: failed to delete the associated alert \"{}\": {e}",
                            alert.name
                        ),
                    )),
                )
                    .into_response());
            }
        }
    }

    Ok(())
}
