use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use opentelemetry_proto::{self, tonic::collector::trace::v1::ExportTraceServiceRequest};
use prost::Message;

#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[post("/echo")]
async fn echo(req_body: String) -> impl Responder {
    HttpResponse::Ok().body(req_body)
}

async fn manual_hello() -> impl Responder {
    HttpResponse::Ok().body("Hey there!")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .service(hello)
            .service(echo)
            .route("/hey", web::get().to(manual_hello))
            .service(web::resource("/v1/traces").to(trace))
    })
    .bind(("127.0.0.1", 4317))?
    .run()
    .await
}

async fn trace(body: actix_web::web::Bytes) -> String {
    let request = ExportTraceServiceRequest::decode(body).expect("Invalid protobuf");
    print!("{:?}", request);
    format!("Done")
}
