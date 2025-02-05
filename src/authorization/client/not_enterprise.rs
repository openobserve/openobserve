use async_trait::async_trait;

use super::{AuthorizationClientTrait, ObjectType};
use crate::common::meta::authz::Authz;

/// Client that performs no-op authorization checks.
#[derive(Debug, Clone)]
pub struct AuthorizationClient {}

impl AuthorizationClient {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl AuthorizationClientTrait for AuthorizationClient {
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
