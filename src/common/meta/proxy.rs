use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct QueryParamProxyURL {
    #[serde(alias = "proxy-token")]
    pub proxy_token: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PathParamProxyURL {
    pub target_url: String,
    pub org_id: String,
}
