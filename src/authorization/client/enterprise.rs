use async_trait::async_trait;
use o2_enterprise::enterprise::openfga::authorizer::OpenFgaConfig;

use super::{AuthorizationClientTrait, ObjectType};

/// Client for performing authorization checks using OpenFGA.
#[derive(Debug, Clone)]
pub struct AuthorizationClient {
    pub open_fga_config: OpenFgaConfig,
    pub open_fga_store_id: String,
    pub page_size: i32,
}

#[cfg(feature = "enterprise")]
impl AuthorizationClient {
    pub fn new() -> Self {
        todo!()
    }
}

#[async_trait]
impl AuthorizationClientTrait for AuthorizationClient {
    async fn set_ownership(&self, org_id: &str, obj_type: ObjectType, obj_id: &str) {
        crate::common::utils::auth::set_ownership(
            &self.open_fga_config,
            &self.open_fga_store_id,
            org_id,
            &obj_type.to_string(),
            &obj_id,
            "",
            "",
        )
        .await
    }

    async fn set_ownership_if_not_exists(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
    ) -> bool {
        o2_enterprise::enterprise::openfga::authorizer::authz::set_ownership_if_not_exists(
            &self.open_fga_config,
            &self.open_fga_store_id,
            org_id,
            &format!("{}:{}", obj_type, obj_id),
        )
        .await
    }

    async fn set_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    ) {
        todo!()
    }

    async fn set_ownership_and_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    ) {
        crate::common::utils::auth::set_ownership(
            &self.open_fga_config,
            &self.open_fga_store_id,
            org_id,
            &obj_type.to_string(),
            &obj_id,
            &parent_type.to_string(),
            parent_id,
        )
        .await
    }

    async fn remove_ownership(&self, org_id: &str, obj_type: ObjectType, obj_id: &str) {
        crate::common::utils::auth::remove_ownership(
            &self.open_fga_config,
            &self.open_fga_store_id,
            org_id,
            &obj_type.to_string(),
            &obj_id,
            "",
            "",
        )
        .await
    }

    async fn remove_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    ) {
        todo!()
    }

    async fn remove_ownership_and_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    ) {
        crate::common::utils::auth::remove_ownership(
            &self.open_fga_config,
            &self.open_fga_store_id,
            org_id,
            &obj_type.to_string(),
            &obj_id,
            &parent_type.to_string(),
            parent_id,
        )
        .await
    }
}
