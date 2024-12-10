use actix_web::HttpResponse;
use config::meta::stream::StreamType;

use crate::common::meta::{self, http::HttpResponse as MetaHttpResponse};

// Check permissions on stream
pub async fn check_stream_premissions(
    stream_name: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &StreamType,
) -> Option<HttpResponse> {
    use o2_enterprise::enterprise::openfga::meta::mapping::OFGA_MODELS;

    use crate::common::{
        infra::config::USERS,
        utils::auth::{is_root_user, AuthExtractor},
    };

    if !is_root_user(user_id) {
        let user: meta::user::User = USERS.get(&format!("{org_id}/{}", user_id)).unwrap().clone();
        let stream_type_str = stream_type.to_string();

        if user.is_external
            && !crate::handler::http::auth::validator::check_permissions(
                user_id,
                AuthExtractor {
                    auth: "".to_string(),
                    method: "GET".to_string(),
                    o2_type: format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(stream_type_str.as_str())
                            .map_or(stream_type_str.as_str(), |model| model.key),
                        stream_name
                    ),
                    org_id: org_id.to_string(),
                    bypass_check: false,
                    parent_id: "".to_string(),
                },
                Some(user.role),
            )
            .await
        {
            return Some(MetaHttpResponse::forbidden("Unauthorized Access"));
        }
    }
    None
}
