use utoipa::OpenApi;
use zinc_oxide::handler::http::request::stream::*;
use zinc_oxide::meta::stream;
use zinc_oxide::meta::StreamType;

#[tokio::main]
async fn main() {
    #[derive(OpenApi)]
    #[openapi(
        paths(list_streams),
        components(schemas(
            stream::ListStream,
            stream::Stream,
            StreamType,
            stream::Stats,
            stream::StreamProperty,
        ))
    )]
    struct ApiDoc;

    println!("{}", ApiDoc::openapi().to_pretty_json().unwrap());
}
