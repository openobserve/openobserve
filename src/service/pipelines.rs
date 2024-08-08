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

use std::io::Error;

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};

use super::db;
use crate::common::{
    infra::config::STREAM_FUNCTIONS,
    meta::{
        http::HttpResponse as MetaHttpResponse,
        pipelines::{PipeLine, PipeLineList},
        stream::StreamParams,
    },
};

// TODO(taiming): add tracing fields since function signature changed
#[tracing::instrument(skip(pipeline))]
pub async fn save_pipeline(mut pipeline: PipeLine) -> Result<HttpResponse, Error> {
    if check_existing_pipeline(&pipeline.name, &pipeline.source)
        .await
        .is_some()
    {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            StatusCode::BAD_REQUEST.into(),
            "Pipeline already exits".to_string(),
        )));
    }

    // Save DerivedStream details if there's any
    if let Some(ref mut derived_streams) = &mut pipeline.derived_streams {
        for derived_stream in derived_streams {
            derived_stream.source = pipeline.source.clone();
            if let Err(e) =
                super::scheduled_ops::derived_streams::save(derived_stream.clone(), &pipeline.name)
                    .await
            {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    format!(
                        "Failed to save DerivedStream details error: {}",
                        e.to_string()
                    ),
                )));
            }
        }
    }

    if let Err(error) = db::pipelines::set(&pipeline).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    } else {
        Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Pipeline saved successfully".to_string(),
        )))
    }
}

#[tracing::instrument(skip(pipeline))]
pub async fn update_pipeline(mut pipeline: PipeLine) -> Result<HttpResponse, Error> {
    let existing_pipeline = match check_existing_pipeline(&pipeline.name, &pipeline.source).await {
        Some(pipeline) => pipeline,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                "Pipeline not found".to_string(),
            )));
        }
    };
    if pipeline.eq(&existing_pipeline) {
        return Ok(HttpResponse::Ok().json(pipeline));
    }

    // QUESTION(taiming): is this necessary?
    // delete the existing pipeline
    if let Err(error) = delete_pipeline(&existing_pipeline.name, existing_pipeline.source).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    }

    // Update DerivedStream details if there's any
    if let Some(ref mut derived_streams) = &mut pipeline.derived_streams {
        for derived_stream in derived_streams {
            derived_stream.source = pipeline.source.clone();
            if !derived_stream.is_valid() {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Invalid DerivedStream details. Name and destination required ".to_string(),
                )));
            }
            if let Err(e) =
                super::scheduled_ops::derived_streams::save(derived_stream.clone(), &pipeline.name)
                    .await
            {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    format!(
                        "Failed to update DerivedStream details with error {}",
                        e.to_string()
                    ),
                )));
            }
        }
    }

    if let Err(error) = db::pipelines::set(&pipeline).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    }
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Pipeline updated successfully".to_string(),
    )))
}

#[tracing::instrument]
pub async fn list_pipelines(
    org_id: String,
    permitted: Option<Vec<String>>,
) -> Result<HttpResponse, Error> {
    if let Ok(pipelines) = db::pipelines::list(&org_id).await {
        let mut result = Vec::new();
        for pipeline in pipelines {
            if permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("logs:{}", pipeline.source.stream_name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("logs:_all_{}", org_id))
            {
                let fn_list = STREAM_FUNCTIONS
                    .get(&format!(
                        "{}/{}/{}",
                        org_id, &pipeline.source.stream_type, &pipeline.source.stream_name
                    ))
                    .map(|val| val.value().clone());
                result.push(pipeline.into_response(fn_list));
            }
        }

        Ok(HttpResponse::Ok().json(PipeLineList { list: result }))
    } else {
        Ok(HttpResponse::Ok().json(PipeLineList { list: vec![] }))
    }
}

#[tracing::instrument]
pub async fn delete_pipeline(
    pipeline_name: &str,
    source: StreamParams,
) -> Result<HttpResponse, Error> {
    let existing_pipeline = match check_existing_pipeline(&pipeline_name, &source).await {
        Some(pipeline) => pipeline,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                "Pipeline not found".to_string(),
            )));
        }
    };

    // delete DerivedStream details if there's any
    if let Some(derived_streams) = existing_pipeline.derived_streams {
        for derived_stream in derived_streams {
            if let Err(error) = super::scheduled_ops::derived_streams::delete(
                derived_stream,
                &existing_pipeline.name,
            )
            .await
            {
                return Ok(
                    HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                        http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                        error.to_string(),
                    )),
                );
            }
        }
    }

    let result = db::pipelines::delete(
        &source.org_id,
        source.stream_type,
        &source.stream_name,
        pipeline_name,
    )
    .await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Pipeline deleted".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

async fn check_existing_pipeline(name: &str, source: &StreamParams) -> Option<PipeLine> {
    match db::pipelines::get(
        &source.org_id,
        source.stream_type,
        &source.stream_name,
        name,
    )
    .await
    {
        Ok(pipeline) => Some(pipeline),
        Err(_) => None,
    }
}
