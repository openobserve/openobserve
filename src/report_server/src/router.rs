use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, put},
};
use serde::{Deserialize, Serialize};

use crate::{
    models::{self, ReportType},
    report::{SMTP_CLIENT, generate_report, send_email},
};

/// HTTP response
/// code 200 is success
/// code 400 is error
/// code 404 is not found
/// code 500 is internal server error
/// code 503 is service unavailable
/// code >= 1000 is custom error code
/// message is the message or error message
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub code: u16,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
}

impl HttpResponse {
    pub fn internal_server_error(e: String) -> Self {
        Self {
            code: StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
            message: e,
            error_detail: None,
            trace_id: None,
        }
    }

    pub fn success(msg: String) -> Self {
        Self {
            code: StatusCode::OK.as_u16(),
            message: msg,
            error_detail: None,
            trace_id: None,
        }
    }
}

pub async fn healthz() -> Response {
    (StatusCode::OK, "Server up and running").into_response()
}

pub async fn send_report(
    Path((org_id, report_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(report): Json<models::Report>,
) -> Response {
    let timezone = match query.get("timezone") {
        Some(v) => v.as_str(),
        None => "Europe/London",
    };

    let cfg = config::get_config();
    let report_type = if report.email_details.recipients.is_empty() {
        ReportType::Cache
    } else {
        ReportType::PDF
    };
    let (pdf_data, email_dashboard_url) = match generate_report(
        &report.dashboards[0],
        &org_id,
        &cfg.report_server.user_email,
        &cfg.report_server.user_password,
        &report.email_details.dashb_url,
        timezone,
        report_type.clone(),
        &report_name,
    )
    .await
    {
        Ok(res) => res,
        Err(e) => {
            log::error!("Error generating pdf for report {org_id}/{report_name}: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::internal_server_error(e.to_string())),
            )
                .into_response();
        }
    };

    if report_type == ReportType::Cache {
        log::info!("Dashboard data cached by report {report_name}");
        return (
            StatusCode::OK,
            Json(HttpResponse::success(format!(
                "dashboard data cached by report {report_name}"
            ))),
        )
            .into_response();
    }

    match send_email(
        &pdf_data,
        models::EmailDetails {
            dashb_url: email_dashboard_url,
            ..report.email_details
        },
        models::SmtpConfig {
            from_email: cfg.smtp.smtp_from_email.to_string(),
            reply_to: cfg.smtp.smtp_reply_to.to_string(),
            client: &SMTP_CLIENT,
        },
    )
    .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(HttpResponse::success(
                "report sent to emails successfully".into(),
            )),
        )
            .into_response(),
        Err(e) => {
            log::error!("Error sending emails to recipients: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::internal_server_error(e.to_string())),
            )
                .into_response()
        }
    }
}

/// Create the router for the report server
pub fn create_router() -> Router {
    Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/:org_id/reports/:name/send", put(send_report))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_http_response_internal_server_error_has_500_code() {
        let r = HttpResponse::internal_server_error("oops".to_string());
        assert_eq!(r.code, 500);
        assert_eq!(r.message, "oops");
        assert!(r.error_detail.is_none());
        assert!(r.trace_id.is_none());
    }

    #[test]
    fn test_http_response_success_has_200_code() {
        let r = HttpResponse::success("done".to_string());
        assert_eq!(r.code, 200);
        assert_eq!(r.message, "done");
        assert!(r.error_detail.is_none());
        assert!(r.trace_id.is_none());
    }

    #[test]
    fn test_http_response_optional_fields_absent_when_none() {
        let r = HttpResponse {
            code: 200,
            message: "ok".to_string(),
            error_detail: None,
            trace_id: None,
        };
        let json = serde_json::to_value(&r).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("error_detail"));
        assert!(!obj.contains_key("trace_id"));
    }

    #[test]
    fn test_http_response_optional_fields_present_when_some() {
        let r = HttpResponse {
            code: 500,
            message: "err".to_string(),
            error_detail: Some("detail".to_string()),
            trace_id: Some("tid".to_string()),
        };
        let json = serde_json::to_value(&r).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("error_detail"));
        assert!(obj.contains_key("trace_id"));
    }
}
