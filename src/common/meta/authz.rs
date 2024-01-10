use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct Authz {
    pub obj_id: String,
    pub parent_type: String,
    pub parent: String,
}
impl Authz {
    pub fn new(obj_id: &str) -> Authz {
        Authz {
            obj_id: obj_id.to_string(),
            ..Default::default()
        }
    }
}
