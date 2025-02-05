use async_trait::async_trait;

use super::{AuthorizationClientTrait, ObjectType};

/// Mock authorization client.
#[derive(Debug, Clone)]
pub struct MockAuthorizationClient {}

impl MockAuthorizationClient {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl AuthorizationClientTrait for MockAuthorizationClient {
    async fn set_ownership(&self, _org_id: &str, _obj_type: ObjectType, _obj_id: &str) {}

    async fn set_ownership_if_not_exists(
        &self,
        _org_id: &str,
        _obj_type: ObjectType,
        _obj_id: &str,
    ) -> bool {
        false
    }

    async fn set_parent(
        &self,
        _org_id: &str,
        _obj_type: ObjectType,
        _obj_id: &str,
        _parent_type: ObjectType,
        _parent_id: &str,
    ) {
    }

    async fn set_ownership_and_parent(
        &self,
        _org_id: &str,
        _obj_type: ObjectType,
        _obj_id: &str,
        _parent_type: ObjectType,
        _parent_id: &str,
    ) {
    }

    async fn remove_ownership(&self, _org_id: &str, _obj_type: ObjectType, _obj_id: &str) {}

    async fn remove_parent(
        &self,
        _org_id: &str,
        _obj_type: ObjectType,
        _obj_id: &str,
        _parent_type: ObjectType,
        _parent_id: &str,
    ) {
    }

    async fn remove_ownership_and_parent(
        &self,
        _org_id: &str,
        _obj_type: ObjectType,
        _obj_id: &str,
        _parent_type: ObjectType,
        _parent_id: &str,
    ) {
    }
}
