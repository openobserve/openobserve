use opentelemetry::sdk::propagation::TraceContextPropagator;
use opentelemetry::trace::TraceError;
use opentelemetry::{global, sdk::trace as sdktrace};
use opentelemetry::{
    trace::{TraceContextExt, Tracer},
    Key,
};
use opentelemetry_otlp::WithExportConfig;
use std::collections::HashMap;
use std::error::Error;
use std::time::Duration;

/* fn _init_tracer() -> Result<sdktrace::Tracer, TraceError> {
    opentelemetry_jaeger::new_pipeline()
        .with_collector_endpoint("http://127.0.0.1:4317/v1/traces")
        .with_service_name("trace-http-demo")
        .install_batch(opentelemetry::runtime::TokioCurrentThread)
} */

fn init_tracer_otlp() -> Result<sdktrace::Tracer, TraceError> {
    let mut headers = HashMap::new();
    headers.insert(
        "Authorization".to_string(),
        "Basic YWRtaW46Q29tcGxleHBhc3MjMTIz".to_string(),
    );
    // Start a new jaeger trace pipeline
    global::set_text_map_propagator(TraceContextPropagator::new());

    let exporter = opentelemetry_otlp::new_exporter()
        .http()
        .with_headers(headers)
        .with_endpoint("http://localhost:5080/api/org1/traces");

    opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(exporter)
        .install_batch(opentelemetry::runtime::Tokio)
}

const LEMONS_KEY: Key = Key::from_static_str("ex.com/lemons");
const ANOTHER_KEY: Key = Key::from_static_str("ex.com/another");

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync + 'static>> {
    let _ = init_tracer_otlp()?;
    let tracer = global::tracer("ex.com/basic");
    tracer.in_span("operation", |cx| {
        let span = cx.span();
        println!("{:?}", span.span_context());
        span.add_event(
            "Nice operation!".to_string(),
            vec![Key::new("bogons").i64(100)],
        );
        span.add_event(
            "Nice operation!".to_string(),
            vec![Key::new("bogons").i64(100)],
        );
        span.set_attribute(ANOTHER_KEY.string("yes"));

        tracer.in_span("Sub operation...", |cx| {
            let span = cx.span();
            span.set_attribute(LEMONS_KEY.string("five"));

            span.add_event("Sub span event", vec![]);
        });
    });

    // wait for 1 minutes so that we could see metrics being pushed via OTLP every 10 seconds.
    tokio::time::sleep(Duration::from_secs(60)).await;
    global::shutdown_tracer_provider();

    Ok(())
}
