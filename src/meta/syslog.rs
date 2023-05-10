use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyslogRoute {
    pub org_id: String,
    pub subnets: Vec<IpNetwork>,
    #[serde(default)]
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Routes {
    pub routes: Vec<SyslogRoute>,
}
