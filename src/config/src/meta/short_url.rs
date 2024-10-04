use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
pub struct ShortenUrlRequest {
    pub original_url: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ShortenUrlResponse {
    pub short_url: String,
}
