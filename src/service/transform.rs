use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;
use tracing::info_span;

use crate::meta::transform::Transform;
use crate::meta::transform::TransformList;
use crate::meta::{self, http::HttpResponse as MetaHttpResponse};
use crate::service::db;

const SUCESS: &str = "Transform saved successfully";
const SPECIFY: &str = "Please specify ";
const STREAM: &str = "stream name ";
const ORDER: &str = "transform order ";
const DELETED: &str = "Transform deleted";

pub async fn register_transform(
    org_id: String,
    stream_name: Option<String>,
    name: String,
    mut trans: Transform,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:transform:register");
    let _guard = loc_span.enter();
    match stream_name {
        Some(stream_name) => {
            let mut is_err = false;
            let mut msg: String = String::from(SPECIFY);
            let stream_name = stream_name.trim();

            if stream_name.is_empty() {
                msg.push_str(STREAM);
                is_err = true;
            }
            if trans.order == 0 {
                msg.push_str(ORDER);
                is_err = true;
            }
            let js_func = trans.function.to_owned();
            if !js_func.contains('(') && !js_func.contains(')') {
                msg.push_str(" not valid function");
                is_err = true;
            }
            if is_err {
                Ok(
                    HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        Some(msg.to_string()),
                    )),
                )
            } else {
                trans.stream_name = stream_name.to_string();
                trans.name = name.to_string();
                extract_num_args(&mut trans);
                db::udf::set(
                    org_id.as_str(),
                    Some(stream_name.to_string()),
                    name.as_str(),
                    trans,
                )
                .await
                .unwrap();
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK.into(),
                    SUCESS.to_string(),
                )))
            }
        }
        None => {
            let mut is_err = false;
            trans.name = name.to_string();
            let js_func = trans.function.to_owned();
            if !js_func.contains('(') && !js_func.contains(')') {
                is_err = true;
            }
            if !is_err {
                extract_num_args(&mut trans);
                db::udf::set(org_id.as_str(), None, name.as_str(), trans)
                    .await
                    .unwrap();
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK.into(),
                    SUCESS.to_string(),
                )))
            } else {
                Ok(
                    HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        Some("Not valid function".to_string()),
                    )),
                )
            }
        }
    }
}

pub async fn list_transform(
    org_id: String,
    stream_name: Option<String>,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:transform:list");
    let _guard = loc_span.enter();
    let udf_list = db::udf::list(org_id.as_str(), stream_name).await.unwrap();
    Ok(HttpResponse::Ok().json(TransformList { list: udf_list }))
}

pub async fn delete_transform(
    org_id: String,
    stream_name: Option<String>,
    name: String,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:transform:delete");
    let _guard = loc_span.enter();
    let result = db::udf::delete(org_id.as_str(), stream_name, name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            DELETED.to_string(),
        ))),
        Err(err) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some(err.to_string()),
        ))),
    }
}

fn extract_num_args(trans: &mut Transform) {
    let js_func = trans.function.to_owned();
    let start_stream = js_func.find('(').unwrap();
    let end_stream = js_func.find(')').unwrap();
    let args = &js_func[start_stream + 1..end_stream].trim();
    if args.is_empty() {
        trans.num_args = 0;
    } else {
        let args_vec = args.split(',');
        trans.num_args = args_vec.into_iter().count() as u8;

        /* let args_vec: Vec<_> = args.split(',').collect();
        trans.num_args = args_vec.len() as u8; */
    }
}

/* #[cfg(test)]
mod test {
    use super::*;

    //#[actix_web::test]
    async fn test_register_transform() {
        let trans = Transform{
            function: "function square(row){const obj = JSON.parse(row);obj['square'] = obj.Year*obj.Year;  return JSON.stringify(obj);}".to_owned(),
            name: "concat".to_owned(),
            order: 1,
            stream_name: "Test".to_owned(),
        };
        let res = register_transform("nexus".to_owned(),None,trans.name.to_owned(),trans).await;
        //assert!(res.is_ok());
    }
} */
