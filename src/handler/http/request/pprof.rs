use actix_web::{get, web, HttpResponse};
use pprof::protos::Message;
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct ProfileParams {
    seconds: Option<u64>,
}

pub mod ingest {
    use super::*;

    #[get("/report")]
    pub async fn log(params: web::Query<ProfileParams>) -> HttpResponse {
        let seconds = params.seconds.unwrap_or(10);
        
        // Create a new profiler guard and handle potential errors
        let guard = match pprof::ProfilerGuardBuilder::default()
            .frequency(1000)
            .blocklist(&["libc", "libgcc", "pthread", "vdso"])
            .build()
        {
            Ok(guard) => guard,
            Err(e) => {
                return HttpResponse::ServiceUnavailable()
                    .content_type("text/plain")
                    .body(format!("Failed to start profiler: {}. This usually means another profiling session is already running.", e));
            }
        };
        
        // Sleep for the requested duration to collect profile data
        tokio::time::sleep(Duration::from_secs(seconds)).await;
        
        // Get the report and handle potential errors
        let report = match guard.report().build() {
            Ok(report) => report,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .content_type("text/plain")
                    .body(format!("Failed to generate profile report: {}", e));
            }
        };

        let profile = match report.pprof() {
            Ok(profile) => profile,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .content_type("text/plain")
                    .body(format!("Failed to generate pprof profile: {}", e));
            }
        };

        // Convert to protobuf format
        let mut protobuf = Vec::new();
        if let Err(e) = profile.encode(&mut protobuf) {
            return HttpResponse::InternalServerError()
                .content_type("text/plain")
                .body(format!("Failed to encode profile: {}", e));
        }
        
        HttpResponse::Ok()
            .content_type("application/x-protobuf")
            .body(protobuf)
    }
} 