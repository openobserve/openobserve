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
use config::meta::stream::StreamType;

use super::db;
use crate::{
    common::{
        meta::{
            authz::Authz,
            http::HttpResponse as MetaHttpResponse,
            pipelines::{PipeLine, PipeLineList},
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    handler::http::request::pipeline,
};

#[tracing::instrument(skip(pipeline))]
pub async fn save_pipeline(org_id: String, mut pipeline: PipeLine) -> Result<HttpResponse, Error> {
    if let Some(_existing_pipeline) = check_existing_pipeline(&org_id, &pipeline.name).await {
        Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            StatusCode::BAD_REQUEST.into(),
            "Pipeline already exits".to_string(),
        )))
    } else {
        if let Err(error) = db::pipelines::set(&org_id, &pipeline.name, &pipeline).await {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    error.to_string(),
                )),
            );
        } else {
            set_ownership(&org_id, "pipeline", Authz::new(&pipeline.name)).await;

            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                "Pipeline saved successfully".to_string(),
            )))
        }
    }
}

#[tracing::instrument(skip(pipeline))]
pub async fn update_pipeline(
    org_id: &str,
    pipeline_name: &str,
    mut pipeline: PipeLine,
) -> Result<HttpResponse, Error> {
    let existing_pipeline = match check_existing_pipeline(org_id, pipeline_name).await {
        Some(pipeline) => pipeline,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                "Pipeline not found".to_string(),
            )));
        }
    };
    if pipeline == existing_pipeline {
        return Ok(HttpResponse::Ok().json(pipeline));
    }

    if let Err(error) = db::pipelines::set(org_id, &pipeline.name, &pipeline).await {
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
                    .contains(&format!("pipeline:{}", pipeline.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("pipeline:{}", org_id))
            {
                result.push(pipeline);
            }
        }

        Ok(HttpResponse::Ok().json(PipeLineList { list: result }))
    } else {
        Ok(HttpResponse::Ok().json(PipeLineList { list: vec![] }))
    }
}

#[tracing::instrument]
pub async fn delete_pipeline(org_id: String, pipeline_name: String) -> Result<HttpResponse, Error> {
    let result = db::pipelines::delete(&org_id, &pipeline_name).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "User deleted".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

async fn check_existing_pipeline(org_id: &str, pipeline: &str) -> Option<PipeLine> {
    match db::pipelines::get(org_id, pipeline).await {
        Ok(pipeline) => Some(pipeline),
        Err(_) => None,
    }
}
