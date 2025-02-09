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
        // Create a new profiler guard just for this request
        let guard = pprof::ProfilerGuardBuilder::default()
            .frequency(1000)
            .blocklist(&["libc", "libgcc", "pthread", "vdso"])
            .build()
            .unwrap();
        
        // Sleep for the requested duration to collect profile data
        tokio::time::sleep(Duration::from_secs(seconds)).await;
        
        let report = guard.report().build().unwrap();
        let profile = report.pprof().unwrap();

        // Convert to protobuf format
        let mut protobuf = Vec::new();
        profile.encode(&mut protobuf).unwrap();
        
        HttpResponse::Ok()
            .content_type("application/x-protobuf")
            .body(protobuf)
    }
} 