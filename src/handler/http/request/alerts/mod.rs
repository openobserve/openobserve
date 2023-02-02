use crate::{meta::alert::Alert, service::alerts};
use actix_web::{delete, get, post, web, HttpResponse, Responder};
use std::io::Error;

#[post("/{org_id}/{stream_name}/alerts/{alert_name}")]
pub async fn save_alert(
    path: web::Path<(String, String, String)>,
    alert: web::Json<Alert>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    alerts::save_alert(org_id, stream_name, name, alert.into_inner()).await
}

#[get("/{org_id}/{stream_name}/alerts")]
async fn list_stream_alerts(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, stream_name) = path.into_inner();
    alerts::list_alert(org_id, Some(stream_name.as_str())).await
}

#[get("/{org_id}/alerts")]
async fn list_alerts(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();
    alerts::list_alert(org_id, None).await
}

#[get("/{org_id}/{stream_name}/alerts/{alert_name}")]
async fn get_alert(path: web::Path<(String, String, String)>) -> impl Responder {
    let (org_id, stream_name, name) = path.into_inner();
    alerts::get_alert(org_id, stream_name, name).await
}

#[delete("/{org_id}/{stream_name}/alerts/{alert_name}")]
async fn delete_alert(path: web::Path<(String, String, String)>) -> impl Responder {
    let (org_id, stream_name, name) = path.into_inner();
    alerts::delete_alert(org_id, stream_name, name).await
}
