use actix_web::{delete, get, post, web, HttpResponse, Responder};
use std::io::Error;

use crate::service::dashboards;

#[post("/{org_id}/dashboards/{name}")]
pub async fn save_dashboard(
    path: web::Path<(String, String)>,
    details: web::Json<String>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    dashboards::save_dashboard(&org_id, &name, &details).await
}

#[get("/{org_id}/dashboards")]
async fn list_dashboards(org_id: web::Path<String>) -> impl Responder {
    dashboards::list_dashboards(&org_id.into_inner()).await
}

#[get("/{org_id}/dashboards/{name}")]
async fn get_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    dashboards::get_dashboard(&org_id, &name).await
}

#[delete("/{org_id}/dashboards/{name}")]
async fn delete_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    dashboards::delete_dashboard(&org_id, &name).await
}
