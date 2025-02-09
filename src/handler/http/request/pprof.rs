use actix_web::{get, HttpResponse};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use pprof::{ProfilerGuard, protos::Message};

// Global profiler guard initialized once
pub static PROFILER: Lazy<Mutex<ProfilerGuard<'static>>> = Lazy::new(|| {
    Mutex::new(pprof::ProfilerGuardBuilder::default()
    .frequency(1000)
    .blocklist(&["libc", "libgcc", "pthread", "vdso"])
    .build()
    .unwrap())
});

pub mod ingest {
    use super::*;

    #[get("/report")]
    pub async fn log() -> HttpResponse {
        // Get the report from the global profiler
        let guard = PROFILER.lock();
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