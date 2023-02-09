use utoipa::openapi::schema::{ObjectBuilder, Schema, SchemaType};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::openapi::{ArrayBuilder, RefOr};
use utoipa::{Modify, OpenApi};

use crate::handler::http::request;
use crate::meta;

#[derive(OpenApi)]
#[openapi(
    paths(
        request::stream::list,
        request::stream::schema,
        request::stream::settings,
        request::ingest::bulk,
        request::ingest::multi,
        request::ingest::json,
        request::search::search,
        request::search::around,
        request::users::list,
        request::users::save,
        request::users::delete,
        request::functions::list_functions,
        request::functions::save_function,
        request::functions::delete_function,
        request::functions::list_stream_function,
        request::functions::save_stream_function,
        request::functions::delete_stream_function,
    ),
    components(
        schemas(
            meta::http::HttpResponse,
            meta::StreamType,
            meta::stream::Stream,
            meta::stream::StreamStats,
            meta::stream::StreamProperty,
            meta::stream::StreamSettings,
            meta::stream::ListStream,
            meta::ingestion::RecordStatus,
            meta::ingestion::StreamStatus,
            meta::ingestion::IngestionResponse,
            meta::user::User,
            meta::user::UserRole,
            meta::user::UserList,
            meta::user::UserResponse,
            meta::functions::Transform,
            meta::functions::FunctionList,
            meta::search::Query,
            meta::search::Request,
            meta::search::Response,
        ),
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Stream"),
        (name = "Ingestion"),
        (name = "Search"),
        (name = "Functions"),
        (name = "Users"),
    ),
    info(
        description = "ZincObserve API documents [https://docs.zinc.dev/](https://docs.zinc.dev/)",
        contact(name = "ZincObserve", email = "hello@zinclabs.io", url = "https://zinc.dev/"),
    ),
)]
pub struct ApiDoc;

pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.as_mut().unwrap();
        components.add_security_scheme(
            "Authorization",
            SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Basic).build()),
        );
    }
}

pub struct ResponseAddon;

impl Modify for ResponseAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.as_mut().unwrap();
        //aggs
        let val = &mut components.schemas;

        let hist_array = Schema::Array(
            ArrayBuilder::new()
                .items(RefOr::T(Schema::Object(
                    ObjectBuilder::new()
                        .property("key", ObjectBuilder::new().schema_type(SchemaType::String))
                        .property("num", ObjectBuilder::new().schema_type(SchemaType::Integer))
                        .build(),
                )))
                .build(),
        );

        val.insert(
            "Aggregates".to_string(),
            utoipa::openapi::RefOr::T(Schema::from(
                ObjectBuilder::new().property("histogram", hist_array),
            )),
        );

        // let search_response = val.get("SearchResponse").unwrap();
        // let value_string = serde_json::to_string(&search_response).unwrap().to_string();
        // let new_str = value_string.replace(
        //     "\"aggs\":{\"$ref\":\"#/components/schemas/AHashMap\"",
        //     "\"aggs\":{\"$ref\":\"#/components/schemas/Aggregates\"",
        // );

        // println!("{}", new_str);

        // let search = utoipa::openapi::schema::RefOr::T(Schema::from
        // search_response. ("CheckingWhat", Ref::new("#/components/schemas/Aggregates"));
    }
}
