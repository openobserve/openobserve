use actix_web::{get, HttpResponse};
use pprof::protos::Message;
pub mod ingest {
    use super::*;

    #[get("/report")]
    pub async fn log() -> HttpResponse {
        // Get the report from the global profiler
        let guard = crate::PROFILER.lock();
        let report = guard.report().build().unwrap();
        
        // Convert to protobuf format
        let mut protobuf = Vec::new();
        let profile = report.pprof().unwrap();

        profile.encode(&mut protobuf).unwrap();
        
        HttpResponse::Ok()
            .content_type("application/x-protobuf")
            .body(protobuf)
    }
} 